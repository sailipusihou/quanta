'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  apiKey: '',
  upstreamBase: 'https://api.deepseek.com',
  proxyPort: 8787,
  balancePollMs: 60000,
  autoStart: false,
  widget: { x: null, y: null, width: 360, height: 148 },
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig() {
  ensureDataDir();
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
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
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return '*'.repeat(key.length);
  return key.slice(0, 3) + '****' + key.slice(-4);
}

module.exports = { loadConfig, saveConfig, maskKey, DATA_DIR, CONFIG_PATH, DEFAULTS };
