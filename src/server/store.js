'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MAX_EVENTS = 8000;

function emptyStats() {
  return {
    requests: 0,
    errors: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheHit: 0,
    cacheMiss: 0,
    cost: 0,
  };
}

class Store extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.usagePath = path.join(dataDir, 'usage.jsonl');
    this.statePath = path.join(dataDir, 'state.json');
    this.rechargesPath = path.join(dataDir, 'recharges.jsonl');
    this.events = [];
    this.recharges = [];
    this.lastBalance = null;
    this.lastBalanceError = null;
    // 余额快照历史（官网口径消耗用：两次快照间的余额减少 = 官网真实扣费）
    this.balanceHistory = [];
    fs.mkdirSync(dataDir, { recursive: true });
    this._load();
  }

  _load() {
    try {
      const lines = fs.readFileSync(this.usagePath, 'utf8').split('\n').filter(Boolean);
      this.events = lines
        .slice(-MAX_EVENTS)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      this.events = [];
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8').replace(/^\uFEFF/, ''));
      if (raw && raw.balance && Array.isArray(raw.history)) {
        // 新格式：{ balance, history }
        this.lastBalance = raw.balance;
        this.balanceHistory = raw.history.slice(-5000);
      } else if (raw && raw.totalBalance != null) {
        // 旧格式：直接是余额快照
        this.lastBalance = raw;
        this.balanceHistory = [{ ts: raw.fetchedAt || Date.now(), total: raw.totalBalance }];
      }
    } catch {
      this.lastBalance = null;
    }
    try {
      const lines = fs.readFileSync(this.rechargesPath, 'utf8').split('\n').filter(Boolean);
      this.recharges = lines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      this.recharges = [];
    }
  }

  _append(e) {
    fs.appendFileSync(this.usagePath, JSON.stringify(e) + '\n', 'utf8');
  }

  _trim() {
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
  }

  recordRequest(entry) {
    const e = { kind: 'request', ...entry };
    this.events.push(e);
    this._trim();
    this._append(e);
    this.emit('event', e);
    return e;
  }

  recordBalance(snapshot) {
    this.lastBalance = snapshot;
    this.lastBalanceError = null;
    // 追加余额历史（用于官网口径消耗计算）
    this.balanceHistory.push({ ts: snapshot.fetchedAt || Date.now(), total: snapshot.totalBalance });
    if (this.balanceHistory.length > 5000) {
      this.balanceHistory = this.balanceHistory.slice(-5000);
    }
    fs.writeFileSync(
      this.statePath,
      JSON.stringify({ balance: snapshot, history: this.balanceHistory.slice(-2000) }, null, 2),
      'utf8'
    );
    this.emit('event', { kind: 'balance', ...snapshot });
    return snapshot;
  }

  // 官网口径消耗：区间内余额快照的减少量之和（含未走代理的扣费；正增量视为充值自动排除）
  // 返回 { consumed, toppedUp }
  officialCostBetween(fromTs, toTs) {
    const start = fromTs || 0;
    const end = toTs || Date.now();
    // 起点：fromTs 之前最近一条快照（避免漏掉区间开头的消耗）
    let prev = null;
    for (let i = this.balanceHistory.length - 1; i >= 0; i--) {
      if (this.balanceHistory[i].ts < start) {
        prev = this.balanceHistory[i];
        break;
      }
    }
    let consumed = 0;
    let toppedUp = 0;
    for (const h of this.balanceHistory) {
      if (h.ts < start || h.ts > end) continue;
      if (prev) {
        const d = prev.total - h.total;
        if (d > 0) consumed += d;
        else if (d < 0) toppedUp += -d;
      }
      prev = h;
    }
    return { consumed, toppedUp };
  }

  recordBalanceError(message) {
    this.lastBalanceError = { message, fetchedAt: Date.now() };
    this.emit('event', { kind: 'balance_error', message, fetchedAt: Date.now() });
  }

  recordRecharge(entry) {
    const e = { ts: Date.now(), ...entry };
    this.recharges.push(e);
    fs.appendFileSync(this.rechargesPath, JSON.stringify(e) + '\n', 'utf8');
    this.emit('event', { kind: 'recharge', ...e });
    return e;
  }

  listRecharges() {
    return [...this.recharges].sort((a, b) => b.ts - a.ts);
  }

  totalRecharges() {
    return this.recharges.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }

  // keyId/model 过滤：null/空 = 全部；否则只统计该 Key / 该模型
  stats(sinceTs, keyId, model) {
    const s = emptyStats();
    for (const e of this.events) {
      if (e.kind !== 'request') continue;
      if (sinceTs && e.ts < sinceTs) continue;
      if (keyId && e.keyId && e.keyId !== keyId) continue;
      if (model && e.model !== model) continue;
      s.requests += 1;
      if (e.status >= 400) s.errors += 1;
      s.totalTokens += e.usage.totalTokens;
      s.promptTokens += e.usage.promptTokens;
      s.completionTokens += e.usage.completionTokens;
      s.cacheHit += e.usage.cacheHit;
      s.cacheMiss += e.usage.cacheMiss;
      s.cost += e.cost;
    }
    return s;
  }

  byModel(sinceTs, keyId, model) {
    const map = new Map();
    for (const e of this.events) {
      if (e.kind !== 'request') continue;
      if (sinceTs && e.ts < sinceTs) continue;
      if (keyId && e.keyId && e.keyId !== keyId) continue;
      if (model && e.model !== model) continue;
      const key = e.model || '(未知模型)';
      const cur = map.get(key) || { model: key, requests: 0, totalTokens: 0, cost: 0, errors: 0 };
      cur.requests += 1;
      cur.totalTokens += e.usage.totalTokens;
      cur.cost += e.cost;
      if (e.status >= 400) cur.errors += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }

  byTag(sinceTs, keyId, model) {
    const map = new Map();
    for (const e of this.events) {
      if (e.kind !== 'request') continue;
      if (sinceTs && e.ts < sinceTs) continue;
      if (keyId && e.keyId && e.keyId !== keyId) continue;
      if (model && e.model !== model) continue;
      const key = e.tag || 'default';
      const cur = map.get(key) || { tag: key, requests: 0, totalTokens: 0, cost: 0, errors: 0 };
      cur.requests += 1;
      cur.totalTokens += e.usage.totalTokens;
      cur.cost += e.cost;
      if (e.status >= 400) cur.errors += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }

  // 区间统计（series 用：每桶为该时段内的真实用量，而非累计）
  statsBetween(sinceTs, untilTs, keyId, model) {
    const s = emptyStats();
    for (const e of this.events) {
      if (e.kind !== 'request') continue;
      if (sinceTs && e.ts < sinceTs) continue;
      if (untilTs && e.ts >= untilTs) continue;
      if (keyId && e.keyId && e.keyId !== keyId) continue;
      if (model && e.model !== model) continue;
      s.requests += 1;
      if (e.status >= 400) s.errors += 1;
      s.totalTokens += e.usage.totalTokens;
      s.promptTokens += e.usage.promptTokens;
      s.completionTokens += e.usage.completionTokens;
      s.cacheHit += e.usage.cacheHit;
      s.cacheMiss += e.usage.cacheMiss;
      s.cost += e.cost;
    }
    return s;
  }

  series(kind, buckets, keyId, model) {
    const out = [];
    const now = Date.now();
    for (let i = buckets - 1; i >= 0; i--) {
      const start = kind === 'day' ? startOfDay(now - i * 86400000) : startOfHour(now - i * 3600000);
      const end = kind === 'day' ? start + 86400000 : start + 3600000;
      const s = this.statsBetween(start, end, keyId, model);
      out.push({ start, end, ...s });
    }
    return out;
  }

  recent(n, keyId, model) {
    return this.events
      .filter((e) => e.kind === 'request' && (!keyId || !e.keyId || e.keyId === keyId) && (!model || e.model === model))
      .slice(-n)
      .reverse();
  }

  clear() {
    this.events = [];
    this.lastBalance = null;
    this.recharges = [];
    fs.writeFileSync(this.usagePath, '', 'utf8');
    fs.writeFileSync(this.rechargesPath, '', 'utf8');
  }
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfHour(ts) {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

module.exports = { Store, startOfDay, startOfHour, emptyStats };
