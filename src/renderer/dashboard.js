'use strict';

let state = null;
let chartMode = 'cost';
let chartRange = 7;
let onboardSkipped = false;
let editorAccounts = [];

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
  rechargeList: $('recharge-list'),
  rechargeTotal: $('recharge-total'),
  alertBox: $('alert-box'),
  accountSelect: $('account-select'),
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
  const series = s.series.days.slice(-chartRange);
  const values = series.map((d) => (chartMode === 'cost' ? d.cost : d.totalTokens));
  const max = Math.max(...values, 1e-9);
  const fmt = chartMode === 'cost' ? fmtMoney : fmtTokens;
  const dense = chartRange > 7;
  els.chart.className = 'bars' + (dense ? ' dense' : '');
  els.chart.innerHTML = series
    .map((d, i) => {
      const h = Math.max((values[i] / max) * 100, 0.8);
      const today = i === series.length - 1;
      const showLabel = !dense || i % 5 === 0 || i === series.length - 1;
      return `<div class="bar-col" title="${fmt(values[i])}">
        <div class="bar-track"><div class="bar-fill" style="height:${h}%;${today ? 'background:linear-gradient(180deg,#2fd189,#1c9e6b)' : ''}"></div></div>
        <div class="bar-val">${fmt(values[i])}</div>
        ${showLabel ? `<div class="bar-label">${today ? '今天' : fmtShortDate(d.start)}</div>` : ''}
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

function renderRecharges(s) {
  const r = s.recharges;
  els.rechargeTotal.innerHTML = r.total > 0
    ? `充值合计 <b>${fmtMoney(r.total)}</b>${r.consumedEstimate != null ? ` · 累计消耗 ≈ ${fmtMoney(r.consumedEstimate)}` : ''}`
    : '';
  if (!r.list.length) {
    els.rechargeList.innerHTML = '<div class="empty">还没有充值记录 —— 点击右上角「记录充值」开始记账</div>';
    return;
  }
  els.rechargeList.innerHTML = r.list
    .map(
      (x) => `<div class="recharge-row">
        <span class="r-amount">+${fmtMoney(x.amount)}</span>
        <span class="r-note">${escapeHtml(x.note || '充值')}</span>
        <span class="r-time">${fmtTime(x.ts)}</span>
      </div>`
    )
    .join('');
}

function renderAlert(s) {
  const threshold = Number(s.config.alertThreshold) || 0;
  const bal = s.balance;
  const low = Boolean(threshold && bal && bal.totalBalance < threshold);
  els.alertBox.classList.toggle('low', low);
  const status = !bal ? '等待余额…' : low ? '低余额预警' : threshold ? '正常' : '未设置预警';
  els.alertBox.innerHTML = `
    <div class="ab-row"><span>当前余额</span><span class="ab-value">${bal ? fmtMoney(bal.totalBalance) : '--'}</span></div>
    <div class="ab-row"><span>预警线</span><span>${threshold ? fmtMoney(threshold) : '未开启'}</span></div>
    <div class="ab-row"><span>状态</span><span>${status}</span></div>`;
}

function renderAccounts(s) {
  const cfg = s.config;
  els.accountSelect.innerHTML =
    `<option value="">切换账户…</option>` +
    cfg.accounts
      .map((a) => `<option value="${escapeHtml(a.id)}" ${a.id === cfg.selectedAccountId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)
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
  els.period.textContent = `${s.pricing.accountName} · ${periodLabel(s.pricing.period)}`;
  els.keyWarn.classList.toggle('hidden', s.config.hasApiKey);
  if (s.balanceError) {
    els.balError.textContent = `余额获取失败：${s.balanceError.message}（将自动重试）`;
    els.balError.classList.remove('hidden');
  } else {
    els.balError.classList.add('hidden');
  }
  renderAccounts(s);
  renderCards(s);
  renderChart(s);
  renderModels(s);
  renderRecharges(s);
  renderAlert(s);
  renderRecent(s);
  els.proxyInfo.textContent = `代理 http://127.0.0.1:${s.server.port || s.config.proxyPort}`;
  els.pricingInfo.textContent = `计费：${periodLabel(s.pricing.period)}（DeepSeek 官方价目，8-17 起峰谷定价）`;
  els.dataInfo.textContent = `数据：data/usage.jsonl · ${s.stats.all.requests} 条历史请求`;
}

async function verifyKeyAndClose() {
  const input = $('onboard-key');
  const key = input.value.trim();
  const errEl = $('onboard-error');
  errEl.classList.add('hidden');
  if (!key) {
    errEl.textContent = '请输入 API Key';
    errEl.classList.remove('hidden');
    return;
  }
  const saveBtn = $('onboard-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '验证中…';
  try {
    const accounts = state.config.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      baseUrl: a.baseUrl,
      balanceUrl: a.balanceUrl,
      balanceJsonPath: a.balanceJsonPath,
      currency: a.currency,
      apiKey: a.id === state.config.selectedAccountId ? key : '',
    }));
    await window.api.saveSettings({ accounts });
    const s = await window.api.refreshBalance();
    if (s.balanceError) {
      errEl.textContent = 'Key 验证失败：' + s.balanceError.message + '（请检查 Key 是否正确）';
      errEl.classList.remove('hidden');
    } else {
      onboardSkipped = true;
      $('onboard-modal').classList.add('hidden');
      render(s);
      toast('验证通过，剩余 ' + fmtMoney(s.balance.totalBalance));
    }
  } catch (err) {
    errEl.textContent = '保存失败：' + err.message;
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存并验证';
  }
}

