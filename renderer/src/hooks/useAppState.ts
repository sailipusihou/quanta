import { useCallback, useEffect, useState } from 'react';
import type { AppSnapshot } from '@/lib/types';

// 单一数据源：订阅 main 进程推送的 snapshot + 主动拉取
export function useAppState() {
  const [state, setState] = useState<AppSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    window.api.onState((s) => {
      if (alive) setState(s);
    });
    window.api.getState().then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refreshBalance = useCallback(async () => {
    const s = await window.api.refreshBalance();
    setState(s);
    return s;
  }, []);

  const reload = useCallback(async () => {
    const s = await window.api.getState();
    setState(s);
    return s;
  }, []);

  return { state, setState, refreshBalance, reload };
}
