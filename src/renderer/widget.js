'use strict';

const els = {
  balance: document.getElementById('balance'),
  todayCost: document.getElementById('today-cost'),
  todayTokens: document.getElementById('today-tokens'),
  est: document.getElementById('est'),
  port: document.getElementById('port'),
  spark: document.getElementById('spark'),
  platform: document.getElementById('platform'),
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
  window.syncLang(s.config.language);
  const bal = s.balance;
  const threshold = Number(s.config.alertThreshold) || 0;
  const low = Boolean(threshold && bal && bal.totalBalance < threshold);
  document.getElementById('widget').classList.toggle('low', low);
  els.platform.textContent = (s.pricing && s.pricing.accountName) || 'DeepSeek';
  els.balance.textContent = bal ? fmtMoney(bal.totalBalance) : '--';
  els.todayCost.textContent = fmtMoney(s.stats.today.cost);
  els.todayTokens.textContent = fmtTokens(s.stats.today.totalTokens) + ' tokens';
  els.est.textContent = (s.estimatedTokens != null ? t('widgetEst') + ' ' + fmtTokens(s.estimatedTokens) : t('widgetEst') + ' --');
  els.port.textContent = (s.server.port || s.config.proxyPort) + '';
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