// ---- 图表模式 ----
$('chart-mode').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.mode) {
    chartMode = btn.dataset.mode;
    document.querySelectorAll('#chart-mode button[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
  }
  if (btn.dataset.range) {
    chartRange = Number(btn.dataset.range);
    document.querySelectorAll('#chart-mode button[data-range]').forEach((b) => b.classList.toggle('active', b === btn));
  }
  if (state) renderChart(state);
});

// ---- 头部操作 ----
$('btn-refresh').addEventListener('click', async () => {
  const s = await window.api.refreshBalance();
  render(s);
  toast('余额已刷新');
});

$('btn-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
$('help-close').addEventListener('click', () => $('help-modal').classList.add('hidden'));

els.accountSelect.addEventListener('change', async () => {
  const id = els.accountSelect.value;
  if (!id) return;
  await window.api.switchAccount(id);
  const s = await window.api.getState();
  render(s);
  toast('已切换到账户 ' + s.pricing.accountName);
});

$('btn-export').addEventListener('click', async () => {
  const r = await window.api.exportCsv();
  if (r.saved) toast('已导出：' + r.path);
  else toast('导出未完成：' + (r.reason || '未知原因'));
});

// ---- 充值 ----
const rechargeModal = $('recharge-modal');
$('btn-recharge').addEventListener('click', () => {
  $('recharge-amount').value = '';
  $('recharge-note').value = '';
  rechargeModal.classList.remove('hidden');
  $('recharge-amount').focus();
});
$('recharge-cancel').addEventListener('click', () => rechargeModal.classList.add('hidden'));
$('recharge-save').addEventListener('click', async () => {
  const amount = Number($('recharge-amount').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('请输入有效的充值金额');
    return;
  }
  await window.api.addRecharge(amount, $('recharge-note').value.trim());
  rechargeModal.classList.add('hidden');
  const s = await window.api.getState();
  render(s);
  toast('充值记录已保存');
});

// ---- 设置 ----
const settingsModal = $('settings-modal');
$('btn-settings').addEventListener('click', openSettings);

function openSettings() {
  if (!state) return;
  $('set-key').value = '';
  $('set-key').placeholder = state.config.hasApiKey ? '已配置（sk-****…），留空保持不变' : 'sk-...';
  $('set-port').value = state.config.proxyPort;
  $('set-poll').value = Math.round(state.config.balancePollMs / 1000);
  $('set-alert').value = state.config.alertThreshold || 0;
  $('set-autostart').checked = state.config.autoStart;
  editorAccounts = state.config.accounts.map((a) => ({ ...a }));
  renderAccountEditor();
  settingsModal.classList.remove('hidden');
}

function renderAccountEditor() {
  const wrap = $('account-editor');
  if (!editorAccounts.length) {
    wrap.innerHTML = '<div class="empty">暂无账户</div>';
    return;
  }
  wrap.innerHTML = editorAccounts
    .map(
      (a, i) => `<div class="account-edit">
        <div class="ae-head">
          <span>账户 ${i + 1}</span>
          ${a.id === state.config.selectedAccountId ? '<span class="ae-active">当前使用</span>' : ''}
          <span class="spacer"></span>
          <button class="ghost small-btn" data-act="set" data-id="${escapeHtml(a.id)}">设为当前</button>
          <button class="ghost small-btn danger-text" data-act="del" data-id="${escapeHtml(a.id)}" ${editorAccounts.length === 1 ? 'disabled' : ''}>删除</button>
        </div>
        <div class="ae-grid">
          <label>名称<input data-f="name" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.name)}" /></label>
          <label>货币<input data-f="currency" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.currency)}" /></label>
          <label>Base URL<input data-f="baseUrl" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.baseUrl)}" placeholder="https://api.deepseek.com" /></label>
          <label>API Key<input data-f="apiKey" data-id="${escapeHtml(a.id)}" type="password" placeholder="${a.apiKey ? '已配置，留空不变' : 'sk-...'}" /></label>
          <label>余额接口 URL<input data-f="balanceUrl" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.balanceUrl)}" placeholder="{base}/user/balance" /></label>
          <label>余额 JSON 路径<input data-f="balanceJsonPath" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.balanceJsonPath)}" placeholder="balance_infos[0].total_balance" /></label>
        </div>
      </div>`
    )
    .join('');
}

$('account-editor').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'del') {
    editorAccounts = editorAccounts.filter((a) => a.id !== id);
    if (state.config.selectedAccountId === id) state.config.selectedAccountId = editorAccounts[0].id;
    renderAccountEditor();
  } else if (btn.dataset.act === 'set') {
    state.config.selectedAccountId = id;
    renderAccountEditor();
  }
});

