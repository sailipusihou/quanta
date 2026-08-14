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
      balanceUrl: '{base}/user/balance',
      balanceJsonPath: 'balance_infos[0].total_balance',
      currency: 'CNY',
    },
  ],
  selectedAccountId: 'deepseek',
  proxyPort: 8787,
  balancePollMs: 60000,
  alertThreshold: 0,
  requestNotify: 'all', // off | error | all
  language: 'zh', // zh | en
  updateFeedUrl: '',
  tagRules: [],
  autoStart: false,
  widget: { x: null, y: null, width: 360, height: 148 },
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
    accounts: (saved.accounts && saved.accounts.length ? saved.accounts : DEFAULTS.accounts).map((a) => ({
      ...DEFAULTS.accounts[0],
      ...a,
    })),
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

module.exports = { loadConfig, saveConfig, maskKey, getDataDir, getConfigPath, DEFAULTS, uniqueId };
