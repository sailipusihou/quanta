'use strict';

const { EventEmitter } = require('events');
const { Store } = require('./store');
const { fetchBalance } = require('./balance');
const { startProxy } = require('./proxy');
const { defaultPerTokenCost, rateFor } = require('./pricing');
const { getDataDir, loadConfig, saveConfig, maskKey, DEFAULTS } = require('./config');

const DEFAULT_PER_TOKEN_CNY = 2.5e-6;

class TokenServer extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.store = new Store(getDataDir());
    this.port = null;
    this.proxyServer = null;
    this.pollTimer = null;
    this.polling = false;
    this.alertFired = false;
  }

  selectedAccount() {
    const cfg = this.config;
    return (
      cfg.accounts.find((a) => a.id === cfg.selectedAccountId) ||
      cfg.accounts[0] || {
        id: 'default',
        name: '默认',
        baseUrl: '',
        apiKey: '',
        balanceUrl: '{base}/user/balance',
        balanceJsonPath: '',
        currency: 'CNY',
      }
    );
  }

  async start() {
    const cfg = this.config;
    const account = this.selectedAccount();
    let started = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = cfg.proxyPort + attempt;
      try {
        const { server, port: usedPort } = await startProxy({
          port,
          upstreamBase: account.baseUrl,
          apiKey: account.apiKey,
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
      const snapshot = await fetchBalance(this.selectedAccount());
      this.store.recordBalance(snapshot);
      this.emit('balance', snapshot);
      this.checkAlert(snapshot);
    } catch (err) {
      this.store.recordBalanceError(err.message);
      this.emit('balance_error', err.message);
    } finally {
      this.polling = false;
    }
  }

  checkAlert(balance) {
    const threshold = Number(this.config.alertThreshold) || 0;
    if (!threshold || !balance) return;
    if (balance.totalBalance < threshold) {
      if (!this.alertFired) {
        this.alertFired = true;
        this.emit(
          'alert',
          `账户「${this.selectedAccount().name}」余额 ${balance.totalBalance.toFixed(2)} 元，已低于预警线 ${threshold} 元`
        );
      }
    } else {
      this.alertFired = false;
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
    const account = this.selectedAccount();
    let started = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = cfg.proxyPort + attempt;
      try {
        const { server: srv, port: usedPort } = await startProxy({
          port,
          upstreamBase: account.baseUrl,
          apiKey: account.apiKey,
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

  async switchAccount(id) {
    if (!this.config.accounts.some((a) => a.id === id)) throw new Error('账户不存在');
    this.config.selectedAccountId = id;
    saveConfig(this.config);
    this.alertFired = false;
    await this.restartProxy();
    await this.pollBalance();
    this.emit('account_switched', id);
  }

  addRecharge(amount, note) {
    return this.store.recordRecharge({ amount: Number(amount) || 0, note: String(note || '').slice(0, 200) });
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
    const account = this.selectedAccount();
    const balance = this.store.lastBalance;
    const totalRecharges = this.store.totalRecharges();
    return {
      balance,
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
        days: this.store.series('day', 30),
        hours: this.store.series('hour', 24),
      },
      byModel: this.store.byModel(startOf24h),
      recent: this.store.recent(30),
      recharges: {
        list: this.store.listRecharges().slice(0, 20),
        total: totalRecharges,
        consumedEstimate: balance && totalRecharges > 0 ? Math.max(totalRecharges - balance.totalBalance, 0) : null,
      },
      server: { running: Boolean(this.proxyServer), port: this.port },
      config: {
        proxyPort: cfg.proxyPort,
        balancePollMs: cfg.balancePollMs,
        alertThreshold: Number(cfg.alertThreshold) || 0,
        autoStart: cfg.autoStart,
        widget: { ...cfg.widget },
        selectedAccountId: cfg.selectedAccountId,
        accounts: cfg.accounts.map((a) => ({ ...a, apiKey: maskKey(a.apiKey) })),
        hasApiKey: Boolean(account.apiKey),
      },
      pricing: { period: rateFor(null, now).period, accountName: account.name },
    };
  }

  updateConfig(patch) {
    const cfg = { ...this.config, ...patch };
    if (patch.widget) cfg.widget = { ...this.config.widget, ...patch.widget };
    if (Array.isArray(patch.accounts)) cfg.accounts = patch.accounts;
    if (!cfg.accounts.length) cfg.accounts = [{ ...DEFAULTS.accounts[0] }];
    if (!cfg.accounts.some((a) => a.id === cfg.selectedAccountId)) cfg.selectedAccountId = cfg.accounts[0].id;
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
