'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCost, rateFor, defaultPerTokenCost } = require('../src/server/pricing');

const BEFORE_NEW = Date.parse('2026-08-14T12:00:00+08:00');
const OFFPEAK = Date.parse('2026-08-17T20:00:00+08:00');
const PEAK = Date.parse('2026-08-17T10:00:00+08:00');

test('老价格（8-17 前）按平价计算', () => {
  const { amount } = computeCost('deepseek-v4-flash', { cacheHit: 1e6, cacheMiss: 0, completion: 0 }, BEFORE_NEW);
  assert.ok(Math.abs(amount - 0.02) < 1e-9);
  const { amount: out } = computeCost('deepseek-v4-pro', { cacheHit: 0, cacheMiss: 1e6, completion: 0 }, BEFORE_NEW);
  assert.ok(Math.abs(out - 3.0) < 1e-9);
});

test('新价格空闲时段（非高峰）', () => {
  const { amount, rates } = computeCost('deepseek-v4-flash', { cacheHit: 1e6, cacheMiss: 0, completion: 0 }, OFFPEAK);
  assert.ok(Math.abs(amount - 0.05) < 1e-9);
  assert.equal(rates.period, 'offpeak');
});

test('新价格高峰时段（9-12 点）', () => {
  const { amount, rates } = computeCost('deepseek-v4-pro', { cacheHit: 0, cacheMiss: 1e6, completion: 1e6 }, PEAK);
  assert.equal(rates.period, 'peak');
  assert.ok(Math.abs(amount - (9.0 + 27.0)) < 1e-9);
});

test('缓存命中与未命中分开计价', () => {
  const { amount } = computeCost(
    'deepseek-v4-flash',
    { cacheHit: 0.5e6, cacheMiss: 0.5e6, completion: 0 },
    OFFPEAK
  );
  assert.ok(Math.abs(amount - (0.05 * 0.5 + 1.5 * 0.5)) < 1e-9);
});

test('未知模型按 pro 兜底并标记 known=false', () => {
  const r = rateFor('some-new-model', OFFPEAK);
  assert.equal(r.known, false);
  assert.equal(r.miss, 4.5);
  const { amount } = computeCost('some-new-model', { cacheHit: 0, cacheMiss: 1e6, completion: 0 }, OFFPEAK);
  assert.ok(Math.abs(amount - 4.5) < 1e-9);
});

test('默认每 token 成本为正值', () => {
  assert.ok(defaultPerTokenCost('deepseek-v4-flash') > 0);
});

test('代理侧 usage 字段（completionTokens）也能正确计价', () => {
  const { amount } = computeCost(
    'deepseek-v4-flash',
    { promptTokens: 100, completionTokens: 20, cacheHit: 40, cacheMiss: 60, totalTokens: 120 },
    BEFORE_NEW
  );
  // 40*0.02/1e6 + 60*1/1e6 + 20*2/1e6
  assert.ok(Math.abs(amount - 0.0001008) < 1e-12);
});
