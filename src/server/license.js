'use strict';

// ===== 本地核销码（离线授权）=====
//
// 码结构：14 字节 → Crockford Base32 共 23 字符，按 5-5-5-5-3 分组显示
//   payload(8) = 版本(1) + 档位(1) + 序号(2, 大端) + 签发日(2, 大端) + 保留(2)
//   sig(6)     = HMAC-SHA256(SECRET, payload) 的前 6 字节
// 档位：1 = 七天版，2 = 一个月版（30 天），3 = 买断版（永久）
//
// 校验流程：Base32 解码 → 长度/字母表检查 → HMAC 校验 → 档位检查。
// 激活后把「核销记录」写入 <数据目录>/license.json，记录本身也带 HMAC，
// 防止用户直接改文件里的到期时间；同时记录机器指纹，防止把授权文件拷到别的电脑。
//
// 说明：离线方案无法连接服务器核销，因此一个码理论上可被多台机器分别激活
// （本机重复核销会被拒绝）。要做到「一码一机、不可复制」必须联网校验。

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./config');

// 签名密钥来源（**不随公开仓库分发**，否则任何人都能伪造核销码）：
//   1) 环境变量 QUANTA_LICENSE_SECRET（64 位 hex）
//   2) 同目录 license.secret.js（已被 .gitignore 忽略，卖家本地保留）
// 两者都缺失时授权功能不可用（无法核销，界面提示需配置密钥）。
function loadSecret() {
  const fromEnv = process.env.QUANTA_LICENSE_SECRET;
  if (fromEnv && /^[0-9a-fA-F]{64}$/.test(fromEnv.trim())) return Buffer.from(fromEnv.trim(), 'hex');
  try {
    const mod = require('./license.secret');
    const hex = mod && (mod.secretHex || mod.default);
    if (typeof hex === 'string' && /^[0-9a-fA-F]{64}$/.test(hex.trim())) return Buffer.from(hex.trim(), 'hex');
  } catch {
    /* 未提供密钥文件 */
  }
  return null;
}

const SECRET = loadSecret();

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32（去掉易混的 I L O U）
const CODE_VERSION = 1;
const PAYLOAD_LEN = 8;
const SIG_LEN = 6;
const RAW_LEN = PAYLOAD_LEN + SIG_LEN; // 14
const CODE_CHARS = Math.ceil((RAW_LEN * 8) / 5); // 23

const TIERS = {
  1: { id: 'd7', days: 7, labelZh: '七天版', labelEn: '7-day' },
  2: { id: 'm30', days: 30, labelZh: '一个月版', labelEn: '30-day' },
  3: { id: 'life', days: null, labelZh: '买断版（永久）', labelEn: 'Lifetime' },
};
const TIER_BY_ID = { d7: 1, m30: 2, life: 3 };
const DAY_MS = 86400000;
const EPOCH_DAY = Math.floor(Date.UTC(2026, 0, 1) / DAY_MS); // 签发日基准 2026-01-01

// ---- Base32（Crockford，位流式编解码）----

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function sign(payload) {
  if (!SECRET) return Buffer.alloc(SIG_LEN);
  return crypto.createHmac('sha256', SECRET).update(payload).digest().subarray(0, SIG_LEN);
}

// 规范化用户输入：去掉分隔符与易混字符（O→0、I/L→1、U→V），统一大写
function normalizeCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

function formatCode(raw) {
  const s = base32Encode(raw);
  return [s.slice(0, 5), s.slice(5, 10), s.slice(10, 15), s.slice(15, 20), s.slice(20)].filter(Boolean).join('-');
}

// ---- 生成（卖家侧，scripts/gen-license.js 使用）----

function buildPayload(tierNum, serial, issuedDay) {
  const p = Buffer.alloc(PAYLOAD_LEN);
  p.writeUInt8(CODE_VERSION, 0);
  p.writeUInt8(tierNum, 1);
  p.writeUInt16BE(serial & 0xffff, 2);
  p.writeUInt16BE(issuedDay & 0xffff, 4);
  return p;
}

