import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

// 星光科技感动效：闪烁星星 + 漂浮微光粒子 + 偶发流星
// canvas 固定层，不拦截鼠标事件
export function Starfield({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    interface Star { x: number; y: number; r: number; speed: number; phase: number }
    interface Particle { x: number; y: number; vx: number; vy: number; r: number; hue: number; alpha: number }
    interface Meteor { x: number; y: number; vx: number; vy: number; life: number }

    let stars: Star[] = [];
    let particles: Particle[] = [];
    let meteors: Meteor[] = [];
    let nextMeteor = 0;

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * DPR);
      canvas.height = Math.floor(h * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };

    const init = () => {
      const starCount = Math.min(Math.floor((w * h) / 7000), 220);
      stars = [];
      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.1 + 0.3,
          speed: Math.random() * 0.9 + 0.3,
          phase: Math.random() * Math.PI * 2,
        });
      }
      const pCount = Math.min(Math.floor((w * h) / 70000), 16);
      particles = [];
      for (let i = 0; i < pCount; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.14,
          vy: (Math.random() - 0.5) * 0.14,
          r: Math.random() * 1.6 + 0.8,
          hue: Math.random() < 0.55 ? 174 : 258, // 青 / 紫
          alpha: Math.random() * 0.35 + 0.15,
        });
      }
      meteors = [];
      nextMeteor = performance.now() + 3500 + Math.random() * 5000;
    };

    const spawnMeteor = () => {
      const fromLeft = Math.random() < 0.6;
      meteors.push({
        x: fromLeft ? -60 : Math.random() * w * 0.7,
        y: Math.random() * h * 0.35,
        vx: 5 + Math.random() * 4,
        vy: 1.6 + Math.random() * 1.6,
        life: 1,
      });
    };

    const tick = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      // 星星（呼吸闪烁）
      for (const s of stars) {
        const a = 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.0012 * s.speed + s.phase));
        ctx.globalAlpha = Math.max(a, 0.05);
        ctx.fillStyle = '#eaf6ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 漂浮微光粒子（青/紫光晕，缓慢漂移）
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -12) p.x = w + 12;
        if (p.x > w + 12) p.x = -12;
        if (p.y < -12) p.y = h + 12;
        if (p.y > h + 12) p.y = -12;
        const c = p.hue < 200 ? '45,212,191' : '167,139,250';
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 7);
        glow.addColorStop(0, `rgba(${c},${p.alpha})`);
        glow.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 7, 0, Math.PI * 2);
        ctx.fill();
      }

      // 流星（偶发划过）
      if (t > nextMeteor) {
        spawnMeteor();
        nextMeteor = t + 4500 + Math.random() * 8000;
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.x += m.vx;
        m.y += m.vy;
        m.life -= 0.007;
        if (m.life <= 0 || m.x > w + 120 || m.y > h + 120) {
          meteors.splice(i, 1);
          continue;
        }
        const tail = 16;
        const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail);
        grad.addColorStop(0, `rgba(200,240,255,${0.75 * m.life})`);
        grad.addColorStop(1, 'rgba(200,240,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - m.vx * tail, m.y - m.vy * tail);
        ctx.stroke();
        // 流星头亮点
        ctx.fillStyle = `rgba(235,250,255,${0.9 * m.life})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };

    resize();
    init();
    raf = requestAnimationFrame(tick);
    const onResize = () => {
      resize();
      init();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} className={cn('pointer-events-none fixed inset-0 z-0 h-full w-full', className)} />;
}
