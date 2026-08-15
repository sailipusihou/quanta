'use strict';

// 跨平台实时价格：从 OpenRouter 公开 API 拉取各平台模型最新定价（USD/每百万 tokens），
// 从 DeepSeek 官方定价文档抓取 DeepSeek 价目并自动校验本地价目表，
// 统一换算为 CNY 并本地缓存（data/prices.json），刷新可强制更新。

const fs = require('fs');
const path = require('path');
const { requestJson } = require('./balance');
const { getDataDir } = require('./config');
const { FLAT_PRICES, OFFPEAK_PRICES, PEAK_PRICES } = require('./pricing');

const USD_RATE = 7.2;
const CACHE_TTL_MS = 6 * 3600 * 1000; // 缓存 6 小时
const API_URL = 'https://openrouter.ai/api/v1/models';
const DEEPSEEK_PRICE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing';

// 目标平台与代表性模型（OpenRouter id 前缀匹配）
const TARGET_PLATFORMS = [
  { key: 'deepseek', name: 'DeepSeek', prefix: 'deepseek/', wants: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4'] },
  { key: 'moonshot', name: '月之暗面', prefix: 'moonshotai/', wants: ['kimi-k2', 'kimi-k3'] },
  { key: 'zhipu', name: '智谱', prefix: ['zhipu/', 'z-ai/'], wants: ['glm-4-plus', 'glm-4-air'] },
  { key: 'openai', name: 'OpenAI', prefix: 'openai/', wants: ['gpt-4o', 'gpt-4o-mini'] },
  { key: 'anthropic', name: 'Anthropic', prefix: 'anthropic/', wants: ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4'] },
  { key: 'gemini', name: 'Gemini', prefix: 'google/', wants: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { key: 'groq', name: 'Groq', prefix: 'groq/', wants: ['llama-3.3-70b-versatile'] },
];

function inPrefixes(id, prefixes) {
  const lower = String(id).toLowerCase();
  return prefixes.some((p) => lower.startsWith(p));
}

// 从 OpenRouter 全量模型里挑出目标平台的代表性模型
function pickModels(all, platform) {
  const prefixes = Array.isArray(platform.prefix) ? platform.prefix : [platform.prefix];
  const picked = [];
  for (const want of platform.wants) {
    const m = all.find(
      (x) => inPrefixes(x.id, prefixes) && String(x.id).toLowerCase().includes(want.toLowerCase())
    );
    if (m && m.pricing) picked.push(m);
  }
  if (!picked.length) {
    const m = all.find((x) => inPrefixes(x.id, prefixes) && x.pricing);
    if (m) picked.push(m);
  }
  return picked.map((m) => ({
    platform: platform.name,
    model: String(m.id).split('/').pop(),
    inRate: Number(m.pricing.prompt || 0) * 1e6 * USD_RATE,
    outRate: Number(m.pricing.completion || 0) * 1e6 * USD_RATE,
  }));
}

// 从 DeepSeek 官方定价文档抓取价目（元/百万 tokens），与本地价目表比对。
// 返回 { matched: bool, official: {flash: {flat,offpeak,peak}, pro: {...}}, local: {...} }
async function fetchDeepSeekOfficialPrices() {
  const body = await requestText(DEEPSEEK_PRICE_URL, 20000);
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  // 提取 flash/pro 的峰谷价格：如 "deepseek-v4-flash 空闲时段 0.05元 1.5元 4.5元 高峰时段 0.10元 3.0元 9.0元"
  const parseModel = (name) => {
    const re = new RegExp(
      name + '\\s*空闲时段\\s*([\\d.]+)元\\s*([\\d.]+)元\\s*([\\d.]+)元\\s*高峰时段\\s*([\\d.]+)元\\s*([\\d.]+)元\\s*([\\d.]+)元'
    );
    const m = text.match(re);
    if (!m) return null;
    return {
      offpeak: [Number(m[1]), Number(m[2]), Number(m[3])],
      peak: [Number(m[4]), Number(m[5]), Number(m[6])],
    };
  };
  // 当前价（生效中）：如 "百万tokens输入（缓存命中） 0.02元 0.025元 ... 百万tokens输出 2元 6元"
  const parseFlat = () => {
    const hit = text.match(/百万tokens输入（缓存命中）\s*([\d.]+)元\s*([\d.]+)元/);
    const miss = text.match(/百万tokens输入（缓存未命中）\s*([\d.]+)元\s*([\d.]+)元/);
    const out = text.match(/百万tokens输出\s*([\d.]+)元\s*([\d.]+)元/);
    if (!hit || !miss || !out) return null;
    return {
      flash: [Number(hit[1]), Number(miss[1]), Number(out[1])],
      pro: [Number(hit[2]), Number(miss[2]), Number(out[2])],
    };
  };

  const flash = parseModel('deepseek-v4-flash');
  const pro = parseModel('deepseek-v4-pro');
  const flat = parseFlat();
  if (!flash || !pro) {
    return { ok: false, reason: '解析失败' };
  }

  const official = {
    flash: { flat: flat ? flat.flash : null, offpeak: flash.offpeak, peak: flash.peak },
    pro: { flat: flat ? flat.pro : null, offpeak: pro.offpeak, peak: pro.peak },
  };
  // 与本地价目表比对（命中/未命中/输出顺序一致）
  const local = {
    flash: { flat: [FLAT_PRICES['deepseek-v4-flash'].hit, FLAT_PRICES['deepseek-v4-flash'].miss, FLAT_PRICES['deepseek-v4-flash'].out], offpeak: [OFFPEAK_PRICES['deepseek-v4-flash'].hit, OFFPEAK_PRICES['deepseek-v4-flash'].miss, OFFPEAK_PRICES['deepseek-v4-flash'].out], peak: [PEAK_PRICES['deepseek-v4-flash'].hit, PEAK_PRICES['deepseek-v4-flash'].miss, PEAK_PRICES['deepseek-v4-flash'].out] },
    pro: { flat: [FLAT_PRICES['deepseek-v4-pro'].hit, FLAT_PRICES['deepseek-v4-pro'].miss, FLAT_PRICES['deepseek-v4-pro'].out], offpeak: [OFFPEAK_PRICES['deepseek-v4-pro'].hit, OFFPEAK_PRICES['deepseek-v4-pro'].miss, OFFPEAK_PRICES['deepseek-v4-pro'].out], peak: [PEAK_PRICES['deepseek-v4-pro'].hit, PEAK_PRICES['deepseek-v4-pro'].miss, PEAK_PRICES['deepseek-v4-pro'].out] },
  };
  const arrEq = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  const matched =
    arrEq(official.flash.offpeak, local.flash.offpeak) &&
    arrEq(official.flash.peak, local.flash.peak) &&
    arrEq(official.pro.offpeak, local.pro.offpeak) &&
    arrEq(official.pro.peak, local.pro.peak) &&
    (!official.flash.flat || arrEq(official.flash.flat, local.flash.flat)) &&
    (!official.pro.flat || arrEq(official.pro.flat, local.pro.flat));
  return { ok: true, matched, official, local };
}

function requestText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const doGet = (u, redirects) => {
      const req = lib.request(
        u,
        { method: 'GET', timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' } },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
            res.resume();
            return doGet(new URL(res.headers.location, u).href, redirects + 1);
          }
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => (res.statusCode >= 400 ? reject(new Error('HTTP ' + res.statusCode)) : resolve(body)));
        }
      );
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', reject);
      req.end();
    };
    doGet(url, 0);
  });
}

