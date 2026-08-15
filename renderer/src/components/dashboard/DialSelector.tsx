import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { AppSnapshot } from '@/lib/types';
import { CUSTOM_PRESET, PLATFORM_PRESETS, presetForAccount } from '@/lib/platforms';
import { Plus, Settings2 } from 'lucide-react';
import { AvatarCircle } from './ProfileSwitcher';

// 平台官网最新 logo（官方矢量 SVG / 官方彩色 PNG，Vite 打包）
import deepseekLogo from '@/assets/platforms/deepseek.svg';
import anthropicLogo from '@/assets/platforms/anthropic.svg';
import groqLogo from '@/assets/platforms/groq.svg';
import moonshotLogo from '@/assets/platforms/moonshot.png';
import openrouterLogo from '@/assets/platforms/openrouter.png';
import openaiLogo from '@/assets/platforms/openai.svg';
import geminiLogo from '@/assets/platforms/gemini.svg';
import siliconflowLogo from '@/assets/platforms/siliconflow.png';
import zhipuLogo from '@/assets/platforms/zhipu.png';

const PLATFORM_LOGOS: Record<string, string> = {
  deepseek: deepseekLogo,
  anthropic: anthropicLogo,
  groq: groqLogo,
  moonshot: moonshotLogo,
  openrouter: openrouterLogo,
  openai: openaiLogo,
  gemini: geminiLogo,
  siliconflow: siliconflowLogo,
  zhipu: zhipuLogo,
};

interface Slot {
  key: string;
  accountId: string;
  platformName: string;
  model: string;
  badgeColor: string;
  badgeChar: string;
  logoStyle: 'square' | 'wide';
  configured: boolean;
  logo?: string;
}

interface Props {
  state: AppSnapshot;
  onSwitch: (accountId: string, model: string) => void;
  onOpenDetail: () => void;
  onOpenSettings: () => void;
  onAdd: () => void;
}

const RADIUS = 150; // 档位环半径（px）
const DIAL = 420; // 表盘容器尺寸
const TICK_LOCK_MS = 60; // 秒针停顿时长

function norm360(v: number) {
  return ((v % 360) + 360) % 360;
}

function angleDiff(from: number, to: number) {
  return norm360(to - from + 180) - 180;
}

// 模型短名（deepseek-ai/DeepSeek-V3.2 -> DeepSeek-V3.2）
function shortModel(m: string) {
  if (!m) return '';
  const parts = m.split('/');
  return parts[parts.length - 1];
}

// 秒针滴答声（Web Audio 短促高频）
let audioCtx: AudioContext | null = null;
function tickSound() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 2300;
    gain.gain.setValueAtTime(0.045, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.032);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  } catch {
    /* 音频不可用则静默 */
  }
}

