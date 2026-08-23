import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderTree } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { groupByFile } from './group-by-file'
import { allFilesByLastChange, maxChanges, churnShare, churnColor, churnCss, changedPaths, deletedPaths } from './churn'
import { FilePath } from './FilePath'
import { Thumb } from './Thumb'
import { LineBadge } from './LineBadge'
import { inDefaultLongFilter } from './lines'
import type { OrchEvent } from '@/lib/api'
import { t, fmtTime, fmtAgo, fmtNum } from '@/i18n'
import { cn } from '@/lib/utils'
import { isImagePath, LINE_ALERT_AT, isExecutablePath } from '@shared/glob.js'

/** A page at a time: thousands of rows would stall the tab, and the tail is
    rarely read. "Show more" extends rather than truncating. */
const PAGE = 100

type FileRowLike = { path: string; lines?: number }

/**
 * Every file in the project, most recently changed first, shaded by how often we
 * saw it change.
 *
 * Ranking uses the filesystem's own mtime, so a file that changed before watching
 * started still appears in its right place — the list is the project, not just
 * what this tool happened to witness. The change count is only ever what we
 * actually observed, which is why a file can rank high with a count of zero.
 *
 * Deliberately a different question from the heat tree: that shades by recency,
 * this by churn, in a different hue family so the two are never confused.
 */
