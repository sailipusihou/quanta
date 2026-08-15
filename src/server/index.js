'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const { Store } = require('./store');
const { fetchBalance, fetchModels, fetchDeepSeekOfficialUsage, fetchDeepSeekTodayUsage, fetchDeepSeekTrendUsage } = require('./balance');
const { startProxy } = require('./proxy');
const { defaultPerTokenCost, rateFor, compareCost, setOfficialRates } = require('./pricing');
const { fetchLatestPrices, fetchDeepSeekOfficialPrices } = require('./prices');
const { getDataDir, loadConfig, saveConfig, maskKey, DEFAULTS, resolveApiKey } = require('./config');
const { createProfileStore } = require('./profiles');

const DEFAULT_PER_TOKEN_CNY = 2.5e-6;

function fileUrl(absPath) {
  if (!absPath) return null;
  return 'file:///' + encodeURI(absPath.replace(/\\/g, '/'));
}

class TokenServer extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.store = new Store(getDataDir());
    this.profiles = createProfileStore();
    // 转发存储层事件（请求/余额/充值…），供 main 进程做实时推送与桌面通知
    this.store.on('event', (e) => this.emit('event', e));
    this.port = null;
    this.proxyServer = null;
    this.pollTimer = null;
    this.polling = false;
    this.alertFired = false;
    this.priceSource = 'local'; // local | official | official-verified
    this.officialMonth = null; // 官网本月消费总结缓存
    this.officialToday = null; // 官网控制台「今日」实时数据缓存（GMT+8 小时级）
    this.officialTrend = null; // 官网近30天消耗趋势缓存（GMT+8 天级）
  }

  // 启动时从 DeepSeek 官网同步价目并注入计价模块（失败静默，不阻塞启动）
  async syncOfficialRates() {
    try {
      const ds = await fetchDeepSeekOfficialPrices();
      if (ds.ok) {
        setOfficialRates({
          'deepseek-v4-flash': ds.official.flash,
          'deepseek-v4-pro': ds.official.pro,
        });
        this.priceSource = ds.matched ? 'official-verified' : 'official';
      } else {
        this.priceSource = 'local';
      }
    } catch {
      this.priceSource = 'local';
    }
    this.emit('prices_synced', { priceSource: this.priceSource });
  }

  // 当前档案绑定的 API Key（无档案时回退账户主 Key）
  activeKey(account) {
    const profile = this.profiles.active();
    let keyId = '';
    if (profile && profile.apiKeyId) keyId = profile.apiKeyId;
    else if (account && Array.isArray(account.apiKeys) && account.apiKeys[0]) keyId = account.apiKeys[0].id;
    return { key: resolveApiKey(account, keyId), keyId };
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

  // 备用账户链（失败降级用）：排除当前账户，按账户列表顺序
  buildFailoverAccounts(cfg, currentId) {
    const out = [];
    for (const a of cfg.accounts) {
      if (a.id === currentId) continue;
      const { key } = this.activeKey(a);
      if (!key) continue;
      const kid = Array.isArray(a.apiKeys) && a.apiKeys[0] ? a.apiKeys[0].id : '';
      out.push({ baseUrl: a.baseUrl, apiKey: key, keyId: kid });
    }
    return out;
  }

  async start() {
    const cfg = this.config;
    const account = this.selectedAccount();
    // 首次启动：自动创建默认用户档案（绑定当前账户与主 Key），滑动切换器立即可用
    if (!this.profiles.list().length) {
      const firstKey = Array.isArray(account.apiKeys) && account.apiKeys[0] ? account.apiKeys[0] : null;
      this.profiles.create({
        name: '默认用户',
        accountId: account.id,
        apiKeyId: firstKey ? firstKey.id : '',
        model: 'deepseek-v4-flash',
      });
    }
    const { key, keyId } = this.activeKey(account);
    const failoverAccounts = cfg.failover && cfg.failover.enabled ? this.buildFailoverAccounts(cfg, account.id) : [];
    let started = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = cfg.proxyPort + attempt;
      try {
        const { server, port: usedPort } = await startProxy({
          port,
          upstreamBase: account.baseUrl,
          apiKey: key,
          keyId,
          tagRules: cfg.tagRules,
          modelRoutes: cfg.modelRoutes,
          failoverAccounts,
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
    // 有平台 Token 时拉取官网消费总结（今日 / 本月 / 30天趋势，之后随余额轮询自动刷新）
    this.refreshOfficialData();
    // 启动后异步从官网同步当前账户的模型列表（失败静默，不阻塞启动）
    this.refreshAccountModels().catch(() => {});
    // 启动后异步从 DeepSeek 官网同步价目并注入计价（失败静默）
    this.syncOfficialRates().catch(() => {});
  }

  // 从官网 /models 拉取当前账户可用模型，合并更新（官网列表优先 + 保留自定义）
  async refreshAccountModels() {
    const account = this.selectedAccount();
    if (!account || !(account.apiKeys && account.apiKeys[0] && account.apiKeys[0].key)) {
      return { fetched: 0, reason: 'no-key' };
    }
    const { key } = this.activeKey(account);
    try {
      const list = await fetchModels(account, key);
      if (!list.length) return { fetched: 0, reason: 'empty' };
      const merged = [...list];
      for (const m of account.models || []) {
        if (!merged.includes(m)) merged.push(m);
      }
      const idx = this.config.accounts.findIndex((a) => a.id === account.id);
      if (idx >= 0) {
        this.config.accounts[idx].models = merged;
        saveConfig(this.config);
        this.emit('models_updated', { accountId: account.id, models: merged });
      }
      return { fetched: list.length, models: merged };
    } catch (err) {
      return { fetched: 0, error: err.message };
    }
  }

  async pollBalance() {
    if (this.polling) return;
    this.polling = true;
    try {
      const account = this.selectedAccount();
      const { key } = this.activeKey(account);
      const snapshot = await fetchBalance(account, key);
      this.store.recordBalance(snapshot);
      this.emit('balance', snapshot);
      this.checkAlert(snapshot);
    } catch (err) {
      this.store.recordBalanceError(err.message);
      this.emit('balance_error', err.message);
    } finally {
      this.polling = false;
    }
    // 官网数据随轮询自动刷新（内部缓存控制频率：今日 5 分钟、本月/趋势 10 分钟）
    this.refreshOfficialData();
  }

  // 刷新官网三份数据（今日 / 本月 / 30天趋势），带并发保护
  async refreshOfficialData() {
    if (this.officialFetching) return;
    this.officialFetching = true;
    try {
      await Promise.allSettled([
        this.fetchOfficialToday(),
        this.fetchOfficialMonthUsage(),
        this.fetchOfficialTrend(),
      ]);
      this.emit('usage_updated');
    } finally {
      this.officialFetching = false;
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
          {
            accountName: this.selectedAccount().name,
            balance: balance.totalBalance.toFixed(2),
            threshold: threshold.toFixed(2),
          }
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
    const { key, keyId } = this.activeKey(account);
    const failoverAccounts = cfg.failover && cfg.failover.enabled ? this.buildFailoverAccounts(cfg, account.id) : [];
    let started = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = cfg.proxyPort + attempt;
      try {
        const { server: srv, port: usedPort } = await startProxy({
          port,
          upstreamBase: account.baseUrl,
          apiKey: key,
          keyId,
          tagRules: this.config.tagRules,
          modelRoutes: this.config.modelRoutes,
          failoverAccounts,
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
    this.config.selectedModel = ''; // 切账户时清空模型，回退该账户首模型
    saveConfig(this.config);
    this.alertFired = false;
    await this.restartProxy();
    await this.pollBalance();
    this.emit('account_switched', id);
  }

  // 余额还能用几天：官网近 30 天日均消耗（排除今天未满整天，用最近 7 个完整天）；无官网数据时回退代理 7 天口径
  estimateDaysLeft() {
    const balance = this.store.lastBalance;
    if (!balance || !(balance.totalBalance > 0)) return null;
    // 官网口径优先：近 7 个完整天的日均消耗
    if (this.officialTrend && this.officialTrend.ok && this.officialTrend.days.length) {
      const days = this.officialTrend.days;
      const full = days.length > 1 ? days.slice(0, -1).slice(-7) : days;
      let cost = 0;
      for (const d of full) cost += d.cost;
      if (cost > 0 && full.length > 0) {
        const daily = cost / full.length;
        return Math.floor(balance.totalBalance / daily);
      }
    }
    const account = this.selectedAccount();
    const profile = this.profiles.active();
    let filterKey = null;
    if (profile && profile.accountId === account.id && profile.apiKeyId) {
      filterKey = profile.apiKeyId;
    } else if (Array.isArray(account.apiKeys) && account.apiKeys[0]) {
      filterKey = account.apiKeys[0].id;
    }
    const weekCost = this.store.statsBetween(Date.now() - 7 * 86400000, Date.now(), filterKey, null).cost;
    if (weekCost <= 0) return null;
    const daily = weekCost / 7;
    return Math.floor(balance.totalBalance / daily);
  }

  // 跨平台比价：官网实时价格优先（force 强制刷新），失败回退内置参考价
  async priceCompare(promptTokens, completionTokens, force = false) {
    const p = Math.max(Number(promptTokens) || 0, 0);
    const c = Math.max(Number(completionTokens) || 0, 0);
    const latest = await fetchLatestPrices(force);
    let rows;
    let source = latest.source;
    if (latest.list && latest.list.length) {
      rows = latest.list
        .map((m) => ({
          platform: m.platform,
          model: m.model,
          inRate: m.inRate,
          outRate: m.outRate,
          cost: (p / 1e6) * m.inRate + (c / 1e6) * m.outRate,
        }))
        .sort((a, b) => a.cost - b.cost);
    } else {
      // 内置参考价兜底
      rows = compareCost(p, c);
      source = 'fallback';
    }
    return { source, fetchedAt: latest.fetchedAt, rows };
  }

  // 官网本月消费总结（需平台登录 userToken；结果缓存 10 分钟，避免频繁调用私有接口）
  async fetchOfficialMonthUsage() {
    const account = this.selectedAccount();
    const token = account && account.platformToken ? account.platformToken : '';
    if (!token) {
      this.officialMonth = null;
      return null;
    }
    if (this.officialMonth && Date.now() - this.officialMonth.fetchedAt < 10 * 60 * 1000) {
      return this.officialMonth;
    }
    const now = new Date();
    const r = await fetchDeepSeekOfficialUsage(token, { month: now.getMonth() + 1, year: now.getFullYear() });
    const result = { ...r, fetchedAt: Date.now() };
    this.officialMonth = result;
    return result;
  }

  // 官网控制台「今日」实时数据（GMT+8 自然日、小时级聚合，与控制台用量页一致；缓存 5 分钟）
  async fetchOfficialToday() {
    const account = this.selectedAccount();
    const token = account && account.platformToken ? account.platformToken : '';
    if (!token) {
      this.officialToday = null;
      return null;
    }
    if (this.officialToday && this.officialToday.ok && Date.now() - this.officialToday.fetchedAt < 5 * 60 * 1000) {
      return this.officialToday;
    }
    const r = await fetchDeepSeekTodayUsage(token);
    this.officialToday = r;
    return r;
  }

  // 官网近 30 天消耗趋势（GMT+8 天级桶，与控制台 30 天趋势图一致；缓存 10 分钟）
  async fetchOfficialTrend() {
    const account = this.selectedAccount();
    const token = account && account.platformToken ? account.platformToken : '';
    if (!token) {
      this.officialTrend = null;
      return null;
    }
    if (this.officialTrend && this.officialTrend.ok && Date.now() - this.officialTrend.fetchedAt < 10 * 60 * 1000) {
      return this.officialTrend;
    }
    const r = await fetchDeepSeekTrendUsage(token);
    this.officialTrend = r;
    return r;
  }

  // 保存官网控制台校准值（今日消耗/Token）
  saveTodayCalibration(cost, tokens) {
    const now = new Date();
    const date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    this.config.todayCalibration = {
      date,
      cost: cost != null && Number.isFinite(Number(cost)) ? Number(cost) : null,
      tokens: tokens != null && Number.isFinite(Number(tokens)) ? Number(tokens) : null,
    };
    saveConfig(this.config);
    return this.config.todayCalibration;
  }

  // 切换表盘档位（账户 + 模型）：切账户 + 记录选中模型 + 重启代理
  async switchModel(accountId, model) {
    if (!this.config.accounts.some((a) => a.id === accountId)) throw new Error('账户不存在');
    this.config.selectedAccountId = accountId;
    this.config.selectedModel = model || '';
    saveConfig(this.config);
    this.alertFired = false;
    await this.restartProxy();
    await this.pollBalance();
    this.emit('model_switched', { accountId, model });
  }

  addRecharge(amount, note) {
    return this.store.recordRecharge({ amount: Number(amount) || 0, note: String(note || '').slice(0, 200) });
  }

  // ---- 用户档案（本地多用户） ----

  createProfile(data) {
    const p = this.profiles.create(data || {});
    this.emit('profiles_changed');
    return p;
  }

  updateProfile(id, patch) {
    const p = this.profiles.update(id, patch || {});
    if (p) this.emit('profiles_changed');
    return p;
  }

  deleteProfile(id) {
    this.profiles.remove(id);
    const active = this.profiles.active();
    if (active && active.accountId && this.config.accounts.some((a) => a.id === active.accountId)) {
      this.config.selectedAccountId = active.accountId;
      saveConfig(this.config);
    }
    this.emit('profiles_changed');
    return true;
  }

  // 切换档案 = 一键切换「平台账户 + API Key + 模型」整套配置
  async switchProfile(id) {
    if (!this.profiles.setActive(id)) throw new Error('档案不存在');
    const profile = this.profiles.active();
    if (profile && profile.accountId && this.config.accounts.some((a) => a.id === profile.accountId)) {
      this.config.selectedAccountId = profile.accountId;
      this.config.selectedModel = ''; // 切档案时清空模型，回退档案/账户模型
      saveConfig(this.config);
    }
    this.alertFired = false;
    await this.restartProxy();
    await this.pollBalance();
    this.emit('profile_switched', id);
  }

  estimateRemainingTokens() {
    const balance = this.store.lastBalance;
    if (!balance || !(balance.totalBalance > 0)) return null;
    // 官网口径优先：本月实际综合单价（含缓存命中与全部请求，最接近真实）
    let perToken = null;
    if (
      this.officialMonth &&
      this.officialMonth.ok &&
      this.officialMonth.cost != null &&
      this.officialMonth.tokens != null &&
      this.officialMonth.tokens > 0 &&
      this.officialMonth.cost > 0
    ) {
      perToken = this.officialMonth.cost / this.officialMonth.tokens;
    }
    // 次选：官网近 30 天实际综合单价（排除今天未满整天）
    if (
      perToken == null &&
      this.officialTrend &&
      this.officialTrend.ok &&
      this.officialTrend.days &&
      this.officialTrend.days.length > 1
    ) {
      const full = this.officialTrend.days.slice(0, -1);
      let cost = 0;
      let tokens = 0;
      for (const d of full) {
        cost += d.cost;
        tokens += d.tokens;
      }
      if (tokens > 0 && cost > 0) perToken = cost / tokens;
    }
    if (perToken != null && perToken > 0) {
      return Math.floor(balance.totalBalance / perToken);
    }
    const account = this.selectedAccount();
    const profile = this.profiles.active();
    let filterKey = null;
    if (profile && profile.accountId === account.id && profile.apiKeyId) {
      filterKey = profile.apiKeyId;
    } else if (Array.isArray(account.apiKeys) && account.apiKeys[0]) {
      filterKey = account.apiKeys[0].id;
    }
    // 账户级估算（全部模型，与官网口径一致）
    const recent = this.store.events
      .filter(
        (e) =>
          e.kind === 'request' &&
          e.usage &&
          e.usage.totalTokens > 0 &&
          (!filterKey || !e.keyId || e.keyId === filterKey)
      )
      .slice(-100);
    let cost = 0;
    let tokens = 0;
    for (const e of recent) {
      cost += e.cost;
      tokens += e.usage.totalTokens;
    }
    let fallbackPerToken;
    if (tokens > 0 && cost > 0) {
      fallbackPerToken = cost / tokens;
    } else {
      const models = this.store.byModel(Date.now() - 30 * 86400000, filterKey, null);
      const dominant = models[0];
      fallbackPerToken = dominant ? defaultPerTokenCost(dominant.model) : DEFAULT_PER_TOKEN_CNY;
    }
    return Math.floor(balance.totalBalance / fallbackPerToken);
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
    // 官网控制台校准值（仅当日有效）
    const cal = cfg.todayCalibration || {};
    const calDate = cal.date || '';
    const todayStr =
      new Date(now).getFullYear() + '-' + String(new Date(now).getMonth() + 1).padStart(2, '0') + '-' + String(new Date(now).getDate()).padStart(2, '0');
    const todayCalibration = calDate === todayStr && (cal.cost != null || cal.tokens != null) ? cal : null;
    // 官网本月消费总结（有 platformToken 时异步拉取，失败不影响主流程）
    const officialMonth = this.officialMonth || null;
    // 官网控制台「今日」实时数据（GMT+8 小时级）
    const officialToday = this.officialToday && this.officialToday.ok ? this.officialToday : null;
    // 官网近 30 天消耗趋势（GMT+8 天级）
    const officialTrend = this.officialTrend && this.officialTrend.ok ? this.officialTrend : null;
    // 金额/趋势统计：账户级（当前 Key 全部模型，与官网口径一致）；
    // 明细表（recent）保留模型筛选（表盘档位=模型 的联动仍在明细体现）
    const activeProfile = this.profiles.active();
    const filterKey = (() => {
      if (activeProfile && activeProfile.accountId === account.id && activeProfile.apiKeyId) {
        return activeProfile.apiKeyId;
      }
      if (Array.isArray(account.apiKeys) && account.apiKeys[0]) return account.apiKeys[0].id;
      return null;
    })();
    const currentModel =
      cfg.selectedModel || (Array.isArray(account.models) && account.models[0]) || null;
    return {
      currentModel,
      daysLeft: this.estimateDaysLeft(),
      balance,
      // 官网口径消耗（余额变化法，含未走代理的扣费）
      todayOfficial: this.store.officialCostBetween(startOfToday.getTime(), now),
      last24hOfficial: this.store.officialCostBetween(now - 24 * 3600000, now),
      monthOfficial: this.store.officialCostBetween(startOfMonth.getTime(), now),
      todayCalibration,
      officialMonth,
      officialToday,
      officialTrend,
      balanceError: this.store.lastBalanceError,
      estimatedTokens: this.estimateRemainingTokens(),
      stats: {
        today: this.store.stats(startOfToday.getTime(), filterKey, null),
        month: this.store.stats(startOfMonth.getTime(), filterKey, null),
        last24h: this.store.stats(startOf24h, filterKey, null),
        week: this.store.stats(now - 7 * 86400000, filterKey, null),
        all: this.store.stats(0, filterKey, null),
      },
      series: {
        days: this.store.series('day', 30, filterKey, null),
        hours: this.store.series('hour', 24, filterKey, null),
      },
      byModel: this.store.byModel(startOf24h, filterKey, null),
      byTag: this.store.byTag(startOf24h, filterKey, null),
      recent: this.store.recent(30, filterKey, currentModel),
      recharges: {
        list: this.store.listRecharges().slice(0, 20),
        total: totalRecharges,
        consumedEstimate: balance && totalRecharges > 0 ? Math.max(totalRecharges - balance.totalBalance, 0) : null,
      },
      profiles: {
        activeId: this.profiles.data.activeProfileId,
        list: this.profiles.list().map((p) => ({
          ...p,
          avatarUrl: fileUrl(this.profiles.avatarAbsPath(p)),
        })),
      },
      server: { running: Boolean(this.proxyServer), port: this.port },
      config: {
        proxyPort: cfg.proxyPort,
        balancePollMs: cfg.balancePollMs,
        alertThreshold: Number(cfg.alertThreshold) || 0,
        requestNotify: cfg.requestNotify || 'all',
        language: cfg.language || 'zh',
        theme: cfg.theme || 'black',
        updateFeedUrl: cfg.updateFeedUrl || '',
        tagRules: Array.isArray(cfg.tagRules) ? cfg.tagRules : [],
        modelRoutes: Array.isArray(cfg.modelRoutes) ? cfg.modelRoutes : [],
        failover: cfg.failover && cfg.failover.enabled ? { enabled: true } : { enabled: false },
        autoStart: cfg.autoStart,
        widget: { ...cfg.widget },
        selectedAccountId: cfg.selectedAccountId,
        selectedModel: cfg.selectedModel || '',
        accounts: cfg.accounts.map((a) => ({
          ...a,
          apiKey: maskKey(a.apiKey),
          apiKeys: Array.isArray(a.apiKeys)
            ? a.apiKeys.map((k) => ({ ...k, key: k.key ? maskKey(k.key) : '' }))
            : [],
          models: Array.isArray(a.models) ? a.models : [],
          platformToken: a.platformToken ? '****' : '',
          hasPlatformToken: Boolean(a.platformToken),
        })),
        hasApiKey: Boolean(account.apiKey || (Array.isArray(account.apiKeys) && account.apiKeys.length)),
      },
      pricing: {
        period: rateFor(null, now).period,
        accountName: account.name,
        priceSource: this.priceSource || 'local',
      },
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