class PriceCache {
  constructor() {
    this.path = path.join(getDataDir(), 'prices.json');
    this.data = null;
    try {
      this.data = JSON.parse(fs.readFileSync(this.path, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      this.data = null;
    }
  }

  get() {
    return this.data;
  }

  set(patch) {
    this.data = { ...(this.data || {}), ...patch };
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      /* 忽略缓存写入失败 */
    }
  }
}

// 拉取官网最新价格；force=true 强制刷新
// 返回 { source: 'live'|'cache'|'fallback', fetchedAt, list, deepseek?, error? }
async function fetchLatestPrices(force = false) {
  const cache = new PriceCache();
  if (!force && cache.get() && cache.get().list && Date.now() - cache.get().fetchedAt < CACHE_TTL_MS) {
    return { source: 'cache', fetchedAt: cache.get().fetchedAt, list: cache.get().list, deepseek: cache.get().deepseek || null };
  }
  try {
    const { body } = await requestJson(API_URL, { apiKey: '', timeoutMs: 20000 });
    const all = Array.isArray(body.data) ? body.data : [];
    const list = [];
    for (const p of TARGET_PLATFORMS) {
      list.push(...pickModels(all, p));
    }
    const clean = list.filter((r) => r.inRate > 0 && r.model);
    if (!clean.length) {
      return { source: 'fallback', fetchedAt: Date.now(), list: [], error: '官网未返回可用价格' };
    }
    // 并行抓 DeepSeek 官方价目并校验本地表
    let deepseek = null;
    try {
      deepseek = await fetchDeepSeekOfficialPrices();
    } catch {
      deepseek = null;
    }
    cache.set({ fetchedAt: Date.now(), list: clean, deepseek });
    return { source: 'live', fetchedAt: Date.now(), list: clean, deepseek };
  } catch (err) {
    return {
      source: 'fallback',
      fetchedAt: Date.now(),
      list: cache.get() ? cache.get().list : [],
      deepseek: cache.get() ? cache.get().deepseek : null,
      error: err.message,
    };
  }
}

module.exports = { fetchLatestPrices, fetchDeepSeekOfficialPrices, requestText };
