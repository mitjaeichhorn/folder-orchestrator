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
import { folderFromHash, hashForFolder, pickFolder } from '@/features/url-state'
import { api, type Folder, type OrchEvent } from '@/lib/api'
import { t, fmtNum } from '@/i18n'
import { cn } from '@/lib/utils'

function Workspace ({ folder, onFolderChange }: { folder: Folder; onFolderChange: () => void }) {
  const { events, status, conn, attempt, evicted, alerts, clearAlerts } = useStream()
  const [selected, setSelected] = useState<OrchEvent | null>(null)
  const [heatOpen, setHeatOpen] = useState(true)
  // files a still-running tool call named — pulsed in both the feed and the tree
  const running = useMemo(() => runningPaths(events), [events])
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
            folderId={folder.id} filtersOpen={filtersOpen} running={running} />
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
              <HeatTree folderId={folder.id} events={events} running={running} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <Sheet open={!!selected} onOpenChange={o => { if (!o) setSelected(null) }}>
        <SheetContent side="right"
          className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-2xl">
          <SheetHeader className="shrink-0 border-b px-4 py-3">
            <SheetTitle className="text-xs font-medium">{t('detail.title')}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {selected && <DetailPanel event={selected} folder={folder} onMute={mute} />}
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
