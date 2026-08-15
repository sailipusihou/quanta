import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { Profile } from '@/lib/types';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

// 头像底色：按名字 hash 取渐变
const AVATAR_GRADIENTS = [
  'from-[#2dd4bf] to-[#0ea5a4]',
  'from-[#a78bfa] to-[#7c3aed]',
  'from-[#fbbf24] to-[#f59e0b]',
  'from-[#f472b6] to-[#ec4899]',
  'from-[#60a5fa] to-[#3b82f6]',
  'from-[#34d399] to-[#10b981]',
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function AvatarCircle({
  profile,
  size = 'md',
  className,
}: {
  profile: Profile;
  size?: 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const cls =
    size === 'xl'
      ? 'size-28 text-3xl'
      : size === 'lg'
        ? 'size-20 text-2xl'
        : 'size-14 text-base';
  if (profile.avatarUrl) {
    return (
      <img
        src={profile.avatarUrl}
        alt={profile.name}
        className={cn('shrink-0 rounded-full object-cover ring-1 ring-white/20', cls, className)}
        draggable={false}
      />
    );
  }
  const g = AVATAR_GRADIENTS[hashName(profile.name || '?') % AVATAR_GRADIENTS.length];
  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br font-bold text-white/95',
        g,
        cls,
        className
      )}
    >
      {(profile.name || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

interface Props {
  profiles: Profile[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onOpenDetail: (profile: Profile) => void;
  onAdd: () => void;
  disabled?: boolean;
}

export function ProfileSwitcher({ profiles, activeId, onSwitch, onOpenDetail, onAdd, disabled }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  const scroll = (dir: 1 | -1) => {
    scroller.current?.scrollBy({ left: dir * 170, behavior: 'smooth' });
  };

  if (!profiles.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-2 text-xs text-muted-foreground/70">
        {t('noProfile')}
      </div>
    );
  }

  return (
    <div className="group/sw flex items-center gap-1">
      <button
        className="widget-no-drag hidden size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:bg-white/[0.12] hover:text-foreground group-hover/sw:flex"
        onClick={() => scroll(-1)}
        title="←"
      >
        <ChevronLeft className="size-4" />
      </button>

      <div
        ref={scroller}
        className="no-scrollbar flex max-w-[420px] items-center gap-2 overflow-x-auto scroll-smooth px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {profiles.map((p) => {
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              onClick={() => {
                if (disabled) return;
                if (active) onOpenDetail(p);
                else onSwitch(p.id);
              }}
              className={cn(
                'flex shrink-0 snap-center flex-col items-center gap-1 rounded-xl px-1.5 py-1 transition-all duration-200',
                active ? 'avatar-pop scale-105' : 'opacity-55 hover:opacity-90'
              )}
              title={`${p.name} · ${p.model || t('unbound')}${active ? ' — ' + t('activeProfile') : ''}`}
            >
              <span
                className={cn(
                  'rounded-full p-[2px] transition-all',
                  active ? 'bg-gradient-to-br from-[#2dd4bf] to-[#a78bfa] shadow-lg shadow-[#2dd4bf]/30' : ''
                )}
              >
                <AvatarCircle profile={p} />
              </span>
              <span className={cn('max-w-16 truncate text-[10px]', active ? 'font-semibold text-[#7ff0e2]' : 'text-muted-foreground')}>
                {p.name}
              </span>
            </button>
          );
        })}

        {/* 快捷注册新用户 */}
        <button
          onClick={() => !disabled && onAdd()}
          className="flex shrink-0 snap-center flex-col items-center gap-1 rounded-xl px-1.5 py-1 opacity-55 transition-all hover:opacity-100"
          title={t('addProfile')}
        >
          <span className="flex size-14 items-center justify-center rounded-full border-2 border-dashed border-white/20 text-muted-foreground transition-colors hover:border-[#2dd4bf]/60 hover:text-[#2dd4bf]">
            <Plus className="size-5" />
          </span>
          <span className="max-w-16 truncate text-[10px] text-muted-foreground">{t('addProfile')}</span>
        </button>
      </div>

      <button
        className="widget-no-drag hidden size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:bg-white/[0.12] hover:text-foreground group-hover/sw:flex"
        onClick={() => scroll(1)}
        title="→"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
