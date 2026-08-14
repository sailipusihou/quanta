'use strict';

let state = null;
let chartMode = 'cost';

const $ = (id) => document.getElementById(id);
const els = {
  balValue: $('bal-value'),
  balSub: $('bal-sub'),
  updated: $('updated'),
  period: $('period-badge'),
  keyWarn: $('key-warn'),
  balError: $('bal-error'),
  cards: $('cards'),
  chart: $('chart'),
  modelList: $('model-list'),
  recent: $('recent'),
  proxyInfo: $('proxy-info'),
  pricingInfo: $('pricing-info'),
  dataInfo: $('data-info'),
  toast: $('toast'),
};

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function statCard(label, value, sub, cls) {
  return `<div class="stat ${cls || ''}">
    <div class="s-label">${label}</div>
    <div class="s-value">${value}</div>
    <div class="s-sub">${sub}</div>
  </div>`;
}

function renderCards(s) {
  const t = s.stats.today;
  const m = s.stats.month;
  els.cards.innerHTML =
    statCard('今日 Token', fmtTokens(t.totalTokens), `${t.requests} 次请求 · 缓存命中 ${fmtTokens(t.cacheHit)}`, 'accent') +
    statCard('今日金额', fmtMoney(t.cost), `输出 ${fmtTokens(t.completionTokens)} · 输入 ${fmtTokens(t.promptTokens)}`) +
    statCard('本月金额', fmtMoney(m.cost), `${m.requests} 次请求`) +
    statCard('估算剩余 Token', s.estimatedTokens != null ? fmtTokens(s.estimatedTokens) : '--', '按近期平均单价估算', 'green');
}

function renderChart(s) {
  const series = s.series.days;
  const values = series.map((d) => (chartMode === 'cost' ? d.cost : d.totalTokens));
  const max = Math.max(...values, 1e-9);
  const fmt = chartMode === 'cost' ? fmtMoney : fmtTokens;
  els.chart.innerHTML = series
    .map((d, i) => {
      const h = Math.max((values[i] / max) * 100, 0.8);
      const today = i === series.length - 1;
      return `<div class="bar-col" title="${fmt(values[i])}">
        <div class="bar-track"><div class="bar-fill" style="height:${h}%;${today ? 'background:linear-gradient(180deg,#2fd189,#1c9e6b)' : ''}"></div></div>
        <div class="bar-val">${fmt(values[i])}</div>
        <div class="bar-label">${today ? '今天' : fmtShortDate(d.start)}</div>
      </div>`;
    })
    .join('');
}

function renderModels(s) {
  const list = s.byModel;
  if (!list.length) {
    els.modelList.innerHTML = '<div class="empty">近 24h 暂无请求</div>';
    return;
  }
  const maxCost = Math.max(...list.map((m) => m.cost), 1e-9);
  els.modelList.innerHTML = list
    .map(
      (m) => `<div class="model-row">
        <div class="m-top">
          <span class="m-name">${escapeHtml(m.model)}</span>
          <span class="m-meta">${fmtTokens(m.totalTokens)} · ${fmtMoney(m.cost)}</span>
        </div>
        <div class="m-track"><div class="m-fill" style="width:${Math.max((m.cost / maxCost) * 100, 2)}%"></div></div>
      </div>`
    )
    .join('');
}

function renderRecent(s) {
  const rows = s.recent;
  if (!rows.length) {
    els.recent.innerHTML = '<tr><td colspan="9"><div class="empty">暂无请求记录 —— 把客户端 Base URL 指向本地代理即可开始统计</div></td></tr>';
    return;
  }
  els.recent.innerHTML =
    `<thead><tr>
      <th>时间</th><th>模型</th><th>状态</th><th>输入</th><th>输出</th>
      <th>缓存命中</th><th>缓存未命中</th><th>金额</th><th>耗时</th>
    </tr></thead>` +
    rows
      .map((r) => {
        const statusCls = r.status >= 400 ? 'status-err' : 'status-ok';
        return `<tr>
          <td class="mono">${fmtTime(r.ts)}</td>
          <td class="model-tag">${escapeHtml(r.model || '(未知)')}</td>
          <td class="${statusCls}">${r.status}${r.stream ? ' · 流' : ''}</td>
          <td class="mono">${fmtTokens(r.usage.promptTokens)}</td>
          <td class="mono">${fmtTokens(r.usage.completionTokens)}</td>
          <td class="mono">${fmtTokens(r.usage.cacheHit)}</td>
          <td class="mono">${fmtTokens(r.usage.cacheMiss)}</td>
          <td class="mono">${fmtMoney(r.cost)}</td>
          <td class="mono">${r.ms}ms</td>
        </tr>`;
      })
      .join('');
}

