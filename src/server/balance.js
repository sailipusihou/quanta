'use strict';

const http = require('http');
const https = require('https');

function requestJson(url, { apiKey, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          }
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            reject(new Error(`响应不是合法 JSON: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

function getPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split(/\.|\[|\]/).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

async function fetchBalance(account) {
  const base = String(account.baseUrl || '').replace(/\/+$/, '');
  const url = String(account.balanceUrl || '{base}/user/balance').replace('{base}', base);
  const { body } = await requestJson(url, { apiKey: account.apiKey });
  const totalBalance = Number(getPath(body, account.balanceJsonPath));
  return {
    ok: true,
    currency: account.currency || 'CNY',
    isAvailable: body.is_available !== false,
    totalBalance: Number.isFinite(totalBalance) ? totalBalance : 0,
    grantedBalance: Number(getPath(body, 'balance_infos[0].granted_balance')) || 0,
    toppedUpBalance: Number(getPath(body, 'balance_infos[0].topped_up_balance')) || 0,
    fetchedAt: Date.now(),
  };
}

module.exports = { fetchBalance, requestJson, getPath };
