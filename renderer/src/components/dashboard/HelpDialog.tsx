import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { BookOpen } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpDialog({ open, onOpenChange }: Props) {
  const steps = [t('help1'), t('help2'), t('help3'), t('help4')];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-[#6d8dff]" />
            {t('helpTitle')}
          </DialogTitle>
        </DialogHeader>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#6d8dff]/15 text-[11px] font-bold text-[#9db4ff]">
                {i + 1}
              </span>
              <span className="text-muted-foreground">{s}</span>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t('gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
