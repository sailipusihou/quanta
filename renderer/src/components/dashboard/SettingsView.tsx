import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { Account, ApiKeyItem, AppSnapshot, Profile } from '@/lib/types';
import { CUSTOM_PRESET, PLATFORM_PRESETS } from '@/lib/platforms';
import {
  ArrowLeft,
  Camera,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  UserCheck,
  RefreshCw,
  Users,
  KeyRound,
  Building2,
  Settings2,
  Tags,
  ChevronRight,
  LayoutDashboard,
  Shuffle,
  ShieldCheck,
} from 'lucide-react';
import { AvatarCircle } from './ProfileSwitcher';
import { LicenseDialog } from './LicenseDialog';

interface Props {
  state: AppSnapshot;
  onClose: () => void;
  onSaved: () => void;
}

interface EditorAccount extends Account {
  _keyInput: string;
  _tokenInput: string;
  _keys: (ApiKeyItem & { _input: string })[];
}

type TabId = 'profiles' | 'accounts' | 'general' | 'tags' | 'router';

const TABS: { id: TabId; label: string; icon: typeof Users; desc: string }[] = [
  { id: 'profiles', label: 'profileSection', icon: Users, desc: '用户档案 · 头像 / 绑定 / 模型' },
  { id: 'accounts', label: 'accounts', icon: Building2, desc: '平台账户 · 多 Key 追踪' },
  { id: 'router', label: 'routerTab', icon: Shuffle, desc: '省钱路由 · 失败自动降级' },
  { id: 'general', label: 'general', icon: Settings2, desc: '端口 / 轮询 / 通知 / 语言' },
  { id: 'tags', label: 'tagRules', icon: Tags, desc: '请求标签匹配规则' },
];

