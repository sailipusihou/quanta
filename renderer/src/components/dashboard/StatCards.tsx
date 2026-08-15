import { Card } from '@/components/ui/card';
import { t } from '@/lib/i18n';
import { fmtMoney, fmtTokens } from '@/lib/format';
import type { AppSnapshot } from '@/lib/types';
import { CalendarDays, Coins, Gauge, Wallet } from 'lucide-react';

interface Props {
  state: AppSnapshot;
}

export function StatCards({ state }: Props) {
  const td = state.stats.today;
  const m = state.stats.month;

  const cards = [
    {
      key: 'todayToken',
      label: t('todayToken'),
      value: fmtTokens(td.totalTokens),
      sub: `${td.requests} ${t('requests')} · ${t('cacheHit')} ${fmtTokens(td.cacheHit)}`,
      icon: <Coins className="size-4 text-[#6d8dff]" />,
      accent: 'from-[#6d8dff]/15 to-transparent',
      valueCls: 'text-[#9db4ff]',
    },
    {
      key: 'todayCost',
      label: t('todayCost'),
      value: fmtMoney(td.cost),
      sub: `${t('output')} ${fmtTokens(td.completionTokens)} · ${t('input')} ${fmtTokens(td.promptTokens)}`,
      icon: <Wallet className="size-4 text-[#ffb454]" />,
      accent: 'from-[#ffb454]/12 to-transparent',
      valueCls: 'text-foreground',
    },
    {
      key: 'monthCost',
      label: t('monthCost'),
      value: fmtMoney(m.cost),
      sub: `${m.requests} ${t('requests')}`,
      icon: <CalendarDays className="size-4 text-[#c084fc]" />,
      accent: 'from-[#c084fc]/12 to-transparent',
      valueCls: 'text-foreground',
    },
    {
      key: 'estTokens',
      label: t('estTokens'),
      value: state.estimatedTokens != null ? fmtTokens(state.estimatedTokens) : '--',
      sub: t('estHint'),
      icon: <Gauge className="size-4 text-[#2fd189]" />,
      accent: 'from-[#2fd189]/12 to-transparent',
      valueCls: 'text-gradient-teal',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.key} className="relative overflow-hidden">
          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.accent}`} />
          <div className="relative p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              {c.icon}
            </div>
            <div className={`tnum mt-2 text-2xl font-bold ${c.valueCls}`}>{c.value}</div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground/80">{c.sub}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}
