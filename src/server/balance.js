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

async function fetchBalance({ apiKey, upstreamBase }) {
  const base = String(upstreamBase || '').replace(/\/+$/, '');
  const { body } = await requestJson(`${base}/user/balance`, { apiKey });
  const info = (body.balance_infos || [])[0] || {};
  return {
    ok: true,
    currency: info.currency || 'CNY',
    isAvailable: Boolean(body.is_available),
    totalBalance: Number(info.total_balance) || 0,
    grantedBalance: Number(info.granted_balance) || 0,
    toppedUpBalance: Number(info.topped_up_balance) || 0,
    fetchedAt: Date.now(),
  };
}

module.exports = { fetchBalance, requestJson };
