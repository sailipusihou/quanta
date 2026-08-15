'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// 打包安装版时由 main.js 注入系统用户数据目录；源码/测试模式回落项目内 data/
// 注意：必须在每次使用时动态读取，避免 require 时机过早导致目录被定死。
function getDataDir() {
  return process.env.TOKEN_DATA_DIR || path.join(ROOT, 'data');
}

function getConfigPath() {
  return path.join(getDataDir(), 'config.json');
}

const DEFAULTS = {
  accounts: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      apiKeys: [], // 多 Key 支持：[{ id, label, key }]
      models: [], // 账户下的模型列表（空 = 渲染层用平台预设）
      platformToken: '', // 平台登录 userToken（可选：用于官网消费总结/明细对账）
      balanceUrl: '{base}/user/balance',
      balanceJsonPath: 'balance_infos[0].total_balance',
      currency: 'CNY',
    },
  ],
  selectedAccountId: 'deepseek',
  selectedModel: '', // 当前表盘选中的模型（空 = 跟随档案/客户端）
  proxyPort: 8787,
  balancePollMs: 60000,
  alertThreshold: 0,
  requestNotify: 'all', // off | error | all
  language: 'zh', // zh | en
  theme: 'black', // black(纯黑) | aurora(极光玻璃)
  updateFeedUrl: 'https://api.github.com/repos/sailipusihou/quanta/releases/latest',
  tagRules: [],
  // 官网控制台校准值（用户手动录入：今日消耗/Token，按日期生效）
  todayCalibration: { date: '', cost: null, tokens: null },
  // 自动省钱路由：请求模型匹配 pattern 时改写为 to 模型
  modelRoutes: [],
  // 失败自动降级：主平台 429/5xx/断连时按账户顺序自动切备用平台重试
  failover: { enabled: false },
  autoStart: false,
  widget: { x: null, y: null, width: 360, height: 148, alwaysOnTop: true },
};

function ensureDataDir() {
  fs.mkdirSync(getDataDir(), { recursive: true });
}

function loadConfig() {
  ensureDataDir();
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    saved = {};
  }
  let cfg = {
    ...DEFAULTS,
    ...saved,
    accounts: (saved.accounts && saved.accounts.length ? saved.accounts : DEFAULTS.accounts).map((a) => {
      const merged = { ...DEFAULTS.accounts[0], ...a };
      // 旧版单 Key 字段迁移为 apiKeys[]（多 Key 追踪）
      if (!Array.isArray(merged.apiKeys) || !merged.apiKeys.length) {
        merged.apiKeys = merged.apiKey
          ? [{ id: 'k1', label: '主 Key', key: merged.apiKey }]
          : [];
      }
      if (!Array.isArray(merged.models)) merged.models = [];
      return merged;
    }),
    widget: { ...DEFAULTS.widget, ...(saved.widget || {}) },
  };
  // 旧版本配置迁移：顶层 apiKey/upstreamBase 并入首个账户
  if (!saved.accounts || !saved.accounts.length) {
    cfg.accounts[0].apiKey = saved.apiKey || cfg.accounts[0].apiKey;
    cfg.accounts[0].baseUrl = saved.upstreamBase || cfg.accounts[0].baseUrl;
  }
  if (!cfg.accounts.some((a) => a.id === cfg.selectedAccountId)) {
    cfg.selectedAccountId = cfg.accounts[0].id;
  }
  return cfg;
}

function saveConfig(cfg) {
  ensureDataDir();
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return '*'.repeat(key.length);
  return key.slice(0, 3) + '****' + key.slice(-4);
}

function uniqueId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// 解析账户实际使用的 API Key：优先按 keyId 命中 apiKeys[]，否则回退主 Key
function resolveApiKey(account, keyId) {
  if (!account) return '';
  if (keyId && Array.isArray(account.apiKeys)) {
    const hit = account.apiKeys.find((k) => k && k.id === keyId && k.key);
    if (hit) return hit.key;
  }
  if (Array.isArray(account.apiKeys) && account.apiKeys.length && account.apiKeys[0].key) {
    return account.apiKeys[0].key;
  }
  return account.apiKey || '';
}

// 解析 keyId 的标签（用于明细表/通知展示）
function resolveApiKeyLabel(account, keyId) {
  if (!account) return '';
  if (keyId && Array.isArray(account.apiKeys)) {
    const hit = account.apiKeys.find((k) => k && k.id === keyId);
    if (hit) return hit.label || hit.id;
  }
  return '';
}

module.exports = { loadConfig, saveConfig, maskKey, getDataDir, getConfigPath, DEFAULTS, uniqueId, resolveApiKey, resolveApiKeyLabel };
