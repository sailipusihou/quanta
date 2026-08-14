'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/server/store');

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-store-'));
  return { store: new Store(dir), dir };
}

test('记录请求并聚合统计', () => {
  const { store, dir } = makeStore();
  const now = Date.now();
  store.recordRequest({
    ts: now,
    model: 'deepseek-v4-flash',
    status: 200,
    usage: { promptTokens: 100, completionTokens: 50, cacheHit: 30, cacheMiss: 70, totalTokens: 150 },
    cost: 0.001,
  });
  store.recordRequest({
    ts: now,
    model: 'deepseek-v4-flash',
    status: 429,
    usage: { promptTokens: 0, completionTokens: 0, cacheHit: 0, cacheMiss: 0, totalTokens: 0 },
    cost: 0,
  });

  const s = store.stats(now - 1000);
  assert.equal(s.requests, 2);
  assert.equal(s.errors, 1);
  assert.equal(s.totalTokens, 150);
  assert.equal(s.cacheHit, 30);
  assert.equal(s.cost, 0.001);

  const byModel = store.byModel(now - 1000);
  assert.equal(byModel.length, 1);
  assert.equal(byModel[0].requests, 2);
  assert.equal(store.series('day', 7).length, 7);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('余额快照持久化并可在重启后读取', () => {
  const { store, dir } = makeStore();
  const snap = {
    ok: true,
    currency: 'CNY',
    totalBalance: 19.09,
    grantedBalance: 0,
    toppedUpBalance: 19.09,
    fetchedAt: Date.now(),
  };
  store.recordBalance(snap);

  const reloaded = new Store(dir);
  assert.equal(reloaded.lastBalance.totalBalance, 19.09);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('clear 清空事件但保留目录', () => {
  const { store, dir } = makeStore();
  store.recordRequest({
    ts: Date.now(),
    model: 'deepseek-v4-pro',
    status: 200,
    usage: { promptTokens: 1, completionTokens: 1, cacheHit: 0, cacheMiss: 1, totalTokens: 2 },
    cost: 0.0001,
  });
  store.clear();
  assert.equal(store.events.length, 0);
  assert.equal(store.stats(0).requests, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
