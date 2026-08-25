import { useEffect, useMemo, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api, type TopicUsage, type OrchEvent } from '@/lib/api'
import { AUTHORED_TONE } from '../feed/authored'
import { fmtTokens } from './usage-format'
import { t, fmtNum } from '@/i18n'
import { cn } from '@/lib/utils'


export function Usage ({ folderId, live }: { folderId: string; live: OrchEvent[] }) {
  const [rows, setRows] = useState<TopicUsage[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.usage(folderId).then(r => { setRows(r); setError(false) }).catch(() => setError(true))
  }, [folderId, live.length])

  const max = useMemo(() => Math.max(1, ...(rows ?? []).map(r => r.outputTokens)), [rows])
  const totals = useMemo(() => (rows ?? []).reduce((a, r) => ({
    out: a.out + r.outputTokens, think: a.think + r.thinkingTokens,
    read: a.read + r.cacheRead, msgs: a.msgs + r.messages
  }), { out: 0, think: 0, read: 0, msgs: 0 }), [rows])

  if (error) return <p className="text-muted-foreground p-8 text-center text-sm">{t('usage.error')}</p>
  if (!rows) return <p className="text-muted-foreground p-8 text-center text-sm">{t('usage.loading')}</p>
  if (rows.length === 0) return <p className="text-muted-foreground p-8 text-center text-sm">{t('usage.empty')}</p>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="text-muted-foreground flex shrink-0 items-center gap-4 border-b px-4 py-2 text-xs">
        <span>{t('usage.turns', { n: fmtNum(totals.msgs) })}</span>
        <span>{t('usage.totalOut', { n: fmtTokens(totals.out) })}</span>
        <span>{t('usage.totalThinking', { n: fmtTokens(totals.think) })}</span>
        <span className="ml-auto">{t('usage.totalCacheRead', { n: fmtTokens(totals.read) })}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full table-fixed text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr className="border-b">
              <th className="px-4 py-1.5 text-left font-normal">{t('usage.task')}</th>
              <th className="w-24 py-1.5 text-right font-normal">{t('usage.output')}</th>
              <th className="w-20 py-1.5 text-right font-normal">{t('usage.thinking')}</th>
              <th className="w-24 py-1.5 text-right font-normal">{t('usage.cacheRead')}</th>
              <th className="w-16 py-1.5 pr-4 text-right font-normal">{t('usage.turnsShort')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.topic || '__none'} className="border-b">
                <td className="max-w-0 px-4 py-1.5">
                  {/* the bar is the comparison; the number is the detail */}
                  <div className="bg-lime-400/10" style={{ width: `${(r.outputTokens / max) * 100}%`, height: 2 }} />
                  <div className={cn('truncate', r.topic ? AUTHORED_TONE : 'text-muted-foreground italic')}
                    title={r.topic || undefined}>
                    {r.topic || t('usage.noTopic')}
                  </div>
                </td>
                <td className="py-1.5 text-right font-mono text-xs tabular-nums">{fmtTokens(r.outputTokens)}</td>
                <td className="text-muted-foreground py-1.5 text-right font-mono text-xs tabular-nums">{fmtTokens(r.thinkingTokens)}</td>
                <td className="text-muted-foreground/70 py-1.5 text-right font-mono text-xs tabular-nums">{fmtTokens(r.cacheRead)}</td>
                <td className="text-muted-foreground py-1.5 pr-4 text-right font-mono text-xs tabular-nums">{r.messages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  )
}
