'use strict';

// 核销码生成工具（卖家侧，自己留着用，不要随应用分发）
//
// 用法：
//   node scripts/gen-license.js 7d 5        # 生成 5 个七天版
//   node scripts/gen-license.js 30d         # 生成 1 个一个月版
//   node scripts/gen-license.js m30 3       # 同上，3 个
//   node scripts/gen-license.js life        # 生成 1 个买断版
//   node scripts/gen-license.js life 10     # 生成 10 个买断版
//   node scripts/gen-license.js check <码>  # 校验一个码是否有效
//   node scripts/gen-license.js status      # 查看本机当前核销状态
//   node scripts/gen-license.js clear       # 清空本机核销记录（自测用）
//
// 可选参数：--serial=1234 指定序号；--issued=120 指定签发日（自 2026-01-01 起的天数）
// 输出为「码,档位,签发日,序号」CSV，便于登记出售记录。

const fs = require('fs');
const path = require('path');
const { generateCode, verifyCode, status, clear, TIERS } = require('../src/server/license');

const ALIAS = { '7': 'd7', '7d': 'd7', '7天': 'd7', week: 'd7', '30': 'm30', '30d': 'm30', '1m': 'm30', '一个月': 'm30', month: 'm30', life: 'life', lifetime: 'life', forever: 'life', '买断': 'life', '永久': 'life' };

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '-h' || cmd === '--help') return usage();

  if (cmd === 'status') {
    console.log(JSON.stringify(status(), null, 2));
    return;
  }
  if (cmd === 'clear') {
    console.log(clear() ? '已清空本机核销记录' : '没有核销记录可清空');
    return;
  }
  if (cmd === 'check') {
    const r = verifyCode(args[1]);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const tier = ALIAS[String(cmd).toLowerCase()] || ALIAS[cmd];
  if (!tier) {
    console.error(`未知档位：${cmd}\n可选：7d / 30d / m30 / life`);
    process.exit(1);
  }
  const count = Math.max(1, Number(args[1]) || 1);
  const serialArg = args.find((a) => a.startsWith('--serial='));
  const issuedArg = args.find((a) => a.startsWith('--issued='));
  const baseSerial = serialArg ? Number(serialArg.split('=')[1]) : null;

  console.log(`# 档位：${TIERS[Object.keys(TIERS).find((k) => TIERS[k].id === tier)].labelZh}  数量：${count}`);
  console.log('code,tier,issuedDate,serial');
  for (let i = 0; i < count; i++) {
    const r = generateCode(tier, {
      serial: baseSerial != null ? baseSerial + i : undefined,
      issuedDay: issuedArg ? Number(issuedArg.split('=')[1]) : undefined,
    });
    console.log(`${r.code},${r.tier},${r.issuedDate},${r.serial}`);
  }
}

main();
