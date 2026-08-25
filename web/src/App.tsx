import { useCallback, useEffect, useMemo, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuAction, SidebarProvider, SidebarRail, SidebarTrigger
} from '@/components/ui/sidebar'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { StreamProvider } from '@/hooks/StreamProvider'
import { useStream } from '@/hooks/useStream'
import { AddFolderDialog } from '@/features/AddFolderDialog'
import { RemoveFolderDialog } from '@/features/RemoveFolderDialog'
import { Trash2 } from 'lucide-react'
import { Feed } from '@/features/Feed'
import { DetailPanel } from '@/features/DetailPanel'
import { Sessions } from '@/features/Sessions'
import { Rules } from '@/features/Rules'
import { Usage } from '@/features/Usage'
import { HeatTree } from '@/features/HeatTree'
import { runningPaths } from '@/features/timeline'
import { newestEventByPath } from '@/features/group-by-file'
import { useAlerts } from '@/features/use-alerts'
import { AlertPanel } from '@/features/AlertPanel'
import type { Alert } from '@/features/alerts'
import { lineIndex } from '@/features/lines'
import { useDebounced } from '@/hooks/useDebounced'
import { treeFiles } from '@/features/churn'
import { config } from '@/config'
import { folderFromHash, hashForFolder, pickFolder } from '@/features/url-state'
import { api, type Folder, type OrchEvent, type Session } from '@/lib/api'
import { t, fmtNum } from '@/i18n'
import { cn } from '@/lib/utils'

/** Matches the server's RATE_WINDOW: a shorter poll resamples the same window. */
const STATUS_POLL_MS = 10_000

