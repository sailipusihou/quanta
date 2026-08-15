// 格式化工具 —— 从旧 src/renderer/shared.js 原样迁移

export function fmtMoney(v: number | null | undefined): string {
  const n = Number(v) || 0;
  if (n === 0) return '¥0';
  return '¥' + Number(n.toFixed(6)).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
}

export function fmtTokens(n: number | null | undefined): string {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export function fmtShortDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtHour(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

export function periodLabel(period: string): string {
  if (period === 'peak') return '高峰计费';
  if (period === 'offpeak') return '空闲时段计费';
  return '平价计费';
}

// 悬浮窗全局拖动：main 进程持久化位置
export function enableWidgetDrag(root: HTMLElement) {
  let dragging = false;
  let moved = false;
  const onDown = () => {
    dragging = true;
    moved = false;
  };
  const onMove = () => {
    if (dragging) moved = true;
  };
  const onUp = () => {
    if (dragging && moved) {
      // 窗口位置由 main 进程 'moved' 事件持久化，无需额外处理
    }
    dragging = false;
  };
  root.addEventListener('mousedown', onDown);
  root.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return () => {
    root.removeEventListener('mousedown', onDown);
    root.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
}
