import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FilePath } from './FilePath'
import { Thumb } from './Thumb'
import { ToolLabel } from './ToolLabel'
import { KindGlyph } from './KindGlyph'
import { rowText } from './event-view'
import { isAuthored, AUTHORED_TONE, TOOL_DESC_TONE } from './authored'
import { isFree, FREE_ROW_CLASS } from './cost'
import { gapPx, fmtGap, isCapped, isRunning, runningFor, isStalled } from './timeline'
import type { NestedEvent } from './collapse'
import { t, fmtTime } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * One feed row, used for both top-level events and the children nested under a
 * call. Children must emit all five `<td>`s — a row whose cell count differs from
 * the colgroup arity collapses the whole table's widths.
 */
export function FeedRow ({
  e, gap, now, depth = 0, folderId, selected, onSelect, running, onZoom, gone,
  onLocate, locatable, expanded, onToggle
}: {
  e: NestedEvent
  gap: number
  now: number
  depth?: number
  folderId: string
  selected: NestedEvent | null
  onSelect: (e: NestedEvent) => void
  running?: Set<string>
  onZoom: (path: string) => void
  gone?: ReadonlySet<string>
  onLocate?: (path: string | null) => void
  locatable?: boolean
  expanded?: boolean
  onToggle?: () => void
}) {
  const kids = e.children?.length ?? 0
  // a burst points at its shared directory; everything else at its own path
  const locateTarget = e.burst ? (e.burst.dir || null) : e.path

  return (
    <tr
      onClick={() => onSelect(e)}
      className={cn('group/row hover:bg-muted/50 cursor-pointer',
        isFree(e) && FREE_ROW_CLASS,
        selected?.id === e.id && 'bg-muted')}>

      <td className="w-24 px-3 py-1 align-top">
        <div className="text-muted-foreground font-mono text-xs tabular-nums">{fmtTime(e.ts)}</div>
        {/* Only top-level rows carry a gap dash: rowGaps is indexed on the
            top-level array, and a child sits inside its parent's interval. */}
        {depth === 0 && gap > 0 && (
          <div className="relative ml-1 flex" style={{ height: gapPx(gap) }}>
            <div className="border-muted-foreground/60 h-full border-l border-dashed" />
            {(gapPx(gap) >= 14 || isCapped(gap)) && (
              <span className={cn('text-muted-foreground/70 self-center pl-1.5 text-[10px] tabular-nums',
                isCapped(gap) && 'text-amber-500/60')}>
                {isCapped(gap) ? `↕ ${fmtGap(gap)}` : fmtGap(gap)}
              </span>
            )}
          </div>
        )}
      </td>

      <td className="w-6 py-1 align-top">
        <KindGlyph kind={e.kind} pulse={isRunning(e)} />
      </td>

      <td className="max-w-0 py-1 pr-2 align-top">
        <div className="flex min-w-0 items-center gap-2"
          style={depth ? { paddingLeft: depth * 18 } : undefined}
          title={e.burst ? e.burst.paths.join('\n') : rowText(e)}>

          {kids > 0 && (
            <button
              onClick={ev => { ev.stopPropagation(); onToggle?.() }}
              aria-label={t(expanded ? 'feed.collapseCall' : 'feed.expandCall')}
              className="text-muted-foreground hover:text-foreground shrink-0">
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          )}

          <ToolLabel tool={e.tool} className="shrink-0" />

          {isRunning(e)
            ? <span className={cn('shrink-0 font-mono text-[10px] tabular-nums',
                isStalled(e.ts, now) ? 'text-amber-500/80' : 'text-lime-400 orch-pulse')}>
                {fmtGap(runningFor(e.ts, now)) || '0s'}
              </span>
            : typeof e.detail?.durationMs === 'number' && e.detail.durationMs >= 1000 && (
              <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px] tabular-nums">
                {fmtGap(e.detail.durationMs)}
              </span>
            )}

          {e.path && isImagePathSafe(e.path) && e.kind !== 'deleted' && !gone?.has(e.path) && (
            <Thumb folderId={folderId} path={e.path} onOpen={onZoom} />
          )}

          {!e.burst && e.repeat && e.repeat > 1 && (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 font-mono text-[10px] tabular-nums">
              {t('feed.repeat', { n: e.repeat })}
            </span>
          )}

          <span className={cn('truncate text-xs',
            isAuthored(e)
              ? (e.kind === 'tool' ? TOOL_DESC_TONE : AUTHORED_TONE)
              : 'font-mono',
            e.path && running?.has(e.path) && 'orch-pulse-soft')}>
            {e.burst
              ? <span className="text-muted-foreground/60">
                  {e.burst.dir ? `${e.burst.dir}/` : ''}
                  <span className="text-foreground">{t('feed.burstFiles', { n: e.burst.count })}</span>
                </span>
              : e.path
                ? <FilePath path={rowText(e)} />
                : rowText(e)}
          </span>

          {/* a collapsed call must still say how much it is hiding */}
          {kids > 0 && !expanded && (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 font-mono text-[10px] tabular-nums">
              {t('feed.callFiles', { n: kids })}
            </span>
          )}
        </div>
      </td>

      <td className="w-16 py-1 pr-2 text-right align-top">
        {e.actor === 'claude' && (
          <Badge variant="secondary" className="text-violet-300">{t('actor.claude')}</Badge>
        )}
        {e.actor === 'during-claude' && (
          <Badge variant="outline" className="text-violet-300/70">{t('actor.during-claude')}</Badge>
        )}
      </td>

      <td className="w-24 py-1 pr-3 align-top"
        onMouseEnter={() => locatable && locateTarget && onLocate?.(locateTarget)}
        onMouseLeave={() => locatable && onLocate?.(null)}>
        <div className="flex items-center justify-end gap-1">
          <span className="text-muted-foreground w-10 text-right font-mono text-xs tabular-nums">
            {typeof e.detail?.linesAdded === 'number' && (
              <span className="text-emerald-400">{t('detail.linesAdded', { n: e.detail.linesAdded })}</span>
            )}
          </span>
          {locatable && locateTarget && (
            // Always visible, dim until approached. Hidden-until-hover made the
            // feature undiscoverable: there was nothing on screen to aim at.
            <button
              onClick={ev => ev.stopPropagation()}
              onMouseEnter={() => onLocate?.(locateTarget)}
              onMouseLeave={() => onLocate?.(null)}
              onFocus={() => onLocate?.(locateTarget)}
              onBlur={() => onLocate?.(null)}
              aria-label={t('feed.locate')}
              title={t('feed.locate')}
              className="text-muted-foreground/40 hover:text-blue-400 group-hover/row:text-muted-foreground/80 shrink-0 transition-colors">
              <FolderTree className="size-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// kept local so this module needs no runtime import from the shared glob helper
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp']
function isImagePathSafe (p: string): boolean {
  const i = p.lastIndexOf('.')
  return i !== -1 && IMAGE_EXTS.includes(p.slice(i).toLowerCase())
}
