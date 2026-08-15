'use strict';

const http = require('http');
const https = require('https');
const { Transform } = require('stream');
const { StringDecoder } = require('string_decoder');
const { computeCost } = require('./pricing');

const SKIP_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'authorization',
  'accept-encoding',
  'transfer-encoding',
]);

function isChatPath(path) {
  return path.includes('/chat/completions') || path.includes('/messages');
}

function buildUpstreamUrl(reqUrl, upstreamBase) {
  const u = new URL(upstreamBase);
  const [pathPart, queryPart] = reqUrl.split('?');
  const basePath = u.pathname.replace(/\/+$/, '');
  const reqPath = pathPart.replace(/^\/+/, '');
  u.pathname = basePath + (basePath && reqPath ? '/' : '') + reqPath;
  if (queryPart !== undefined) u.search = queryPart;
  return u;
}

function prepareChatBody(rawBody) {
  if (!rawBody) return { body: rawBody, json: null };
  try {
    const j = JSON.parse(rawBody);
    if (j.stream && !(j.stream_options && j.stream_options.include_usage)) {
      j.stream_options = { ...(j.stream_options || {}), include_usage: true };
    }
    return { body: JSON.stringify(j), json: j };
  } catch {
    return { body: rawBody, json: null };
  }
}

function extractOpenAIUsage(body) {
  const u = body && body.usage;
  if (!u) return null;
  const promptTokens = Number(u.prompt_tokens) || 0;
  const completionTokens = Number(u.completion_tokens) || 0;
  let cacheHit = Number(u.prompt_cache_hit_tokens);
  if (!Number.isFinite(cacheHit) || cacheHit < 0) {
    cacheHit = Number(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
  }
  let cacheMiss = Number(u.prompt_cache_miss_tokens);
  if (!Number.isFinite(cacheMiss) || cacheMiss < 0) {
    cacheMiss = Math.max(promptTokens - cacheHit, 0);
  }
  return {
    promptTokens,
    completionTokens,
    cacheHit,
    cacheMiss,
    totalTokens: Number(u.total_tokens) || promptTokens + completionTokens,
  };
}

function extractAnthropicUsage(body) {
  const u = body && body.usage;
  if (!u) return null;
  const cacheHit = Number(u.cache_read_input_tokens) || 0;
  const cacheMiss = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
  const promptTokens = cacheHit + cacheMiss;
  const completionTokens = Number(u.output_tokens) || 0;
  return { promptTokens, completionTokens, cacheHit, cacheMiss, totalTokens: promptTokens + completionTokens };
}

function extractError(body) {
  if (!body) return null;
  if (body.error) {
    return typeof body.error === 'string' ? body.error : body.error.message || body.error.type || JSON.stringify(body.error);
  }
  return null;
}

function startProxy({ port, upstreamBase, apiKey, keyId = '', onRecord, tagRules = [], modelRoutes = [], failoverAccounts = [] }) {
  const compiledRules = tagRules
    .map((r) => {
      try {
        return { label: String(r.label || '').trim(), regex: new RegExp(String(r.pattern || ''), 'i') };
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.label && r.regex);

  // 自动省钱路由规则（请求模型匹配 -> 改写为 to）
  const compiledRoutes = modelRoutes
    .map((r) => {
      try {
        return { re: new RegExp(String(r.pattern || ''), 'i'), to: String(r.to || '').trim() };
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.to);

  function resolveTag(req) {
    const header = req.headers['x-token-tag'] || req.headers['x-tag'];
    if (header && String(header).trim()) return String(header).trim().slice(0, 40);
    const ua = String(req.headers['user-agent'] || '');
    for (const r of compiledRules) {
      if (r.regex.test(ua)) return r.label;
    }
    return 'default';
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res, { upstreamBase, apiKey, keyId, onRecord, resolveTag, compiledRoutes, failoverAccounts }).catch((err) => {
        onRecord(makeEntry(req, { status: 502 }, { keyId, error: err.message }, err, Date.now(), false));
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { message: `代理转发失败: ${err.message}` } }));
        } else {
          res.end();
        }
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, resolveTag }));
  });
}

