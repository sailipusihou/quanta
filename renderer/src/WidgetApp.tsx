import { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { langFromConfig, setLang, t } from '@/lib/i18n';
import { fmtMoney, fmtTokens } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ArrowUpRight, X } from 'lucide-react';

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1e-9);
  const w = 150;
  const h = 26;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * (w - 4) + 2;
      const y = h - 4 - (v / max) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `2,${h} ${pts} ${w - 2},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="flex-1">
      <polygon points={area} fill="rgba(157,180,255,0.16)" />
      <polyline points={pts} fill="none" stroke="#9db4ff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function WidgetApp() {
  const { state } = useAppState();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (state) {
      setLang(langFromConfig(state.config));
      document.documentElement.dataset.theme = state.config.theme === 'aurora' ? 'aurora' : 'black';
    }
  }, [state]);

  if (!state || hidden) return null;

  const bal = state.balance;
  const threshold = Number(state.config.alertThreshold) || 0;
  const low = Boolean(threshold && bal && bal.totalBalance < threshold);
  const activeProfile = state.profiles.list.find((p) => p.id === state.profiles.activeId) || null;
  const platformLabel = activeProfile ? `${state.pricing.accountName} · ${activeProfile.name}` : state.pricing.accountName;
  // 官网控制台「今日」数据优先（GMT+8），一切以官网口径为准
  const ot = state.officialToday && state.officialToday.ok ? state.officialToday : null;
  const todayCost = ot && ot.cost != null ? ot.cost : state.stats.today.cost;
  const todayTokens = ot && ot.tokens != null ? ot.tokens : state.stats.today.totalTokens;
  const sparkValues = ot && ot.hours && ot.hours.length ? ot.hours.map((h) => h.cost) : (state.series.hours || []).map((p) => p.cost);

  return (
    <div
      className={cn(
        'widget-drag flex select-none flex-col rounded-2xl border bg-[rgba(16,18,26,0.94)] px-3 py-2.5 shadow-2xl backdrop-blur-md',
        low ? 'border-[#ff5c6c]/50 low-pulse' : 'border-white/10 shadow-black/45'
      )}
    >
      {/* 顶栏 */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className={cn('size-2 rounded-full shadow-[0_0_8px]', low ? 'bg-[#ff5c6c] shadow-[#ff5c6c]/90' : 'bg-[#2fd189] shadow-[#2fd189]/80')} />
        <span className="font-semibold">{platformLabel}</span>
        <span className="ml-auto text-[11px] text-muted-foreground/70">
          {t('widgetProxy')} {state.server.port || state.config.proxyPort}
        </span>
        <button
          className="widget-no-drag flex size-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-white"
          title={t('widgetOpen')}
          onClick={() => window.api.openDashboard()}
        >
          <ArrowUpRight className="size-3.5" />
        </button>
        <button
          className="widget-no-drag flex size-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-white"
          title={t('widgetHide')}
          onClick={() => window.api.hideWidget()}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* 主体 */}
      <div className="mt-2 flex items-end gap-5" onDoubleClick={() => window.api.openDashboard()}>
        <div>
          <div className="text-[11px] text-muted-foreground">{t('widgetBalance')}</div>
          <div className={cn('tnum mt-0.5 text-2xl leading-none font-bold', low ? 'text-[#ff5c6c]' : 'text-white')}>
            {bal ? fmtMoney(bal.totalBalance) : '--'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">{t('widgetToday')}</div>
          <div className="tnum mt-0.5 text-base leading-none font-semibold text-[#9db4ff]">
            {fmtMoney(todayCost)}
          </div>
          <div className="tnum mt-1 text-[10px] text-muted-foreground/60">
            {fmtTokens(todayTokens)} tokens
          </div>
        </div>
      </div>

      {/* 底部 */}
      <div className="mt-2 flex items-center gap-2">
        <Spark values={sparkValues} />
        <span className="tnum whitespace-nowrap text-[10px] text-muted-foreground/70">
          {t('widgetEst')}{' '}
          {state.estimatedTokens != null ? fmtTokens(state.estimatedTokens) : '--'}
        </span>
      </div>
    </div>
  );
}
