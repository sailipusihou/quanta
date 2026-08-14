'use strict';

const { EventEmitter } = require('events');
const { Store } = require('./store');
const { fetchBalance } = require('./balance');
const { startProxy } = require('./proxy');
const { defaultPerTokenCost, rateFor } = require('./pricing');
const { DATA_DIR, loadConfig, saveConfig } = require('./config');

const DEFAULT_PER_TOKEN_CNY = 2.5e-6;

class TokenServer extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.store = new Store(DATA_DIR);
    this.port = null;
    this.proxyServer = null;
    this.pollTimer = null;
    this.polling = false;
  }

  async start() {
    const cfg = this.config;
    let started = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = cfg.proxyPort + attempt;
      try {
        const { server, port: usedPort } = await startProxy({
          port,
          upstreamBase: cfg.upstreamBase,
          apiKey: cfg.apiKey,
          onRecord: (entry) => this.store.recordRequest(entry),
        });
        this.proxyServer = server;
        this.port = usedPort;
        started = true;
        break;
      } catch (err) {
        if (err.code === 'EADDRINUSE') {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    if (!started) throw lastErr || new Error('代理端口全部被占用');
    this.emit('started', { port: this.port });

    await this.pollBalance();
    this.pollTimer = setInterval(() => this.pollBalance(), Math.max(cfg.balancePollMs, 10000));
    this.pollTimer.unref?.();
  }

  async pollBalance() {
    if (this.polling) return;
    this.polling = true;
    try {
      const snapshot = await fetchBalance({
        apiKey: this.config.apiKey,
        upstreamBase: this.config.upstreamBase,
      });
      this.store.recordBalance(snapshot);
      this.emit('balance', snapshot);
    } catch (err) {
      this.store.recordBalanceError(err.message);
      this.emit('balance_error', err.message);
    } finally {
      this.polling = false;
    }
  }

  async restartProxy() {
    if (this.proxyServer) {
      await new Promise((resolve) => {
        this.proxyServer.close(resolve);
        this.proxyServer.closeAllConnections?.();
      });
      this.proxyServer = null;
    }
    const cfg = this.config;
    let started = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = cfg.proxyPort + attempt;
      try {
        const { server: srv, port: usedPort } = await startProxy({
          port,
          upstreamBase: cfg.upstreamBase,
          apiKey: cfg.apiKey,
          onRecord: (entry) => this.store.recordRequest(entry),
        });
        this.proxyServer = srv;
        this.port = usedPort;
        started = true;
        break;
      } catch (err) {
        if (err.code === 'EADDRINUSE') continue;
        throw err;
      }
    }
    if (!started) throw new Error('代理端口全部被占用');
    this.emit('started', { port: this.port });
  }

  rescheduleBalancePoll() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.pollBalance(), Math.max(this.config.balancePollMs, 10000));
    this.pollTimer.unref?.();
  }

  estimateRemainingTokens() {
    const balance = this.store.lastBalance;
    if (!balance || !(balance.totalBalance > 0)) return null;
    const recent = this.store.events
      .filter((e) => e.kind === 'request' && e.usage && e.usage.totalTokens > 0)
      .slice(-100);
    let cost = 0;
    let tokens = 0;
    for (const e of recent) {
      cost += e.cost;
      tokens += e.usage.totalTokens;
    }
    let perToken;
    if (tokens > 0 && cost > 0) {
      perToken = cost / tokens;
    } else {
      const models = this.store.byModel(Date.now() - 30 * 86400000);
      const dominant = models[0];
      perToken = dominant ? defaultPerTokenCost(dominant.model) : DEFAULT_PER_TOKEN_CNY;
    }
    return Math.floor(balance.totalBalance / perToken);
  }

  snapshot() {
    const now = Date.now();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOf24h = now - 24 * 3600000;
    const cfg = this.config;
    return {
      balance: this.store.lastBalance,
      balanceError: this.store.lastBalanceError,
      estimatedTokens: this.estimateRemainingTokens(),
      stats: {
        today: this.store.stats(startOfToday.getTime()),
        month: this.store.stats(startOfMonth.getTime()),
        last24h: this.store.stats(startOf24h),
        week: this.store.stats(now - 7 * 86400000),
        all: this.store.stats(0),
      },
      series: {
        days: this.store.series('day', 7),
        hours: this.store.series('hour', 24),
      },
      byModel: this.store.byModel(startOf24h),
      recent: this.store.recent(30),
      server: { running: Boolean(this.proxyServer), port: this.port },
      config: {
        proxyPort: cfg.proxyPort,
        upstreamBase: cfg.upstreamBase,
        balancePollMs: cfg.balancePollMs,
        autoStart: cfg.autoStart,
        widget: { ...cfg.widget },
        hasApiKey: Boolean(cfg.apiKey),
      },
      pricing: { period: rateFor(null, now).period },
    };
  }

  updateConfig(patch) {
    const cfg = { ...this.config, ...patch };
    if (patch.widget) cfg.widget = { ...this.config.widget, ...patch.widget };
    this.config = cfg;
    saveConfig(cfg);
    return cfg;
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.proxyServer?.close?.();
  }
}

function createTokenServer() {
  return new TokenServer(loadConfig());
}

module.exports = { TokenServer, createTokenServer };
