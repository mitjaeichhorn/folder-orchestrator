import { TriangleAlert } from 'lucide-react'
import type { Alert } from './alerts'
import { alertTitle } from './alert-text'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The mark a row carries when a proposition concerns its file.
 *
 * Replaced a full-width band under the row. The band explained itself, which
 * was the problem: four of them in a feed is four paragraphs, and the reader is
 * scanning rows. The list of propositions is its own view now, so a row only has
 * to say "there is something about this file" and be clickable.
 */
export function AlertDot ({ alerts, onOpen, className }: {
  alerts: Alert[]
  onOpen: (a: Alert) => void
  className?: string
}) {
  if (!alerts.length) return null
  const first = alerts[0]
  return (
    <button
      onClick={e => { e.stopPropagation(); onOpen(first) }}
      title={alerts.map(a => alertTitle(t, a)).join('\n')}
      aria-label={alertTitle(t, first)}
      className={cn('shrink-0 rounded-sm text-amber-500 hover:text-amber-300', className)}>
      <span className="flex items-center gap-0.5">
        <TriangleAlert className="size-3.5" />
        {alerts.length > 1 && (
          <span className="font-mono text-[10px] tabular-nums">{alerts.length}</span>
        )}
      </span>
    </button>
  )
}
