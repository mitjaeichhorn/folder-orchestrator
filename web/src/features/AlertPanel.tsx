import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { alertTitle, alertBody, alertPrompt } from './alert-text'
import type { Alert } from './alerts'
import { t, fmtNum, fmtDateTime } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The off-canvas for one alert: what it is, the evidence, the prompt to hand an
 * agent, and how to make it stop.
 *
 * The prompt is displayed as well as copyable. Handing someone a button that
 * sends text they have not read is how a tool loses trust the first time the
 * text is wrong.
 */
export function AlertPanel ({ alert, sessionNames, onSnooze, onMute, onCopy, onOpenFile, onLocate }: {
  alert: Alert
  sessionNames?: Map<string, string>
  onSnooze: (a: Alert) => void
  onMute: (a: Alert) => void
  onCopy: (text: string) => void
  onOpenFile?: (path: string) => void
  onLocate?: (path: string) => void
}) {
  const prompt = alertPrompt(t, alert)
  const e = alert.evidence

  const Row = ({ label, value }: { label: string; value?: string | null }) =>
    value ? (
      <>
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd className="min-w-0 text-xs break-words [overflow-wrap:anywhere]">{value}</dd>
      </>
    ) : null

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-4 p-4">
        <div>
          <p className="text-sm font-medium text-amber-200">{alertTitle(t, alert)}</p>
          <p className="text-muted-foreground mt-1 font-mono text-xs break-words [overflow-wrap:anywhere]">
            {alert.path}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs uppercase">{t('alert.whatThisIs')}</p>
          <p className="text-xs break-words [overflow-wrap:anywhere]">{alertBody(t, alert)}</p>
          {/* Says its own uncertainty out loud. 41 of 41 measured stretches
              resolved unaided; an alert that reads as a verdict teaches the
              operator to ignore alerts. */}
          <p className="text-muted-foreground/80 text-xs break-words [overflow-wrap:anywhere]">
            {t('alert.caveat')}
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs uppercase">{t('alert.evidence')}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <Row label={t('kind.modified')} value={e.count ? fmtNum(e.count) : null} />
            <Row label={t('alert.lines', { n: '' }).trim()} value={e.lines ? fmtNum(e.lines) : null} />
            <Row label={t('alert.sessions')}
              value={e.sessions?.map(s => sessionNames?.get(s) ?? s.slice(0, 4)).join(' · ')} />
            <Row label={t('detail.metaSessionLast')} value={fmtDateTime(alert.anchorTs)} />
          </dl>
          <div className="flex flex-wrap gap-2 pt-1">
            {onOpenFile && (
              <Button size="sm" variant="outline" className="text-xs"
                onClick={() => onOpenFile(alert.path)}>{t('alert.openFile')}</Button>
            )}
            {onLocate && (
              <Button size="sm" variant="outline" className="text-xs"
                onClick={() => onLocate(alert.path)}>{t('feed.locate')}</Button>
            )}
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-muted-foreground text-xs uppercase">{t('alert.prompt')}</p>
            <Button size="sm" variant="outline" className="ml-auto h-6 text-xs"
              onClick={() => onCopy(prompt)}>
              <Copy className="size-3" />{t('alert.copyPrompt')}
            </Button>
          </div>
          <pre className="bg-muted/40 rounded-md border p-2 text-xs break-words whitespace-pre-wrap">
            {prompt}
          </pre>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs uppercase">{t('alert.dismiss')}</p>
          <div className="space-y-1.5">
            <Button size="sm" variant="outline" className={cn('w-full justify-start text-xs')}
              onClick={() => onSnooze(alert)}>{t('alert.snooze')}</Button>
            <p className="text-muted-foreground/70 text-xs">{t('alert.snoozeHint')}</p>
            <Button size="sm" variant="ghost" className="w-full justify-start text-xs"
              onClick={() => onMute(alert)}>{t('alert.mute')}</Button>
            <p className="text-muted-foreground/70 text-xs">{t('alert.muteHint')}</p>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
