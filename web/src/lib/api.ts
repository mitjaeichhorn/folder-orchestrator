import { config } from '@/config'

export type EventKind = 'created' | 'modified' | 'deleted' | 'renamed' | 'tool' | 'prompt' | 'alert'

export interface OrchEvent {
  id: number
  folderId: string
  ts: number
  kind: EventKind
  path: string | null
  actor: 'claude' | 'during-claude' | 'external' | 'unknown'
  sessionId: string | null
  tool: string | null
  /** The operator's prompt, verbatim — see the event contract. */
  topic: string | null
  /**
   * events.id of the tool call whose measured interval contained this event.
   * Co-occurrence, not authorship — see invariant 6 of the event contract.
   */
  duringToolEventId?: number | null
  detail: Record<string, any>
}

export interface FolderStatus { folderId: string; watching: boolean; reason: string | null; fileCount: number; eventsPerMin: number }
export interface Folder { id: string; path: string; name: string; ignore: string[]; enabled: boolean; createdAt: number; status: FolderStatus }
export interface Session { id: string; startedAt: number; lastAt: number; events: number; files: number }
export interface TopicUsage {
  topic: string
  messages: number
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  cacheRead: number
  cacheCreation: number
  firstTs: number
  lastTs: number
}

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
  removeFolder: (id: string, purge = false) =>
    req<void>(`/api/folders/${id}${purge ? '?purge=1' : ''}`, { method: 'DELETE' }),
  events: (folderId: string, opts: { limit?: number; before?: number; session?: string } = {}) => {
    const q = new URLSearchParams({ folder: folderId })
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.before) q.set('before', String(opts.before))
    if (opts.session) q.set('session', opts.session)
    return req<OrchEvent[]>(`/api/events?${q}`)
  },
  diff: (folderId: string, path: string) => req<{
    available: boolean; reason?: string; source?: string
    against?: 'worktree' | 'head' | 'untracked'; truncated?: boolean; text?: string
  }>(`/api/diff?folder=${encodeURIComponent(folderId)}&path=${encodeURIComponent(path)}`),
  usage: (folderId: string) => req<TopicUsage[]>(`/api/usage?folder=${folderId}`),
  sessions: (folderId: string) => req<Session[]>(`/api/sessions?folder=${folderId}`),
  rules: () => req<Rule[]>('/api/rules'),
  addRule: (r: Partial<Rule>) => req<Rule>('/api/rules', { method: 'POST', body: JSON.stringify(r) }),
  patchRule: (id: string, r: Partial<Rule>) => req<Rule>(`/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify(r) }),
  removeRule: (id: string) => req<void>(`/api/rules/${id}`, { method: 'DELETE' }),
  pickFolder: () => req<{ path?: string; cancelled?: boolean; error?: string }>(
    '/api/pick-folder', { method: 'POST', body: '{}' }),
  fileUrl: (folderId: string, path: string) =>
    `${config.apiBase}/api/file?folder=${encodeURIComponent(folderId)}&path=${encodeURIComponent(path)}`,
  reveal: (path: string) => req<{ ok: boolean }>('/api/reveal', { method: 'POST', body: JSON.stringify({ path }) }),
  /** Raw text of a served file. Not `req()`: that parses JSON, this is markdown. */
  fileText: async (folderId: string, path: string) => {
    const res = await fetch(api.fileUrl(folderId, path))
    if (!res.ok) throw Object.assign(new Error('file'), { status: res.status })
    return res.text()
  }
}
