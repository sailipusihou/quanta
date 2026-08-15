import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { t } from '@/lib/i18n';
import { fmtMoney, fmtShortDate, fmtTokens } from '@/lib/format';
import type { AppSnapshot, SeriesPoint } from '@/lib/types';
import { TrendingUp } from 'lucide-react';

interface Props {
  days: SeriesPoint[];
  official: AppSnapshot['officialTrend'];
}

export function TrendChart({ days, official }: Props) {
  const [mode, setMode] = useState<'cost' | 'tokens'>('cost');
  const [range, setRange] = useState<7 | 30>(7);

  // 官网口径优先（与控制台趋势图同源）；失败时回退本地代理记录
  const officialDays = official && official.ok && official.days && official.days.length ? official.days : null;
  const baseSeries = officialDays ? officialDays : days;
  const series = baseSeries.slice(-range);
  const values = series.map((d) => (mode === 'cost' ? d.cost : (d as { tokens?: number }).tokens ?? d.totalTokens));
  const max = Math.max(...values, 1e-9);
  const fmt = mode === 'cost' ? fmtMoney : fmtTokens;
  const dense = range > 7;

  return (
    <Card className="flex min-h-[320px] flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="size-4 text-[#6d8dff]" />
          {t('trend')}
          <span
            className={
              'rounded px-1.5 py-0.5 text-[9px] font-normal ' +
              (officialDays
                ? 'bg-[#2fd189]/15 text-[#2fd189]'
                : 'bg-white/10 text-muted-foreground/70')
            }
            title={officialDays ? t('trendOfficialHint') : t('trendProxyHint')}
          >
            {officialDays ? t('trendOfficial') : t('trendProxy')}
          </span>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant={mode === 'cost' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setMode('cost')}
          >
            {t('cost')}
          </Button>
          <Button
            variant={mode === 'tokens' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setMode('tokens')}
          >
            {t('tokens')}
          </Button>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <Button
            variant={range === 7 ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setRange(7)}
          >
            {t('days7')}
          </Button>
          <Button
            variant={range === 30 ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setRange(30)}
          >
            {t('days30')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="relative flex-1">
          {/* 网格线 */}
          <div className="absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border-t border-border/40" />
            ))}
          </div>
          {/* 柱子 */}
          <div className="absolute inset-0 flex items-end gap-[3px] px-1">
            {series.map((d, i) => {
              const h = Math.max((values[i] / max) * 100, 0.8);
              const isToday = i === series.length - 1;
              const showLabel = !dense || i % 5 === 0 || i === series.length - 1;
              return (
                <div key={d.start} className="group relative flex h-full flex-1 flex-col justify-end" title={fmt(values[i])}>
                  <div className="relative w-full" style={{ height: `${h}%` }}>
                    <div
                      className={
                        'absolute inset-x-0 bottom-0 h-full w-full rounded-t-[3px] transition-all duration-300 group-hover:opacity-100 ' +
                        (isToday
                          ? 'bg-gradient-to-t from-[#1c9e6b] to-[#2fd189] opacity-90'
                          : 'bg-gradient-to-t from-[#6d8dff]/30 to-[#6d8dff]/70 opacity-80 group-hover:opacity-100')
                      }
                    />
                    {/* hover 数值提示 */}
                    <div className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-0.5 text-[10px] font-medium shadow-md group-hover:block">
                      {fmt(values[i])}
                    </div>
                  </div>
                  {showLabel && (
                    <div className="mt-1 text-center text-[10px] text-muted-foreground/70">
                      {isToday ? t('today') : fmtShortDate(d.start)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
