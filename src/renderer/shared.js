'use strict';

function fmtMoney(v) {
  const n = Number(v) || 0;
  if (n === 0) return '¥0';
  return '¥' + Number(n.toFixed(6)).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
}

function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function fmtShortDate(ts) {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtHour(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function periodLabel(period) {
  if (period === 'peak') return '高峰计费';
  if (period === 'offpeak') return '空闲时段计费';
  return '平价计费';
}
