import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';
import type { AppSnapshot } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  license: AppSnapshot['license'];
  /** 拦截模式：无法关闭（未核销 / 已过期） */
  blocking?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onActivated: () => Promise<void> | void;
}

const STATE_STYLE: Record<string, { color: string; icon: typeof ShieldAlert }> = {
  none: { color: 'text-[#ffb454]', icon: KeyRound },
  expired: { color: 'text-[#ff5c6c]', icon: ShieldAlert },
  mismatch: { color: 'text-[#ff5c6c]', icon: ShieldAlert },
  clock: { color: 'text-[#ff5c6c]', icon: ShieldAlert },
  invalid: { color: 'text-[#ff5c6c]', icon: ShieldAlert },
  active: { color: 'text-[#2fd189]', icon: CheckCircle2 },
};

function stateText(state: string) {
  switch (state) {
    case 'none':
      return t('licenseStateNone');
    case 'expired':
      return t('licenseStateExpired');
    case 'mismatch':
      return t('licenseStateMismatch');
    case 'clock':
      return t('licenseStateClock');
    case 'invalid':
      return t('licenseStateInvalid');
    default:
      return t('licenseStateActive');
  }
}

export function LicenseDialog({ license, blocking, open, onOpenChange, onActivated }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const style = STATE_STYLE[license.state] || STATE_STYLE.none;
  const Icon = style.icon;

  useEffect(() => {
    if (open) setErr('');
  }, [open]);

  const submit = async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await window.api.activateLicense(value);
      if (r.ok) {
        toast.success(t('licenseActivated'));
        setCode('');
        await onActivated();
        onOpenChange?.(false);
      } else {
        setErr(r.message || t('licenseInvalid'));
      }
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="space-y-4">
      {/* 当前状态 */}
      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <Icon className={cn('mt-0.5 size-5 shrink-0', style.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-semibold', style.color)}>{stateText(license.state)}</span>
            {license.tierLabel && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {license.tierLabel}
              </Badge>
            )}
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {license.state === 'active' && license.lifetime && t('licenseLifetimeHint')}
            {license.state === 'active' && !license.lifetime && license.daysLeft != null && (
              <>
                {t('licenseDaysLeft')}: <span className="tnum font-semibold text-foreground">{license.daysLeft}</span> {t('days')}
                {license.expiresAt ? ` · ${t('licenseExpiresAt')} ${new Date(license.expiresAt).toLocaleString()}` : ''}
              </>
            )}
            {license.state !== 'active' && (license.message || t('licenseNeedCode'))}
          </div>
          {license.codeMasked && license.state === 'active' && (
            <div className="tnum mt-1 font-mono text-[10px] text-muted-foreground/60">
              {t('licenseCurrent')}: {license.codeMasked}
            </div>
          )}
        </div>
      </div>

      {/* 核销码输入 */}
      <div className="space-y-2">
        <Label className="text-xs">{t('licenseInputLabel')}</Label>
        <div className="flex gap-2">
          <Input
            className="h-10 flex-1 font-mono text-sm tracking-wider uppercase"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXX"
            value={code}
            spellCheck={false}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <Button className="h-10" disabled={busy || !code.trim()} onClick={submit}>
            {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            {t('licenseActivate')}
          </Button>
        </div>
        {err && <p className="text-[11px] text-[#ff5c6c]">{err}</p>}
        <p className="text-[10px] leading-relaxed text-muted-foreground/60">{t('licenseInputHint')}</p>
      </div>

      {/* 档位说明 */}
      <div className="rounded-xl border border-white/10 p-3">
        <div className="text-[11px] font-medium text-muted-foreground">{t('licenseTiersTitle')}</div>
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground/80">
          <li>· {t('licenseTier7')}</li>
          <li>· {t('licenseTier30')}</li>
          <li>· {t('licenseTierLife')}</li>
        </ul>
        <p className="mt-2 text-[10px] text-muted-foreground/50">{t('licenseBindHint')}</p>
      </div>
    </div>
  );

  if (blocking) {
    return (
      <Dialog open>
        <DialogContent
          className="max-w-md [&>button]:hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-[#ffb454]" />
              {t('licenseTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs">{t('licenseBlockedDesc')}</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-[#ffb454]" />
            {t('licenseTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">{t('licenseDesc')}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