function generateCode(tierId, opts = {}) {
  if (!SECRET) throw new Error('未配置授权签名密钥：请设置 QUANTA_LICENSE_SECRET 环境变量，或创建 src/server/license.secret.js（见 license.secret.example.js）');
  const tierNum = TIER_BY_ID[String(tierId).toLowerCase()];
  if (!tierNum) throw new Error(`未知档位: ${tierId}（可选 d7 / m30 / life）`);
  const serial = opts.serial != null ? Number(opts.serial) : crypto.randomInt(0, 0x10000);
  const issuedDay = opts.issuedDay != null ? Number(opts.issuedDay) : Math.floor(Date.now() / DAY_MS) - EPOCH_DAY;
  const payload = buildPayload(tierNum, serial, issuedDay);
  const raw = Buffer.concat([payload, sign(payload)]);
  return {
    code: formatCode(raw),
    tier: TIERS[tierNum].id,
    tierLabel: TIERS[tierNum].labelZh,
    serial,
    issuedDay,
    issuedDate: new Date((issuedDay + EPOCH_DAY) * DAY_MS).toISOString().slice(0, 10),
  };
}

// ---- 校验 ----

// 返回 { ok, tier, tierId, days, serial, issuedDay, reason }
function verifyCode(input) {
  if (!SECRET) return { ok: false, reason: 'noconfig' };
  const norm = normalizeCode(input);
  if (!norm) return { ok: false, reason: 'empty' };
  if (norm.length !== CODE_CHARS) return { ok: false, reason: 'length' };
  const raw = base32Decode(norm);
  if (!raw || raw.length < RAW_LEN) return { ok: false, reason: 'format' };
  const payload = raw.subarray(0, PAYLOAD_LEN);
  const sig = raw.subarray(PAYLOAD_LEN, PAYLOAD_LEN + SIG_LEN);
  const expect = sign(payload);
  if (!crypto.timingSafeEqual(sig, expect)) return { ok: false, reason: 'signature' };
  if (payload.readUInt8(0) !== CODE_VERSION) return { ok: false, reason: 'version' };
  const tierNum = payload.readUInt8(1);
  const tier = TIERS[tierNum];
  if (!tier) return { ok: false, reason: 'tier' };
  const serial = payload.readUInt16BE(2);
  const issuedDay = payload.readUInt16BE(4);
  return {
    ok: true,
    tier: tier.id,
    tierNum,
    tierLabel: tier.labelZh,
    days: tier.days,
    serial,
    issuedDay,
    code: formatCode(raw),
  };
}

// ---- 机器指纹（授权文件与机器绑定，防止直接拷贝文件）----

function machineId() {
  const nets = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        mac = ni.mac;
        break;
      }
    }
    if (mac) break;
  }
  const raw = [os.hostname(), os.platform(), os.arch(), mac].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

// ---- 核销记录（license.json）----

function licensePath() {
  return path.join(getDataDir(), 'license.json');
}

function recordSignature(rec) {
  const base = [rec.code_hash, rec.tier, rec.activated_at, rec.expires_at || 0, rec.machine_id].join('|');
  if (!SECRET) return '';
  return crypto.createHmac('sha256', SECRET).update(base).digest('hex').slice(0, 32);
}

function hashCode(code) {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex').slice(0, 32);
}

function readRecord() {
  try {
    const rec = JSON.parse(fs.readFileSync(licensePath(), 'utf8').replace(/^\uFEFF/, ''));
    if (!rec || typeof rec !== 'object') return null;
    if (recordSignature(rec) !== rec.sig) return { tampered: true };
    return rec;
  } catch {
    return null;
  }
}

function writeRecord(rec) {
  const withSig = { ...rec, sig: recordSignature(rec) };
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(licensePath(), JSON.stringify(withSig, null, 2), 'utf8');
  return withSig;
}

function maskCode(code) {
  const norm = normalizeCode(code);
  if (norm.length < 8) return '****';
  return `${norm.slice(0, 5)}-****-****-${norm.slice(-5, -2)}-${norm.slice(-2)}`;
}

