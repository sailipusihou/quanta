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
