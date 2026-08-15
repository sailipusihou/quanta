import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';
import type { Account, AppSnapshot, Profile } from '@/lib/types';
import { CUSTOM_PRESET, PLATFORM_PRESETS, presetById } from '@/lib/platforms';
import { AvatarCircle } from './ProfileSwitcher';
import { Camera, KeyRound, Trash2, UserCheck, UserRound } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AppSnapshot;
  profile: Profile | null;
  onChanged: () => Promise<void>; // 变更后刷新 snapshot
}

// 档案详情（二层界面）：点击用户头像进入
export function ProfileDialog({ open, onOpenChange, state, profile, onChanged }: Props) {
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !profile) return;
    setName(profile.name);
    setAccountId(profile.accountId);
    setApiKeyId(profile.apiKeyId);
    setModel(profile.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?.id]);

  const account = useMemo(() => state.config.accounts.find((a) => a.id === accountId) || null, [accountId, state.config.accounts]);
  const preset = presetById(account?.id || '') || CUSTOM_PRESET;
  const models = useMemo(() => {
    const base = preset?.models || [];
    if (model && !base.includes(model)) return [model, ...base];
    return base;
  }, [preset, model]);

  const uploadAvatar = async () => {
    if (!profile) return;
    const r = await window.api.pickAvatar(profile.id);
    if (r.saved) {
      await onChanged();
      toast.success(t('avatarOk'));
    } else if (r.reason && r.reason !== '已取消') {
      toast.error(t('avatarFail', { msg: r.reason }));
    }
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await window.api.updateProfile(profile.id, { name, accountId, apiKeyId, model });
      await onChanged();
      onOpenChange(false);
      toast.success(t('profileSaved'));
    } catch (err) {
      toast.error(t('saveFail', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!profile) return;
    if (!window.confirm(t('deleteProfileConfirm', { name: profile.name }))) return;
    await window.api.deleteProfile(profile.id);
    await onChanged();
    onOpenChange(false);
    toast.success(t('profileDeleted'));
  };

  const setActive = async () => {
    if (!profile) return;
    await window.api.switchProfile(profile.id);
    await onChanged();
    toast.success(t('toastSwitched', { name: name || profile.name }));
  };

  if (!profile) return null;
  const isActive = profile.id === state.profiles.activeId;
  const accountOptions = state.config.accounts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-[#2dd4bf]" />
            {isActive ? t('activeProfile') : t('profileSection')} · {profile.name}
            {isActive && (
              <Badge variant="secondary" className="text-[10px]">
                {t('current')}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {/* 大头像 + 上传 */}
          <div className="relative">
            <div className="rounded-full bg-gradient-to-br from-[#2dd4bf] to-[#a78bfa] p-[3px] shadow-lg shadow-[#2dd4bf]/25">
              <AvatarCircle profile={profile} size="lg" />
            </div>
            <Button
              variant="secondary"
              size="icon"
              className="absolute -right-1 -bottom-1 size-8 rounded-full shadow-md"
              title={t('profileAvatar')}
              onClick={uploadAvatar}
            >
              <Camera className="size-4" />
            </Button>
          </div>

          <div className="w-full space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('profileName')}</Label>
              <Input className="h-9 text-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('profileBindAccount')}</Label>
                <select
                  className="h-9 w-full rounded-md border bg-transparent px-2 text-xs"
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setApiKeyId('');
                  }}
                >
                  <option value="">—</option>
                  {accountOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('profileBindKey')}</Label>
                <select
                  className="h-9 w-full rounded-md border bg-transparent px-2 text-xs"
                  value={apiKeyId}
                  onChange={(e) => setApiKeyId(e.target.value)}
                  disabled={!account || !account.apiKeys.length}
                >
                  <option value="">{t('unbound')}</option>
                  {account?.apiKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label || k.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('profileModel')}
                <span className="ml-1 font-normal opacity-60">{t('profileModelHint')}</span>
              </Label>
              <Input
                className="h-9 font-mono text-xs"
                list="quanta-model-presets"
                value={model}
                placeholder="deepseek-v4-flash"
                onChange={(e) => setModel(e.target.value)}
              />
              <datalist id="quanta-model-presets">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>

            {/* 平台徽章 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="inline-flex h-2 w-2 rounded-full"
                style={{ background: preset.badgeColor }}
              />
              <span className="text-[11px] text-muted-foreground">
                {preset.name} · {account?.baseUrl || t('unbound')}
              </span>
              {account && !account.balanceUrl && (
                <Badge variant="outline" className="border-amber-500/40 text-[10px] font-normal text-amber-400">
                  {t('noBalanceApi')}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-[#ff5c6c]" onClick={remove}>
              <Trash2 className="mr-1 size-3.5" />
              {t('delete')}
            </Button>
            {!isActive && (
              <Button variant="secondary" size="sm" onClick={setActive}>
                <UserCheck className="mr-1 size-3.5" />
                {t('setCurrent')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <KeyRound className="mr-1 size-3.5" />
              {t('save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
