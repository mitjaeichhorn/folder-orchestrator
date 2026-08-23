import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { api, type Rule } from '@/lib/api'
import { t } from '@/i18n'

export function Rules () {
  const [rules, setRules] = useState<Rule[]>([])
  const [pattern, setPattern] = useState('')

  const load = () => api.rules().then(setRules).catch(() => setRules([]))
  useEffect(() => { load() }, [])

  const toggle = async (r: Rule) => {
    await api.patchRule(r.id, { enabled: !r.enabled })
    load()
  }
  const remove = async (r: Rule) => { await api.removeRule(r.id); load() }
  const add = async () => {
    if (!pattern.trim()) return
    await api.addRule({ pathGlob: pattern.trim(), kinds: [], actions: ['toast'], label: pattern.trim() })
    setPattern(''); load()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <p className="text-sm">{t('rules.heading')}</p>
        <div className="ml-auto flex gap-2">
          <Input className="h-8 w-64" value={pattern} placeholder={t('rules.pattern')}
            onChange={e => setPattern(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }} />
          <Button size="sm" onClick={add}>{t('rules.add')}</Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {rules.length === 0
          ? <p className="text-muted-foreground p-8 text-center text-sm">{t('rules.empty')}</p>
          : rules.map(r => (
            <div key={r.id} className="flex items-center gap-3 border-b px-4 py-2">
              <Switch checked={r.enabled} onCheckedChange={() => toggle(r)} aria-label={t('rules.enabled')} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{t(r.label)}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  {r.thresholdCount
                    ? t('rules.threshold', { count: r.thresholdCount, seconds: r.thresholdSeconds ?? 0 })
                    : r.pathGlob}
                </p>
              </div>
              <div className="flex gap-1">
                {r.kinds.length === 0
                  ? <Badge variant="outline">{t('rules.anyKind')}</Badge>
                  : r.kinds.map(k => <Badge key={k} variant="outline">{t(`kind.${k}`)}</Badge>)}
                {r.actions.map(a => <Badge key={a} variant="secondary">{a}</Badge>)}
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(r)}>{t('rules.delete')}</Button>
            </div>
          ))}
      </ScrollArea>
    </div>
  )
}
