import { useCallback, useEffect, useMemo, useState } from 'react'
import { detectAlerts, visibleAlerts, alertsByPath, type Alert } from './alerts.ts'

const MUTE_KEY = 'orch.alerts.muted'

/**
 * Alert state: what is firing, and what the operator has silenced.
 *
 * Snoozes live in memory — "until it happens again" is about this sitting, and
 * surviving a reload would make a dismissed alert impossible to get back.
 * Mutes persist in localStorage, because "never" has to outlive the tab.
 *
 * A muted alert is per-BROWSER, not per-project-on-disk. That is the honest
 * limit of this version: the wireframe put permanent dismissals under
 * Filter ▸ Rules so they could be undone, and that needs the server's rules
 * table. Until then the key is listed here so it can be cleared deliberately.
 */
export function useAlerts (events: Parameters<typeof detectAlerts>[0], lines?: Map<string, number>) {
  const [snoozed, setSnoozed] = useState<Map<string, number>>(new Map())
  const [muted, setMuted] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]')) } catch { return new Set() }
  })

  // The stall rule is about elapsed time, so it can become true with NO new
  // event arriving — which is exactly the case it exists for. A slow tick is
  // what lets it appear; 30s is well under the 10-minute threshold it feeds.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const all = useMemo(() => detectAlerts(events, lines, now), [events, lines, now])
  const shown = useMemo(() => visibleAlerts(all, snoozed, muted), [all, snoozed, muted])
  const byPath = useMemo(() => alertsByPath(shown), [shown])

  const snooze = useCallback((a: Alert) => {
    setSnoozed(prev => new Map(prev).set(a.key, a.anchorId))
  }, [])

  const mute = useCallback((a: Alert) => {
    setMuted(prev => {
      const next = new Set(prev).add(a.key)
      try { localStorage.setItem(MUTE_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }, [])

  return { alerts: shown, byPath, snooze, mute }
}
