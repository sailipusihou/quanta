import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { fmtMoney, fmtTime } from '@/lib/format';
import type { AppSnapshot } from '@/lib/types';
import { CircleDollarSign, Download, HelpCircle, MonitorUp, Pin, Plus, RefreshCw, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  state: AppSnapshot;
  onRefresh: () => void;
  onExport: () => void;
  onHelp: () => void;
  onSettings: () => void;
  onRecharge: () => void;
  onSwitchAccount: (id: string) => void;
  onToggleWidget: () => void;
  onTogglePin: () => void;
}

export function Header({
  state,
  onRefresh,
  onExport,
  onHelp,
  onSettings,
  onRecharge,
  onSwitchAccount,
  onToggleWidget,
  onTogglePin,
}: Props) {
  const bal = state.balance;
  const low = Boolean(state.config.alertThreshold && bal && bal.totalBalance < state.config.alertThreshold);
  const pinned = state.config.widget.alwaysOnTop !== false;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
      {/* 余额 */}
      <div
        className={
          'ml-auto flex items-center gap-3 rounded-xl border px-4 py-1.5 backdrop-blur-xl ' +
          (low ? 'border-[#ff5c6c]/50 bg-[#ff5c6c]/10' : 'border-white/10 bg-white/[0.05]')
        }
      >
        <CircleDollarSign className={low ? 'size-4 text-[#ff5c6c]' : 'size-4 text-[#2dd4bf]'} />
        <div>
          <div className="text-[11px] leading-none text-muted-foreground">
            {t('balanceLeft')}
            {bal && (
              <span className="ml-1.5 text-[10px] text-muted-foreground/70">
                {t('recharge')} {fmtMoney(bal.toppedUpBalance)} · {t('granted')} {fmtMoney(bal.grantedBalance)}
              </span>
            )}
          </div>
          <div className="tnum mt-0.5 text-lg font-bold leading-none">
            {bal ? fmtMoney(bal.totalBalance) : '--'}
          </div>
        </div>
        {bal && (
          <span className="hidden text-[10px] text-muted-foreground/60 lg:inline">
            {t('updatedAt')} {fmtTime(bal.fetchedAt)}
          </span>
        )}
      </div>

      {/* 操作 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={state.config.selectedAccountId} onValueChange={onSwitchAccount}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {state.config.accounts.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs">
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="sm" onClick={onRecharge}>
          <Plus className="mr-1 size-3.5" />
          {t('recordRecharge')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onExport}>
          <Download className="mr-1 size-3.5" />
          {t('export')}
        </Button>
        <span className="h-4 w-px bg-white/10" />
        <Button variant="ghost" size="icon" onClick={onToggleWidget} title={t('widgetShow')}>
          <MonitorUp className="size-4" />
        </Button>
        <Button
          variant={pinned ? 'secondary' : 'ghost'}
          size="icon"
          onClick={onTogglePin}
          title={pinned ? t('pinOn') : t('pinOff')}
        >
          <Pin className={cn('size-4 transition-transform', pinned && 'rotate-45 text-[#2dd4bf]')} />
        </Button>
        <span className="h-4 w-px bg-white/10" />
        <Button variant="ghost" size="icon" onClick={onRefresh} title={t('refresh')}>
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onHelp} title={t('help')}>
          <HelpCircle className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onSettings} title={t('settings')}>
          <Settings className="size-4" />
        </Button>
      </div>
    </div>
  );
}
