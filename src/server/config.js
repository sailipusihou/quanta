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
  apiKey: '',
  upstreamBase: 'https://api.deepseek.com',
  proxyPort: 8787,
  balancePollMs: 60000,
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
  return {
    ...DEFAULTS,
    ...saved,
    widget: { ...DEFAULTS.widget, ...(saved.widget || {}) },
  };
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

module.exports = { loadConfig, saveConfig, maskKey, getDataDir, getConfigPath, DEFAULTS };
