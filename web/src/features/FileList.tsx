import { useMemo } from 'react'
import { FolderTree } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { groupByFile } from './group-by-file'
import { filesByLastChange, maxChanges, churnShare, churnColor } from './churn'
import { FilePath } from './FilePath'
import { Thumb } from './Thumb'
import type { OrchEvent } from '@/lib/api'
import { t, fmtTime, fmtAgo } from '@/i18n'
import { cn } from '@/lib/utils'
import { isImagePath } from '@shared/glob.js'

/**
 * Every file that changed, most recent first, shaded by how often it changed.
 *
 * Deliberately a different question from the heat tree: that one shades by
 * recency ("what is being worked on"), this one by churn ("what keeps being
 * reworked"). Different hues so the two are never read as the same signal.
 */
export function FileList ({ events, folderId, onSelect, onLocate, locatable, onZoom }: {
  events: OrchEvent[]
  folderId: string
  onSelect: (e: OrchEvent) => void
  onLocate?: (path: string | null) => void
  locatable?: boolean
  onZoom: (path: string) => void
}) {
  const files = useMemo(() => filesByLastChange(groupByFile(events)), [events])
  const max = useMemo(() => maxChanges(files), [files])

  if (files.length === 0) {
    return <p className="text-muted-foreground p-8 text-center text-sm">{t('files.empty')}</p>
  }

  return (
    <div className="text-sm">
      <div className="text-muted-foreground flex items-center gap-3 border-b px-4 py-1.5 text-xs">
        <span>{t('files.count', { n: files.length })}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {t('files.legend')}
          <span className="inline-block h-2 w-16 rounded-full"
            style={{ background: `linear-gradient(to right, ${churnColor(0)}, ${churnColor(0.55)}, ${churnColor(1)})` }} />
        </span>
      </div>

      {files.map(f => {
        const share = churnShare(f.changes, max)
        const tone = churnColor(share)
        // newest event for this file — clicking opens it in the detail panel
        const newest = f.events[0]
        return (
          <div key={f.path}
            onClick={() => newest && onSelect(newest)}
            className="group/file hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-4 py-1.5">

            <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs tabular-nums">
              {fmtTime(f.lastTs)}
            </span>

            {/* the bar is the comparison; the number is the detail */}
            <span className="w-14 shrink-0" title={t('files.changes', { n: f.changes })}>
              <span className="bg-muted block h-1 w-full overflow-hidden rounded-full">
                <span className="block h-full rounded-full"
                  style={{ width: `${Math.max(6, share * 100)}%`, background: tone }} />
              </span>
            </span>

            <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums" style={{ color: tone }}>
              {f.changes}
            </span>

            {isImagePath(f.path) && (
              <Thumb folderId={folderId} path={f.path} onOpen={onZoom} />
            )}

            <FilePath path={f.path} className="min-w-0 flex-1 truncate text-xs" />

            {f.actors.has('claude') && (
              <Badge variant="secondary" className="shrink-0 text-violet-300">{t('actor.claude')}</Badge>
            )}
            {!f.actors.has('claude') && f.actors.has('during-claude') && (
              <Badge variant="outline" className="shrink-0 text-violet-300/70">{t('actor.during-claude')}</Badge>
            )}

            <span className="text-muted-foreground/70 w-16 shrink-0 text-right text-xs tabular-nums">
              {fmtAgo(f.lastTs)}
            </span>

            {locatable && (
              <button
                onClick={ev => ev.stopPropagation()}
                onMouseEnter={() => onLocate?.(f.path)}
                onMouseLeave={() => onLocate?.(null)}
                onFocus={() => onLocate?.(f.path)}
                onBlur={() => onLocate?.(null)}
                aria-label={t('feed.locate')}
                title={t('feed.locate')}
                className={cn('text-muted-foreground/40 hover:text-primary group-hover/file:text-muted-foreground/80',
                  'shrink-0 transition-colors')}>
                <FolderTree className="size-3.5" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
