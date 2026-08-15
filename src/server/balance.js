'use strict';

const http = require('http');
const https = require('https');

function requestJson(url, { apiKey, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'Quanta/0.1.0 (desktop app)',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const req = lib.request(
      u,
      {
        method: 'GET',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          }
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            reject(new Error(`响应不是合法 JSON: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

function getPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split(/\.|\[|\]/).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

async function fetchBalance(account, apiKeyOverride) {
  const base = String(account.baseUrl || '').replace(/\/+$/, '');
  const url = String(account.balanceUrl || '{base}/user/balance').replace('{base}', base);
  if (!url.startsWith('http')) {
    throw new Error('未配置余额接口 URL');
  }
  const apiKey = apiKeyOverride || account.apiKey;
  const { body } = await requestJson(url, { apiKey });
  const totalBalance = Number(getPath(body, account.balanceJsonPath));
  return {
    ok: true,
    currency: account.currency || 'CNY',
    isAvailable: body.is_available !== false,
    totalBalance: Number.isFinite(totalBalance) ? totalBalance : 0,
    grantedBalance: Number(getPath(body, 'balance_infos[0].granted_balance')) || 0,
    toppedUpBalance: Number(getPath(body, 'balance_infos[0].topped_up_balance')) || 0,
    fetchedAt: Date.now(),
  };
}

// 从官网拉取该账号可用的模型列表（OpenAI 兼容 /models 接口，官方排序通常最新在前）
async function fetchModels(account, apiKeyOverride) {
  const base = String(account.baseUrl || '').replace(/\/+$/, '');
  const url = base + '/models';
  const apiKey = apiKeyOverride || account.apiKey;
  const { body } = await requestJson(url, { apiKey });
  const list = Array.isArray(body.data) ? body.data.map((m) => m && m.id).filter(Boolean) : [];
  return list;
}

// ===== DeepSeek 官网消费总结（需平台登录 userToken，私有接口）=====
// 端点：/api/v0/usage/cost 与 /api/v0/usage/amount（按月查询，响应含按天明细 days）
// 实测结构：biz_data[0] = { total: [{model, usage:[{type,amount}]}], days: [{date, data:[...]}] }
// 「今日」用控制台用量页同款端点 /usage/by_api_key/{cost,amount}?start=&end=&tz=（时区感知、小时级）
const DS_USAGE_BASE = 'https://platform.deepseek.com/api/v0/usage';

// 计算某时区（秒，默认 GMT+8=28800）下「今日 00:00 → 明日 00:00」的 unix 秒区间
function dayBoundsInTz(tzSec = 28800) {
  const nowMs = Date.now();
  const shifted = new Date(nowMs + tzSec * 1000);
  const startMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 0, 0, 0) - tzSec * 1000;
  return { startSec: Math.floor(startMs / 1000), endSec: Math.floor((startMs + 86400000) / 1000), tzSec };
}

// cost 响应：biz_data = { data: [{currency, series:[{api_key, model, buckets:[{time, cost}]}]}] }
function sumCostSeries(biz) {
  let tot = 0;
  const list = Array.isArray(biz.data) ? biz.data : Array.isArray(biz.series) ? biz.series : [];
  for (const group of list) {
    const series = Array.isArray(group.series) ? group.series : [group];
    for (const s of series) {
      for (const bk of s.buckets || []) tot += Number(bk.cost) || 0;
    }
  }
  return tot;
}

// amount 响应：biz_data = { series: [{api_key, model, buckets:[{time, usage:{...}}]}] }
function sumAmountSeries(biz) {
  let tok = 0;
  let req = 0;
  const list = Array.isArray(biz.series) ? biz.series : Array.isArray(biz.data) ? biz.data : [];
  for (const group of list) {
    const series = Array.isArray(group.series) ? group.series : [group];
    for (const s of series) {
      for (const bk of s.buckets || []) {
        const u = bk.usage || {};
        tok += (Number(u.PROMPT_CACHE_HIT_TOKEN) || 0) + (Number(u.PROMPT_CACHE_MISS_TOKEN) || 0) + (Number(u.RESPONSE_TOKEN) || 0);
        req += Number(u.REQUEST) || 0;
      }
    }
  }
  return { tokens: tok, requests: req };
}

// 拉取官网控制台「今日」数据（GMT+8 自然日、小时级聚合，与控制台用量页完全一致）
// 返回 { ok, cost, tokens, requests, bucket, byModel, hours, startSec, endSec, fetchedAt, error }
async function fetchDeepSeekTodayUsage(token, { tzSec = 28800 } = {}) {
  const { startSec, endSec } = dayBoundsInTz(tzSec);
  const out = {
    ok: false, cost: null, tokens: null, requests: null, bucket: null,
    byModel: [], hours: [], startSec, endSec, fetchedAt: Date.now(), error: null,
  };
  try {
    const [costResp, amountResp] = await Promise.all([
      requestJson(`${DS_USAGE_BASE}/by_api_key/cost?start=${startSec}&end=${endSec}&tz=${tzSec}`, { apiKey: token, timeoutMs: 15000 }).catch((e) => ({ error: e.message })),
      requestJson(`${DS_USAGE_BASE}/by_api_key/amount?start=${startSec}&end=${endSec}&tz=${tzSec}`, { apiKey: token, timeoutMs: 15000 }).catch((e) => ({ error: e.message })),
    ]);
    const costBiz = costResp.error ? null : (costResp.body?.data?.biz_data || null);
    const amountBiz = amountResp.error ? null : (amountResp.body?.data?.biz_data || null);
    const modelMap = new Map(); // model -> { cost, tokens, requests }
    const hourMap = new Map(); // 小时桶 time(秒) -> cost（widget 迷你趋势线用）
    if (costBiz) {
      out.bucket = costBiz.bucket != null ? costBiz.bucket : out.bucket;
      const list = Array.isArray(costBiz.data) ? costBiz.data : Array.isArray(costBiz.series) ? costBiz.series : [];
      for (const group of list) {
        const series = Array.isArray(group.series) ? group.series : [group];
        for (const s of series) {
          const mv = modelMap.get(s.model) || { cost: 0, tokens: 0, requests: 0 };
          for (const bk of s.buckets || []) {
            const c = Number(bk.cost) || 0;
            mv.cost += c;
            hourMap.set(bk.time, (hourMap.get(bk.time) || 0) + c);
          }
          modelMap.set(s.model, mv);
        }
      }
    }
    if (amountBiz) {
      if (out.bucket == null) out.bucket = amountBiz.bucket;
      const list = Array.isArray(amountBiz.series) ? amountBiz.series : Array.isArray(amountBiz.data) ? amountBiz.data : [];
      for (const group of list) {
        const series = Array.isArray(group.series) ? group.series : [group];
        for (const s of series) {
          const mv = modelMap.get(s.model) || { cost: 0, tokens: 0, requests: 0 };
          for (const bk of s.buckets || []) {
            const u = bk.usage || {};
            mv.tokens += (Number(u.PROMPT_CACHE_HIT_TOKEN) || 0) + (Number(u.PROMPT_CACHE_MISS_TOKEN) || 0) + (Number(u.RESPONSE_TOKEN) || 0);
            mv.requests += Number(u.REQUEST) || 0;
          }
          modelMap.set(s.model, mv);
        }
      }
    }
    out.byModel = [...modelMap.entries()]
      .map(([model, v]) => ({ model, cost: v.cost, tokens: v.tokens, requests: v.requests }))
      .filter((m) => m.cost > 0 || m.tokens > 0)
      .sort((a, b) => b.cost - a.cost);
    out.cost = 0;
    out.tokens = 0;
    out.requests = 0;
    for (const v of modelMap.values()) {
      out.cost += v.cost;
      out.tokens += v.tokens;
      out.requests += v.requests;
    }
    out.hours = [...hourMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, cost]) => ({ start: time * 1000, cost }));
    out.ok = out.cost != null || out.tokens != null;
    if (costResp.error) out.error = (out.error ? out.error + '; ' : '') + 'cost: ' + costResp.error;
    if (amountResp.error) out.error = (out.error ? out.error + '; ' : '') + 'amount: ' + amountResp.error;
    if (!out.ok && !out.error) out.error = '接口响应结构异常';
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

// 拉取官网控制台近 N 天消耗趋势（与控制台 30 天趋势图同源；天级桶）
// 返回 { ok, bucket, days: [{start, end, cost, tokens, requests}], fetchedAt, error }
async function fetchDeepSeekTrendUsage(token, { days = 30, tzSec = 28800 } = {}) {
  const { startSec, endSec } = dayBoundsInTz(tzSec); // endSec = 明日 00:00（GMT+8）
  const rangeStart = startSec - (days - 1) * 86400;
  const out = { ok: false, bucket: null, days: [], fetchedAt: Date.now(), error: null };
  try {
    const [costResp, amountResp] = await Promise.all([
      requestJson(`${DS_USAGE_BASE}/by_api_key/cost?start=${rangeStart}&end=${endSec}&tz=${tzSec}`, { apiKey: token, timeoutMs: 15000 }).catch((e) => ({ error: e.message })),
      requestJson(`${DS_USAGE_BASE}/by_api_key/amount?start=${rangeStart}&end=${endSec}&tz=${tzSec}`, { apiKey: token, timeoutMs: 15000 }).catch((e) => ({ error: e.message })),
    ]);
    const costBiz = costResp.error ? null : (costResp.body?.data?.biz_data || null);
    const amountBiz = amountResp.error ? null : (amountResp.body?.data?.biz_data || null);
    const map = new Map(); // time(秒) -> { cost, tokens, requests }
    if (costBiz) {
      out.bucket = costBiz.bucket != null ? costBiz.bucket : out.bucket;
      const list = Array.isArray(costBiz.data) ? costBiz.data : Array.isArray(costBiz.series) ? costBiz.series : [];
      for (const group of list) {
        const series = Array.isArray(group.series) ? group.series : [group];
        for (const s of series) {
          for (const bk of s.buckets || []) {
            const v = map.get(bk.time) || { cost: 0, tokens: 0, requests: 0 };
            v.cost += Number(bk.cost) || 0;
            map.set(bk.time, v);
          }
        }
      }
    }
    if (amountBiz) {
      if (out.bucket == null) out.bucket = amountBiz.bucket;
      const list = Array.isArray(amountBiz.series) ? amountBiz.series : Array.isArray(amountBiz.data) ? amountBiz.data : [];
      for (const group of list) {
        const series = Array.isArray(group.series) ? group.series : [group];
        for (const s of series) {
          for (const bk of s.buckets || []) {
            const u = bk.usage || {};
            const v = map.get(bk.time) || { cost: 0, tokens: 0, requests: 0 };
            v.tokens += (Number(u.PROMPT_CACHE_HIT_TOKEN) || 0) + (Number(u.PROMPT_CACHE_MISS_TOKEN) || 0) + (Number(u.RESPONSE_TOKEN) || 0);
            v.requests += Number(u.REQUEST) || 0;
            map.set(bk.time, v);
          }
        }
      }
    }
    const bucketSec = out.bucket || 86400;
    out.days = [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, v]) => ({ start: time * 1000, end: (time + bucketSec) * 1000, cost: v.cost, tokens: v.tokens, requests: v.requests }));
    out.ok = out.days.length > 0;
    if (costResp.error) out.error = (out.error ? out.error + '; ' : '') + 'cost: ' + costResp.error;
    if (amountResp.error) out.error = (out.error ? out.error + '; ' : '') + 'amount: ' + amountResp.error;
    if (!out.ok && !out.error) out.error = '接口响应结构异常';
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

module.exports = { fetchBalance, fetchModels, fetchDeepSeekOfficialUsage, fetchDeepSeekTodayUsage, fetchDeepSeekTrendUsage, requestJson, getPath };

// 汇总 usage 列表金额/token（type: PROMPT_CACHE_HIT_TOKEN / PROMPT_CACHE_MISS_TOKEN /
// RESPONSE_TOKEN / PROMPT_TOKEN / REQUEST）
function sumUsage(list) {
  let s = 0;
  for (const m of list || []) {
    for (const u of m.usage || []) {
      s += Number(u.amount) || 0;
    }
  }
  return s;
}

function dayValue(days, todayStr, typeOnly) {
  const day = (days || []).find((d) => d && d.date === todayStr);
  if (!day) return null;
  if (typeOnly) {
    let s = 0;
    for (const m of day.data || []) {
      for (const u of m.usage || []) {
        if (u.type === typeOnly) s += Number(u.amount) || 0;
      }
    }
    return s;
  }
  return sumUsage(day.data);
}

// 拉取官网消费总结（本月 + 今日）
// 返回 { ok, month, year, cost, tokens, requests, todayCost, todayTokens, todayRequests, raw, error }
async function fetchDeepSeekOfficialUsage(token, { month, year } = {}) {
  const now = new Date();
  const m = month != null ? month : now.getMonth() + 1;
  const y = year != null ? year : now.getFullYear();
  const todayStr =
    now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const out = { ok: false, month: m, year: y, cost: null, tokens: null, requests: null, todayCost: null, todayTokens: null, todayRequests: null, raw: null, error: null };
  try {
    const [costResp, amountResp] = await Promise.all([
      requestJson(`${DS_USAGE_BASE}/cost?month=${m}&year=${y}`, { apiKey: token, timeoutMs: 15000 }).catch((e) => ({ error: e.message })),
      requestJson(`${DS_USAGE_BASE}/amount?month=${m}&year=${y}`, { apiKey: token, timeoutMs: 15000 }).catch((e) => ({ error: e.message })),
    ]);
    const costEntry = costResp.error ? null : (Array.isArray(costResp.body?.data?.biz_data) ? costResp.body.data.biz_data[0] : costResp.body?.data?.biz_data || null);
    const amountEntry = amountResp.error ? null : (Array.isArray(amountResp.body?.data?.biz_data) ? amountResp.body.data.biz_data[0] : amountResp.body?.data?.biz_data || null);
    if (costEntry) {
      out.cost = sumUsage(costEntry.total);
      out.todayCost = dayValue(costEntry.days, todayStr);
    }
    if (amountEntry) {
      out.tokens = sumUsage(amountEntry.total);
      out.todayTokens = dayValue(amountEntry.days, todayStr);
      out.requests = dayValue(amountEntry.days, null, 'REQUEST') || dayValue(amountEntry.days, todayStr, 'REQUEST');
      // 本月请求数 = total 中 REQUEST 类型之和
      let reqSum = 0;
      for (const mm of amountEntry.total || []) {
        for (const u of mm.usage || []) if (u.type === 'REQUEST') reqSum += Number(u.amount) || 0;
      }
      if (reqSum > 0) out.requests = reqSum;
      if (out.todayRequests == null) out.todayRequests = dayValue(amountEntry.days, todayStr, 'REQUEST');
    }
    out.raw = JSON.stringify({
      cost: costEntry ? { total: costEntry.total, days: (costEntry.days || []).slice(0, 2) } : null,
      amount: amountEntry ? { total: amountEntry.total, days: (amountEntry.days || []).slice(0, 2) } : null,
    }).slice(0, 800);
    out.ok = out.cost != null || out.tokens != null;
    if (costResp.error) out.error = (out.error ? out.error + '; ' : '') + 'cost: ' + costResp.error;
    if (amountResp.error) out.error = (out.error ? out.error + '; ' : '') + 'amount: ' + amountResp.error;
    if (!out.ok && !out.error) out.error = '接口响应结构异常';
  } catch (err) {
    out.error = err.message;
  }
  return out;
}