// 中央模型转盘：头像固定不动，模型档位环整体旋转，
// 模型转到顶部指针位置即锁定切换对应展示与数据
export function DialSelector({ state, onSwitch, onOpenDetail, onOpenSettings, onAdd }: Props) {
  const accounts = state.config.accounts;
  const selectedAccountId = state.config.selectedAccountId;
  const selectedModel = state.config.selectedModel || '';

  // 档位 = 每个平台一个档位（取账户配置的第一个模型或平台默认模型）
  const customAccounts = accounts.filter((a) => !PLATFORM_PRESETS.some((p) => presetForAccount(a)?.id === p.id));
  const slots: Slot[] = [
    ...PLATFORM_PRESETS.map((p) => {
      const acc = accounts.find((a) => a.id === p.id) || accounts.find((a) => presetForAccount(a)?.id === p.id);
      const configured = !!acc && (acc.apiKeys?.length > 0 || !!acc.apiKey);
      const model = acc && acc.models?.length ? acc.models[0] : p.models[0] || '';
      return {
        key: acc ? acc.id : p.id,
        accountId: acc ? acc.id : p.id,
        platformName: p.name,
        model,
        badgeColor: p.badgeColor,
        badgeChar: p.badgeChar || p.name.slice(0, 1),
        logoStyle: (p.logoStyle || 'square') as 'square' | 'wide',
        configured,
        logo: PLATFORM_LOGOS[p.id],
      };
    }),
    ...customAccounts.map((a) => ({
      key: a.id,
      accountId: a.id,
      platformName: a.name,
      model: a.models?.length ? a.models[0] : '',
      badgeColor: '#8b90a0',
      badgeChar: a.name.slice(0, 1),
      logoStyle: 'square' as const,
      configured: !!(a.apiKeys?.length || a.apiKey),
    })),
  ];
  const n = slots.length;
  const STEP = n ? 360 / n : 360;

  // 当前选中档位（指针下）：按账户 + 模型匹配
  const currentIdx = Math.max(
    slots.findIndex((s) => s.accountId === selectedAccountId && (!selectedModel || s.model === selectedModel)),
    slots.findIndex((s) => s.accountId === selectedAccountId),
    0
  );

  // rotation = 档位环的旋转角；指针固定在顶部（-90°），
  // 选中档位 = 绝对角度最接近指针的档位
  const [ringRot, setRingRot] = useState(-currentIdx * STEP);
  const [dragging, setDragging] = useState(false);
  const [pulseSlot, setPulseSlot] = useState<number | null>(null);
  const ringRotRef = useRef(-currentIdx * STEP);
  const draggingRef = useRef(false);
  const dragRef = useRef<{ startAngle: number; startRot: number; moved: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const lockUntilRef = useRef(0);
  const lastSlotRef = useRef(currentIdx);
  const wheelTimerRef = useRef(0);
  const pulseTimerRef = useRef(0);

  const setRing = (v: number) => {
    ringRotRef.current = v;
    setRingRot(v);
  };

  // 最新值 ref（供原生 wheel 监听使用）
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

  // 指针下档位（实时）
  const activeIdx = n ? Math.round(norm360(-ringRotRef.current) / STEP) % n : 0;
  const activeSlot = slots[activeIdx] || slots[0] || null;
  const activeProfile = state.profiles.list.find((p) => p.id === state.profiles.activeId) || state.profiles.list[0] || null;

  // 跨格反馈
  const tickFeedback = (slot: number) => {
    setPulseSlot(slot);
    clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulseSlot(null), 320);
    tickSound();
  };

  // 锁定模型：环转到指针下并切换展示
  const lockTo = (idx: number) => {
    lastSlotRef.current = idx;
    animateTo(-idx * STEP);
    const s = slots[idx];
    const cur = slots[currentIdxRef.current];
    if (s && cur && (s.accountId !== cur.accountId || s.model !== cur.model)) {
      onSwitchRef.current(s.accountId, s.model);
    }
  };

  // 滚轮旋转（原生 passive:false，阻止页面滚动）
  const C = DIAL / 2;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !n) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const next = (Math.round(norm360(-ringRotRef.current) / STEP) + dir + n) % n;
      if (next === lastSlotRef.current) return;
      lastSlotRef.current = next;
      tickFeedback(next);
      animateTo(-next * STEP);
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(() => {
        const s = slotsRef.current[next];
        const cur = slotsRef.current[currentIdxRef.current];
        if (s && cur && (s.accountId !== cur.accountId || s.model !== cur.model)) {
          onSwitchRef.current(s.accountId, s.model);
        }
      }, 260);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, STEP]);

  // 外部切换（Header/右卡/设置）→ 环旋转对齐
  useEffect(() => {
    if (draggingRef.current) return;
    if (currentIdx >= 0) {
      lastSlotRef.current = currentIdx;
      const target = -currentIdx * STEP;
      if (Math.abs(angleDiff(ringRotRef.current, target)) > 0.5) animateTo(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, n]);

  const animateTo = (target: number) => {
    cancelAnimationFrame(rafRef.current);
    const start = ringRotRef.current;
    const d = angleDiff(start, target);
    const t0 = performance.now();
    const dur = 280;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const step = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      setRing(start + d * ease(p));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const angleOf = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!n) return;
    dragRef.current = { startAngle: angleOf(e), startRot: ringRotRef.current, moved: false };
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (performance.now() < lockUntilRef.current) return;
    let delta = angleOf(e) - d.startAngle;
    delta = norm360(delta + 180) - 180;
    if (Math.abs(delta) > 0.5) d.moved = true;
    const raw = d.startRot + delta;
    const slot = Math.round(norm360(-raw) / STEP) % n;
    if (slot !== lastSlotRef.current) {
      lastSlotRef.current = slot;
      lockUntilRef.current = performance.now() + TICK_LOCK_MS;
      tickFeedback(slot);
    }
    setRing(raw);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    const idx = Math.round(norm360(-ringRotRef.current) / STEP) % n;
    animateTo(-idx * STEP);
    if (!d.moved) {
      onOpenDetail();
      return;
    }
    lockTo(idx);
  };

  return (
    <div className="relative flex flex-col items-center">
      <div
        ref={containerRef}
        className="relative size-[420px] select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* 外环刻度轨道 */}
        <div className="absolute left-1/2 top-1/2 size-[348px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/12" />
        <div className="absolute left-1/2 top-1/2 size-[386px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]" />

        {/* 顶部固定指针（锁定标记） */}
        <div className="absolute left-1/2 top-[-4px] z-10 -translate-x-1/2">
          <div className="mx-auto size-0 border-x-[7px] border-t-[10px] border-x-transparent border-t-[#2dd4bf] drop-shadow-[0_0_8px_rgba(45,212,191,1)]" />
          <div className="mx-auto h-4 w-px bg-gradient-to-b from-[#2dd4bf] via-[#2dd4bf]/60 to-transparent" />
        </div>

        {/* 装饰光点 */}
        <span className="pointer-events-none absolute left-1/2 top-[22%] size-1 -translate-x-1/2 rounded-full bg-[#2dd4bf]/90 shadow-[0_0_8px_rgba(45,212,191,1)]" />
        <span className="pointer-events-none absolute right-[24%] top-[30%] size-1 rounded-full bg-[#a78bfa]/90 shadow-[0_0_8px_rgba(167,139,250,1)]" />
        <span className="pointer-events-none absolute bottom-[24%] left-[19%] size-0.5 rounded-full bg-white/70 shadow-[0_0_5px_rgba(255,255,255,0.8)]" />

        {/* 模型档位环（整体随 ringRot 旋转，顶部指针下 = 锁定选中） */}
        {slots.map((s, i) => {
          const a = ((-90 + i * STEP + ringRot) * Math.PI) / 180;
          const x = C + RADIUS * Math.cos(a);
          const y = C + RADIUS * Math.sin(a);
          const active = i === activeIdx;
          const pulsing = i === pulseSlot;
          return (
            <div
              key={s.key}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                tickFeedback(i);
                lockTo(i);
              }}
              className={cn(
                'absolute flex cursor-pointer flex-col items-center transition-all duration-150',
                active ? 'z-10 scale-110' : 'scale-100',
                pulsing && 'slot-pulse'
              )}
              style={{ left: x, top: y, transform: 'translate(-50%,-50%)' }}
            >
              {/* 完整 logo：横版文字标完整 contain，方形标满格 cover，高度统一 */}
              {s.logo ? (
                <img
                  src={s.logo}
                  alt={s.platformName}
                  draggable={false}
                  className={cn(
                    s.logoStyle === 'wide'
                      ? 'h-12 w-[76px] object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]'
                      : 'size-12 rounded-xl object-cover ring-1 ring-white/15',
                    'transition-all duration-150',
                    active
                      ? 'drop-shadow-[0_0_12px_rgba(45,212,191,0.8)]'
                      : 'opacity-90 hover:opacity-100',
                    !s.configured && 'opacity-40 saturate-[0.4]'
                  )}
                />
              ) : (
                <span
                  className={cn(
                    'flex size-12 select-none items-center justify-center rounded-2xl text-lg font-bold transition-all duration-150',
                    active ? 'text-white drop-shadow-[0_0_10px_rgba(45,212,191,0.9)]' : 'opacity-80'
                  )}
                  style={{ background: s.badgeColor }}
                >
                  {s.badgeChar}
                </span>
              )}
              {/* 模型名 */}
              <span
                className={cn(
                  'pointer-events-none mt-1 max-w-[84px] truncate rounded-md px-1 text-center font-mono leading-tight',
                  active
                    ? 'bg-[#2dd4bf]/15 text-[10px] font-bold text-[#8df4e6]'
                    : 'text-[9px] text-muted-foreground/75'
                )}
                title={`${s.platformName} · ${s.model || ''}`}
              >
                {shortModel(s.model) || s.platformName}
              </span>
              {!s.configured && (
                <span className="pointer-events-none mt-0.5 text-[8px] text-amber-400/70">未配置</span>
              )}
            </div>
          );
        })}

        {/* 中心头像（固定不转，身份展示） */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className={cn(
              'relative flex size-[164px] items-center justify-center rounded-full transition-shadow',
              dragging ? 'shadow-[0_0_60px_rgba(45,212,191,0.4)]' : 'shadow-[0_0_42px_rgba(45,212,191,0.2)]'
            )}
          >
            <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,rgba(45,212,191,0.28),rgba(167,139,250,0.22),rgba(45,212,191,0.1),rgba(167,139,250,0.28))] blur-[2px]" />
            <div className="absolute inset-[4px] rounded-full border border-white/15 bg-[#050508]/92 backdrop-blur-xl" />
            {activeProfile ? (
              <div key={activeProfile.id} className="avatar-pop relative z-10">
                <AvatarCircle profile={activeProfile} size="xl" />
              </div>
            ) : (
              <div className="avatar-pop relative z-10 flex size-28 items-center justify-center rounded-full bg-gradient-to-br from-[#2dd4bf] to-[#a78bfa] text-3xl font-bold text-white">
                ?
              </div>
            )}
            {dragging && (
              <div className="absolute -bottom-1.5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#2dd4bf]/20 px-2.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-[#8df4e6] backdrop-blur">
                {activeSlot ? `${activeSlot.platformName} · ${shortModel(activeSlot.model)}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* 添加档案 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          className="absolute bottom-0 left-1/2 z-20 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-dashed border-white/20 bg-[#0a0a0e]/80 text-muted-foreground transition-all hover:border-[#2dd4bf]/60 hover:text-[#2dd4bf]"
          title={t('addProfile')}
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* 当前锁定信息 */}
      <div className="mt-1 flex flex-col items-center gap-1">
        <div className="flex items-center gap-2 text-base font-bold">
          <span className="inline-flex size-3 rounded-full" style={{ background: activeSlot?.badgeColor || '#8b90a0' }} />
          {activeSlot?.platformName || t('unbound')}
          {activeSlot?.model && (
            <span className="font-mono text-sm text-[#8df4e6]">· {shortModel(activeSlot.model)}</span>
          )}
          {activeProfile && <span className="text-xs font-normal text-muted-foreground">· {activeProfile.name}</span>}
        </div>
        {activeSlot?.configured ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono text-[#8df4e6]">{activeSlot.model || '—'}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[#2fd189]">{t('platformConfigured')}</span>
          </div>
        ) : (
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/20"
          >
            <Settings2 className="size-3.5" />
            {t('platformNotConfigured')}
          </button>
        )}
        <div className="mt-0.5 text-[10px] text-muted-foreground/50">
          {t('dialHint')} · {t('dialWheelHint')}
        </div>
      </div>
    </div>
  );
}
