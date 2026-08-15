'use strict';
// 扒控制台前端 JS：找 usage 相关端点与"今日"计算逻辑
const fs = require('fs');
const path = require('path');
const https = require('https');
const { requestJson } = require('../src/server/balance');

function get(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(u, { method: 'GET', timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // 1) 控制台首页 HTML
  const home = await get('https://platform.deepseek.com/').catch((e) => ({ error: e.message }));
  if (home.error) { console.log('home ERR', home.error); return; }
  console.log('home status:', home.status, '| len:', home.body.length);
  const scripts = [...home.body.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
  console.log('scripts:', JSON.stringify(scripts.slice(0, 30)));
  // 也可能是 /assets/index-xxx.js
  const assetIdx = home.body.match(/assets\/index-[^"]+\.js/);
  console.log('assetIdx:', assetIdx && assetIdx[0]);

  // 2) 下载所有 js 找 usage 相关
  const urls = [...new Set([...scripts, ...(assetIdx ? [assetIdx[0]] : [])].map((s) => (s.startsWith('http') ? s : 'https://platform.deepseek.com' + (s.startsWith('/') ? s : '/' + s))))];
  const dir = path.join(__dirname, 'console-js');
  fs.mkdirSync(dir, { recursive: true });
  const findings = [];
  for (const u of urls) {
    const r = await get(u).catch((e) => ({ error: e.message }));
    if (r.error) { console.log('DL ERR', u, r.error); continue; }
    const name = path.basename(u.split('?')[0]);
    fs.writeFileSync(path.join(dir, name), r.body);
    console.log('DL ok', name, r.body.length);
    // 找 usage 端点字符串
    for (const m of r.body.matchAll(/["'`]\/api\/v0\/[^"'`]{0,80}/g)) {
      const s = m[0];
      if (/usage|bill|consum|expense|stat/i.test(s)) findings.push(s);
    }
  }
  console.log('\n=== api strings found ===');
  console.log([...new Set(findings)].join('\n'));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