$('account-editor').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.f) return;
  const acc = editorAccounts.find((a) => a.id === el.dataset.id);
  if (acc) acc[el.dataset.f] = el.value;
});

$('btn-add-account').addEventListener('click', () => {
  const preset = $('account-preset').value;
  const isDeepseek = preset === 'deepseek';
  const id = 'acc-' + Date.now().toString(36);
  editorAccounts.push({
    id,
    name: isDeepseek ? 'DeepSeek' : '自定义平台',
    baseUrl: isDeepseek ? 'https://api.deepseek.com' : 'https://api.example.com',
    apiKey: '',
    balanceUrl: isDeepseek ? '{base}/user/balance' : '{base}/user/balance',
    balanceJsonPath: isDeepseek ? 'balance_infos[0].total_balance' : 'data.balance',
    currency: isDeepseek ? 'CNY' : 'CNY',
  });
  renderAccountEditor();
});

$('btn-cancel').addEventListener('click', () => settingsModal.classList.add('hidden'));
$('toggle-key').addEventListener('click', () => {
  const input = $('set-key');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggle-key').textContent = show ? '隐藏' : '显示';
});
$('btn-save').addEventListener('click', async () => {
  const key = $('set-key').value.trim();
  const selectedId = state.config.selectedAccountId;
  const accounts = editorAccounts.map((a) => ({
    ...a,
    apiKey: a.id === selectedId && key ? key : a.apiKey,
  }));
  const patch = {
    accounts,
    selectedAccountId: selectedId,
    proxyPort: Math.max(1024, Number($('set-port').value) || 8787),
    balancePollMs: Math.max(10, Number($('set-poll').value) || 60) * 1000,
    alertThreshold: Math.max(0, Number($('set-alert').value) || 0),
    autoStart: $('set-autostart').checked,
  };
  try {
    await window.api.saveSettings(patch);
    settingsModal.classList.add('hidden');
    const s = await window.api.getState();
    render(s);
    toast('已保存，代理已重启');
  } catch (err) {
    toast('保存失败：' + err.message);
  }
});
$('btn-clear').addEventListener('click', async () => {
  if (!confirm('确定清空全部请求记录吗？此操作不可恢复。')) return;
  await window.api.clearData();
  settingsModal.classList.add('hidden');
  const s = await window.api.getState();
  render(s);
  toast('记录已清空');
});

// ---- 引导 ----
$('onboard-toggle').addEventListener('click', () => {
  const input = $('onboard-key');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('onboard-toggle').textContent = show ? '隐藏' : '显示';
});
$('onboard-save').addEventListener('click', verifyKeyAndClose);
$('onboard-skip').addEventListener('click', () => {
  onboardSkipped = true;
  $('onboard-modal').classList.add('hidden');
});

window.api.onState(render);
window.api.getState().then((s) => {
  render(s);
  if (!s.config.hasApiKey && !onboardSkipped) {
    $('onboard-modal').classList.remove('hidden');
  }
});
