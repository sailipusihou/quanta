import { useState } from 'react';
import { toast } from 'sonner';
import { useAppState } from '@/hooks/useAppState';
import { langFromConfig, setLang, t } from '@/lib/i18n';
import { periodLabel } from '@/lib/format';
import type { AppSnapshot, Profile } from '@/lib/types';
import { Header } from '@/components/dashboard/Header';
import { TrendChart } from '@/components/dashboard/TrendChart';
import { ModelList } from '@/components/dashboard/ModelList';
import { RechargeCard, AlertCard } from '@/components/dashboard/RechargeAlertCards';
import { RecentTable } from '@/components/dashboard/RecentTable';
import { SettingsView } from '@/components/dashboard/SettingsView';
import { RechargeDialog } from '@/components/dashboard/RechargeDialog';
import { OnboardDialog } from '@/components/dashboard/OnboardDialog';
import { HelpDialog } from '@/components/dashboard/HelpDialog';
import { ProfileDialog } from '@/components/dashboard/ProfileDialog';
import { Workbench } from '@/components/dashboard/Workbench';
import { Starfield } from '@/components/Starfield';
import { TitleBar } from '@/components/TitleBar';
import { AlertTriangle, Server, ReceiptText, Database } from 'lucide-react';

export default function App() {
  const { state, setState, refreshBalance, reload } = useAppState();
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [tagFilter, setTagFilter] = useState('all');
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardSkipped, setOnboardSkipped] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

  // 语言与主题在渲染期同步（幂等），保证任何一次重渲染都使用最新配置
  if (state) {
    setLang(langFromConfig(state.config));
    document.documentElement.dataset.theme = state.config.theme === 'aurora' ? 'aurora' : 'black';
  }

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {t('waiting')}
      </div>
    );
  }

  const onRefresh = async () => {
    await refreshBalance();
    toast.success(t('toastRefreshed'));
  };

  const onExport = async () => {
    const r = await window.api.exportCsv();
    if (r.saved) toast.success(t('toastExported', { path: r.path }));
    else toast.error(t('toastExportFail', { reason: r.reason || '?' }));
  };

  const onSwitchAccount = async (id: string) => {
    await window.api.switchAccount(id);
    const s = await reload();
    toast.success(t('toastSwitched', { name: s.pricing.accountName }));
  };

  const onSwitchProfile = async (id: string) => {
    await window.api.switchProfile(id);
    const s = await reload();
    toast.success(t('toastSwitched', { name: s.profiles.list.find((p) => p.id === id)?.name || '' }));
  };

  // 主面板快捷打开悬浮小窗（关闭后随时找回）
  const onToggleWidget = () => {
    window.api.showWidget();
  };

  // 表盘选中模型档位：切换账户 + 记录选中模型（下方数据按模型过滤）
  const onSwitchModel = async (accountId: string, model: string) => {
    await window.api.switchModel(accountId, model);
    const s = await reload();
    toast.success(
      t('toastSwitched', { name: `${model || ''} · ${s.pricing.accountName}` })
    );
  };

  // 悬浮窗置顶固定开关
  const onTogglePin = async () => {
    const next = !(state.config.widget.alwaysOnTop !== false);
    await window.api.setWidgetAlwaysOnTop(next);
    await reload();
    toast.success(next ? t('widgetPinned') : t('widgetUnpinned'));
  };

  // 点击用户头像 -> 进入档案详情（二层界面）
  const onOpenProfileDetail = (profile: Profile) => {
    setEditingProfile(profile);
    setProfileDialogOpen(true);
  };

  // 快捷注册：创建档案并直接进入详情编辑
  const onAddProfile = async () => {
    try {
      const p = await window.api.createProfile({ name: '新用户', model: 'deepseek-v4-flash' });
      setEditingProfile(p);
      setProfileDialogOpen(true);
      toast.success(t('profileCreated'));
    } catch (err) {
      toast.error(t('saveFail', { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  const onSaved = async () => {
    await reload();
  };

  return (
    <div className="relative min-h-screen">
      {/* 科技星光背景层 */}
      <Starfield />

      {/* 自绘玻璃标题栏（替代系统白条） */}
      <TitleBar state={state} />

      <div className="relative z-10">
        {view === 'settings' ? (
          <div className="view-fade">
            <SettingsView state={state} onClose={() => setView('main')} onSaved={onSaved} />
          </div>
        ) : (
          <div className="view-fade">
            <div className="relative bg-white/[0.03] backdrop-blur-xl">
              <Header
            state={state}
            onRefresh={onRefresh}
            onExport={onExport}
            onHelp={() => setHelpOpen(true)}
            onSettings={() => setView('settings')}
            onRecharge={() => setRechargeOpen(true)}
            onSwitchAccount={onSwitchAccount}
            onToggleWidget={onToggleWidget}
            onTogglePin={onTogglePin}
            />
            <div className="tech-line absolute inset-x-0 bottom-0" />
            </div>

            <main className="mx-auto max-w-[1200px] space-y-4 px-5 py-4">
            {/* 整体工作台：中央平台表盘 + 底部数据带 */}
            <Workbench
              state={state}
              onSwitch={onSwitchModel}
              onOpenDetail={() => {
                const ap = state.profiles.list.find((p) => p.id === state.profiles.activeId);
                if (ap) onOpenProfileDetail(ap);
              }}
              onOpenSettings={() => setView('settings')}
              onAdd={onAddProfile}
              onRefresh={onRefresh}
            />
            <div id="probe-a" className="hidden">{state.profiles.list.length}</div>
        {/* 余额错误横幅 */}
        {state.balanceError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="truncate">{t('balanceFailed', { msg: state.balanceError.message })}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TrendChart days={state.series.days} official={state.officialTrend} />
          </div>
          <div className="lg:col-span-2">
            <ModelList
              list={
                state.officialToday && state.officialToday.ok && state.officialToday.byModel?.length
                  ? state.officialToday.byModel.map((x) => ({
                      model: x.model,
                      requests: x.requests,
                      errors: 0,
                      totalTokens: x.tokens,
                      promptTokens: 0,
                      completionTokens: 0,
                      cacheHit: x.tokens,
                      cacheMiss: 0,
                      cost: x.cost,
                    }))
                  : state.byModel
              }
              official={Boolean(state.officialToday && state.officialToday.ok && state.officialToday.byModel?.length)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <RechargeCard state={state} />
          <AlertCard state={state} />
        </div>

        <RecentTable recent={state.recent} byTag={state.byTag} tagFilter={tagFilter} onTagFilter={setTagFilter} />
      </main>

      <footer className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-5 gap-y-1 px-5 pb-5 text-[11px] text-muted-foreground/60">
        <span className="flex items-center gap-1.5">
          <Server className="size-3" />
          {t('proxy')} http://127.0.0.1:{state.server.port || state.config.proxyPort}
        </span>
        <span className="flex items-center gap-1.5">
          <ReceiptText className="size-3" />
          {t('billing')}
          {periodLabel(state.pricing.period)}
          {state.pricing.priceSource !== 'local' && (
            <span className="text-[#2fd189]">
              · {state.pricing.priceSource === 'official-verified' ? t('priceVerified') : t('priceOfficial')}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <Database className="size-3" />
          {t('data')} usage.jsonl · {state.stats.all.requests} {t('history')}
        </span>
      </footer>

          <RechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} onSaved={onSaved} state={state} />
          <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
          <ProfileDialog
            open={profileDialogOpen}
            onOpenChange={setProfileDialogOpen}
            state={state}
            profile={editingProfile}
            onChanged={onSaved}
          />
          <OnboardDialog
            open={onboardOpen}
            onOpenChange={(open) => {
              setOnboardOpen(open);
              if (!open) setOnboardSkipped(true);
            }}
            state={state}
            onVerified={(s: AppSnapshot) => setState(s)}
          />
            </div>
        )}
      </div>
    </div>
  );
}