// 主请求处理：自动省钱路由（改写模型） + 失败自动降级（多账户重试链）
async function handleRequest(req, res, { upstreamBase, apiKey, keyId, onRecord, resolveTag, compiledRoutes = [], failoverAccounts = [] }) {
  const startTs = Date.now();
  const rawBody = await collectBody(req);
  const tag = resolveTag(req);
  const isChat = isChatPath(req.url);
  let { body, json: bodyJson } = isChat ? prepareChatBody(rawBody) : { body: rawBody, json: null };
  // 自动省钱路由：改写请求模型
  let originalModel = null;
  if (isChat && bodyJson) {
    originalModel = bodyJson.model || null;
    const route = compiledRoutes.find((r) => originalModel && r.re.test(originalModel));
    if (route) {
      bodyJson.model = route.to;
      body = JSON.stringify(bodyJson);
    }
  }
  const routed = Boolean(originalModel && bodyJson && bodyJson.model !== originalModel);
  const isStream = Boolean(bodyJson && bodyJson.stream);

  // 降级链：主账户 + 备用账户（按账户顺序）
  const chain = [{ baseUrl: upstreamBase, apiKey, keyId, label: '主' }, ...failoverAccounts];
  let lastError = null;
  let failoverUsed = false;
  for (let i = 0; i < chain.length; i++) {
    const target = chain[i];
    const outcome = await tryForward(req, res, {
      body,
      bodyJson,
      isChat,
      isStream,
      startTs,
      tag,
      onRecord,
      target,
      originalModel,
      routed,
      failover: i > 0,
      canFailover: i < chain.length - 1,
    });
    if (outcome.done) return;
    lastError = outcome.error;
    if (i === 0) failoverUsed = true;
  }
  // 全部上游失败
  onRecord(
    makeEntry(
      req,
      { status: 502 },
      { keyId, tag, originalModel, routed, failover: failoverUsed, error: lastError ? lastError.message : '全部上游不可用' },
      lastError,
      Date.now() - startTs,
      false
    )
  );
  if (!res.headersSent) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: `代理转发失败: ${lastError ? lastError.message : '全部上游不可用'}` } }));
  } else {
    res.end();
  }
}

// 单次上游尝试：可降级且失败（429/5xx/断连）时返回 {done:false} 继续下一家；
// 否则正常处理响应（流式/缓冲）返回 {done:true}
function tryForward(req, res, { body, bodyJson, isChat, isStream, startTs, tag, onRecord, target, originalModel, routed, failover, canFailover }) {
  return new Promise((resolve) => {
    let settled = false;
    const upstreamUrl = buildUpstreamUrl(req.url, target.baseUrl);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (SKIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
      headers[k] = v;
    }
    headers.Host = upstreamUrl.host;
    headers.Authorization = `Bearer ${target.apiKey}`;
    headers['Content-Length'] = Buffer.byteLength(body || '');
    if (body) headers['Content-Type'] = req.headers['content-type'] || 'application/json';

    const lib = upstreamUrl.protocol === 'https:' ? https : http;
    const outReq = lib.request(upstreamUrl, { method: req.method, headers }, (upRes) => {
      const retryable = upRes.statusCode === 429 || upRes.statusCode >= 500;
      if (retryable && canFailover) {
        upRes.resume(); // 丢弃该响应
        settled = true;
        return resolve({ done: false, retryable: true, error: new Error(`上游返回 ${upRes.statusCode}`) });
      }
      settled = true;
      const meta = { startTs, tag, onRecord, keyId: target.keyId, originalModel, routed, failover };
      if (isChat && isStream) {
        handleStreamResponse(req, res, upRes, meta);
      } else {
        handleBufferedResponse(req, res, upRes, meta);
      }
      resolve({ done: true });
    });

    outReq.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (canFailover) {
        return resolve({ done: false, retryable: true, error: err });
      }
      onRecord(
        makeEntry(
          req,
          { status: 0 },
          { keyId: target.keyId, tag, originalModel, routed, failover, error: err.message },
          err,
          Date.now() - startTs,
          false
        )
      );
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: `连接上游失败: ${err.message}` } }));
      } else {
        res.end();
      }
      resolve({ done: true });
    });

    if (body) outReq.write(body);
    outReq.end();
  });
}

