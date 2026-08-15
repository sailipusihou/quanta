import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/lib/i18n';
import { fmtMoney, fmtTokens } from '@/lib/format';
import type { ModelStat } from '@/lib/types';
import { Cpu } from 'lucide-react';

interface Props {
  list: ModelStat[];
  official?: boolean;
}

export function ModelList({ list, official }: Props) {
  const maxCost = Math.max(...list.map((m) => m.cost), 1e-9);

  return (
    <Card className="flex min-h-[320px] flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cpu className="size-4 text-[#ffb454]" />
          {official ? t('modelToday') : t('model24h')}
          <span
            className={
              'rounded px-1.5 py-0.5 text-[9px] font-normal ' +
              (official ? 'bg-[#2fd189]/15 text-[#2fd189]' : 'bg-white/10 text-muted-foreground/70')
            }
            title={official ? t('trendOfficialHint') : t('trendProxyHint')}
          >
            {official ? t('trendOfficial') : t('trendProxy')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center gap-3">
        {!list.length ? (
          <div className="py-8 text-center text-xs text-muted-foreground">{t('noModel24h')}</div>
        ) : (
          list.map((m) => (
            <div key={m.model}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-xs">{m.model}</span>
                <span className="tnum shrink-0 text-[11px] text-muted-foreground">
                  {fmtTokens(m.totalTokens)} · {fmtMoney(m.cost)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#6d8dff] to-[#9b6dff] transition-all duration-500"
                  style={{ width: `${Math.max((m.cost / maxCost) * 100, 2)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
