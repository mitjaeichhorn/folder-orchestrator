import { Button } from '@/components/ui/button'
import { TriangleAlert } from 'lucide-react'
import { alertTitle, alertBody } from './alert-text'
import { heatColor } from './heat-color'
import type { Alert } from './alerts'
import { FilePath } from './FilePath'
import { t, fmtAgo } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Everything the rules currently propose, newest first.
 *
 * The outline follows the heat principle rather than a fixed border: the
 * newest proposition is white and older ones fade toward the muted floor, so
 * "what just came up" is legible without reading a timestamp. Same ramp module
 * as the tree — a new ramp here would be a second interpolation to keep in step.
 *
 * Empty is not rendered: the tab only exists while something is proposed.
 */
export function Propositions ({ alerts, onOpen, selectedKey }: {
  alerts: Alert[]
  onOpen: (a: Alert) => void
  selectedKey?: string | null
}) {
  if (!alerts.length) {
    return <p className="text-muted-foreground p-8 text-center text-sm">{t('prop.empty')}</p>
  }
  const newest = alerts[0].anchorTs
  const oldest = alerts[alerts.length - 1].anchorTs
  const span = Math.max(1, newest - oldest)

  return (
    <div className="divide-y text-sm">
      {alerts.map(a => {
        // 1 = newest, 0 = oldest in view; same scale the heat ramp expects
        const share = (a.anchorTs - oldest) / span
        return (
          <div key={a.key}
            className={cn('hover:bg-muted/40 flex items-start gap-3 px-4 py-2',
              selectedKey === a.key && 'bg-muted')}>
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium" style={{ color: heatColor(share) }}>
                {alertTitle(t, a)}
              </p>
              <FilePath path={a.path} className="mt-0.5 block text-xs break-words [overflow-wrap:anywhere]" />
              <p className="text-muted-foreground mt-1 text-xs break-words [overflow-wrap:anywhere]">
                {alertBody(t, a)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-muted-foreground/70 text-xs tabular-nums">{fmtAgo(a.anchorTs)}</span>
              <Button size="sm" variant="outline" className="h-6 text-xs"
                onClick={() => onOpen(a)}>{t('alert.showMore')}</Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
