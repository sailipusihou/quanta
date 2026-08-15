'use strict';

function toCsv(rows) {
  const header = ['时间', '模型', 'API Key', '标签', '状态', '输入Token', '输出Token', '缓存命中', '缓存未命中', '金额(元)', '耗时(ms)', '流式', '错误'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const r of rows) {
    const time = new Date(r.ts).toLocaleString('zh-CN', { hour12: false });
    lines.push(
      [
        time,
        r.model || '',
        r.keyId || '',
        r.tag || '',
        r.status,
        r.usage.promptTokens,
        r.usage.completionTokens,
        r.usage.cacheHit,
        r.usage.cacheMiss,
        Number(r.cost || 0).toFixed(6),
        r.ms,
        r.stream ? '是' : '否',
        r.error || '',
      ]
        .map(esc)
        .join(',')
    );
  }
  return lines.join('\r\n');
}

module.exports = { toCsv };
