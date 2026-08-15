'use strict';
// 验证控制台真实端点：by_api_key/cost + by_api_key/amount（tz=28800）
const fs = require('fs');
const path = require('path');
const { requestJson } = require('../src/server/balance');

const TZ = 28800; // GMT+8 秒数

function tzSecToUnix(ts, tzSec) { return Math.floor(ts / 1000) - tzSec; }

async function main() {
  const dataDir = path.join(process.env.APPDATA, 'Quanta', 'data');
  const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  const acc = (cfg.accounts || []).find((a) => a.id === cfg.selectedAccountId) || (cfg.accounts || [])[0];
  const token = (acc && acc.platformToken) || (cfg.deepseek && cfg.deepseek.platformToken);

  const now = new Date();
  // 今天 00:00 GMT+8 → unix 秒：用 UTC 偏移计算
  const todayStartBeijing = new Date(now.getTime());
  todayStartBeijing.setUTCHours(now.getUTCHours() - (now.getUTCHours() + 8) % 24 + 0, 0, 0, 0); // 简化：下面用清晰算法
  // 清晰算法：北京今天 00:00 对应的 UTC 时间
  const bjNow = new Date(now.getTime() + 8 * 3600 * 1000); // 北京时间
  const bjTodayMidnight = Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), bjNow.getUTCDate(), 0, 0, 0, 0) - 8 * 3600 * 1000; // 北京今天00:00的UTC毫秒
  const bjTomorrowMidnight = bjTodayMidnight + 86400 * 1000;
  const startSec = Math.floor(bjTodayMidnight / 1000);
  const endSec = Math.floor(bjTomorrowMidnight / 1000);
  const nowSec = Math.floor(now.getTime() / 1000);
  console.log('now:', now.toISOString(), '| startSec:', startSec, '| endSec:', endSec, '| nowSec:', nowSec);

  async function call(ep, start, end, tz) {
    const url = `https://platform.deepseek.com/api/v0/usage/by_api_key/${ep}?start=${start}&end=${end}&tz=${tz}`;
    const r = await requestJson(url, { apiKey: token }).catch((e) => ({ error: e.message }));
    return r;
  }

  // 1) 今日（北京时间）cost —— end 用明天00:00（整点对齐，同控制台）
  const c1 = await call('cost', startSec, endSec, TZ);
  console.log('\n=== TODAY cost ===');
  console.log(c1.error ? 'ERR ' + c1.error : JSON.stringify(c1.body).slice(0, 2000));
  if (c1.body && c1.body.data && c1.body.data.biz_data) {
    const b = c1.body.data.biz_data;
    let tot = 0; const byModel = {};
    const list = b.data || b.series || [];
    for (const s of list) {
      const series = s.series ? s.series : [s];
      for (const ss of series) {
        for (const bk of ss.buckets || []) { tot += Number(bk.cost) || 0; byModel[ss.model] = (byModel[ss.model] || 0) + (Number(bk.cost) || 0); }
      }
    }
    console.log('bucket:', b.bucket, '| start:', b.start, '| end:', b.end, '| models:', JSON.stringify(b.models));
    console.log('TODAY COST SUM:', tot, '| byModel:', JSON.stringify(byModel));
  }

  // 2) 今日 amount
  const a1 = await call('amount', startSec, endSec, TZ);
  console.log('\n=== TODAY amount ===');
  if (a1.error) console.log('ERR ' + a1.error);
  else {
    if (!a1.body.data.biz_data) { console.log('biz_data null:', JSON.stringify(a1.body).slice(0, 400)); }
    else {
    const b = a1.body.data.biz_data;
    let tok = 0, req = 0; const byModel = {};
    for (const s of b.series || []) {
      for (const bk of s.buckets || []) {
        const u = bk.usage || {};
        const t = (Number(u.PROMPT_CACHE_HIT_TOKEN) || 0) + (Number(u.PROMPT_CACHE_MISS_TOKEN) || 0) + (Number(u.RESPONSE_TOKEN) || 0);
        tok += t; req += Number(u.REQUEST) || 0;
        byModel[s.model] = (byModel[s.model] || 0) + t;
      }
    }
    console.log('bucket:', b.bucket, '| TIDAY TOKENS SUM:', tok, '| REQUESTS:', req, '| byModel:', JSON.stringify(byModel));
    // 逐桶明细（小时级）
    console.log('first series buckets:', JSON.stringify((b.series || [])[0] && (b.series || [])[0].buckets || []).slice(0, 800));
    }
  }

  // 3) 本月（北京时区整月）cost 对比 usage/cost 月汇总
  const monthStart = Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), 1, 0, 0, 0, 0) - 8 * 3600 * 1000;
  const monthEnd = Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth() + 1, 1, 0, 0, 0, 0) - 8 * 3600 * 1000;
  const c2 = await call('cost', Math.floor(monthStart / 1000), Math.floor(monthEnd / 1000), TZ);
  console.log('\n=== MONTH cost (tz=28800) ===');
  if (c2.error) console.log('ERR ' + c2.error);
  else {
    const b = c2.body.data.biz_data;
    let tot = 0;
    const list = b.data || b.series || [];
    for (const s of list) {
      const series = s.series ? s.series : [s];
      for (const ss of series) for (const bk of ss.buckets || []) tot += Number(bk.cost) || 0;
    }
    console.log('bucket:', b.bucket, '| MONTH COST SUM:', tot);
  }
  const a2 = await call('amount', Math.floor(monthStart / 1000), Math.floor(monthEnd / 1000), TZ);
  if (!a2.error) {
    const b = a2.body.data.biz_data;
    let tok = 0, req = 0;
    for (const s of b.series || []) for (const bk of s.buckets || []) {
      const u = bk.usage || {};
      tok += (Number(u.PROMPT_CACHE_HIT_TOKEN) || 0) + (Number(u.PROMPT_CACHE_MISS_TOKEN) || 0) + (Number(u.RESPONSE_TOKEN) || 0);
      req += Number(u.REQUEST) || 0;
    }
    console.log('MONTH TOKENS:', tok, '| REQUESTS:', req, '| bucket:', b.bucket);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
