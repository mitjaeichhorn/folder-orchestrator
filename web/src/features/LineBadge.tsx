import { Badge } from '@/components/ui/badge'
import { LINE_ALERT_AT } from '@shared/glob.js'
import { showsLineBadge } from './lines.ts'
import { t, fmtNum } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * "This file is long." One component so the four places that show it — feed,
 * By topic, By file and the detail panel — cannot drift apart.
 *
 * The count is the label because "long" is a judgement and 6,314 is a fact.
 */
export function LineBadge ({ lines, className }: {
  lines?: number
  className?: string
}) {
  if (typeof lines !== 'number' || !showsLineBadge(lines)) return null
  return (
    <Badge variant="outline"
      className={cn('text-muted-foreground shrink-0 tabular-nums', className)}
      title={t('files.longFile', { n: fmtNum(lines), at: fmtNum(LINE_ALERT_AT) })}>
      {t('files.lines', { n: fmtNum(lines) })}
    </Badge>
  )
}
