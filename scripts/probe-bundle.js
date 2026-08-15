'use strict';
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/console-js/main.fafba25c5d.js', 'utf8');

function ctx(label, needle, before = 400, after = 600, max = 6) {
  console.log(`\n########## ${label} (${needle}) ##########`);
  let idx = 0, n = 0;
  while (n < max) {
    idx = src.indexOf(needle, idx);
    if (idx < 0) break;
    console.log(`--- hit at ${idx} ---`);
    console.log(src.slice(Math.max(0, idx - before), Math.min(src.length, idx + after)));
    idx += needle.length;
    n++;
  }
}

ctx('USAGE_DAY', 'usage/cost');
ctx('BY_API_KEY', 'by_api_key');
ctx('TODAY_CN', '今日');
ctx('TZ', 'Asia/Shanghai');
ctx('UTC', 'utc');
