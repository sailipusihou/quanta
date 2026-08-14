'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPath } = require('../src/server/balance');
const { Store } = require('../src/server/store');
const { toCsv } = require('../src/server/export');
const { loadConfig } = require('../src/server/config');

test('JSON 路径取值：支持点号和数组下标', () => {
  const body = { balance_infos: [{ currency: 'CNY', total_balance: '19.09', granted_balance: '0.00' }], is_available: true };
  assert.equal(getPath(body, 'balance_infos[0].total_balance'), '19.09');
  assert.equal(getPath(body, 'balance_infos[0].currency'), 'CNY');
  assert.equal(getPath(body, 'data.balance'), undefined);
  assert.equal(getPath(body, 'missing.path'), undefined);
});

test('充值记录：写入、汇总、持久化、清空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-recharge-'));
  const store = new Store(dir);
  store.recordRecharge({ amount: 50, note: '支付宝', ts: 2000 });
  store.recordRecharge({ amount: 30, note: '', ts: 1000 });
  assert.equal(store.totalRecharges(), 80);
  assert.equal(store.listRecharges().length, 2);
  assert.equal(store.listRecharges()[0].note, '支付宝'); // 时间倒序

  const reloaded = new Store(dir);
  assert.equal(reloaded.totalRecharges(), 80);
  reloaded.clear();
  assert.equal(reloaded.totalRecharges(), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CSV 导出：表头、转义、金额格式化', () => {
  const csv = toCsv([
    {
      ts: Date.now(),
      model: 'deepseek-v4-flash',
      status: 200,
      usage: { promptTokens: 10, completionTokens: 2, cacheHit: 0, cacheMiss: 10 },
      cost: 0.000014,
      ms: 321,
      stream: true,
      error: null,
    },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '时间,模型,状态,输入Token,输出Token,缓存命中,缓存未命中,金额(元),耗时(ms),流式,错误');
  assert.ok(lines[1].includes('deepseek-v4-flash'));
  assert.ok(lines[1].includes('0.000014'));
  assert.ok(lines[1].includes('是'));
});

test('旧版配置迁移到多账户结构', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-cfg-'));
  const oldEnv = process.env.TOKEN_DATA_DIR;
  process.env.TOKEN_DATA_DIR = dir;
  try {
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ apiKey: 'sk-legacy', upstreamBase: 'https://legacy.example.com', proxyPort: 9000 })
    );
    const cfg = loadConfig();
    assert.equal(cfg.accounts[0].apiKey, 'sk-legacy');
    assert.equal(cfg.accounts[0].baseUrl, 'https://legacy.example.com');
    assert.equal(cfg.proxyPort, 9000);
    assert.equal(cfg.selectedAccountId, 'deepseek');
  } finally {
    if (oldEnv) process.env.TOKEN_DATA_DIR = oldEnv;
    else delete process.env.TOKEN_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
