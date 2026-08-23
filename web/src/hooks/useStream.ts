import { createContext, useContext } from 'react'
import type { OrchEvent, FolderStatus } from '@/lib/api'

export type ConnState = 'connecting' | 'open' | 'closed'

export interface StreamValue {
  events: OrchEvent[]
  status: FolderStatus | null
  conn: ConnState
  attempt: number
  evicted: number
  alerts: OrchEvent[]
  clearAlerts: () => void
}

export const StreamContext = createContext<StreamValue | null>(null)

export function useStream (): StreamValue {
  const v = useContext(StreamContext)
  if (!v) throw new Error('useStream must be used inside StreamProvider')
  return v
}
