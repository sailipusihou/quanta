'use strict';

const { requestJson } = require('./balance');

function parseVersion(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return m.slice(1).map(Number);
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function checkForUpdate({ feedUrl, currentVersion, apiKey }) {
  if (!feedUrl) {
    return { status: 'no-feed', message: '未配置更新源' };
  }
  try {
    const { body } = await requestJson(feedUrl, { apiKey: apiKey || '' });
    const version = body.version || body.tag_name || '';
    const url = body.url || body.html_url || body.downloadUrl || '';
    const notes = body.notes || body.body || '';
    if (version && isNewer(version, currentVersion)) {
      return { status: 'update-available', version, url, notes, currentVersion };
    }
    return { status: 'up-to-date', version, currentVersion };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

module.exports = { checkForUpdate, parseVersion, isNewer };
