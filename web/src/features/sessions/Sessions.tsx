import { useEffect, useMemo, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { api, type OrchEvent, type Session } from '@/lib/api'
import { t, fmtTime, fmtAgo } from '@/i18n'
import { cn } from '@/lib/utils'
import { ToolLabel } from '../shared/ToolLabel'
import { groupBySession, filesTouched, isRunning, UNATTRIBUTED } from './session-logic'


export function Sessions ({ folderId, live, onPickPath }: {
  folderId: string
  live: OrchEvent[]
  onPickPath: (p: string) => void
}) {
  const [stored, setStored] = useState<Session[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    api.sessions(folderId).then(setStored).catch(() => setStored([]))
  }, [folderId, live.length])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const groups = useMemo(() => groupBySession(live), [live])
  const current = active ?? stored[0]?.id ?? [...groups.keys()][0] ?? null
  const rows = current ? (groups.get(current) ?? []) : []
  const files = useMemo(() => filesTouched(rows), [rows])

  if (stored.length === 0 && groups.size === 0) {
    return <p className="text-muted-foreground p-8 text-center text-sm">{t('session.none')}</p>
  }

  const meta = stored.find(s => s.id === current)
  const lastAt = meta?.lastAt ?? rows.at(-1)?.ts ?? 0
  const running = isRunning(lastAt, now)

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 min-h-0 shrink-0 overflow-hidden border-r">
        <ScrollArea className="h-full">
          {(stored.length ? stored.map(s => s.id) : [...groups.keys()]).map(id => {
            const m = stored.find(s => s.id === id)
            const last = m?.lastAt ?? groups.get(id)?.at(-1)?.ts ?? 0
            return (
              <button key={id} onClick={() => setActive(id)}
                className={cn('hover:bg-muted/50 w-full border-b px-3 py-2 text-left', current === id && 'bg-muted')}>
                <p className="font-mono text-xs">{id === UNATTRIBUTED ? t('session.unattributed') : id.slice(0, 8)}</p>
                <p className="text-muted-foreground text-xs">
                  {isRunning(last, now) ? t('session.running') : t('session.ended')} ·{' '}
                  {t('session.lastActivity', { ago: fmtAgo(last, now) })}
                </p>
                {/* Branch and directory are what separate two agents editing the
                    same relative path in different worktrees. Absent for sessions
                    first seen before this was recorded — shown as nothing rather
                    than as a guess. */}
                {(m?.gitBranch || m?.cwd) && (
                  <p className="text-muted-foreground/70 truncate font-mono text-[10px]"
                    title={m?.cwd ?? undefined}>
                    {m?.gitBranch && <span className="text-teal-300">{m.gitBranch}</span>}
                    {m?.gitBranch && m?.cwd && ' · '}
                    {m?.cwd && m.cwd.split('/').slice(-2).join('/')}
                  </p>
                )}
              </button>
            )
          })}
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-sm">
          <span className="font-mono">{current?.slice(0, 8)}</span>
          <Badge variant={running ? 'default' : 'outline'}>
            {running ? t('session.running') : t('session.ended')}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {t('session.toolCalls', { n: meta?.events ?? rows.length })} ·{' '}
            {t('session.filesTouched', { n: files.length })}
          </span>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(e => (
                <tr key={e.id} className="border-b">
                  <td className="text-muted-foreground w-24 px-4 py-1.5 font-mono text-xs tabular-nums">{fmtTime(e.ts)}</td>
                  <td className="w-px py-1.5 pr-3 whitespace-nowrap">
                    {e.tool ? <ToolLabel tool={e.tool} /> : <span className="text-muted-foreground font-mono text-xs">{t('kind.prompt')}</span>}
                  </td>
                  <td className="truncate py-1.5 font-mono text-xs">
                    {e.path ?? e.detail?.input?.command ?? e.detail?.text ?? ''}
                  </td>
                  <td className="text-muted-foreground w-20 py-1.5 pr-4 text-right font-mono text-xs">
                    {typeof e.detail?.exitCode === 'number' ? `${t('detail.exitCode')} ${e.detail.exitCode}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>

        {files.length > 0 && (
          <div className="border-t p-3">
            <p className="text-muted-foreground mb-2 text-xs uppercase">{t('session.filesHeading')}</p>
            <div className="flex flex-wrap gap-1">
              {files.map(f => (
                <button key={f} onClick={() => onPickPath(f)}
                  className="bg-muted hover:bg-muted/70 rounded px-2 py-0.5 font-mono text-xs">{f}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
