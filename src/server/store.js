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
    this.events = [];
    this.lastBalance = null;
    this.lastBalanceError = null;
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
      this.lastBalance = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch {
      this.lastBalance = null;
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
    fs.writeFileSync(this.statePath, JSON.stringify(snapshot, null, 2), 'utf8');
    this.emit('event', { kind: 'balance', ...snapshot });
    return snapshot;
  }

  recordBalanceError(message) {
    this.lastBalanceError = { message, fetchedAt: Date.now() };
    this.emit('event', { kind: 'balance_error', message, fetchedAt: Date.now() });
  }

  stats(sinceTs) {
    const s = emptyStats();
    for (const e of this.events) {
      if (e.kind !== 'request') continue;
      if (sinceTs && e.ts < sinceTs) continue;
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

  byModel(sinceTs) {
    const map = new Map();
    for (const e of this.events) {
      if (e.kind !== 'request') continue;
      if (sinceTs && e.ts < sinceTs) continue;
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

  series(kind, buckets) {
    const out = [];
    const now = Date.now();
    for (let i = buckets - 1; i >= 0; i--) {
      const start = kind === 'day' ? startOfDay(now - i * 86400000) : startOfHour(now - i * 3600000);
      const end = kind === 'day' ? start + 86400000 : start + 3600000;
      const s = this.stats(start);
      out.push({ start, end, ...s });
    }
    return out;
  }

  recent(n) {
    return this.events
      .filter((e) => e.kind === 'request')
      .slice(-n)
      .reverse();
  }

  clear() {
    this.events = [];
    this.lastBalance = null;
    fs.writeFileSync(this.usagePath, '', 'utf8');
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