// 激活（核销）：校验码 → 计算到期时间 → 写绑定本机的核销记录
function activate(input, { now = Date.now() } = {}) {
  const v = verifyCode(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  const prev = readRecord();
  if (prev && !prev.tampered && prev.code_hash === hashCode(v.code)) {
    return { ok: false, reason: 'already', tier: v.tier };
  }
  const expiresAt = v.days == null ? null : now + v.days * DAY_MS;
  const rec = writeRecord({
    version: CODE_VERSION,
    code_hash: hashCode(v.code),
    code_mask: maskCode(v.code),
    tier: v.tier,
    tier_num: v.tierNum,
    serial: v.serial,
    activated_at: now,
    expires_at: expiresAt,
    machine_id: machineId(),
    last_seen: now,
  });
  return { ok: true, record: rec, ...status(now) };
}

const REASON_TEXT = {
  empty: '请输入核销码',
  length: '核销码长度不对',
  format: '核销码格式无效',
  signature: '核销码无效（校验失败）',
  version: '核销码版本不支持',
  tier: '核销码档位无效',
  already: '该核销码已在本机核销',
  mismatch: '该授权属于另一台设备，请在本机重新核销',
  tampered: '授权文件已被修改，请重新核销',
  noconfig: '未配置授权签名密钥（卖家侧需保留 license.secret.js）',
};

// 读取当前授权状态
// state: none（未核销）/ active（有效）/ expired（已过期）/ mismatch（换机）/ clock（时间异常）/ invalid（记录损坏）
function status(now = Date.now()) {
  const rec = readRecord();
  if (!rec) {
    return { state: 'none', enforced: true, tier: null, tierLabel: null, activatedAt: null, expiresAt: null, daysLeft: null, hoursLeft: null, codeMasked: null };
  }
  if (rec.tampered) {
    return { state: 'invalid', reason: 'tampered', message: REASON_TEXT.tampered, enforced: true, tier: null, tierLabel: null, activatedAt: null, expiresAt: null, daysLeft: null, hoursLeft: null, codeMasked: null };
  }
  const tier = TIERS[rec.tier_num] || null;
  const base = {
    tier: rec.tier,
    tierLabel: tier ? tier.labelZh : rec.tier,
    activatedAt: rec.activated_at || null,
    expiresAt: rec.expires_at || null,
    codeMasked: rec.code_mask || '****',
    enforced: true,
  };
  if (rec.machine_id !== machineId()) {
    return { ...base, state: 'mismatch', daysLeft: null, hoursLeft: null, message: REASON_TEXT.mismatch };
  }
  // 时间回拨检测：上次见到的时间比现在晚超过 24 小时 → 视为改系统时间
  const clockBad = rec.last_seen && now < rec.last_seen - DAY_MS;
  if (clockBad) {
    return { ...base, state: 'clock', daysLeft: null, hoursLeft: null, message: '系统时间异常（检测到时间回拨），请校正系统时间后重启应用' };
  }
  // 每小时最多落盘一次，记录最近见到的时间
  if (!rec.last_seen || now - rec.last_seen > 3600000) {
    try {
      writeRecord({ ...rec, last_seen: now });
    } catch {
      /* 写入失败不影响本次判定 */
    }
  }
  if (base.expiresAt == null) {
    return { ...base, state: 'active', lifetime: true, daysLeft: null, hoursLeft: null };
  }
  const left = base.expiresAt - now;
  if (left <= 0) {
    return { ...base, state: 'expired', daysLeft: 0, hoursLeft: 0, message: '授权已到期，请输入新的核销码' };
  }
  return { ...base, state: 'active', lifetime: false, daysLeft: Math.ceil(left / DAY_MS), hoursLeft: Math.ceil(left / 3600000) };
}

// 本机机器指纹是否与授权一致（不一致说明授权文件被拷到了别的电脑）
function machineMatches() {
  const rec = readRecord();
  if (!rec || rec.tampered) return false;
  return rec.machine_id === machineId();
}

// 卖家侧：清空本机核销记录（便于自测）
function clear() {
  try {
    fs.unlinkSync(licensePath());
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  generateCode,
  verifyCode,
  activate,
  status,
  clear,
  machineId,
  machineMatches,
  normalizeCode,
  formatCode,
  maskCode,
  reasonText: (r) => REASON_TEXT[r] || '核销失败',
  TIERS,
  TIER_BY_ID,
  licensePath,
  _signRecord: recordSignature, // 供单元测试构造「签名有效但字段异常」的记录
};
