import { useEffect, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { fmtMoney } from '@/lib/format';
import type { AppSnapshot } from '@/lib/types';
import { CloudDownload, History, RefreshCw, Scale } from 'lucide-react';

interface PriceRow {
  platform: string;
  model: string;
  inRate: number;
  outRate: number;
  cost: number;
}

interface CompareResult {
  source: string;
  fetchedAt: number;
  rows: PriceRow[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AppSnapshot;
}

const PLATFORM_COLORS: Record<string, string> = {
  DeepSeek: '#4d6bfe',
  月之暗面: '#1e1e2f',
  智谱: '#3859ff',
  OpenAI: '#10a37f',
  Anthropic: '#d97757',
  Gemini: '#4285f4',
  Groq: '#f55036',
  OpenRouter: '#7c3aed',
};

// 跨平台比价：token 量按官网实时价格估算各模型费用（可刷新）
export function CompareDialog({ open, onOpenChange, state }: Props) {
  const [prompt, setPrompt] = useState('1000');
  const [completion, setCompletion] = useState('500');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingForce, setLoadingForce] = useState(false);

  useEffect(() => {
    if (open) {
      setResult(null);
      run(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = async (force: boolean) => {
    const p = Number(prompt) || 0;
    const c = Number(completion) || 0;
    if (p <= 0 && c <= 0) return;
    force ? setLoadingForce(true) : setLoading(true);
    try {
      const r = await window.api.priceCompare(p, c, force);
      setResult(r);
    } finally {
      setLoading(false);
      setLoadingForce(false);
    }
  };

  const fromLast = () => {
    const last = state.recent[0];
    if (!last) return;
    setPrompt(String(last.usage.promptTokens));
    setCompletion(String(last.usage.completionTokens));
  };

  const rows = result ? result.rows : [];
  const cheapest = rows.length ? rows[0] : null;
  const currentCost =
    rows.length && state.currentModel ? rows.find((r) => r.model === state.currentModel)?.cost : null;
  const isLive = result && result.source !== 'fallback';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4 text-[#2dd4bf]" />
            {t('compareTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">{t('compareNote')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">{t('comparePrompt')}</Label>
            <Input
              type="number"
              min="0"
              className="h-9 w-28 font-mono text-xs"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">{t('compareCompletion')}</Label>
            <Input
              type="number"
              min="0"
              className="h-9 w-28 font-mono text-xs"
              value={completion}
              onChange={(e) => setCompletion(e.target.value)}
            />
          </div>
          <Button size="sm" className="h-9" onClick={() => run(false)} disabled={loading || loadingForce}>
            {loading ? '…' : t('compareBtn')}
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" title={t('compareFromLast')} onClick={fromLast}>
            <History className="size-4" />
          </Button>
        </div>

        {/* 来源与刷新 */}
        <div className="flex items-center justify-between">
          <span
            className={cn(
              'flex items-center gap-1 text-[10px]',
              isLive ? 'text-[#2fd189]' : 'text-amber-400/80'
            )}
          >
            <CloudDownload className="size-3" />
            {isLive
              ? `${t('compareLive')} · ${t('compareUpdated')} ${new Date(result!.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
              : t('compareOffline')}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => run(true)}
            disabled={loading || loadingForce}
          >
            <RefreshCw className={cn('mr-1 size-3', loadingForce && 'animate-spin')} />
            {t('compareRefresh')}
          </Button>
        </div>

        {rows.length > 0 && (
          <div className="max-h-[280px] space-y-1 overflow-y-auto">
            {rows.map((r, i) => {
              const isMin = i === 0;
              const isCurrent = state.currentModel === r.model;
              return (
                <div
                  key={r.platform + r.model}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
                    isMin
                      ? 'border-[#2dd4bf]/40 bg-[#2dd4bf]/[0.08]'
                      : 'border-white/10 bg-white/[0.02]',
                    isCurrent && !isMin && 'border-[#a78bfa]/40 bg-[#a78bfa]/[0.06]'
                  )}
                >
                  <span
                    className="inline-flex size-2.5 shrink-0 rounded-full"
                    style={{ background: PLATFORM_COLORS[r.platform] || '#8b90a0' }}
                  />
                  <span className="w-14 shrink-0 truncate text-[10px] text-muted-foreground">{r.platform}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{r.model}</span>
                  <span className="tnum shrink-0 text-[10px] text-muted-foreground/60">
                    ¥{r.inRate.toFixed(2)}/{r.outRate.toFixed(2)}M
                  </span>
                  <span className={cn('tnum w-20 shrink-0 text-right text-xs font-semibold', isMin && 'text-[#2fd189]')}>
                    {fmtMoney(r.cost)}
                  </span>
                  {isMin && (
                    <span className="shrink-0 rounded-full bg-[#2fd189]/15 px-1.5 py-0.5 text-[9px] font-medium text-[#2fd189]">
                      {t('compareMin')}
                    </span>
                  )}
                  {isCurrent && !isMin && (
                    <span className="shrink-0 rounded-full bg-[#a78bfa]/15 px-1.5 py-0.5 text-[9px] text-[#c4b5fd]">
                      {t('currentModel')}
                    </span>
                  )}
                </div>
              );
            })}
            {cheapest && currentCost != null && currentCost > cheapest.cost && (
              <div className="mt-2 rounded-lg bg-[#2fd189]/10 px-2.5 py-1.5 text-[11px] text-[#2fd189]">
                💡 {t('compareSave')} ≈{' '}
                {fmtMoney(currentCost - cheapest.cost)}（{Math.round((1 - cheapest.cost / currentCost) * 100)}%）
              </div>
            )}
          </div>
        )}
        {!rows.length && !loading && (
          <div className="py-6 text-center text-xs text-muted-foreground">{t('syncModelsEmpty')}</div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
