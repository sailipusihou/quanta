import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';
import { presetForAccount } from '@/lib/platforms';
import type { AppSnapshot } from '@/lib/types';
import { ExternalLink, QrCode, Wallet } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  state: AppSnapshot;
}

export function RechargeDialog({ open, onOpenChange, onSaved, state }: Props) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setAmount('');
      setNote('');
    }
  }, [open]);

  const account = state.config.accounts.find((a) => a.id === state.config.selectedAccountId) || null;
  const preset = presetForAccount(account || { id: '', baseUrl: '' });

  const save = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(t('toastBadAmount'));
      return;
    }
    await window.api.addRecharge(n, note.trim());
    onOpenChange(false);
    onSaved();
    toast.success(t('toastRechargeSaved'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('rechargeTitle')}</DialogTitle>
          <DialogDescription className="text-xs">{t('rechargeSaveNote')}</DialogDescription>
        </DialogHeader>

        {/* 官方充值入口（当前平台） */}
        {preset?.rechargeUrl && (
          <div className="rounded-xl border border-[#2dd4bf]/25 bg-[#2dd4bf]/[0.06] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#8df4e6]">
              <QrCode className="size-3.5" />
              {preset.name} · {t('rechargeOfficial')}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {t('rechargeOfficialHint')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 h-8 w-full text-xs"
              onClick={() => window.api.openExternal(preset.rechargeUrl!)}
            >
              <ExternalLink className="mr-1 size-3.5" />
              {t('rechargeGo', { name: preset.name })}
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
          <Wallet className="size-3" />
          {t('rechargeLocalNote')}
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">{t('rechargeAmount')}</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="50"
              className="h-9"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('rechargeNote')}</Label>
            <Input
              maxLength={100}
              placeholder={t('rechargeNotePlaceholder')}
              className="h-9"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button size="sm" onClick={save}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