export function FileList ({ events, folderId, onSelect, onLocate, locatable, onZoom, tree, error }: {
  events: OrchEvent[]
  folderId: string
  onSelect: (e: OrchEvent) => void
  onLocate?: (path: string | null) => void
  locatable?: boolean
  onZoom: (path: string) => void
  /** Fetched once in Workspace and shared — four surfaces want line counts. */
  tree: Array<{ p: string; m?: number; l?: number }> | null
  error: boolean
}) {

  const rows = useMemo(
    () => (tree ? allFilesByLastChange(tree, groupByFile(events)) : []),
    [tree, events]
  )
  // Long files sort by size, not recency: the point of the filter is to find the
  // worst offender, and their mtimes are by definition old — that is why they
  // were invisible in the default order (earliest sat at row 558 of 4,783).
  const bySize = (a: FileRowLike, b: FileRowLike) => (b.lines ?? 0) - (a.lines ?? 0)
  const over = (r: FileRowLike) => typeof r.lines === 'number' && r.lines > LINE_ALERT_AT
  const longRows = useMemo(
    () => rows.filter(r => inDefaultLongFilter(r.path, r.lines)).sort(bySize), [rows])
  // Python is measured but not badged by default, so it appears here and only
  // here — which is the whole point of keeping measurement and display apart.
  const execRows = useMemo(
    () => rows.filter(r => over(r) && isExecutablePath(r.path)).sort(bySize), [rows])

  const [mode, setMode] = useState<'all' | 'long' | 'exec'>('all')
  const view = mode === 'long' ? longRows : mode === 'exec' ? execRows : rows

  // the tree is only refetched on a debounce, so it can still list a file we
  // have already watched being deleted
  const gone = useMemo(() => deletedPaths(events), [events])
  const max = useMemo(() => maxChanges(rows.filter(r => r.changes > 0) as never), [rows])
  // Flash the name of any file that just gained an event. Keyed remount is what
  // replays the CSS animation — re-rendering the same element would not.
  const seen = useRef<Map<string, number>>(new Map())
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const { changed, next } = changedPaths(seen.current, rows)
    seen.current = next
    if (!changed.length) return
    setFlashing(new Set(changed))
    const id = setTimeout(() => setFlashing(new Set()), 2700)  // matches orch-flash
    return () => clearTimeout(id)
  }, [rows])

  const [limit, setLimit] = useState(PAGE)
  // a new folder starts from the top again
  useEffect(() => { setLimit(PAGE); seen.current = new Map() }, [folderId])
  // a filter change starts from the top again, or page 6 of one list becomes
  // page 6 of a list with 43 entries
  useEffect(() => { setLimit(PAGE) }, [mode])
  const shown = view.slice(0, limit)

  if (error) return <p className="text-muted-foreground p-8 text-center text-sm">{t('files.error')}</p>
  if (!tree) return <p className="text-muted-foreground p-8 text-center text-sm">{t('files.loading')}</p>
  if (rows.length === 0) return <p className="text-muted-foreground p-8 text-center text-sm">{t('files.empty')}</p>

  return (
    <div className="text-sm">
      <div className="text-muted-foreground flex items-center gap-3 border-b px-4 py-1.5 text-xs">
        <span>{t('files.count', { n: view.length })}</span>
        {shown.length < view.length && <span>{t('files.showing', { n: shown.length })}</span>}
        {longRows.length > 0 && (
          <Button size="sm" variant={mode === 'long' ? 'secondary' : 'ghost'}
            className="h-5 px-1.5 text-xs"
            onClick={() => setMode(m => (m === 'long' ? 'all' : 'long'))}>
            {t('files.longCount', { n: fmtNum(longRows.length), at: fmtNum(LINE_ALERT_AT) })}
          </Button>
        )}
        {execRows.length > 0 && (
          <Button size="sm" variant={mode === 'exec' ? 'secondary' : 'ghost'}
            className="h-5 px-1.5 text-xs"
            onClick={() => setMode(m => (m === 'exec' ? 'all' : 'exec'))}>
            {t('files.execCount', { n: fmtNum(execRows.length), at: fmtNum(LINE_ALERT_AT) })}
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {t('files.legend')}
          <span className="inline-block h-2 w-16 rounded-full"
            style={{ background: churnCss() }} />
        </span>
      </div>

      {shown.map(f => {
        const share = f.changes > 0 ? churnShare(f.changes, max) : 0
        const tone = churnColor(share)
        const newest = f.events[0]
        return (
          <div key={f.path}
            onClick={() => newest && onSelect(newest)}
            className={cn('group/file flex items-center gap-3 border-b px-4 py-1.5',
              newest ? 'hover:bg-muted/50 cursor-pointer' : 'hover:bg-muted/30')}>

            <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs tabular-nums">
              {fmtTime(f.lastTs)}
            </span>

            <span className="w-14 shrink-0"
              title={f.observed ? t('files.changes', { n: f.changes }) : t('files.unobserved')}>
              <span className="bg-muted block h-1 w-full overflow-hidden rounded-full">
                {f.changes > 0 && (
                  <span className="block h-full rounded-full"
                    style={{ width: `${Math.max(6, share * 100)}%`, background: tone }} />
                )}
              </span>
            </span>

            {/* a dash, not a zero: we did not see it change, we are not claiming it never did */}
            <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums"
              style={f.changes > 0 ? { color: tone } : undefined}>
              {f.changes > 0
                ? f.changes
                : <span className="text-muted-foreground/40">{t('files.notObserved')}</span>}
            </span>

            {isImagePath(f.path) && f.present && !gone.has(f.path) && (
              <Thumb folderId={folderId} path={f.path} onOpen={onZoom} />
            )}

            <span key={`${f.path}:${f.events[0]?.id ?? 0}`}
              className={cn('min-w-0 flex-1 truncate rounded-sm',
                flashing.has(f.path) && 'orch-flash')}>
              <FilePath path={f.path}
                className={cn('truncate text-xs', !f.present && 'line-through opacity-50')} />
            </span>

            {/* The count is the point: "long" is a judgement, 6,314 is a fact. */}
            <LineBadge lines={f.lines} />

            {f.actors.has('claude') && (
              <Badge variant="secondary" className="shrink-0 text-violet-300">{t('actor.claude')}</Badge>
            )}
            {!f.actors.has('claude') && f.actors.has('during-claude') && (
              <Badge variant="outline" className="shrink-0 text-violet-300/70">{t('actor.during-claude')}</Badge>
            )}

            <span className="text-muted-foreground/70 w-16 shrink-0 text-right text-xs tabular-nums">
              {fmtAgo(f.lastTs)}
            </span>

            {locatable && f.present && (
              <button
                onClick={ev => ev.stopPropagation()}
                onMouseEnter={() => onLocate?.(f.path)}
                onMouseLeave={() => onLocate?.(null)}
                onFocus={() => onLocate?.(f.path)}
                onBlur={() => onLocate?.(null)}
                aria-label={t('feed.locate')}
                title={t('feed.locate')}
                className="text-muted-foreground/40 hover:text-blue-400 group-hover/file:text-muted-foreground/80 shrink-0 transition-colors">
                <FolderTree className="size-3.5" />
              </button>
            )}
          </div>
        )
      })}

      {shown.length < view.length && (
        <div className="border-t p-3 text-center">
          <Button size="sm" variant="outline" onClick={() => setLimit(n => n + PAGE)}>
            {t('files.showMore', { n: Math.min(PAGE, view.length - shown.length) })}
          </Button>
          <p className="text-muted-foreground mt-1.5 text-xs">
            {t('files.remaining', { n: view.length - shown.length })}
          </p>
        </div>
      )}
    </div>
  )
}
