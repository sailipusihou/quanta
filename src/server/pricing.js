'use strict';

// DeepSeek 官方价格（元 / 百万 tokens），来源：api-docs.deepseek.com/zh-cn/quick_start/pricing
// 2026-08-17 00:00（北京时间）起生效峰谷定价；高峰 9-12、14-18 点，其余为空闲时段。
const NEW_PRICES_EFFECTIVE_AT = Date.parse('2026-08-17T00:00:00+08:00');

const FLAT_PRICES = {
  'deepseek-v4-flash': { hit: 0.02, miss: 1.0, out: 2.0 },
  'deepseek-v4-pro': { hit: 0.025, miss: 3.0, out: 6.0 },
};

const OFFPEAK_PRICES = {
  'deepseek-v4-flash': { hit: 0.05, miss: 1.5, out: 4.5 },
  'deepseek-v4-pro': { hit: 0.15, miss: 4.5, out: 13.5 },
};

const PEAK_PRICES = {
  'deepseek-v4-flash': { hit: 0.10, miss: 3.0, out: 9.0 },
  'deepseek-v4-pro': { hit: 0.30, miss: 9.0, out: 27.0 },
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

// 返回 { hit, miss, out, period, known }
function rateFor(model, ts = Date.now()) {
  const effectiveNew = ts >= NEW_PRICES_EFFECTIVE_AT;
  const known = Boolean(FLAT_PRICES[model] || OFFPEAK_PRICES[model]);
  if (!effectiveNew) return { ...modelRates(model), period: 'flat', known };
  if (isPeakHour(ts)) {
    const r = PEAK_PRICES[model] || modelRates(model);
    return { hit: r.hit, miss: r.miss, out: r.out, period: 'peak', known };
  }
  const r = OFFPEAK_PRICES[model] || modelRates(model);
  return { hit: r.hit, miss: r.miss, out: r.out, period: 'offpeak', known };
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

module.exports = {
  computeCost,
  rateFor,
  defaultPerTokenCost,
  FLAT_PRICES,
  OFFPEAK_PRICES,
  PEAK_PRICES,
  NEW_PRICES_EFFECTIVE_AT,
};