function keyId() {
  return 'k-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// 全窗口设置页（全局界面）：进入后整个窗口切换到设置视图
export function SettingsView({ state, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<TabId>('profiles');
  const [accounts, setAccounts] = useState<EditorAccount[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tagRules, setTagRules] = useState<{ pattern: string; label: string }[]>([]);
  const [modelRoutes, setModelRoutes] = useState<{ pattern: string; to: string }[]>([]);
  const [failoverEnabled, setFailoverEnabled] = useState(false);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [port, setPort] = useState(8787);
  const [pollSec, setPollSec] = useState(60);
  const [alertThreshold, setAlertThreshold] = useState(0);
  const [notify, setNotify] = useState('all');
  const [language, setLanguage] = useState('zh');
  const [theme, setTheme] = useState('black');
  const [updateFeed, setUpdateFeed] = useState('');
  const [autoStart, setAutoStart] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ text: string; link?: string } | null>(null);
  const [calCost, setCalCost] = useState('');
  const [calTokens, setCalTokens] = useState('');
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const presetRef = useRef<HTMLSelectElement>(null);

  // 挂载时初始化一次（离开页面即放弃未保存修改）
  useEffect(() => {
    const cfg = state.config;
    setAccounts(
      cfg.accounts.map((a) => ({
        ...a,
        _keyInput: '',
        _tokenInput: '',
        _keys: (a.apiKeys || []).map((k) => ({ ...k, _input: '' })),
        models: Array.isArray(a.models) ? a.models : [],
      }))
    );
    setSelectedId(cfg.selectedAccountId);
    setProfiles(state.profiles.list.map((p) => ({ ...p })));
    setTagRules(cfg.tagRules.map((r) => ({ ...r })));
    setModelRoutes(Array.isArray(cfg.modelRoutes) ? cfg.modelRoutes.map((r) => ({ ...r })) : []);
    setFailoverEnabled(!!(cfg.failover && cfg.failover.enabled));
    setPort(cfg.proxyPort);
    setPollSec(Math.round(cfg.balancePollMs / 1000));
    setAlertThreshold(cfg.alertThreshold || 0);
    setNotify(cfg.requestNotify || 'all');
    setLanguage(cfg.language || 'zh');
    setTheme(cfg.theme || 'black');
    setUpdateFeed(cfg.updateFeedUrl || '');
    setAutoStart(cfg.autoStart);
    setCalCost(state.todayCalibration && state.todayCalibration.cost != null ? String(state.todayCalibration.cost) : '');
    setCalTokens(state.todayCalibration && state.todayCalibration.tokens != null ? String(state.todayCalibration.tokens) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 账户编辑 ----
  const updateAccount = (id: string, patch: Partial<EditorAccount>) => {
    setAccounts((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const addAccount = () => {
    const preset = PLATFORM_PRESETS.find((p) => p.id === presetRef.current?.value) || CUSTOM_PRESET;
    const id = 'acc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    setAccounts((list) => [
      ...list,
      {
        id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: '',
        apiKeys: [],
        platformToken: '',
        hasPlatformToken: false,
        hasApiKey: false,
        _keyInput: '',
        _tokenInput: '',
        _keys: [],
        models: [],
        balanceUrl: preset.balanceUrl,
        balanceJsonPath: preset.balanceJsonPath,
        currency: preset.currency,
      },
    ]);
  };

  // ---- 档案编辑 ----
  const updateProfile = (id: string, patch: Partial<Profile>) => {
    setProfiles((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addProfile = async () => {
    try {
      const p = await window.api.createProfile({ name: '新用户', model: 'deepseek-v4-flash' });
      setProfiles((list) => [...list, p]);
      toast.success(t('profileCreated'));
    } catch (err) {
      toast.error(t('saveFail', { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  const uploadAvatar = async (profileId: string) => {
    const r = await window.api.pickAvatar(profileId);
    if (r.saved) {
      await onSaved();
      toast.success(t('avatarOk'));
    } else if (r.reason && r.reason !== '已取消') {
      toast.error(t('avatarFail', { msg: r.reason }));
    }
  };

  const removeProfile = async (p: Profile) => {
    if (!window.confirm(t('deleteProfileConfirm', { name: p.name }))) return;
    await window.api.deleteProfile(p.id);
    setProfiles((list) => list.filter((x) => x.id !== p.id));
    toast.success(t('profileDeleted'));
  };

  const setActiveProfile = async (id: string) => {
    await window.api.switchProfile(id);
    await onSaved();
    toast.success(t('toastSwitched', { name: profiles.find((p) => p.id === id)?.name || '' }));
  };

  // ---- 其他 ----
  const checkUpdate = async () => {
    setChecking(true);
    setUpdateResult({ text: t('updateChecking') });
    const r = await window.api.checkUpdate();
    setChecking(false);
    if (r.status === 'up-to-date') {
      setUpdateResult({ text: t('updateLatest', { ver: r.currentVersion }) });
    } else if (r.status === 'update-available') {
      setUpdateResult({ text: t('updateFound', { ver: r.version }), link: r.url });
    } else if (r.status === 'no-feed') {
      setUpdateResult({ text: t('updateNoFeed') });
    } else {
      setUpdateResult({ text: t('updateError', { msg: r.message }) });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payloadAccounts = accounts.map((a) => ({
        id: a.id,
        name: a.name,
        baseUrl: a.baseUrl,
        balanceUrl: a.balanceUrl,
        balanceJsonPath: a.balanceJsonPath,
        currency: a.currency,
        apiKey: a.apiKey,
        models: a.models || [],
        platformToken: a._tokenInput ? a._tokenInput : a.platformToken,
        apiKeys: a._keys.map((k) => ({
          id: k.id,
          label: k.label,
          key: k._input ? k._input : k.key,
        })),
      }));
      await window.api.saveSettings({
        accounts: payloadAccounts,
        selectedAccountId: selectedId,
        proxyPort: Math.max(1024, Number(port) || 8787),
        balancePollMs: Math.max(10, Number(pollSec) || 60) * 1000,
        alertThreshold: Math.max(0, Number(alertThreshold) || 0),
        requestNotify: notify,
        language,
        theme,
        updateFeedUrl: updateFeed.trim(),
        tagRules: tagRules.filter((r) => r.label && r.pattern),
        modelRoutes: modelRoutes.filter((r) => r.pattern && r.to),
        failover: { enabled: failoverEnabled },
        autoStart,
      });
      await Promise.all(
        profiles.map((p) =>
          window.api.updateProfile(p.id, {
            name: p.name,
            accountId: p.accountId,
            apiKeyId: p.apiKeyId,
            model: p.model,
          })
        )
      );
      await onSaved();
      onClose();
      toast.success(t('toastSaved'));
    } catch (err) {
      toast.error(t('saveFail', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSaving(false);
    }
  };

  const clearData = async () => {
    if (!window.confirm(t('confirmClear'))) return;
    await window.api.clearData();
    await onSaved();
    toast.success(t('toastCleared'));
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* 顶部栏 */}
      <header className="flex items-center gap-3 border-b border-white/10 bg-white/[0.035] px-5 py-3 backdrop-blur-2xl">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="mr-1 size-4" />
          <LayoutDashboard className="mr-1 size-4" />
          {t('backToDashboard')}
        </Button>
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-bold">{t('settingsTitle')}</h1>
          <span className="hidden text-[11px] text-muted-foreground/60 lg:inline">{t('settingsNote')}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-[#ff5c6c]" onClick={clearData}>
            <Trash2 className="mr-1 size-3.5" />
            {t('clearData')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {t('save')}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧分层导航（更宽更舒适） */}
        <nav className="w-60 shrink-0 space-y-1.5 overflow-y-auto border-r border-white/10 bg-white/[0.02] p-4">
          {TABS.map((tb) => {
            const Icon = tb.icon;
            const active = tab === tb.id;
            return (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors',
                  active
                    ? 'bg-[#2dd4bf]/12 text-[#7ff0e2] shadow-inner shadow-[#2dd4bf]/5'
                    : 'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-lg',
                    active ? 'bg-[#2dd4bf]/15 text-[#2dd4bf]' : 'bg-white/[0.04] text-muted-foreground/70'
                  )}
                >
                  <Icon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(tb.label)}</span>
                  <span className="block truncate text-[10px] text-muted-foreground/50">{tb.desc}</span>
                </span>
                <ChevronRight className={cn('size-4 shrink-0', active ? 'text-[#2dd4bf]' : 'opacity-25')} />
              </button>
            );
          })}
        </nav>

        {/* 右侧内容区（全窗口滚动） */}
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {/* ===== 用户档案 ===== */}
          {tab === 'profiles' && (
            <section className="mx-auto max-w-3xl space-y-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Users className="size-5 text-[#2dd4bf]" />
                  {t('profileSection')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground/70">{t('profileHint')}</p>
              </div>
              <div className="space-y-3">
                {profiles.map((p) => {
                  const acc = accounts.find((a) => a.id === p.accountId);
                  const isActive = p.id === state.profiles.activeId;
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'rounded-2xl border p-4 transition-colors',
                        isActive ? 'border-[#2dd4bf]/30 bg-[#2dd4bf]/[0.04]' : 'border-white/10 bg-white/[0.03]'
                      )}
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <AvatarCircle profile={p} size="lg" />
                        <div className="min-w-0 flex-1">
                          <Input
                            className="h-10 text-base"
                            value={p.name}
                            placeholder={t('profileName')}
                            onChange={(e) => updateProfile(p.id, { name: e.target.value })}
                          />
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => uploadAvatar(p.id)}>
                          <Camera className="mr-1 size-3.5" />
                          {t('profileAvatar')}
                        </Button>
                        {isActive && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t('activeProfile')}
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-[#ff5c6c]"
                          title={t('delete')}
                          onClick={() => removeProfile(p)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">{t('profileBindAccount')}</Label>
                          <select
                            className="h-9 w-full rounded-md border bg-transparent px-2 text-xs"
                            value={p.accountId}
                            onChange={(e) => updateProfile(p.id, { accountId: e.target.value, apiKeyId: '' })}
                          >
                            <option value="">—</option>
                            {accounts.map((a) => (
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
                            value={p.apiKeyId}
                            onChange={(e) => updateProfile(p.id, { apiKeyId: e.target.value })}
                            disabled={!acc || !acc._keys.length}
                          >
                            <option value="">{t('unbound')}</option>
                            {acc?._keys.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.label || k.id}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">{t('profileModel')}</Label>
                          <Input
                            className="h-9 font-mono text-xs"
                            list="quanta-model-presets"
                            value={p.model}
                            placeholder="deepseek-v4-flash"
                            onChange={(e) => updateProfile(p.id, { model: e.target.value })}
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 text-xs text-[#2dd4bf]"
                            onClick={() => setActiveProfile(p.id)}
                            disabled={isActive}
                          >
                            <UserCheck className="mr-1 size-3.5" />
                            {t('setCurrent')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Button variant="secondary" size="sm" onClick={addProfile}>
                <Plus className="mr-1 size-3.5" />
                {t('addProfile')}
              </Button>
            </section>
          )}

          {/* ===== 平台账户 ===== */}
          {tab === 'accounts' && (
            <section className="mx-auto max-w-3xl space-y-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Building2 className="size-5 text-[#2dd4bf]" />
                  {t('accounts')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground/70">
                  选择平台预设后添加，填入 API Key 即可对接；每平台可添加多个 Key 分别追踪消耗。
                </p>
              </div>
              <div className="space-y-3">
                {accounts.map((a, i) => (
                  <div key={a.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t('accountN', { n: i + 1 })} · {a.name || '?'}
                      </span>
                      {a.id === selectedId && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t('current')}
                        </Badge>
                      )}
                      <div className="ml-auto flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setSelectedId(a.id)}
                          disabled={a.id === selectedId}
                        >
                          <UserCheck className="mr-1 size-3.5" />
                          {t('setCurrent')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-[#ff5c6c] hover:text-[#ff5c6c]"
                          onClick={() => setAccounts((list) => list.filter((x) => x.id !== a.id))}
                          disabled={accounts.length === 1}
                        >
                          <Trash2 className="mr-1 size-3.5" />
                          {t('delete')}
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">{t('name')}</Label>
                        <Input className="h-9 text-sm" value={a.name} onChange={(e) => updateAccount(a.id, { name: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">{t('currency')}</Label>
                        <Input className="h-9 text-sm" value={a.currency} onChange={(e) => updateAccount(a.id, { currency: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">{t('baseUrl')}</Label>
                        <Input
                          className="h-9 font-mono text-xs"
                          value={a.baseUrl}
                          onChange={(e) => updateAccount(a.id, { baseUrl: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">{t('balanceUrl')}</Label>
                        <Input
                          className="h-9 font-mono text-xs"
                          value={a.balanceUrl}
                          placeholder={t('noBalanceApi')}
                          onChange={(e) => updateAccount(a.id, { balanceUrl: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">{t('balanceJsonPath')}</Label>
                        <Input
                          className="h-9 font-mono text-xs"
                          value={a.balanceJsonPath}
                          onChange={(e) => updateAccount(a.id, { balanceJsonPath: e.target.value })}
                        />
                      </div>
                    </div>
                    {/* 多 Key 编辑 */}
                    <div className="mt-4 space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">{t('keySection')}</Label>
                      {a._keys.map((k, ki) => (
                        <div key={k.id} className="flex gap-1.5">
                          <Input
                            className="h-9 w-40 shrink-0 text-sm"
                            placeholder={t('keyLabel')}
                            value={k.label}
                            onChange={(e) =>
                              setAccounts((list) =>
                                list.map((x) =>
                                  x.id === a.id
                                    ? { ...x, _keys: x._keys.map((kk, i) => (i === ki ? { ...kk, label: e.target.value } : kk)) }
                                    : x
                                )
                              )
                            }
                          />
                          <Input
                            type="password"
                            className="h-9 flex-1 font-mono text-xs"
                            placeholder={k.key && !k._input ? t('keyConfigured') : 'sk-...'}
                            value={k._input}
                            onChange={(e) =>
                              setAccounts((list) =>
                                list.map((x) =>
                                  x.id === a.id
                                    ? { ...x, _keys: x._keys.map((kk, i) => (i === ki ? { ...kk, _input: e.target.value } : kk)) }
                                    : x
                                )
                              )
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0 text-[#ff5c6c]"
                            title={t('deleteKey')}
                            onClick={() =>
                              setAccounts((list) =>
                                list.map((x) => (x.id === a.id ? { ...x, _keys: x._keys.filter((_, i) => i !== ki) } : x))
                              )
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-[#2dd4bf]"
                        onClick={() =>
                          setAccounts((list) =>
                            list.map((x) =>
                              x.id === a.id ? { ...x, _keys: [...x._keys, { id: keyId(), label: '', key: '', _input: '' }] } : x
                            )
                          )
                        }
                      >
                        <KeyRound className="mr-1 size-3.5" />
                        {t('addKey')}
                      </Button>
                    </div>
                    {/* 平台登录 Token（官网消费总结对账） */}
                    <div className="mt-4 space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">{t('platformToken')}</Label>
                      <div className="flex gap-1.5">
                        <Input
                          type="password"
                          className="h-8 flex-1 font-mono text-[11px]"
                          placeholder={a.hasPlatformToken ? '已配置（****），留空不变' : 'userToken'}
                          value={a._tokenInput}
                          onChange={(e) =>
                            setAccounts((list) =>
                              list.map((x) => (x.id === a.id ? { ...x, _tokenInput: e.target.value } : x))
                            )
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 shrink-0 text-[10px] text-[#2dd4bf]"
                          onClick={() => window.api.openExternal('https://platform.deepseek.com/')}
                        >
                          {t('tokenGuide')}
                        </Button>
                      </div>
                      <p className="text-[10px] leading-relaxed text-muted-foreground/60">{t('platformTokenHint')}</p>
                    </div>
                    {/* 模型列表（表盘档位） */}
                    <div className="mt-4 space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">{t('modelList')}</Label>                      <div className="flex flex-wrap gap-1.5">
                        {(a.models || []).map((mm, mi) => (
                          <span
                            key={mi}
                            className="group/model flex items-center gap-1 rounded-md border border-[#2dd4bf]/25 bg-[#2dd4bf]/[0.07] px-2 py-1 font-mono text-[11px] text-[#8df4e6]"
                          >
                            {mm}
                            <button
                              className="text-muted-foreground/50 transition-colors hover:text-[#ff5c6c]"
                              title={t('delete')}
                              onClick={() =>
                                setAccounts((list) =>
                                  list.map((x) =>
                                    x.id === a.id
                                      ? { ...x, models: (x.models || []).filter((_, i) => i !== mi) }
                                      : x
                                  )
                                )
                              }
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {!(a.models || []).length && (
                          <span className="text-[11px] text-muted-foreground/50">（使用平台默认模型）</span>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs"
                          placeholder={t('modelAddPlaceholder')}
                          list="quanta-account-models"
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            const v = (e.target as HTMLInputElement).value.trim();
                            if (!v) return;
                            setAccounts((list) =>
                              list.map((x) =>
                                x.id === a.id && !(x.models || []).includes(v)
                                  ? { ...x, models: [...(x.models || []), v] }
                                  : x
                              )
                            );
                            (e.target as HTMLInputElement).value = '';
                          }}
                        />
                        <datalist id="quanta-account-models">
                          {PLATFORM_PRESETS.flatMap((p) => p.models).map((mm) => (
                            <option key={mm} value={mm} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <select ref={presetRef} className="h-9 max-w-72 flex-1 rounded-md border bg-transparent px-2 text-sm" defaultValue="deepseek">
                  {PLATFORM_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value={CUSTOM_PRESET.id}>{CUSTOM_PRESET.name}</option>
                </select>
                <Button variant="secondary" onClick={addAccount}>
                  <Plus className="mr-1 size-3.5" />
                  {t('addAccount')}
                </Button>
              </div>
            </section>
          )}

          {/* ===== 通用 ===== */}
          {tab === 'general' && (
            <section className="mx-auto max-w-3xl space-y-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Settings2 className="size-5 text-[#2dd4bf]" />
                  {t('general')}
                </h2>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t('apiKey')}</Label>
                <div className="flex gap-2">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    className="h-10 flex-1 font-mono text-sm"
                    placeholder={state.config.hasApiKey ? t('keyPlaceholder') : 'sk-...'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t('port')}</Label>
                  <Input type="number" className="h-9 text-sm" value={port} onChange={(e) => setPort(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t('pollSec')}</Label>
                  <Input type="number" className="h-9 text-sm" value={pollSec} onChange={(e) => setPollSec(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t('alertThreshold')}</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    className="h-9 text-sm"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t('requestNotify')}</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                    value={notify}
                    onChange={(e) => setNotify(e.target.value)}
                  >
                    <option value="off">{t('notifyOff')}</option>
                    <option value="error">{t('notifyError')}</option>
                    <option value="all">{t('notifyAll')}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t('language')}</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="zh">{t('langZh')}</option>
                    <option value="en">{t('langEn')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t('themeLabel')}</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="black">{t('themeBlack')}</option>
                    <option value="aurora">{t('themeAurora')}</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground/50">{t('themeHint')}</p>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('updateFeed')}</Label>
                <Input className="h-9 font-mono text-xs" value={updateFeed} onChange={(e) => setUpdateFeed(e.target.value)} />
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={checkUpdate} disabled={checking}>
                  <RefreshCw className={cn('mr-1 size-3.5', checking && 'animate-spin')} />
                  {t('updateCheck')}
                </Button>
                {updateResult && (
                  <span className="text-xs text-muted-foreground">
                    {updateResult.text}
                    {updateResult.link && (
                      <a
                        className="ml-1 cursor-pointer text-[#2dd4bf] underline-offset-2 hover:underline"
                        onClick={() => window.api.openExternal(updateResult.link!)}
                      >
                        {t('updateOpen')}
                      </a>
                    )}
                  </span>
                )}
              </div>
              <Separator />
              {/* 授权（本地核销码） */}
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck
                      className={cn('size-4', state.license?.ok ? 'text-[#2fd189]' : 'text-[#ffb454]')}
                    />
                    <Label className="text-sm">{t('licenseSection')}</Label>
                    {state.license?.tierLabel && (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {state.license.tierLabel}
                      </Badge>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" className="h-8" onClick={() => setLicenseOpen(true)}>
                    {t('licenseManage')}
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                  {state.license?.state === 'active' && state.license.lifetime
                    ? t('licenseLifetimeHint')
                    : state.license?.state === 'active' && state.license.daysLeft != null
                      ? `${t('licenseDaysLeft')} ${state.license.daysLeft} ${t('days')}${
                          state.license.expiresAt ? ` · ${t('licenseExpiresAt')} ${new Date(state.license.expiresAt).toLocaleString()}` : ''
                        }`
                      : state.license?.message || t('licenseNeedCode')}
                  {' · '}
                  {t('licenseSectionHint')}
                </p>
              </div>
              <Separator />
              {/* 今日消耗校准（官网控制台值） */}
              <div className="space-y-2 rounded-xl border border-[#ffb454]/20 bg-[#ffb454]/[0.04] p-3">
                <Label className="flex items-center gap-2 text-sm">
                  <span className="size-2 rounded-full bg-[#ffb454] shadow-[0_0_6px_rgba(255,180,84,0.9)]" />
                  {t('calibrationTitle')}
                </Label>
                <p className="text-[11px] leading-relaxed text-muted-foreground/70">{t('calibrationHint')}</p>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">{t('calibrationCost')}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 w-28 font-mono text-xs"
                      value={calCost}
                      onChange={(e) => setCalCost(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">{t('calibrationTokens')}</Label>
                    <Input
                      type="number"
                      className="h-8 w-36 font-mono text-xs"
                      value={calTokens}
                      onChange={(e) => setCalTokens(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8"
                    onClick={async () => {
                      const cost = calCost.trim() === '' ? null : Number(calCost);
                      const tokens = calTokens.trim() === '' ? null : Number(calTokens);
                      if (cost === null && tokens === null) return;
                      await window.api.saveCalibration(cost, tokens);
                      await onSaved();
                      toast.success(t('toastSaved'));
                    }}
                  >
                    {t('calibrationSave')}
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm">
                  <Switch checked={autoStart} onCheckedChange={setAutoStart} />
                  {t('autoStart')}
                </Label>
              </div>
            </section>
          )}

          {/* ===== 标签规则 ===== */}
          {tab === 'tags' && (
            <section className="mx-auto max-w-3xl space-y-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Tags className="size-5 text-[#2dd4bf]" />
                  {t('tagRules')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground/70">{t('tagHint')}</p>
              </div>
              <div className="space-y-2">
                {tagRules.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      className="h-9 flex-1 font-mono text-xs"
                      placeholder={t('tagPattern')}
                      value={r.pattern}
                      onChange={(e) =>
                        setTagRules((list) => list.map((x, xi) => (xi === i ? { ...x, pattern: e.target.value } : x)))
                      }
                    />
                    <Input
                      className="h-9 flex-1 font-mono text-xs"
                      placeholder={t('tagLabel')}
                      value={r.label}
                      onChange={(e) =>
                        setTagRules((list) => list.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-[#ff5c6c]"
                      onClick={() => setTagRules((list) => list.filter((_, xi) => xi !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setTagRules((list) => [...list, { pattern: '', label: '' }])}>
                <Plus className="mr-1 size-3.5" />
                {t('addRule')}
              </Button>
            </section>
          )}

          {/* ===== 路由与降级 ===== */}
          {tab === 'router' && (
            <section className="mx-auto max-w-3xl space-y-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Shuffle className="size-5 text-[#2dd4bf]" />
                  {t('routerTab')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground/70">{t('routeHint')}</p>
              </div>

              {/* 自动省钱路由 */}
              <div className="space-y-2">
                <Label className="text-xs">{t('routePattern')}</Label>
                <div className="space-y-2">
                  {modelRoutes.map((r, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        className="h-9 flex-1 font-mono text-xs"
                        placeholder="gpt-4o"
                        value={r.pattern}
                        onChange={(e) =>
                          setModelRoutes((list) => list.map((x, xi) => (xi === i ? { ...x, pattern: e.target.value } : x)))
                        }
                      />
                      <span className="flex items-center text-muted-foreground">→</span>
                      <Input
                        className="h-9 flex-1 font-mono text-xs"
                        placeholder="deepseek-v4-flash"
                        value={r.to}
                        onChange={(e) =>
                          setModelRoutes((list) => list.map((x, xi) => (xi === i ? { ...x, to: e.target.value } : x)))
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-[#ff5c6c]"
                        title={t('delete')}
                        onClick={() => setModelRoutes((list) => list.filter((_, xi) => xi !== i))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setModelRoutes((list) => [...list, { pattern: '', to: '' }])}
                >
                  <Plus className="mr-1 size-3.5" />
                  {t('addRoute')}
                </Button>
                <p className="text-[11px] text-muted-foreground/60">
                  客户端请求模型匹配规则（正则）时，代理自动改写为「实际使用模型」并按实际模型计费。
                </p>
              </div>

              <Separator />

              {/* 失败自动降级 */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Switch checked={failoverEnabled} onCheckedChange={setFailoverEnabled} />
                  {t('failoverEnabled')}
                </Label>
                <p className="text-[11px] leading-relaxed text-muted-foreground/70">{t('failoverHint')}</p>
                <p className="text-[11px] text-muted-foreground/50">
                  备用顺序 = 平台账户列表顺序（需配置 API Key 的账户才会参与）。
                </p>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* 授权管理弹窗（非拦截模式） */}
      <LicenseDialog
        license={state.license}
        open={licenseOpen}
        onOpenChange={setLicenseOpen}
        onActivated={onSaved}
      />
    </div>
  );
}
