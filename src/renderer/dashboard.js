'use strict';

let state = null;
let chartMode = 'cost';
let chartRange = 7;
let onboardSkipped = false;
let tagFilter = 'all';
let editorAccounts = [];
let editorTagRules = [];

const $ = (id) => document.getElementById(id);
const els = {
  accountBadge: $('account-badge'),
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
  tagChips: $('tag-chips'),
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
  toast._t = setTimeout(() => els.toast.classList.add('hidden'), 3000);
}

function statCard(label, value, sub, cls) {
  return `<div class="stat ${cls || ''}">
    <div class="s-label">${label}</div>
    <div class="s-value">${value}</div>
    <div class="s-sub">${sub}</div>
  </div>`;
}

function renderCards(s) {
  const td = s.stats.today;
  const m = s.stats.month;
  els.cards.innerHTML =
    statCard(t('todayToken'), fmtTokens(td.totalTokens), `${td.requests} ${t('requests')} · ${t('cacheHit')} ${fmtTokens(td.cacheHit)}`, 'accent') +
    statCard(t('todayCost'), fmtMoney(td.cost), `${t('output')} ${fmtTokens(td.completionTokens)} · ${t('input')} ${fmtTokens(td.promptTokens)}`) +
    statCard(t('monthCost'), fmtMoney(m.cost), `${m.requests} ${t('requests')}`) +
    statCard(t('estTokens'), s.estimatedTokens != null ? fmtTokens(s.estimatedTokens) : '--', t('estHint'), 'green');
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
        ${showLabel ? `<div class="bar-label">${today ? t('today') : fmtShortDate(d.start)}</div>` : ''}
      </div>`;
    })
    .join('');
}

function renderModels(s) {
  const list = s.byModel;
  if (!list.length) {
    els.modelList.innerHTML = `<div class="empty">${t('noModel24h')}</div>`;
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
    ? `${t('rechargeTotal')} <b>${fmtMoney(r.total)}</b>${r.consumedEstimate != null ? ` · ${t('consumedEst')} ${fmtMoney(r.consumedEstimate)}` : ''}`
    : '';
  if (!r.list.length) {
    els.rechargeList.innerHTML = `<div class="empty">${t('noRecharge')}</div>`;
    return;
  }
  els.rechargeList.innerHTML = r.list
    .map(
      (x) => `<div class="recharge-row">
        <span class="r-amount">+${fmtMoney(x.amount)}</span>
        <span class="r-note">${escapeHtml(x.note || t('rechargeFallback'))}</span>
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
  const status = !bal ? t('waiting') : low ? t('lowBalance') : threshold ? t('normal') : t('noAlert');
  els.alertBox.innerHTML = `
    <div class="ab-row"><span>${t('currentBalance')}</span><span class="ab-value">${bal ? fmtMoney(bal.totalBalance) : '--'}</span></div>
    <div class="ab-row"><span>${t('alertLine')}</span><span>${threshold ? fmtMoney(threshold) : t('notEnabled')}</span></div>
    <div class="ab-row"><span>${t('status')}</span><span>${status}</span></div>`;
}

function renderAccounts(s) {
  const cfg = s.config;
  els.accountBadge.textContent = s.pricing.accountName;
  els.accountSelect.innerHTML =
    `<option value="">${t('switchAccount')}</option>` +
    cfg.accounts
      .map((a) => `<option value="${escapeHtml(a.id)}" ${a.id === cfg.selectedAccountId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)
      .join('');
}

function renderTagChips(s) {
  const tags = ['all', ...s.byTag.map((x) => x.tag)];
  els.tagChips.innerHTML = tags
    .map(
      (tag) =>
        `<button class="tag-chip ${tag === tagFilter ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${tag === 'all' ? t('allTags') : escapeHtml(tag)}</button>`
    )
    .join('');
}

