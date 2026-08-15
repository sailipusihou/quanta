import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/lib/i18n';
import { fmtMoney, fmtTime } from '@/lib/format';
import type { AppSnapshot } from '@/lib/types';
import { ArrowDownToLine, BellRing, PlusCircle } from 'lucide-react';

export function RechargeCard({ state }: { state: AppSnapshot }) {
  const r = state.recharges;

  return (
    <Card className="flex min-h-[260px] flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowDownToLine className="size-4 text-[#2fd189]" />
          {t('rechargeRecords')}
          {r.total > 0 && (
            <span className="tnum ml-auto text-[11px] font-normal text-muted-foreground">
              {t('rechargeTotal')}{' '}
              <span className="font-semibold text-[#2fd189]">{fmtMoney(r.total)}</span>
              {r.consumedEstimate != null && (
                <>
                  {' · '}
                  {t('consumedEst')} {fmtMoney(r.consumedEstimate)}
                </>
              )}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {!r.list.length ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <PlusCircle className="size-6 text-muted-foreground/40" />
            <span className="max-w-[220px] text-xs leading-relaxed text-muted-foreground">{t('noRecharge')}</span>
          </div>
        ) : (
          r.list.map((x, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <span className="tnum w-20 shrink-0 text-sm font-semibold text-[#2fd189]">+{fmtMoney(x.amount)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {x.note || t('rechargeFallback')}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/60">{fmtTime(x.ts)}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function AlertCard({ state }: { state: AppSnapshot }) {
  const threshold = Number(state.config.alertThreshold) || 0;
  const bal = state.balance;
  const low = Boolean(threshold && bal && bal.totalBalance < threshold);
  const status = !bal ? t('waiting') : low ? t('lowBalance') : threshold ? t('normal') : t('noAlert');

  return (
    <Card className="flex min-h-[260px] flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BellRing className={low ? 'size-4 text-[#ff5c6c]' : 'size-4 text-[#6d8dff]'} />
          {t('balanceAlert')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center gap-3">
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
          <span className="text-xs text-muted-foreground">{t('currentBalance')}</span>
          <span className="tnum text-lg font-bold">{bal ? fmtMoney(bal.totalBalance) : '--'}</span>
        </div>
        <div className="flex items-center justify-between px-1 text-xs">
          <span className="text-muted-foreground">{t('alertLine')}</span>
          <span className="tnum font-medium">{threshold ? fmtMoney(threshold) : t('notEnabled')}</span>
        </div>
        <div className="flex items-center justify-between px-1 text-xs">
          <span className="text-muted-foreground">{t('status')}</span>
          <span
            className={
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium ' +
              (low ? 'bg-[#ff5c6c]/15 text-[#ff5c6c]' : threshold ? 'bg-[#2fd189]/15 text-[#2fd189]' : 'bg-muted text-muted-foreground')
            }
          >
            {status}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
