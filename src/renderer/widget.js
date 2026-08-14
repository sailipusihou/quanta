'use strict';

const els = {
  balance: document.getElementById('balance'),
  todayCost: document.getElementById('today-cost'),
  todayTokens: document.getElementById('today-tokens'),
  est: document.getElementById('est'),
  port: document.getElementById('port'),
  spark: document.getElementById('spark'),
};

function renderSpark(series) {
  const values = (series || []).map((p) => p.cost || 0);
  const max = Math.max(...values, 1e-9);
  const w = 130;
  const h = 26;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * (w - 4) + 2;
      const y = h - 4 - (v / max) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `2,${h} ${pts} ${w - 2},${h}`;
  els.spark.innerHTML = `
    <polygon points="${area}" fill="rgba(157,180,255,0.16)"></polygon>
    <polyline points="${pts}" fill="none" stroke="#9db4ff" stroke-width="1.6"></polyline>`;
}

function render(s) {
  const bal = s.balance;
  els.balance.textContent = bal ? fmtMoney(bal.totalBalance) : '--';
  els.todayCost.textContent = fmtMoney(s.stats.today.cost);
  els.todayTokens.textContent = fmtTokens(s.stats.today.totalTokens) + ' tokens';
  els.est.textContent = s.estimatedTokens != null ? '估算剩余 ' + fmtTokens(s.estimatedTokens) : '估算剩余 --';
  els.port.textContent = '代理 ' + (s.server.port || s.config.proxyPort);
  renderSpark(s.series.hours);
}

document.getElementById('btn-open').addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.openDashboard();
});
document.getElementById('btn-close').addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.hideWidget();
});
document.getElementById('widget').addEventListener('dblclick', () => window.api.openDashboard());

window.api.onState(render);
window.api.getState().then(render);