function render(s) {
  state = s;
  const bal = s.balance;
  els.balValue.textContent = bal ? fmtMoney(bal.totalBalance) : '--';
  els.balSub.textContent = bal ? `充值 ${fmtMoney(bal.toppedUpBalance)} · 赠金 ${fmtMoney(bal.grantedBalance)}` : '';
  els.updated.textContent = bal ? `更新于 ${fmtTime(bal.fetchedAt)}` : '等待余额数据…';
  els.period.textContent = periodLabel(s.pricing.period);
  els.keyWarn.classList.toggle('hidden', s.config.hasApiKey);
  if (s.balanceError) {
    els.balError.textContent = `余额获取失败：${s.balanceError.message}（将自动重试）`;
    els.balError.classList.remove('hidden');
  } else {
    els.balError.classList.add('hidden');
  }
  renderCards(s);
  renderChart(s);
  renderModels(s);
  renderRecent(s);
  els.proxyInfo.textContent = `代理 http://127.0.0.1:${s.server.port || s.config.proxyPort}`;
  els.pricingInfo.textContent = `计费：${periodLabel(s.pricing.period)}（DeepSeek 官方价目，8-17 起峰谷定价）`;
  els.dataInfo.textContent = `数据：data/usage.jsonl · ${s.stats.all.requests} 条历史请求`;
}

$('chart-mode').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  chartMode = btn.dataset.mode;
  document.querySelectorAll('#chart-mode button').forEach((b) => b.classList.toggle('active', b === btn));
  if (state) renderChart(state);
});

$('btn-refresh').addEventListener('click', async () => {
  const s = await window.api.refreshBalance();
  render(s);
  toast('余额已刷新');
});

const settingsModal = $('settings-modal');
$('btn-settings').addEventListener('click', openSettings);
function openSettings() {
  if (!state) return;
  $('set-key').value = '';
  $('set-key').placeholder = state.config.hasApiKey ? '已配置（sk-****…），留空保持不变' : 'sk-...';
  $('set-port').value = state.config.proxyPort;
  $('set-poll').value = Math.round(state.config.balancePollMs / 1000);
  $('set-autostart').checked = state.config.autoStart;
  settingsModal.classList.remove('hidden');
}
$('btn-cancel').addEventListener('click', () => settingsModal.classList.add('hidden'));
$('toggle-key').addEventListener('click', () => {
  const input = $('set-key');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggle-key').textContent = show ? '隐藏' : '显示';
});
$('btn-save').addEventListener('click', async () => {
  const key = $('set-key').value.trim();
  const patch = {
    proxyPort: Math.max(1024, Number($('set-port').value) || 8787),
    balancePollMs: Math.max(10, Number($('set-poll').value) || 60) * 1000,
    autoStart: $('set-autostart').checked,
  };
  if (key) patch.apiKey = key;
  try {
    await window.api.saveSettings(patch);
    settingsModal.classList.add('hidden');
    toast('已保存，代理已重启');
  } catch (err) {
    toast('保存失败：' + err.message);
  }
});
$('btn-clear').addEventListener('click', async () => {
  if (!confirm('确定清空全部请求记录吗？此操作不可恢复。')) return;
  await window.api.clearData();
  settingsModal.classList.add('hidden');
  toast('记录已清空');
});

window.api.onState(render);
window.api.getState().then(render);
