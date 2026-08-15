'use strict';
// 探测 usage 接口的参数变体：小时粒度 / 时段参数 / 时区参数
const fs = require('fs');
const path = require('path');
const { requestJson } = require('../src/server/balance');

async function main() {
  const dataDir = path.join(process.env.APPDATA, 'Quanta', 'data');
  const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  const acc = (cfg.accounts || []).find((a) => a.id === cfg.selectedAccountId) || (cfg.accounts || [])[0];
  const token = (acc && acc.platformToken) || (cfg.deepseek && cfg.deepseek.platformToken);

  const base = 'https://platform.deepseek.com/api/v0/usage';
  const variants = [
    'cost?month=8&year=2026&time_type=1',
    'cost?month=8&year=2026&time_type=2',
    'cost?month=8&year=2026&granularity=hour',
    'cost?month=8&year=2026&tz=Asia/Shanghai',
    'cost?month=8&year=2026&timezone=8',
    'cost?month=8&year=2026&offset=8',
    'cost?start_time=2026-08-15&end_time=2026-08-15',
    'cost?start=2026-08-15&end=2026-08-15',
    'cost?day=2026-08-15',
    'cost?date=2026-08-15',
    'cost',
    'amount?month=8&year=2026&time_type=1',
    'amount',
    'hour?month=8&year=2026',
    'day?month=8&year=2026',
    'cost?month=8&year=2026&time_type=hour',
  ];
  for (const v of variants) {
    const r = await requestJson(`${base}/${v}`, { apiKey: token, timeoutMs: 8000 }).catch((e) => ({ error: e.message }));
    let label;
    if (r.body) {
      const d = r.body.data;
      const biz = Array.isArray(d && d.biz_data) ? d.biz_data[0] : (d && d.biz_data);
      if (biz && biz.days) label = `OK days=${biz.days.length} first=${JSON.stringify(biz.days[0]).slice(0, 120)} last=${JSON.stringify(biz.days[biz.days.length - 1]).slice(0, 120)}`;
      else label = 'OK ' + JSON.stringify(r.body).slice(0, 300);
    } else {
      label = 'ERR ' + r.error;
    }
    console.log(`[${v}] -> ${label}`);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
