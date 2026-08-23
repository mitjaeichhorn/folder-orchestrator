import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { config } from '@/config'
import { StreamContext, type ConnState } from './useStream'
import type { OrchEvent, FolderStatus } from '@/lib/api'

const log = (code: string, fields: Record<string, unknown>) => {
  if (import.meta.env.DEV) console.info(JSON.stringify({ code, ...fields }))
}

/** One EventSource per folder, shared by every consumer. */
export function StreamProvider ({ folderId, children }: { folderId: string; children: ReactNode }) {
  const [events, setEvents] = useState<OrchEvent[]>([])
  const [status, setStatus] = useState<FolderStatus | null>(null)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [attempt, setAttempt] = useState(0)
  const [evicted, setEvicted] = useState(0)
  const [alerts, setAlerts] = useState<OrchEvent[]>([])
  const attemptRef = useRef(0)
  // Buffer lives in a ref: setState updaters must be pure, so eviction cannot be
  // counted inside one. Nested setState in an updater is silently dropped.
  const bufRef = useRef<OrchEvent[]>([])
  const evictedRef = useRef(0)

  useEffect(() => {
    bufRef.current = []; evictedRef.current = 0
    setEvents([]); setAlerts([]); setEvicted(0)
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      setConn('connecting')
      es = new EventSource(`${config.apiBase}/api/stream?folder=${encodeURIComponent(folderId)}`)

      es.onopen = () => {
        attemptRef.current = 0
        setAttempt(0)
        setConn('open')
        log('sse_open', { folderId })
      }

      es.addEventListener('append', ev => {
        let e: OrchEvent
        try { e = JSON.parse((ev as MessageEvent).data) } catch { log('sse_bad_frame', { folderId }); return }
        bufRef.current.push(e)
        if (bufRef.current.length > config.bufferLimit) {
          const drop = bufRef.current.length - config.bufferLimit
          bufRef.current = bufRef.current.slice(drop)
          evictedRef.current += drop
          log('buffer_evict', { dropped: drop })
          setEvicted(evictedRef.current)
        }
        setEvents([...bufRef.current])
        if (e.kind === 'alert') setAlerts(prev => [...prev, e])
      })

      es.addEventListener('patch', ev => {
        try {
          const p = JSON.parse((ev as MessageEvent).data)
          bufRef.current = bufRef.current.map(e => (e.id === p.id ? { ...e, ...p } : e))
          setEvents([...bufRef.current])
        } catch { log('sse_bad_frame', { folderId }) }
      })

      es.addEventListener('status', ev => {
        try { setStatus(JSON.parse((ev as MessageEvent).data)) } catch { /* ignore */ }
      })

      es.onerror = () => {
        es?.close()
        if (cancelled) return
        setConn('closed')
        attemptRef.current += 1
        setAttempt(attemptRef.current)
        const delay = Math.min(30000, 1000 * 2 ** (attemptRef.current - 1))
        log('sse_reconnect', { folderId, attempt: attemptRef.current, backoff_ms: delay })
        timer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => { cancelled = true; es?.close(); if (timer) clearTimeout(timer) }
  }, [folderId])

  const value = useMemo(() => ({
    events, status, conn, attempt, evicted, alerts, clearAlerts: () => setAlerts([])
  }), [events, status, conn, attempt, evicted, alerts])

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>
}
