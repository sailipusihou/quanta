'use strict';
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/console-js/main.fafba25c5d.js', 'utf8');

function ctx(label, needle, before = 300, after = 500, max = 8) {
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

ctx('H3_DEF', 'h3=');
ctx('H3_CALL', 'h3(');
ctx('START_SEC', 'startSec');
ctx('TZ_SEC', 'tzSec');
ctx('BUCKET', 'bucket');
ctx('DAY_BUCKET', '"day"');
