import { config } from '@/config'

export type EventKind = 'created' | 'modified' | 'deleted' | 'renamed' | 'tool' | 'prompt' | 'alert'

export interface OrchEvent {
  id: number
  folderId: string
  ts: number
  kind: EventKind
  path: string | null
  actor: 'claude' | 'external' | 'unknown'
  sessionId: string | null
  tool: string | null
  detail: Record<string, any>
}

export interface FolderStatus { folderId: string; watching: boolean; reason: string | null; fileCount: number; eventsPerMin: number }
export interface Folder { id: string; path: string; name: string; ignore: string[]; enabled: boolean; createdAt: number; status: FolderStatus }
export interface Session { id: string; startedAt: number; lastAt: number; events: number; files: number }
export interface Rule {
  id: string; folderId: string | null; kinds: EventKind[]; pathGlob: string
  thresholdCount: number | null; thresholdSeconds: number | null
  actions: string[]; label: string; enabled: boolean
}

async function req<T> (path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(config.apiBase + path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined
  })
  if (!res.ok) {
    let code = 'HTTP_' + res.status
    try { code = (await res.json()).code ?? code } catch { /* non-json error body */ }
    throw Object.assign(new Error(code), { code, status: res.status })
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const api = {
  folders: () => req<Folder[]>('/api/folders'),
  addFolder: (body: { path: string; name?: string; ignore?: string[] }) =>
    req<Folder>('/api/folders', { method: 'POST', body: JSON.stringify(body) }),
  patchFolder: (id: string, body: Partial<Pick<Folder, 'enabled' | 'name' | 'ignore'>>) =>
    req<Folder>(`/api/folders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeFolder: (id: string) => req<void>(`/api/folders/${id}`, { method: 'DELETE' }),
  events: (folderId: string, opts: { limit?: number; before?: number; session?: string } = {}) => {
    const q = new URLSearchParams({ folder: folderId })
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.before) q.set('before', String(opts.before))
    if (opts.session) q.set('session', opts.session)
    return req<OrchEvent[]>(`/api/events?${q}`)
  },
  sessions: (folderId: string) => req<Session[]>(`/api/sessions?folder=${folderId}`),
  rules: () => req<Rule[]>('/api/rules'),
  addRule: (r: Partial<Rule>) => req<Rule>('/api/rules', { method: 'POST', body: JSON.stringify(r) }),
  patchRule: (id: string, r: Partial<Rule>) => req<Rule>(`/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify(r) }),
  removeRule: (id: string) => req<void>(`/api/rules/${id}`, { method: 'DELETE' }),
  reveal: (path: string) => req<{ ok: boolean }>('/api/reveal', { method: 'POST', body: JSON.stringify({ path }) })
}
