'use strict';
// 探测官网 usage 接口的 days 日期键与今日数据（GMT+8 验证）
const fs = require('fs');
const path = require('path');
const { fetchDeepSeekOfficialUsage, requestJson } = require('../src/server/balance');

async function main() {
const dataDir = path.join(process.env.APPDATA, 'Quanta', 'data');
const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
const acc = (cfg.accounts || []).find((a) => a.id === cfg.selectedAccountId) || (cfg.accounts || [])[0];
const token = (acc && acc.platformToken) || (cfg.deepseek && cfg.deepseek.platformToken);
if (!token) { console.log('NO TOKEN'); process.exit(1); }
console.log('account:', acc && acc.name, '| token len:', token.length);

const now = new Date();
const m = now.getMonth() + 1, y = now.getFullYear();
const localToday = `${y}-${String(m).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const utcToday = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
console.log('local today:', localToday, '| UTC today:', utcToday, '| local offset min:', now.getTimezoneOffset());

const DS = 'https://platform.deepseek.com/api/v0/usage';
for (const ep of ['cost', 'amount']) {
  const { body, status } = await requestJson(`${DS}/${ep}?month=${m}&year=${y}`, { apiKey: token }).catch((e) => ({ error: e.message }));
  if (body === undefined) { console.log(`[${ep}] ERROR:`, status, body); continue; }
  const entry = Array.isArray(body.data?.biz_data) ? body.data.biz_data[0] : body.data?.biz_data;
  if (!entry) { console.log(`[${ep}] no biz_data; raw keys:`, Object.keys(body.data || {})); continue; }
  console.log(`\n===== ${ep} =====`);
  console.log('currency:', entry.currency, '| total entries:', (entry.total || []).length, '| days entries:', (entry.days || []).length);
  // 汇总 total
  let totCost = 0, totReq = 0;
  for (const mm of entry.total || []) for (const u of mm.usage || []) {
    totCost += Number(u.amount) || 0;
    if (u.type === 'REQUEST') totReq += Number(u.amount) || 0;
  }
  console.log('TOTAL sum:', totCost, '| requests:', totReq);
  console.log('total breakdown by type:');
  const byType = {};
  for (const mm of entry.total || []) for (const u of mm.usage || []) byType[u.type] = (byType[u.type] || 0) + (Number(u.amount) || 0);
  console.log(JSON.stringify(byType));
  // 逐日明细：打印每个日期及其总额
  const days = entry.days || [];
  console.log('--- days (all) ---');
  for (const d of days) {
    let s = 0;
    const t = {};
    for (const mm of d.data || []) for (const u of mm.usage || []) {
      s += Number(u.amount) || 0;
      t[u.type] = (t[u.type] || 0) + (Number(u.amount) || 0);
    }
    const flag = d.date === localToday ? ' <== LOCAL TODAY' : d.date === utcToday ? ' <== UTC TODAY' : '';
    console.log(`${d.date}  sum=${s}  ${JSON.stringify(t)}${flag}`);
  }
}
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