function renderRecent(s) {
  const rows = s.recent.filter((r) => tagFilter === 'all' || (r.tag || 'default') === tagFilter);
  if (!rows.length) {
    els.recent.innerHTML = `<tr><td colspan="10"><div class="empty">${t('noRequests')}</div></td></tr>`;
    return;
  }
  els.recent.innerHTML =
    `<thead><tr>
      <th>${t('time')}</th><th>${t('tag')}</th><th>${t('model')}</th><th>${t('statusH')}</th>
      <th>${t('prompt')}</th><th>${t('completion')}</th><th>${t('cacheHitH')}</th><th>${t('cacheMiss')}</th>
      <th>${t('costH')}</th><th>${t('latency')}</th>
    </tr></thead>` +
    rows
      .map((r) => {
        const statusCls = r.status >= 400 ? 'status-err' : 'status-ok';
        return `<tr>
          <td class="mono">${fmtTime(r.ts)}</td>
          <td><span class="tag-chip static">${escapeHtml(r.tag || 'default')}</span></td>
          <td class="model-tag">${escapeHtml(r.model || t('unknown'))}</td>
          <td class="${statusCls}">${r.status}${r.stream ? ' · ⧉' : ''}</td>
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
  window.syncLang(s.config.language);
  const bal = s.balance;
  els.balValue.textContent = bal ? fmtMoney(bal.totalBalance) : '--';
  els.balSub.textContent = bal ? `${t('recharge')} ${fmtMoney(bal.toppedUpBalance)} · ${t('granted')} ${fmtMoney(bal.grantedBalance)}` : '';
  els.updated.textContent = bal ? `${t('updatedAt')} ${fmtTime(bal.fetchedAt)}` : t('waiting');
  els.period.textContent = `${s.pricing.accountName} · ${periodLabel(s.pricing.period)}`;
  els.keyWarn.classList.toggle('hidden', s.config.hasApiKey);
  if (s.balanceError) {
    els.balError.textContent = t('balanceFailed', { msg: s.balanceError.message });
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
  renderTagChips(s);
  renderRecent(s);
  els.proxyInfo.textContent = `${t('proxy')} http://127.0.0.1:${s.server.port || s.config.proxyPort}`;
  els.pricingInfo.textContent = t('billing') + periodLabel(s.pricing.period);
  els.dataInfo.textContent = `${t('data')} usage.jsonl · ${s.stats.all.requests} ${t('history')}`;
}

async function verifyKeyAndClose() {
  const input = $('onboard-key');
  const key = input.value.trim();
  const errEl = $('onboard-error');
  errEl.classList.add('hidden');
  if (!key) {
    errEl.textContent = t('needKey');
    errEl.classList.remove('hidden');
    return;
  }
  const saveBtn = $('onboard-save');
  saveBtn.disabled = true;
  saveBtn.textContent = t('verifying');
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
      errEl.textContent = t('keyFail', { msg: s.balanceError.message });
      errEl.classList.remove('hidden');
    } else {
      onboardSkipped = true;
      $('onboard-modal').classList.add('hidden');
      render(s);
      toast(t('keyOk', { bal: fmtMoney(s.balance.totalBalance) }));
    }
  } catch (err) {
    errEl.textContent = t('saveFail', { msg: err.message });
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = t('onboardSave');
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

// ---- 标签筛选 ----
els.tagChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.tag-chip');
  if (!chip || !chip.dataset.tag) return;
  tagFilter = chip.dataset.tag;
  if (state) {
    renderTagChips(state);
    renderRecent(state);
  }
});

// ---- 头部操作 ----
$('btn-refresh').addEventListener('click', async () => {
  const s = await window.api.refreshBalance();
  render(s);
  toast(t('toastRefreshed'));
});

$('btn-help').addEventListener('click', () => {
  window.applyStatic();
  $('help-modal').classList.remove('hidden');
});
$('help-close').addEventListener('click', () => $('help-modal').classList.add('hidden'));

els.accountSelect.addEventListener('change', async () => {
  const id = els.accountSelect.value;
  if (!id) return;
  await window.api.switchAccount(id);
  const s = await window.api.getState();
  render(s);
  toast(t('toastSwitched', { name: s.pricing.accountName }));
});

$('btn-export').addEventListener('click', async () => {
  const r = await window.api.exportCsv();
  if (r.saved) toast(t('toastExported', { path: r.path }));
  else toast(t('toastExportFail', { reason: r.reason || '?' }));
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
    toast(t('toastBadAmount'));
    return;
  }
  await window.api.addRecharge(amount, $('recharge-note').value.trim());
  rechargeModal.classList.add('hidden');
  const s = await window.api.getState();
  render(s);
  toast(t('toastRechargeSaved'));
});

// ---- 设置 ----
const settingsModal = $('settings-modal');
$('btn-settings').addEventListener('click', openSettings);

function openSettings() {
  if (!state) return;
  window.applyStatic();
  $('set-key').value = '';
  $('set-key').placeholder = state.config.hasApiKey ? t('keyPlaceholder') : 'sk-...';
  $('set-port').value = state.config.proxyPort;
  $('set-poll').value = Math.round(state.config.balancePollMs / 1000);
  $('set-alert').value = state.config.alertThreshold || 0;
  $('set-notify').value = state.config.requestNotify || 'all';
  $('set-lang').value = state.config.language || 'zh';
  $('set-update-feed').value = state.config.updateFeedUrl || '';
  $('set-autostart').checked = state.config.autoStart;
  $('update-result').textContent = '';
  editorAccounts = state.config.accounts.map((a) => ({ ...a }));
  editorTagRules = state.config.tagRules.map((r) => ({ ...r }));
  renderAccountEditor();
  renderTagRuleEditor();
  settingsModal.classList.remove('hidden');
}

