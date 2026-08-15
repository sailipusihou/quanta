import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { fmtMoney, fmtTime, fmtTokens } from '@/lib/format';
import type { RequestEntry, TagStat } from '@/lib/types';
import { History } from 'lucide-react';

interface Props {
  recent: RequestEntry[];
  byTag: TagStat[];
  tagFilter: string;
  onTagFilter: (tag: string) => void;
}

export function RecentTable({ recent, byTag, tagFilter, onTagFilter }: Props) {
  const rows = recent.filter((r) => tagFilter === 'all' || (r.tag || 'default') === tagFilter);
  const tags = ['all', ...byTag.map((x) => x.tag)];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="size-4 text-[#c084fc]" />
          {t('recent')}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => onTagFilter(tag)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                tag === tagFilter
                  ? 'border-[#6d8dff]/60 bg-[#6d8dff]/15 text-[#9db4ff]'
                  : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
              )}
            >
              {tag === 'all' ? t('allTags') : tag}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[380px] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="text-xs">{t('time')}</TableHead>
                <TableHead className="text-xs">{t('tag')}</TableHead>
                <TableHead className="text-xs">{t('model')}</TableHead>
                <TableHead className="text-xs">{t('keyCol')}</TableHead>
                <TableHead className="text-xs">{t('statusH')}</TableHead>
                <TableHead className="text-right text-xs">{t('prompt')}</TableHead>
                <TableHead className="text-right text-xs">{t('completion')}</TableHead>
                <TableHead className="text-right text-xs">{t('cacheHitH')}</TableHead>
                <TableHead className="text-right text-xs">{t('cacheMiss')}</TableHead>
                <TableHead className="text-right text-xs">{t('costH')}</TableHead>
                <TableHead className="text-right text-xs">{t('latency')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-xs text-muted-foreground">
                    {t('noRequests')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell className="tnum whitespace-nowrap text-muted-foreground">{fmtTime(r.ts)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                        {r.tag || 'default'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate font-mono text-[11px]">
                      {r.model || t('unknown')}
                      {r.routed && (
                        <span className="ml-1 cursor-help text-[9px] text-[#2dd4bf]" title={t('routedMark')}>
                          ⇄
                        </span>
                      )}
                      {r.failover && (
                        <span className="ml-1 cursor-help text-[9px] text-amber-400" title={t('failoverMark')}>
                          ⤵
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.keyId ? (
                        <Badge variant="outline" className="border-[#2dd4bf]/30 bg-[#2dd4bf]/5 text-[10px] font-normal text-[#7ff0e2]">
                          {r.keyId}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'tnum font-medium',
                          r.status >= 400 ? 'text-[#ff5c6c]' : 'text-[#2fd189]'
                        )}
                      >
                        {r.status}
                        {r.stream && <span className="ml-0.5 text-muted-foreground">⧉</span>}
                      </span>
                    </TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">{fmtTokens(r.usage.promptTokens)}</TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">{fmtTokens(r.usage.completionTokens)}</TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">{fmtTokens(r.usage.cacheHit)}</TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">{fmtTokens(r.usage.cacheMiss)}</TableCell>
                    <TableCell className="tnum text-right font-medium">{fmtMoney(r.cost)}</TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">{r.ms}ms</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
