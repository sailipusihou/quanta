'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startProxy } = require('../src/server/proxy');

function startMockUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function post(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
  });
}

function waitForEvent(target, name) {
  return new Promise((resolve) => target.once(name, resolve));
}

test('非流式转发：解析 usage 并记录费用', async () => {
  let upstreamBody = null;
  const mock = await startMockUpstream((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      upstreamBody = body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'x',
          model: 'deepseek-v4-flash',
          choices: [{ message: { role: 'assistant', content: 'hi' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_cache_hit_tokens: 40,
            prompt_cache_miss_tokens: 60,
          },
        })
      );
    });
  });

  const records = [];
  const { server, port } = await startProxy({
    port: 0,
    upstreamBase: `http://127.0.0.1:${mock.address().port}`,
    apiKey: 'sk-test',
    onRecord: (e) => records.push(e),
  });

  const res = await post(port, '/v1/chat/completions', {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'hi' }],
  });

  assert.equal(res.status, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.usage.total_tokens, 120);
  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.usage.totalTokens, 120);
  assert.equal(rec.usage.cacheHit, 40);
  assert.equal(rec.usage.cacheMiss, 60);
  // 40 hit*0.02 + 60 miss*1 + 20 out*2（元/百万）＝ 0.0001008
  assert.ok(Math.abs(rec.cost - 0.0001008) < 1e-12);
  assert.equal(rec.status, 200);
  assert.equal(JSON.parse(upstreamBody).model, 'deepseek-v4-flash');

  server.close();
  mock.close();
});

test('流式转发：注入 include_usage、透传 chunk 并记录用量', async () => {
  let upstreamBody = null;
  const mock = await startMockUpstream((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      upstreamBody = body;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"id":"1","model":"deepseek-v4-pro","choices":[{"delta":{"content":"你"}}]}\n\n');
      res.write('data: {"id":"1","model":"deepseek-v4-pro","choices":[{"delta":{"content":"好"}}]}\n\n');
      res.write('data: {"id":"1","model":"deepseek-v4-pro","choices":[],"usage":{"prompt_tokens":50,"completion_tokens":8,"total_tokens":58,"prompt_cache_hit_tokens":10,"prompt_cache_miss_tokens":40}}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  const records = [];
  const { server, port } = await startProxy({
    port: 0,
    upstreamBase: `http://127.0.0.1:${mock.address().port}`,
    apiKey: 'sk-test',
    onRecord: (e) => records.push(e),
  });

  const res = await post(port, '/chat/completions', {
    model: 'deepseek-v4-pro',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  });

  assert.equal(res.status, 200);
  assert.ok(res.body.includes('data: [DONE]'));
  assert.ok(res.body.includes('你'));
  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.stream, true);
  assert.equal(rec.usage.totalTokens, 58);
  assert.equal(rec.usage.cacheHit, 10);
  assert.equal(rec.usage.cacheMiss, 40);
  assert.equal(rec.model, 'deepseek-v4-pro');
  const sent = JSON.parse(upstreamBody);
  assert.equal(sent.stream_options.include_usage, true);

  server.close();
  mock.close();
});

test('上游 4xx 错误也会被记录', async () => {
  const mock = await startMockUpstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '余额不足' } }));
    });
  });

  const records = [];
  const { server, port } = await startProxy({
    port: 0,
    upstreamBase: `http://127.0.0.1:${mock.address().port}`,
    apiKey: 'sk-test',
    onRecord: (e) => records.push(e),
  });

  const res = await post(port, '/v1/chat/completions', {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(res.status, 402);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 402);
  assert.equal(records[0].error, '余额不足');

  server.close();
  mock.close();
});

test('非对话路径（/models）正常转发且不产生消耗记录', async () => {
  const mock = await startMockUpstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }));
    });
  });

  const records = [];
  const { server, port } = await startProxy({
    port: 0,
    upstreamBase: `http://127.0.0.1:${mock.address().port}`,
    apiKey: 'sk-test',
    onRecord: (e) => records.push(e),
  });

  const res = await get(port, '/models');
  assert.equal(res.status, 200);
  assert.ok(JSON.parse(res.body).data[0].id === 'deepseek-v4-flash');
  assert.equal(records.length, 0);

  server.close();
  mock.close();
});

test('请求标签：请求头优先，其次按 User-Agent 规则匹配', async () => {
  const mock = await startMockUpstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'deepseek-v4-flash',
          choices: [],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        })
      );
    });
  });

  const records = [];
  const { server, port } = await startProxy({
    port: 0,
    upstreamBase: `http://127.0.0.1:${mock.address().port}`,
    apiKey: 'sk-test',
    tagRules: [
      { pattern: 'claude', label: 'CLI' },
      { pattern: 'chatbox', label: 'ChatBox' },
    ],
    onRecord: (e) => records.push(e),
  });

  await post(
    port,
    '/chat/completions',
    { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }] },
    { 'user-agent': 'Claude-CLI/1.2.3' }
  );
  await post(
    port,
    '/chat/completions',
    { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }] },
    { 'user-agent': 'ChatBox/0.9', 'x-token-tag': 'my-project' }
  );
  await post(
    port,
    '/chat/completions',
    { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }] },
    { 'user-agent': 'curl/8.0' }
  );

  assert.deepEqual(
    records.map((r) => r.tag),
    ['CLI', 'my-project', 'default']
  );

  server.close();
  mock.close();
});