function handleStreamResponse(req, res, upRes, { startTs, bodyJson, onRecord, tag, keyId, originalModel, routed, failover }) {
  let usage = null;
  let model = (bodyJson && bodyJson.model) || null;
  let usageRecorded = false;
  let error = null;

  const respondHeaders = { ...upRes.headers };
  delete respondHeaders['content-length'];
  delete respondHeaders['transfer-encoding'];
  delete respondHeaders.connection;
  res.writeHead(upRes.statusCode || 200, respondHeaders);

  const decoder = new StringDecoder('utf8');
  let buf = '';

  const recordIfUsage = (json) => {
    if (json.model && !model) model = json.model;
    if (json.usage && !usageRecorded) {
      usage = extractOpenAIUsage(json);
      usageRecorded = true;
    }
  };

  const finalize = () => {
    if (!usageRecorded) {
      if (upRes.statusCode >= 400) error = `上游返回 ${upRes.statusCode}`;
      usage = usage || { promptTokens: 0, completionTokens: 0, cacheHit: 0, cacheMiss: 0, totalTokens: 0 };
    }
  const cost = computeCost(model, usage, Date.now());
    onRecord(
      makeEntry(req, { status: upRes.statusCode || 200 }, { model, usage, cost, error, tag, keyId, originalModel, routed, failover }, null, Date.now() - startTs, true)
    );
  };

  const transform = new Transform({
    transform(chunk, _enc, done) {
      buf += decoder.write(chunk);
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          if (payload && payload !== '[DONE]') {
            try {
              recordIfUsage(JSON.parse(payload));
            } catch {
              /* 忽略无法解析的行 */
            }
          }
        }
      }
      this.push(chunk);
      done();
    },
    flush(done) {
      buf += decoder.end();
      if (buf.trim()) {
        try {
          recordIfUsage(JSON.parse(buf.replace(/^data:\s*/i, '').trim()));
        } catch {
          /* 忽略 */
        }
      }
      finalize();
      done();
    },
  });

  upRes.pipe(transform).pipe(res);
}

function handleBufferedResponse(req, res, upRes, { startTs, bodyJson, onRecord, tag, keyId, originalModel, routed, failover }) {
  const chunks = [];
  upRes.on('data', (c) => chunks.push(c));
  upRes.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    if (isChatPath(req.url)) {
      let usage = null;
      let model = (bodyJson && bodyJson.model) || null;
      if (json && json.model) model = json.model;
      usage = req.url.includes('/messages') ? extractAnthropicUsage(json) : extractOpenAIUsage(json);
      const error = extractError(json);
      const cost = computeCost(model, usage, Date.now());
      onRecord(
        makeEntry(req, { status: upRes.statusCode || 200 }, { model, usage, cost, error, tag, keyId, originalModel, routed, failover }, null, Date.now() - startTs, false)
      );
    }
    const respondHeaders = { ...upRes.headers };
    delete respondHeaders.connection;
    delete respondHeaders['transfer-encoding'];
    res.writeHead(upRes.statusCode || 200, respondHeaders);
    res.end(body);
  });
  upRes.on('error', (err) => {
    onRecord(makeEntry(req, { status: 0 }, { keyId }, err, Date.now() - startTs, false));
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: `上游中断: ${err.message}` } }));
    } else {
      res.end();
    }
  });
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function makeEntry(req, resInfo, extra, err, ms, stream) {
  const e = extra || {};
  const status = resInfo.status || 200;
  const usage = e.usage || { promptTokens: 0, completionTokens: 0, cacheHit: 0, cacheMiss: 0, totalTokens: 0 };
  return {
    ts: Date.now(),
    method: req.method,
    path: req.url.split('?')[0],
    status,
    ms,
    stream: Boolean(stream),
    model: e.model || null,
    originalModel: e.originalModel || null,
    routed: Boolean(e.routed),
    failover: Boolean(e.failover),
    tag: e.tag || null,
    keyId: e.keyId || null,
    usage,
    cost: e.cost ? e.cost.amount : 0,
    costRates: e.cost ? e.cost.rates : null,
    error: e.error || (err ? err.message : null),
  };
}

module.exports = {
  startProxy,
  buildUpstreamUrl,
  extractOpenAIUsage,
  extractAnthropicUsage,
  prepareChatBody,
};