function Workspace ({ folder, onFolderChange }: { folder: Folder; onFolderChange: () => void }) {
  const { events, status, conn, attempt, evicted, alerts, clearAlerts } = useStream()
  const [selected, setSelected] = useState<OrchEvent | null>(null)
  const [heatOpen, setHeatOpen] = useState(true)
  // files a still-running tool call named — pulsed in both the feed and the tree
  const running = useMemo(() => runningPaths(events), [events])
  // hovering a feed row reveals that file in the heat tree — same route as `running`
  const [hoverPath, setHoverPath] = useState<string | null>(null)

  // The tree is the only source of line counts, and four surfaces want them —
  // feed, By topic, By file, detail panel. Fetched once here rather than per
  // component: FileList used to fetch its own copy, so this is one request
  // fewer, not one more. Refetched on structural change only, like the heat
  // tree: a modification never changes which files exist.
  const [treeRows, setTreeRows] = useState<Array<{ p: string; m?: number; l?: number }> | null>(null)
  const [treeError, setTreeError] = useState(false)
  // Counts MODIFICATIONS as well as structure. The heat tree only needs the
  // shape, but this fetch also carries line counts, and a file crossing 1,000
  // lines is a modification — refetching on structure alone left the badge
  // stale until something happened to be created or deleted.
  const contentVersion = useMemo(
    () => events.reduce((n, e) =>
      n + (e.kind === 'created' || e.kind === 'deleted' ||
           e.kind === 'renamed' || e.kind === 'modified' ? 1 : 0), 0),
    [events]
  )
  // Debounced, or a build refetches the tree once per file it touches.
  const treeVersion = useDebounced(contentVersion, 1500)
  useEffect(() => {
    let live = true
    fetch(`${config.apiBase}/api/tree?folder=${encodeURIComponent(folder.id)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => { if (live) { setTreeRows(treeFiles(d.children)); setTreeError(false) } })
      .catch(() => { if (live) setTreeError(true) })
    return () => { live = false }
  }, [folder.id, treeVersion])
  const lines = useMemo(() => lineIndex(treeRows), [treeRows])

  // Clicking a file in the heat tree opens the same panel a feed row does, on
  // that file's newest event. A file with no event stays inert in the tree
  // rather than offering a click that opens nothing.
  // Session names come from /api/sessions, not the stream: an `ai-title` record
  // is not an event and has no place in the feed. Refreshed on the same cadence
  // as folder status — a session is named a little after it starts.
  const [sessionsById, setSessionsById] = useState<Map<string, Session>>(new Map())
  useEffect(() => {
    let live = true
    const load = () => api.sessions(folder.id)
      .then(rows => {
        if (!live) return
        setSessionsById(new Map(rows.map(r => [r.id, r])))
      })
      .catch(() => { /* names are a nicety; the hex id always works */ })
    load()
    const t = setInterval(load, STATUS_POLL_MS)
    return () => { live = false; clearInterval(t) }
  }, [folder.id])

  // the feed only needs names; the detail panel wants the whole record
  const sessionNames = useMemo(
    () => new Map([...sessionsById].filter(([, r]) => r.aiTitle).map(([id, r]) => [id, r.aiTitle as string])),
    [sessionsById]
  )

  // Conditions worth attention, derived from the same events the feed shows.
  const { alerts: propositions, byPath: alertsByPath, snooze, mute: muteAlert } = useAlerts(events as never, lines)
  const [openAlert, setOpenAlert] = useState<Alert | null>(null)

  // clipboard needs a secure context; localhost qualifies, but a failure must
  // say so rather than silently copying nothing
  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t(label))
    } catch {
      toast.error(t('detail.copyFailed'))
    }
  }, [])

  const newestByPath = useMemo(() => newestEventByPath(events), [events])
  const openFromTree = useCallback((path: string) => {
    const e = newestByPath.get(path)
    if (e) setSelected(e)
  }, [newestByPath])

  // Name the open project in the tab, so several orchestrator tabs stay
  // tellable apart. Restored on unmount rather than left behind.
  useEffect(() => {
    const previous = document.title
    document.title = t('app.tabTitle', { name: folder.name })
    return () => { document.title = previous }
  }, [folder.name])
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    if (alerts.length === 0) return
    for (const a of alerts) {
      toast.warning(t(a.detail?.label ?? 'kind.alert'), {
        description: a.path ? t('alert.path', { path: a.path }) : undefined
      })
    }
    clearAlerts()
  }, [alerts, clearAlerts])

  const mute = useCallback(async (pattern: string) => {
    await api.patchFolder(folder.id, { ignore: [...folder.ignore, pattern] })
    onFolderChange()
  }, [folder, onFolderChange])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <SidebarTrigger className="-ml-1" />
        <p className="truncate font-mono text-sm">{folder.path}</p>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={cn('inline-block size-2 rounded-full',
            conn === 'open' ? 'bg-emerald-500' : conn === 'connecting' ? 'bg-amber-500' : 'bg-rose-500')} />
          <span className="text-muted-foreground">
            {conn === 'open' ? t('app.connected')
              : conn === 'connecting' ? t('app.reconnecting', { n: attempt })
                : t('app.disconnected')}
          </span>
          {status && (
            <span className="text-muted-foreground">
              · {t('folder.files', { n: fmtNum(status.fileCount) })} · {t('sidebar.eventsPerMin', { n: status.eventsPerMin })}
            </span>
          )}
          <Button size="sm" variant={filtersOpen ? 'secondary' : 'ghost'}
            onClick={() => setFiltersOpen(v => !v)}>{t('filter.toggle')}</Button>
          <Button size="sm" variant={heatOpen ? 'secondary' : 'ghost'}
            onClick={() => setHeatOpen(v => !v)}>{t('heat.toggle')}</Button>
          <Button size="sm" variant="outline" onClick={async () => {
            await api.patchFolder(folder.id, { enabled: !folder.enabled }); onFolderChange()
          }}>
            {folder.enabled ? t('folder.pause') : t('folder.resume')}
          </Button>
        </div>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 overflow-hidden">
        <ResizablePanel defaultSize="76" minSize="35" className="flex min-h-0 flex-col overflow-hidden">
          <Tabs defaultValue="activity" className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden">
        {filtersOpen && (
          <TabsList className="mx-4 my-2 w-fit shrink-0">
            <TabsTrigger value="activity">{t('tab.activity')}</TabsTrigger>
            <TabsTrigger value="session">{t('tab.session')}</TabsTrigger>
            <TabsTrigger value="rules">{t('tab.rules')}</TabsTrigger>
            <TabsTrigger value="tokens">{t('tab.tokens')}</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="activity" className="min-h-0 flex-1 overflow-hidden">
          <Feed events={events} evicted={evicted} selected={selected} onSelect={setSelected}
            folderId={folder.id} filtersOpen={filtersOpen} running={running}
            onLocate={setHoverPath} locatable={heatOpen}
            treeRows={treeRows} treeError={treeError} lines={lines}
            sessionNames={sessionNames}
            alertsByPath={alertsByPath} onOpenAlert={setOpenAlert} propositions={propositions} />
        </TabsContent>

        <TabsContent value="session" className="min-h-0 flex-1 overflow-hidden">
          <Sessions folderId={folder.id} live={events} onPickPath={() => {}} />
        </TabsContent>

        <TabsContent value="rules" className="min-h-0 flex-1 overflow-hidden">
          <Rules />
        </TabsContent>

        <TabsContent value="tokens" className="min-h-0 flex-1 overflow-hidden">
          <Usage folderId={folder.id} live={events} />
        </TabsContent>
      </Tabs>
        </ResizablePanel>
        {heatOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="24" minSize="12" maxSize="50" className="min-h-0 overflow-hidden">
              <HeatTree folderId={folder.id} events={events} running={running} hoverPath={hoverPath}
                onOpenFile={openFromTree} lines={lines} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <Sheet open={!!openAlert} onOpenChange={o => { if (!o) setOpenAlert(null) }}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-xl">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm">{t('alert.title')}</SheetTitle>
          </SheetHeader>
          {openAlert && (
            <AlertPanel alert={openAlert} sessionNames={sessionNames}
              onSnooze={a => { snooze(a); setOpenAlert(null) }}
              onMute={a => { muteAlert(a); setOpenAlert(null) }}
              onCopy={text => copyText(text, 'alert.copied')}
              onOpenFile={p => { window.location.href = `vscode://file/${folder.path}/${p}` }}
              onLocate={p => { setHoverPath(p); setOpenAlert(null) }} />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selected} onOpenChange={o => { if (!o) setSelected(null) }}>
        <SheetContent side="right"
          className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-2xl">
          <SheetHeader className="shrink-0 border-b px-4 py-3">
            <SheetTitle className="text-xs font-medium">{t('detail.title')}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {selected && <DetailPanel event={selected} folder={folder} onMute={mute} lines={lines}
              session={selected.sessionId ? sessionsById.get(selected.sessionId) : undefined} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

export default function App () {
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeId, setActiveId] = useState<string | null>(() => folderFromHash(window.location.hash))
  const [dialog, setDialog] = useState(false)
  const [removing, setRemoving] = useState<Folder | null>(null)
  const [offline, setOffline] = useState(false)

  const load = useCallback(async () => {
    try {
      const f = await api.folders()
      setFolders(f); setOffline(false)
      setActiveId(prev => pickFolder(f, folderFromHash(window.location.hash), prev))
    } catch {
      setOffline(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // The sidebar rate came from /api/folders, fetched once — so every row froze
  // at whatever it was when the tab opened, and a project being actively worked
  // on kept reading "idle". Refresh only the status field: re-running load()
  // would also re-pick the active folder, letting a poll fight the operator's
  // own selection. Matched to the server's 10s RATE_WINDOW — polling faster
  // would resample the same window and show noise, not news.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const fresh = await api.folders()
        const byId = new Map(fresh.map(f => [f.id, f.status]))
        setFolders(prev => prev.map(p => (byId.has(p.id) ? { ...p, status: byId.get(p.id)! } : p)))
        setOffline(false)
      } catch { /* the offline banner already reports this */ }
    }, STATUS_POLL_MS)
    return () => clearInterval(id)
  }, [])

  // keep the URL in step, and follow it when the user goes back or edits it
  useEffect(() => {
    const want = hashForFolder(activeId)
    if (activeId && window.location.hash !== want) {
      window.history.replaceState(null, '', want || window.location.pathname)
    }
  }, [activeId])
  useEffect(() => {
    const onHash = () => {
      const id = folderFromHash(window.location.hash)
      if (id) setActiveId(id)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (!offline) return
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [offline, load])

  const active = folders.find(f => f.id === activeId) ?? null

  return (
    <SidebarProvider>
      <div className="bg-background text-foreground flex h-screen w-full">
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="border-b">
          <p className="text-sm font-semibold">{t('app.title')}</p>
          <p className="text-muted-foreground text-xs">{t('app.watching', { count: folders.length })}</p>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t('sidebar.projects')}</SidebarGroupLabel>
            {folders.length === 0
              ? <p className="text-muted-foreground px-2 py-1 text-xs">{t('sidebar.noFolders')}</p>
              : (
                <SidebarMenu>
                  {folders.map(f => (
                    <SidebarMenuItem key={f.id}>
                      <SidebarMenuButton isActive={activeId === f.id} onClick={() => setActiveId(f.id)}
                        className="h-auto flex-col items-start gap-0.5 py-1.5">
                        <span className="flex w-full items-center gap-2">
                          <span className={cn('inline-block size-2 shrink-0 rounded-full',
                            !f.enabled ? 'bg-muted-foreground' : f.status?.watching ? 'bg-emerald-500' : 'bg-rose-500')} />
                          <span className="truncate text-sm">{f.name}</span>
                        </span>
                        <span className="text-muted-foreground pl-4 text-xs">
                          {!f.enabled ? t('sidebar.paused')
                            : f.status?.eventsPerMin ? t('sidebar.eventsPerMin', { n: f.status.eventsPerMin })
                              : t('sidebar.idle')}
                        </span>
                      </SidebarMenuButton>
                      <SidebarMenuAction showOnHover title={t('remove.action')}
                        onClick={e => { e.stopPropagation(); setRemoving(f) }}>
                        <Trash2 />
                        <span className="sr-only">{t('remove.action')}</span>
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">
          <Button className="w-full" size="sm" onClick={() => setDialog(true)}>{t('sidebar.addFolder')}</Button>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        {offline
          ? <div className="flex flex-1 items-center justify-center">
              <Badge variant="destructive">{t('app.disconnected')}</Badge>
            </div>
          : active
            ? <StreamProvider key={active.id} folderId={active.id}>
                <Workspace folder={active} onFolderChange={load} />
              </StreamProvider>
            : <div className="text-muted-foreground flex flex-1 items-center justify-center gap-3 text-sm">
                <SidebarTrigger />
                {t('sidebar.noFolders')}
              </div>}
      </SidebarInset>

      <AddFolderDialog open={dialog} onOpenChange={setDialog} onAdded={load} />
      <RemoveFolderDialog folder={removing} onClose={() => setRemoving(null)} onRemoved={load} />
      <Toaster theme="dark" position="top-right" />
      </div>
    </SidebarProvider>
  )
}