function renderAccountEditor() {
  const wrap = $('account-editor');
  if (!editorAccounts.length) {
    wrap.innerHTML = '<div class="empty">—</div>';
    return;
  }
  wrap.innerHTML = editorAccounts
    .map(
      (a, i) => `<div class="account-edit">
        <div class="ae-head">
          <span>${t('accountN', { n: i + 1 })}</span>
          ${a.id === state.config.selectedAccountId ? `<span class="ae-active">${t('current')}</span>` : ''}
          <span class="spacer"></span>
          <button class="ghost small-btn" data-act="set" data-id="${escapeHtml(a.id)}">${t('setCurrent')}</button>
          <button class="ghost small-btn danger-text" data-act="del" data-id="${escapeHtml(a.id)}" ${editorAccounts.length === 1 ? 'disabled' : ''}>${t('delete')}</button>
        </div>
        <div class="ae-grid">
          <label>${t('name')}<input data-f="name" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.name)}" /></label>
          <label>${t('currency')}<input data-f="currency" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.currency)}" /></label>
          <label>${t('baseUrl')}<input data-f="baseUrl" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.baseUrl)}" placeholder="https://api.deepseek.com" /></label>
          <label>${t('apiKeyField')}<input data-f="apiKey" data-id="${escapeHtml(a.id)}" type="password" placeholder="${a.apiKey ? t('keyConfigured') : 'sk-...'}" /></label>
          <label>${t('balanceUrl')}<input data-f="balanceUrl" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.balanceUrl)}" placeholder="{base}/user/balance" /></label>
          <label>${t('balanceJsonPath')}<input data-f="balanceJsonPath" data-id="${escapeHtml(a.id)}" value="${escapeHtml(a.balanceJsonPath)}" placeholder="balance_infos[0].total_balance" /></label>
        </div>
      </div>`
    )
    .join('');
}

function renderTagRuleEditor() {
  const wrap = $('tag-rule-editor');
  if (!editorTagRules.length) {
    wrap.innerHTML = '<div class="empty">—</div>';
    return;
  }
  wrap.innerHTML = editorTagRules
    .map(
      (r, i) => `<div class="tag-rule-row">
        <input data-rule="pattern" data-idx="${i}" value="${escapeHtml(r.pattern || '')}" placeholder="${t('tagPattern')}" />
        <input data-rule="label" data-idx="${i}" value="${escapeHtml(r.label || '')}" placeholder="${t('tagLabel')}" />
        <button class="ghost small-btn danger-text" data-rule-del="${i}">${t('delete')}</button>
      </div>`
    )
    .join('');
}

$('tag-rule-editor').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.rule) return;
  const idx = Number(el.dataset.idx);
  if (editorTagRules[idx]) editorTagRules[idx][el.dataset.rule] = el.value;
});
$('tag-rule-editor').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-rule-del]');
  if (!btn) return;
  editorTagRules.splice(Number(btn.dataset.ruleDel), 1);
  renderTagRuleEditor();
});
$('btn-add-rule').addEventListener('click', () => {
  editorTagRules.push({ pattern: '', label: '' });
  renderTagRuleEditor();
});

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
    name: isDeepseek ? 'DeepSeek' : t('customName'),
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

$('btn-check-update').addEventListener('click', async () => {
  const resultEl = $('update-result');
  resultEl.textContent = t('updateChecking');
  const r = await window.api.checkUpdate();
  if (r.status === 'up-to-date') {
    resultEl.textContent = t('updateLatest', { ver: r.currentVersion });
  } else if (r.status === 'update-available') {
    resultEl.innerHTML = `${t('updateFound', { ver: r.version })} — <a id="update-download">${t('updateOpen')}</a>`;
    $('update-download').addEventListener('click', () => {
      if (r.url) window.api.openExternal(r.url);
    });
  } else if (r.status === 'no-feed') {
    resultEl.textContent = t('updateNoFeed');
  } else {
    resultEl.textContent = t('updateError', { msg: r.message });
  }
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
    requestNotify: $('set-notify').value,
    language: $('set-lang').value,
    updateFeedUrl: $('set-update-feed').value.trim(),
    tagRules: editorTagRules.filter((r) => r.label && r.pattern),
    autoStart: $('set-autostart').checked,
  };
  try {
    await window.api.saveSettings(patch);
    settingsModal.classList.add('hidden');
    const s = await window.api.getState();
    render(s);
    toast(t('toastSaved'));
  } catch (err) {
    toast(t('saveFail', { msg: err.message }));
  }
});
$('btn-clear').addEventListener('click', async () => {
  if (!confirm(t('confirmClear'))) return;
  await window.api.clearData();
  settingsModal.classList.add('hidden');
  const s = await window.api.getState();
  render(s);
  toast(t('toastCleared'));
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
