'use strict';

// DeepSeek 官方价格（元 / 百万 tokens），来源：api-docs.deepseek.com/zh-cn/quick_start/pricing
// 2026-08-17 00:00（北京时间）起生效峰谷定价；高峰 9-12、14-18 点，其余为空闲时段。
const NEW_PRICES_EFFECTIVE_AT = Date.parse('2026-08-17T00:00:00+08:00');

const FLAT_PRICES = {
  'deepseek-v4-flash': { hit: 0.02, miss: 1.0, out: 2.0 },
  'deepseek-v4-pro': { hit: 0.025, miss: 3.0, out: 6.0 },
  // 旧模型/思考模式：deepseek-chat 与 flash 同价；reasoner 与 pro 同价（官网同系列价）
  'deepseek-chat': { hit: 0.02, miss: 1.0, out: 2.0 },
  'deepseek-reasoner': { hit: 0.025, miss: 3.0, out: 6.0 },
};

const OFFPEAK_PRICES = {
  'deepseek-v4-flash': { hit: 0.05, miss: 1.5, out: 4.5 },
  'deepseek-v4-pro': { hit: 0.15, miss: 4.5, out: 13.5 },
  'deepseek-chat': { hit: 0.05, miss: 1.5, out: 4.5 },
  'deepseek-reasoner': { hit: 0.15, miss: 4.5, out: 13.5 },
};

const PEAK_PRICES = {
  'deepseek-v4-flash': { hit: 0.10, miss: 3.0, out: 9.0 },
  'deepseek-v4-pro': { hit: 0.30, miss: 9.0, out: 27.0 },
  'deepseek-chat': { hit: 0.10, miss: 3.0, out: 9.0 },
  'deepseek-reasoner': { hit: 0.30, miss: 9.0, out: 27.0 },
};

function beijingHour(ts) {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts));
  return Number(h);
}

function isPeakHour(ts) {
  const h = beijingHour(ts);
  return (h >= 9 && h < 12) || (h >= 14 && h < 18);
}

function modelRates(model) {
  return (
    FLAT_PRICES[model] ||
    OFFPEAK_PRICES[model] ||
    PEAK_PRICES[model] || { hit: 0.15, miss: 4.5, out: 13.5 }
  );
}

// 官网价目（来自 DeepSeek 官方定价文档，启动时注入；{model: {flat, offpeak, peak}}）
let officialRates = null;

function setOfficialRates(map) {
  officialRates = map;
}

function officialRatesFor(model) {
  if (!officialRates || !officialRates[model]) return null;
  return officialRates[model];
}

// 返回 { hit, miss, out, period, known }
function rateFor(model, ts = Date.now()) {
  const effectiveNew = ts >= NEW_PRICES_EFFECTIVE_AT;
  const known = Boolean(FLAT_PRICES[model] || OFFPEAK_PRICES[model]);
  const o = officialRatesFor(model);
  if (!effectiveNew) {
    const r =
      o && o.flat ? { hit: o.flat[0], miss: o.flat[1], out: o.flat[2] } : modelRates(model);
    return { ...r, period: 'flat', known };
  }
  if (isPeakHour(ts)) {
    const r =
      o && o.peak
        ? { hit: o.peak[0], miss: o.peak[1], out: o.peak[2] }
        : PEAK_PRICES[model] || modelRates(model);
    return { ...r, period: 'peak', known };
  }
  const r =
    o && o.offpeak
      ? { hit: o.offpeak[0], miss: o.offpeak[1], out: o.offpeak[2] }
      : OFFPEAK_PRICES[model] || modelRates(model);
  return { ...r, period: 'offpeak', known };
}

// usage: { cacheHit, cacheMiss, completion }（token 数）
function computeCost(model, usage, ts = Date.now()) {
  const rates = rateFor(model, ts);
  const u = usage || {};
  const hit = Number(u.cacheHit ?? u.promptCacheHit) || 0;
  const miss = Number(u.cacheMiss ?? u.promptCacheMiss) || 0;
  const out = Number(u.completion ?? u.completionTokens) || 0;
  const amount = (hit / 1e6) * rates.hit + (miss / 1e6) * rates.miss + (out / 1e6) * rates.out;
  return { amount, rates, model: model || null };
}

// 兜底估算：每 token 平均成本（元），未知模型按 pro 的 miss/out 均值
function defaultPerTokenCost(model) {
  const r = modelRates(model);
  return (r.miss + r.out) / 2 / 1e6;
}

// ===== 跨平台比价参考价目（每百万 tokens，统一换算为 CNY；USD 按 7.2 折算）=====
// 注意：公开参考价，可能随官方调整；DeepSeek 为官方价目，其余为市场公开价。
const USD = 7.2;
const COMPARE_MODELS = [
  // 平台, 模型, 输入¥/M, 输出¥/M
  { platform: 'DeepSeek', model: 'deepseek-v4-flash', in: 1.0, out: 2.0 },
  { platform: 'DeepSeek', model: 'deepseek-v4-pro', in: 3.0, out: 6.0 },
  { platform: 'DeepSeek', model: 'deepseek-reasoner', in: 3.0, out: 6.0 },
  { platform: 'DeepSeek', model: 'deepseek-chat', in: 1.0, out: 2.0 },
  { platform: '月之暗面', model: 'kimi-k2', in: 4.0, out: 16.0 },
  { platform: '月之暗面', model: 'moonshot-v1-128k', in: 12.0, out: 12.0 },
  { platform: '智谱', model: 'glm-4-plus', in: 50.0, out: 50.0 },
  { platform: '智谱', model: 'glm-4-air', in: 5.0, out: 5.0 },
  { platform: 'OpenAI', model: 'gpt-4o', in: 2.5 * USD, out: 10 * USD },
  { platform: 'OpenAI', model: 'gpt-4o-mini', in: 0.15 * USD, out: 0.6 * USD },
  { platform: 'Anthropic', model: 'claude-opus-4', in: 15 * USD, out: 75 * USD },
  { platform: 'Anthropic', model: 'claude-sonnet-4', in: 3 * USD, out: 15 * USD },
  { platform: 'Anthropic', model: 'claude-haiku-4', in: 1 * USD, out: 5 * USD },
  { platform: 'Gemini', model: 'gemini-2.5-pro', in: 1.25 * USD, out: 10 * USD },
  { platform: 'Gemini', model: 'gemini-2.5-flash', in: 0.3 * USD, out: 2.5 * USD },
];

// 比价：按 prompt/completion token 数计算各模型费用（CNY），升序返回
function compareCost(promptTokens, completionTokens) {
  const p = Math.max(Number(promptTokens) || 0, 0);
  const c = Math.max(Number(completionTokens) || 0, 0);
  return COMPARE_MODELS.map((m) => ({
    platform: m.platform,
    model: m.model,
    inRate: m.in,
    outRate: m.out,
    cost: (p / 1e6) * m.in + (c / 1e6) * m.out,
  })).sort((a, b) => a.cost - b.cost);
}

module.exports = {
  computeCost,
  rateFor,
  defaultPerTokenCost,
  compareCost,
  setOfficialRates,
  COMPARE_MODELS,
  FLAT_PRICES,
  OFFPEAK_PRICES,
  PEAK_PRICES,
  NEW_PRICES_EFFECTIVE_AT,
};
