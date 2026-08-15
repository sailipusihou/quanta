'use strict';
// 探测：get_user_summary 完整结构 + 尝试可能的"今日消费"端点
const fs = require('fs');
const path = require('path');
const { requestJson } = require('../src/server/balance');

async function main() {
  const dataDir = path.join(process.env.APPDATA, 'Quanta', 'data');
  const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  const acc = (cfg.accounts || []).find((a) => a.id === cfg.selectedAccountId) || (cfg.accounts || [])[0];
  const token = (acc && acc.platformToken) || (cfg.deepseek && cfg.deepseek.platformToken);

  // 1) get_user_summary 完整 dump
  const r1 = await requestJson('https://platform.deepseek.com/api/v0/users/get_user_summary', { apiKey: token }).catch((e) => ({ error: e.message }));
  console.log('=== get_user_summary ===');
  console.log(JSON.stringify(r1.body || r1.error, null, 1).slice(0, 2500));

  // 2) usage/cost 原始结构（含顶层所有字段）
  const now = new Date();
  const m = now.getMonth() + 1, y = now.getFullYear();
  const r2 = await requestJson(`https://platform.deepseek.com/api/v0/usage/cost?month=${m}&year=${y}`, { apiKey: token }).catch((e) => ({ error: e.message }));
  console.log('\n=== usage/cost top-level keys ===');
  console.log('data keys:', r2.body && r2.body.data ? Object.keys(r2.body.data) : r2.error);
  console.log('biz_data[0] keys:', r2.body && r2.body.data && r2.body.data.biz_data && r2.body.data.biz_data[0] ? Object.keys(r2.body.data.biz_data[0]) : 'n/a');
  console.log('first day entry keys:', r2.body && r2.body.data && r2.body.data.biz_data && r2.body.data.biz_data[0] && r2.body.data.biz_data[0].days && r2.body.data.biz_data[0].days[0] ? Object.keys(r2.body.data.biz_data[0].days[0]) : 'n/a');

  // 3) 尝试常见"今日/概览"端点（404 无妨）
  const candidates = [
    'https://platform.deepseek.com/api/v0/usage/today',
    'https://platform.deepseek.com/api/v0/usage/overview',
    'https://platform.deepseek.com/api/v0/usage/statistics',
    'https://platform.deepseek.com/api/v0/usage/summary',
    'https://platform.deepseek.com/api/v0/users/get_user',
    'https://platform.deepseek.com/api/v0/users/get_user_info',
    'https://platform.deepseek.com/api/v0/users/get_user_detail',
    'https://platform.deepseek.com/api/v0/users/get_user_stats',
    'https://platform.deepseek.com/api/v0/account/usage',
    'https://platform.deepseek.com/api/v0/usage/dashboard',
  ];
  for (const u of candidates) {
    const r = await requestJson(u, { apiKey: token, timeoutMs: 8000 }).catch((e) => ({ error: e.message }));
    const label = r.body ? ('OK ' + JSON.stringify(r.body).slice(0, 400)) : ('ERR ' + r.error);
    console.log(`\n[${u}] -> ${label}`);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
