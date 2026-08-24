import { Badge } from '@/components/ui/badge'
import { laneOf, laneProfile, LANES, LANE_TONE, type Lane } from './lanes'
import { FilePath } from './FilePath'
import { ToolLabel } from './ToolLabel'
import { KindGlyph } from './KindGlyph'
import { rowText } from './event-view'
import { isAuthored, AUTHORED_TONE, TOOL_DESC_TONE } from './authored'
import { sessionLabel } from './session-color'
import { isRunning } from './timeline'
import type { OrchEvent } from '@/lib/api'
import { t, fmtTime, fmtNum } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Planning · work · test, with one shared timeline down the middle.
 *
 * Chronology is preserved exactly: rows appear in the same order as the feed,
 * they simply sit in different columns. An event with a file goes to its lane;
 * an event with none — `Bash`, MCP, prompts, about half of all traffic — spans
 * the full width. That spanning row IS the centralised timeline: it is what
 * ties the three lanes to one clock, and it is why the spine cannot be a fourth
 * column without the view losing its spine.
 */
export function LaneView ({ events, selected, onSelect, sessionTones, sessionNames }: {
  events: OrchEvent[]
  selected: OrchEvent | null
  onSelect: (e: OrchEvent) => void
  sessionTones?: Map<string, string>
  sessionNames?: Map<string, string>
}) {
  if (events.length === 0) {
    return <p className="text-muted-foreground p-8 text-center text-sm">{t('feed.empty')}</p>
  }
  const profile = laneProfile(events)

  const Cell = ({ e }: { e: OrchEvent }) => (
    <button onClick={() => onSelect(e)}
      className={cn('hover:bg-muted/50 w-full min-w-0 rounded-sm px-1.5 py-0.5 text-left',
        selected?.id === e.id && 'bg-muted')}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="text-muted-foreground/70 shrink-0 font-mono text-[10px] tabular-nums">
          {fmtTime(e.ts)}
        </span>
        <KindGlyph kind={e.kind} pulse={isRunning(e)} />
        <span className={cn('truncate text-xs',
          isAuthored(e) ? (e.kind === 'tool' ? TOOL_DESC_TONE : AUTHORED_TONE) : 'font-mono')}>
          {e.path ? <FilePath path={e.path} /> : rowText(e)}
        </span>
      </span>
    </button>
  )

  return (
    <div className="text-sm">
      {/* Lane totals, so an empty column is visibly empty rather than ambiguous */}
      <div className="text-muted-foreground bg-background sticky top-0 z-10 grid grid-cols-3 gap-2 border-b px-3 py-1.5 text-xs">
        {LANES.map(l => (
          <span key={l} className={cn('truncate', LANE_TONE[l])}>
            {t(`lane.${l}`)} · {fmtNum(profile[l])}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-x-2 px-3 py-1">
        {events.map(e => {
          const lane = laneOf(e.path)
          if (lane === 'spine') {
            // full width: the shared clock every lane is read against
            return (
              <div key={e.id ?? `${e.ts}-spine`} className="col-span-3 my-0.5 border-y border-dashed border-muted/60">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-muted-foreground/70 shrink-0 font-mono text-[10px] tabular-nums">
                    {fmtTime(e.ts)}
                  </span>
                  <ToolLabel tool={e.tool} className="shrink-0" />
                  <button onClick={() => onSelect(e)}
                    className={cn('min-w-0 flex-1 truncate rounded-sm px-1 text-left text-xs hover:bg-muted/50',
                      isAuthored(e) ? (e.kind === 'tool' ? TOOL_DESC_TONE : AUTHORED_TONE) : 'font-mono',
                      selected?.id === e.id && 'bg-muted')}>
                    {rowText(e)}
                  </button>
                  {e.sessionId && (
                    <Badge variant="outline"
                      className={cn('shrink-0 max-w-32 truncate', sessionTones?.get(e.sessionId))}>
                      <span className="truncate">
                        {sessionLabel(sessionNames?.get(e.sessionId), e.sessionId)}
                      </span>
                    </Badge>
                  )}
                </span>
              </div>
            )
          }
          const col = LANES.indexOf(lane as Lane) + 1
          return (
            <div key={e.id ?? `${e.ts}-${e.path}`} style={{ gridColumn: col }} className="min-w-0">
              <Cell e={e} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
