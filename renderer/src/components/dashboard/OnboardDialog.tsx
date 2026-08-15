import { useState } from 'react';
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
import { t } from '@/lib/i18n';
import { fmtMoney } from '@/lib/format';
import type { AppSnapshot } from '@/lib/types';
import { Eye, EyeOff, KeyRound } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AppSnapshot;
  onVerified: (s: AppSnapshot) => void;
}

export function OnboardDialog({ open, onOpenChange, state, onVerified }: Props) {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const verify = async () => {
    const k = key.trim();
    setError(null);
    if (!k) {
      setError(t('needKey'));
      return;
    }
    setVerifying(true);
    try {
      const accounts = state.config.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        baseUrl: a.baseUrl,
        balanceUrl: a.balanceUrl,
        balanceJsonPath: a.balanceJsonPath,
        currency: a.currency,
        apiKey: a.id === state.config.selectedAccountId ? k : '',
      }));
      await window.api.saveSettings({ accounts });
      const s = await window.api.refreshBalance();
      if (s.balanceError) {
        setError(t('keyFail', { msg: s.balanceError.message }));
      } else {
        onOpenChange(false);
        onVerified(s);
        toast.success(t('keyOk', { bal: fmtMoney(s.balance?.totalBalance) }));
      }
    } catch (err) {
      setError(t('saveFail', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6d8dff] to-[#9b6dff] shadow-lg shadow-[#6d8dff]/25">
            <KeyRound className="size-6 text-white" />
          </div>
          <DialogTitle className="text-center">{t('onboardTitle')}</DialogTitle>
          <DialogDescription className="text-center text-xs leading-relaxed">{t('onboardIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              type={showKey ? 'text' : 'password'}
              placeholder="sk-..."
              className="h-9 flex-1 font-mono text-xs"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verify()}
              autoFocus
            />
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          {error && <p className="text-xs text-[#ff5c6c]">{error}</p>}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('onboardSkip')}
          </Button>
          <Button size="sm" onClick={verify} disabled={verifying}>
            {verifying ? t('verifying') : t('onboardSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
