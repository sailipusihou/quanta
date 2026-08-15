import { useState } from 'react';
import { DialSelector } from './DialSelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { fmtMoney, fmtTokens, periodLabel } from '@/lib/format';
import type { AppSnapshot } from '@/lib/types';
import { presetForAccount } from '@/lib/platforms';
import { Activity, CalendarDays, Coins, Gauge, Hourglass, RefreshCw, Scale, Settings2, Wallet, CloudDownload } from 'lucide-react';
import { toast } from 'sonner';
import { CompareDialog } from './CompareDialog';

// 模型短名（deepseek-ai/DeepSeek-V3.2 -> DeepSeek-V3.2）
function shortModel(m: string) {
  if (!m) return '';
  const parts = m.split('/');
  return parts[parts.length - 1];
}

interface Props {
  state: AppSnapshot;
  onSwitch: (accountId: string, model: string) => void;
  onOpenDetail: () => void;
  onOpenSettings: () => void;
  onAdd: () => void;
  onRefresh: () => void;
}

// 整体工作台：中央平台表盘 + 右侧模型信息 + 底部数据带
export function Workbench({ state, onSwitch, onOpenDetail, onOpenSettings, onAdd, onRefresh }: Props) {
  const td = state.stats.today;
  const m = state.stats.month;
  const l24 = state.stats.last24h;
  // 官网控制台「今日」实时数据（GMT+8）；一切以官网口径为准
  const ot = state.officialToday && state.officialToday.ok ? state.officialToday : null;

  const currentAccount = state.config.accounts.find((a) => a.id === state.config.selectedAccountId) || null;
  const preset = presetForAccount(currentAccount || { id: '', baseUrl: '' });
  // 当前模型：服务端解析值，回退平台预设默认
  const currentModel = state.currentModel || preset?.models[0] || '';
  // 当前账户可用模型（配置的或平台预设）
  const accountModels = currentAccount?.models?.length
    ? currentAccount.models
    : preset?.models || [];
  // 当前表盘模型的官网今日数据（控制台可能合并模型名，如 "deepseek-chat & deepseek-reasoner"）
  const modelStat =
    ot && ot.byModel && ot.byModel.length
      ? ot.byModel.find((x) => x.model === currentModel || x.model.includes(currentModel) || currentModel.includes(x.model)) || null
      : null;

  // 从官网拉取该账号的最新模型列表
  const [syncing, setSyncing] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const syncModels = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await window.api.fetchModels();
      await onRefresh();
      if (r.fetched > 0) toast.success(t('syncModelsOk', { n: r.fetched }));
      else if (r.reason === 'no-key') toast.error(t('platformNotConfigured'));
      else if (r.reason === 'empty') toast.error(t('syncModelsEmpty'));
      else toast.error(t('syncModelsFail'));
    } finally {
      setSyncing(false);
    }
  };

  const dataItems = [
    {
      label: t('todayToken'),
      // 官网控制台「今日」实时（GMT+8 小时级）优先 → 手动校准 → 官网按日 Token → 代理口径
      value:
        state.officialToday && state.officialToday.ok && state.officialToday.tokens != null
          ? fmtTokens(state.officialToday.tokens)
          : state.todayCalibration && state.todayCalibration.tokens != null
            ? fmtTokens(state.todayCalibration.tokens)
            : state.officialMonth && state.officialMonth.ok && state.officialMonth.todayTokens != null && state.officialMonth.todayTokens > 0
              ? fmtTokens(state.officialMonth.todayTokens)
              : fmtTokens(td.totalTokens),
      sub:
        (state.officialToday && state.officialToday.ok && state.officialToday.tokens != null
          ? t('todayOfficialLive')
          : state.todayCalibration && state.todayCalibration.tokens != null
            ? t('calibrationMark')
            : state.officialMonth && state.officialMonth.ok && state.officialMonth.todayTokens != null && state.officialMonth.todayTokens > 0
              ? t('todayOfficialDirect')
              : t('proxyRecorded')) +
        ` · ${
          state.officialToday && state.officialToday.ok && state.officialToday.requests != null
            ? state.officialToday.requests.toLocaleString('en-US')
            : td.requests
        } ${t('requests')}`,
      icon: Coins,
      color: '#2dd4bf',
    },
    {
      label: t('todayCost'),
      // 优先级：官网控制台「今日」实时（GMT+8）→ 手动校准 → 官网按日 → 近24h余额差值
      value:
        state.officialToday && state.officialToday.ok && state.officialToday.cost != null
          ? fmtMoney(state.officialToday.cost)
          : state.todayCalibration && state.todayCalibration.cost != null
            ? fmtMoney(state.todayCalibration.cost)
            : state.officialMonth && state.officialMonth.ok && state.officialMonth.todayCost != null && state.officialMonth.todayCost > 0
              ? fmtMoney(state.officialMonth.todayCost)
              : fmtMoney(state.last24hOfficial.consumed),
      sub:
        (state.officialToday && state.officialToday.ok && state.officialToday.cost != null
          ? t('todayOfficialLive')
          : state.todayCalibration && state.todayCalibration.cost != null
            ? t('calibrationMark')
            : state.officialMonth && state.officialMonth.ok && state.officialMonth.todayCost != null && state.officialMonth.todayCost > 0
              ? t('todayOfficialDirect')
              : t('todayOfficial24h')) +
        (state.last24hOfficial.toppedUp > 0 ? ` · ${t('topUpDetected')} ${fmtMoney(state.last24hOfficial.toppedUp)}` : ''),
      icon: Wallet,
      color: '#ffb454',
    },
    {
      label: t('monthCost'),
      // 官网本月数据优先（有 Token 且接口成功）→ 余额差值 → 代理
      value:
        state.officialMonth && state.officialMonth.ok && state.officialMonth.cost != null
          ? fmtMoney(state.officialMonth.cost)
          : fmtMoney(state.monthOfficial.consumed),
      sub:
        (state.officialMonth && state.officialMonth.ok && state.officialMonth.cost != null
          ? t('monthOfficialDirect')
          : t('monthOfficialDelta')) +
        (state.monthOfficial.toppedUp > 0 ? ` · ${t('topUpDetected')} ${fmtMoney(state.monthOfficial.toppedUp)}` : ''),
      icon: CalendarDays,
      color: '#a78bfa',
    },
    {
      label: t('estTokens'),
      value: state.estimatedTokens != null ? fmtTokens(state.estimatedTokens) : '--',
      sub: t('estHint'),
      icon: Gauge,
      color: '#2fd189',
    },
    {
      label: ot && ot.requests != null ? t('requestsToday') : t('requests24h'),
      value: ot && ot.requests != null ? ot.requests.toLocaleString('en-US') : `${l24.requests}`,
      sub: ot ? t('todayOfficialLive') : l24.errors ? `${l24.errors} ✗` : '✓',
      icon: Activity,
      color: '#60a5fa',
    },
    {
      label: t('daysLeft'),
      value: state.daysLeft != null ? (state.daysLeft > 999 ? '999+' : String(state.daysLeft)) + ` ${t('days')}` : '--',
      sub: t('daysLeftHint'),
      icon: Hourglass,
      color: '#fbbf24',
    },
  ];

  return (
    <section className="glass glass-hover workbench-fx relative overflow-hidden rounded-3xl border px-4 pt-6 pb-5 shadow-xl shadow-black/30">
      {/* 科技特效背景层 */}
      <div className="fx-glow-a" />
      <div className="fx-glow-b" />
      <div className="fx-scan" />
      {/* 顶部光带 */}
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#2dd4bf]/50 to-transparent" />

      <div className="relative z-10">
        {/* 两栏：中央表盘 + 右侧模型信息 */}
        <div className="flex flex-col items-center justify-center gap-5 lg:flex-row">
          {/* 中央表盘 */}
          <DialSelector
            state={state}
            onSwitch={onSwitch}
            onOpenDetail={onOpenDetail}
            onOpenSettings={onOpenSettings}
            onAdd={onAdd}
          />

          {/* 右侧：模型信息 */}
          <aside className="glass w-full shrink-0 rounded-2xl border p-4 lg:w-[248px]">
            <div className="flex items-center gap-2 text-[10px] font-medium tracking-wide text-muted-foreground">
              <span className="size-2 rounded-full bg-[#2dd4bf] shadow-[0_0_6px_rgba(45,212,191,0.9)]" />
              {t('modelInfo')}
            </div>
            <div className="mt-2.5 truncate font-mono text-sm font-semibold text-[#8df4e6]">
              {currentModel || '—'}
            </div>
            <div className="mt-1.5">
              <Badge
                variant={state.pricing.period === 'peak' ? 'destructive' : 'secondary'}
                className="text-[10px] font-normal"
              >
                {periodLabel(state.pricing.period)}
              </Badge>
            </div>

            <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-[11px] text-muted-foreground">
              <div className="flex justify-between" title={ot ? t('todayOfficialLive') : t('proxyRecorded')}>
                <span>{t('todayCost')}</span>
                <span className="tnum">
                  {modelStat ? fmtMoney(modelStat.cost) : ot ? fmtMoney(ot.cost) : fmtMoney(td.cost)}
                  {ot && <span className="ml-1 text-[9px] text-[#2fd189]">官</span>}
                </span>
              </div>
              <div className="flex justify-between" title={ot ? t('todayOfficialLive') : t('proxyRecorded')}>
                <span>{ot && ot.requests != null ? t('requestsToday') : t('requests24h')}</span>
                <span className="tnum">
                  {ot && ot.requests != null ? ot.requests.toLocaleString('en-US') : l24.requests}
                  {ot && <span className="ml-1 text-[9px] text-[#2fd189]">官</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t('model')}</span>
                <span className="max-w-[110px] truncate">{preset?.name || currentAccount?.name || '—'}</span>
              </div>
            </div>

            {/* 模型切换（同平台多模型点选 + 官网同步） */}
            {accountModels.length > 1 && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{t('modelList')}</span>
                  <button
                    onClick={syncModels}
                    title={t('syncModels')}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] text-muted-foreground/70 transition-colors hover:text-[#2dd4bf]"
                  >
                    <CloudDownload className={syncing ? 'size-3 animate-pulse' : 'size-3'} />
                    {t('syncModels')}
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {accountModels.map((mm) => (
                    <button
                      key={mm}
                      onClick={() => currentAccount && onSwitch(currentAccount.id, mm)}
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                        mm === currentModel
                          ? 'border-[#2dd4bf]/50 bg-[#2dd4bf]/15 text-[#8df4e6]'
                          : 'border-white/10 text-muted-foreground hover:border-white/25 hover:text-foreground'
                      )}
                      title={mm}
                    >
                      {shortModel(mm)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button variant="secondary" size="sm" className="h-8 flex-1 text-xs" onClick={onRefresh}>
                <RefreshCw className="mr-1 size-3" />
                {t('refreshShort')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 flex-1 text-xs"
                onClick={() => setCompareOpen(true)}
                title={t('compare')}
              >
                <Scale className="mr-1 size-3" />
                {t('compare')}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenSettings} title={t('settings')}>
                <Settings2 className="size-3.5" />
              </Button>
            </div>
          </aside>
        </div>

        {/* 底部功能数据带 */}
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/50">
            <span className="inline-flex size-1.5 rounded-full bg-[#2dd4bf]" />
            {t('statsAllModels')}
            <span className="text-muted-foreground/30">·</span>
            {t('todayOfficialHint')}
            {state.officialMonth && state.officialMonth.ok && (state.officialMonth.cost != null || state.officialMonth.tokens != null) && (
              <span className="text-[#2fd189]">
                · {t('officialMonthSummary')}：
                {state.officialMonth.cost != null ? ` ¥${Number(state.officialMonth.cost).toFixed(4)}` : ''}
                {state.officialMonth.tokens != null ? ` · ${fmtTokens(state.officialMonth.tokens)} tokens` : ''}
                {state.officialMonth.requests != null ? ` · ${state.officialMonth.requests} 次` : ''}
              </span>
            )}
            {state.officialMonth && !state.officialMonth.ok && (
              <span className="text-amber-400/80">
                · {state.officialMonth.error ? t('usageFailed') : t('usageNoToken')}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {dataItems.map((it) => (
              <div
                key={it.label}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 transition-colors hover:border-[#2dd4bf]/30 hover:bg-white/[0.05]"
              >
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <it.icon className="size-3.5 transition-transform group-hover:scale-110" style={{ color: it.color }} />
                  {it.label}
                </div>
                <div className="tnum mt-1.5 text-xl leading-none font-bold">{it.value}</div>
                <div className="tnum mt-1 truncate text-[10px] text-muted-foreground/60">{it.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 跨平台比价 */}
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} state={state} />
    </section>
  );
}
