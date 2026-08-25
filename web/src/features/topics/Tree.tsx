import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { groupByTopic, NO_FILE, NO_TOPIC } from '../files/group-by-file'
import { FilePath } from '../shared/FilePath'
import { Thumb } from '../shared/Thumb'
import { isImagePath } from '@shared/glob.js'
import { rowText } from '../feed/event-view'
import { isAuthored, AUTHORED_TONE, TOOL_DESC_TONE } from '../feed/authored'
import { ToolLabel } from '../shared/ToolLabel'
import { recurring } from '../feed/entities'
import { Marked } from '../feed/Marked'
import { KindGlyph } from '../shared/KindGlyph'
import { LineBadge } from '../shared/LineBadge'
import type { OrchEvent } from '@/lib/api'
import { t, fmtTime, fmtAgo } from '@/i18n'
import { cn } from '@/lib/utils'

export function Tree ({ events, selected, onSelect, folderId, onZoom, lines }: {
  events: OrchEvent[]
  selected: OrchEvent | null
  onSelect: (e: OrchEvent) => void
  folderId: string
  lines?: Map<string, number>
  onZoom?: (path: string) => void
}) {
  const topics = useMemo(() => groupByTopic(events), [events])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setCollapsed(s => {
    const n = new Set(s)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  if (topics.length === 0) {
    return <p className="text-muted-foreground p-8 text-center text-sm">{t('feed.empty')}</p>
  }

  return (
    <div className="text-sm">
      {topics.map(tg => {
        const tKey = `t:${tg.topic}`
        const tOpen = !collapsed.has(tKey)
        // Per topic, not per view: a name recurring inside ONE task is what ties
        // that task's rows together, and the group boundary is already drawn.
        const marks = recurring(tg.files.flatMap(f => f.events.map(rowText)))
        return (
          <div key={tKey} className="border-b">
            <button onClick={() => toggle(tKey)}
              className="hover:bg-muted/40 flex w-full items-center gap-2 px-3 py-2 text-left">
              {tOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
              <span className={cn('min-w-0 flex-1 truncate',
                tg.topic === NO_TOPIC ? 'text-muted-foreground italic' : AUTHORED_TONE)}>
                {tg.topic === NO_TOPIC ? t('tree.noTopic') : tg.topic}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {t('tree.fileCount', { n: tg.files.filter(f => f.path !== NO_FILE).length })}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{fmtAgo(tg.lastTs)}</span>
            </button>

            {tOpen && tg.files.map(fg => {
              const fKey = `${tKey}/f:${fg.path}`
              const fOpen = !collapsed.has(fKey)
              return (
                <div key={fKey}>
                  <button onClick={() => toggle(fKey)}
                    className="hover:bg-muted/40 flex w-full items-center gap-2 py-1 pr-3 pl-8 text-left">
                    {fOpen ? <ChevronDown className="size-3 shrink-0 opacity-50" /> : <ChevronRight className="size-3 shrink-0 opacity-50" />}
                    {fg.path !== NO_FILE && isImagePath(fg.path) && (
                      <Thumb folderId={folderId} path={fg.path} size={18} onOpen={onZoom} />
                    )}
                    <span className="min-w-0 flex-1 text-xs break-words [overflow-wrap:anywhere]">
                      {fg.path === NO_FILE
                        ? <span className="text-muted-foreground italic">{t('tree.noFile')}</span>
                        : <FilePath path={fg.path} />}
                      {fg.path !== NO_FILE && (
                        <LineBadge lines={lines?.get(fg.path)} className="ml-2" />
                      )}
                    </span>
                    {fg.changes > 0 && (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {t('tree.changes', { n: fg.changes })}
                      </span>
                    )}
                    {fg.claudeActions > 0 && (
                      <Badge variant="secondary" className="shrink-0 text-violet-300">
                        {t('tree.claudeActions', { n: fg.claudeActions })}
                      </Badge>
                    )}
                  </button>

                  {fOpen && fg.events.map(e => (
                    <button key={e.id ?? `${e.ts}-${e.path}`} onClick={() => onSelect(e)}
                      className={cn('hover:bg-muted/50 flex w-full items-center gap-2 py-0.5 pr-3 pl-14 text-left',
                        selected?.id === e.id && 'bg-muted')}>
                      <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs tabular-nums">
                        {fmtTime(e.ts)}
                      </span>
                      <span className="w-4 shrink-0"><KindGlyph kind={e.kind} /></span>
                      {e.tool && <ToolLabel tool={e.tool} className="shrink-0 whitespace-nowrap" />}
                      <span className={cn('min-w-0 flex-1 truncate text-xs',
                        isAuthored(e)
                          ? (e.kind === 'tool' ? TOOL_DESC_TONE : AUTHORED_TONE)
                          : 'font-mono')} title={rowText(e)}>
                        {fg.path === NO_FILE || e.kind === 'tool'
                          ? <Marked text={rowText(e)} marks={marks} />
                          : t(`kind.${e.kind}`)}
                      </span>
                      {e.actor === 'claude' && (
                        <Badge variant="secondary" className="shrink-0 text-violet-300">{t('actor.claude')}</Badge>
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
