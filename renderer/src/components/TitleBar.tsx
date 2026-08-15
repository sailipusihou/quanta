import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';
import { periodLabel } from '@/lib/format';
import type { AppSnapshot } from '@/lib/types';
import { presetForAccount } from '@/lib/platforms';
import { Minus, Square, Copy, X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import logoUrl from '@/assets/logo.png';

interface Props {
  state: AppSnapshot;
}

// 自绘玻璃标题栏：替代系统白色标题条，整行可拖拽
export function TitleBar({ state }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const check = () => {
      // 通过窗口宽高比简单推断最大化状态（Electron 无同步查询）
      setMaximized(window.outerHeight >= window.screen.availHeight - 8 && window.outerWidth >= window.screen.availWidth - 8);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const toggleMax = async () => {
    const m = await window.api.maximizeToggle();
    setMaximized(m);
  };

  // 当前模型：服务端解析值，回退平台预设默认模型（按 id/baseUrl 匹配）
  const currentModel =
    state.currentModel ||
    presetForAccount(state.config.accounts.find((a) => a.id === state.config.selectedAccountId) || { id: '', baseUrl: '' })?.models[0] ||
    null;

  return (
    <div
      className="widget-drag sticky top-0 z-40 flex h-11 items-center gap-3 bg-white/[0.045] px-4 backdrop-blur-2xl"
      onDoubleClick={toggleMax}
    >
      {/* 品牌区（实际 logo 图片） */}
      <div className="flex items-center gap-2.5">
        <img
          src={logoUrl}
          alt="Quanta"
          draggable={false}
          className="size-8 rounded-[9px] object-cover shadow-md shadow-black/40 ring-1 ring-white/15"
        />
        <span className="text-sm font-bold tracking-wide">Quanta</span>
      </div>

      {/* 徽章 */}
      <div className="hidden items-center gap-1.5 md:flex">
        <Badge variant="secondary" className="text-[10px] font-normal">
          {state.pricing.accountName}
        </Badge>
        {currentModel && (
          <Badge variant="outline" className="border-[#2dd4bf]/40 bg-[#2dd4bf]/10 text-[10px] font-normal text-[#7ff0e2]">
            <Sparkles className="mr-0.5 size-3" />
            {currentModel}
          </Badge>
        )}
        <Badge variant={state.pricing.period === 'peak' ? 'destructive' : 'secondary'} className="text-[10px] font-normal">
          {periodLabel(state.pricing.period)}
        </Badge>
        {!state.config.hasApiKey && (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] font-normal text-amber-400">
            {t('noKey')}
          </Badge>
        )}
      </div>

      {/* 拖拽空白区 */}
      <div className="min-w-4 flex-1" />

      {/* 窗口按钮（不参与拖拽） */}
      <div className="widget-no-drag flex items-center gap-1">
        <button
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
          title={t('windowMinimize')}
          onClick={() => window.api.minimize()}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
          title={maximized ? t('windowRestore') : t('windowMaximize')}
          onClick={toggleMax}
        >
          {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </button>
        <button
          className={cn(
            'ml-1 flex size-7 items-center justify-center rounded-lg text-muted-foreground/80 transition-colors hover:bg-[#ff5c6c] hover:text-white'
          )}
          title={t('windowClose')}
          onClick={() => window.api.closeWindow()}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {/* 科技流动光带 */}
      <div className="tech-line absolute inset-x-0 bottom-0" />
    </div>
  );
}
