'use strict';

// 核销码（离线授权）单元测试：使用临时数据目录，不影响真实配置
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'quanta-license-test-' + process.pid);
process.env.TOKEN_DATA_DIR = TMP;

const L = require('../src/server/license');

const DAY = 86400000;

function reset() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
}

test.beforeEach(reset);

test('三档核销码生成与校验：档位与天数正确', () => {
  const d7 = L.generateCode('d7');
  const m30 = L.generateCode('m30');
  const life = L.generateCode('life');
  assert.equal(L.verifyCode(d7.code).days, 7);
  assert.equal(L.verifyCode(m30.code).days, 30);
  assert.equal(L.verifyCode(life.code).days, null);
  assert.equal(L.verifyCode(d7.code).tier, 'd7');
  assert.equal(L.verifyCode(life.code).tier, 'life');
  // 码格式：5-5-5-5-3
  assert.match(d7.code, /^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{3}$/);
});

test('核销码容错：忽略分隔符、大小写与易混字符', () => {
  const c = L.generateCode('d7').code;
  assert.equal(L.verifyCode(c.replace(/-/g, '').toLowerCase()).ok, true);
  assert.equal(L.verifyCode('  ' + c + '  ').ok, true);
});

test('伪造/篡改的码无法通过校验', () => {
  assert.equal(L.verifyCode('').reason, 'empty');
  assert.equal(L.verifyCode('AAAAA-AAAAA-AAAAA-AAAAA-AAA').ok, false);
  const c = L.generateCode('life').code;
  const chars = c.split('');
  const pos = chars.findIndex((x) => x !== '-');
  chars[pos] = chars[pos] === 'Z' ? 'Y' : 'Z';
  const bad = chars.join('');
  assert.equal(L.verifyCode(bad).ok, false);
  assert.equal(L.verifyCode(bad).reason, 'signature');
});

test('激活后状态为有效，到期时间 = 激活时间 + 档位天数', () => {
  const now = Date.now();
  const c = L.generateCode('m30').code;
  const r = L.activate(c, { now });
  assert.equal(r.ok, true);
  const st = L.status(now);
  assert.equal(st.state, 'active');
  assert.equal(st.tier, 'm30');
  assert.equal(st.expiresAt, now + 30 * DAY);
  assert.equal(st.daysLeft, 30);
});

test('买断版无到期时间，长期有效', () => {
  const now = Date.now();
  L.activate(L.generateCode('life').code, { now });
  const st = L.status(now + 3650 * DAY);
  assert.equal(st.state, 'active');
  assert.equal(st.lifetime, true);
  assert.equal(st.expiresAt, null);
});

test('到期后状态为 expired', () => {
  const now = Date.now();
  L.activate(L.generateCode('d7').code, { now });
  assert.equal(L.status(now + 6 * DAY).state, 'active');
  assert.equal(L.status(now + 8 * DAY).state, 'expired');
  assert.equal(L.status(now + 8 * DAY).daysLeft, 0);
});

test('同一台机器重复核销同一个码会被拒绝', () => {
  const c = L.generateCode('d7').code;
  assert.equal(L.activate(c).ok, true);
  const again = L.activate(c);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already');
});

test('直接修改授权文件的到期时间会被识别为篡改', () => {
  const now = Date.now();
  L.activate(L.generateCode('d7').code, { now });
  const p = L.licensePath();
  const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
  rec.expires_at = now + 3650 * DAY;
  fs.writeFileSync(p, JSON.stringify(rec));
  const st = L.status(now);
  assert.equal(st.state, 'invalid');
  assert.equal(st.reason, 'tampered');
});

test('授权文件被拷到另一台机器（机器指纹不符）会被拒绝', () => {
  const now = Date.now();
  L.activate(L.generateCode('m30').code, { now });
  const p = L.licensePath();
  const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
  // 构造「签名有效但机器指纹不同」的记录，模拟把文件复制到别的电脑
  const forged = { ...rec, machine_id: 'ffffffffffffffffffffffffffffffff' };
  forged.sig = L._signRecord(forged);
  fs.writeFileSync(p, JSON.stringify(forged));
  const st = L.status(now);
  assert.equal(st.state, 'mismatch');
});

test('系统时间回拨超过一天会被识别为时间异常', () => {
  const now = Date.now();
  L.activate(L.generateCode('m30').code, { now });
  const st = L.status(now - 2 * DAY);
  assert.equal(st.state, 'clock');
});

test('未核销时状态为 none，且不带任何档位信息', () => {
  const st = L.status();
  assert.equal(st.state, 'none');
  assert.equal(st.tier, null);
  assert.equal(st.daysLeft, null);
});

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
