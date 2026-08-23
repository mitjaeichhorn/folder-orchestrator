import { lazy, Suspense, useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api, type OrchEvent, type Folder } from '@/lib/api'
import { isImagePath, isMarkdownPath } from '@shared/glob.js'
import { Thumb } from './Thumb'
import { Lightbox } from './Lightbox'
import { toast } from 'sonner'
import { t, fmtDateTime } from '@/i18n'
import { cn } from '@/lib/utils'

// ~100kb of parser, for a file type most rows are not. Kept out of the initial
// chunk — the panel renders without it and fills in when it lands.
const Markdown = lazy(() => import('./Markdown'))

const AGAINST_KEY: Record<string, string> = {
  worktree: 'detail.againstWorktree', head: 'detail.againstHead', untracked: 'detail.againstUntracked'
}

/** Unified diff text, coloured by leading character. No parser needed. */
function UnifiedDiff ({ text }: { text: string }) {
  return (
    <div className="bg-muted/40 rounded-md border font-mono text-xs">
      {text.split('\n').map((l, i) => (
        <div key={i} className={cn('px-2 break-words whitespace-pre-wrap',
          l.startsWith('+') && !l.startsWith('+++') && 'text-emerald-400',
          l.startsWith('-') && !l.startsWith('---') && 'text-rose-400',
          l.startsWith('@@') && 'text-sky-400',
          (l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('+++') || l.startsWith('---')) && 'text-muted-foreground/50'
        )}>{l || ' '}</div>
      ))}
    </div>
  )
}

/** A path with no spaces will not wrap on its own — offer a break after each "/". */
function WrapPath ({ path, className }: { path: string; className?: string }) {
  const parts = path.split('/')
  return (
    <span className={cn('font-mono break-words', className)}>
      {parts.map((seg, i) => (
        <span key={i}>
          {i > 0 && '/'}<wbr />{seg}
        </span>
      ))}
    </span>
  )
}

function Diff ({ oldS, newS }: { oldS?: { text?: string; truncated?: boolean }; newS?: { text?: string; truncated?: boolean } }) {
  if (!oldS && !newS) return <p className="text-muted-foreground text-xs">{t('detail.noDiff')}</p>
  const removed = (oldS?.text ?? '').split('\n')
  const added = (newS?.text ?? '').split('\n')
  return (
    <div className="bg-muted/40 rounded-md border font-mono text-xs">
      {removed.filter(Boolean).map((l, i) => (
        <div key={`r${i}`} className="px-2 break-words whitespace-pre-wrap text-rose-400">- {l}</div>
      ))}
      {added.filter(Boolean).map((l, i) => (
        <div key={`a${i}`} className="px-2 break-words whitespace-pre-wrap text-emerald-400">+ {l}</div>
      ))}
      {(oldS?.truncated || newS?.truncated) && (
        <div className="text-muted-foreground border-t px-2 py-1">{t('feed.truncated')}</div>
      )}
    </div>
  )
}

export function DetailPanel ({ event, folder, onMute }: {
  event: OrchEvent | null
  folder: Folder
  onMute: (pattern: string) => void
}) {
  // Its own lightbox: DetailPanel is a sibling of Feed, not a child, so there is
  // no shared state to lift — and two overlays can never both be open anyway.
  const [zoom, setZoom] = useState<string | null>(null)
  const [gitDiff, setGitDiff] = useState<Awaited<ReturnType<typeof api.diff>> | null>(null)

  // The Edit tool carries its own before/after. Everything else — Bash, a
  // formatter, the operator's editor — carries nothing, so ask git.
  const path = event?.path ?? null
  const needsGit = !!path && !(event as any)?.burst && event?.kind !== 'alert' &&
    !(event?.kind === 'tool' && (event.tool === 'Edit' || event.tool === 'MultiEdit'))
  useEffect(() => {
    if (!needsGit || !path) { setGitDiff(null); return }
    let live = true
    setGitDiff(null)
    api.diff(folder.id, path)
      .then(d => { if (live) setGitDiff(d) })
      .catch(() => { if (live) setGitDiff({ available: false, reason: 'ERROR' }) })
    return () => { live = false }
  }, [folder.id, path, needsGit])

  // Markdown preview. A deleted file has nothing on disk to read, so the
  // section is skipped entirely rather than showing an error for a known cause.
  const [md, setMd] = useState<{ text: string } | { error: true } | null>(null)
  const [mdRaw, setMdRaw] = useState(false)
  const wantsMd = !!path && isMarkdownPath(path) && event?.kind !== 'deleted'
  useEffect(() => {
    if (!wantsMd || !path) { setMd(null); return }
    let live = true
    setMd(null)
    api.fileText(folder.id, path)
      .then(text => { if (live) setMd({ text }) })
      .catch(() => { if (live) setMd({ error: true }) })
    return () => { live = false }
  }, [folder.id, path, wantsMd])
  // the toggle is a per-file choice, not a sticky preference
  useEffect(() => { setMdRaw(false) }, [path])

  // navigator.clipboard needs a secure context; localhost qualifies, but a
  // failure must say so rather than silently copying nothing.
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t(label), { description: text })
    } catch {
      toast.error(t('detail.copyFailed'), { description: text })
    }
  }
  if (!event) {
    return <p className="text-muted-foreground p-8 text-center text-xs">{t('detail.none')}</p>
  }
  const d = event.detail ?? {}
  const burst = (event as any).burst as { count: number; dir: string; paths: string[] } | undefined
  const isEdit = event.kind === 'tool' && (event.tool === 'Edit' || event.tool === 'MultiEdit')
  const abs = event.path ? `${folder.path}/${event.path}` : null

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-4 p-4">
        <div>
          {event.path
            ? <WrapPath path={event.path} className="text-xs" />
            : <p className="font-mono text-xs">{t(`kind.${event.kind}`)}</p>}
          <p className="text-muted-foreground text-xs">
            {t(`kind.${event.kind}`)} · {fmtDateTime(event.ts)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={event.actor === 'claude' ? 'secondary' : 'outline'}>{t(`actor.${event.actor}`)}</Badge>
            {event.tool && <Badge variant="outline">{event.tool}</Badge>}
            {typeof d.linesAdded === 'number' && (
              <span className="font-mono text-xs text-emerald-400">{t('detail.linesAdded', { n: d.linesAdded })}</span>
            )}
            {typeof d.linesRemoved === 'number' && (
              <span className="font-mono text-xs text-rose-400">{t('detail.linesRemoved', { n: d.linesRemoved })}</span>
            )}
          </div>
        </div>

        <Separator />

        {abs && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => { window.location.href = `vscode://file/${abs}` }}>
              {t('detail.openEditor')}
            </Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => api.reveal(abs)}>{t('detail.reveal')}</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => copy(abs, 'detail.copiedFile')}>
              <Copy className="size-3" />{t('detail.copyFile')}
            </Button>
            <Button size="sm" variant="outline" className="text-xs"
              onClick={() => copy(abs.slice(0, abs.lastIndexOf('/')) || folder.path, 'detail.copiedFolder')}>
              <Copy className="size-3" />{t('detail.copyFolder')}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => onMute(event.path!)}>{t('detail.mute')}</Button>
          </div>
        )}

        {burst && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs uppercase">
              {t('detail.burstFiles', { n: burst.count })}
            </p>
            <div className="bg-muted/40 space-y-0.5 rounded-md border p-2">
              {burst.paths.map(p => <WrapPath key={p} path={p} className="block text-xs" />)}
            </div>
          </div>
        )}

        {event.path && isImagePath(event.path) && event.kind !== 'deleted' && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs uppercase">{t('detail.preview')}</p>
            <div className="bg-muted/40 flex justify-center rounded-md border p-2">
              <Thumb folderId={folder.id} path={event.path} size={0} onOpen={setZoom}
                className="h-auto max-h-72 w-auto max-w-full object-contain" />
            </div>
          </div>
        )}

        {wantsMd && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground text-xs uppercase">{t('detail.markdown')}</p>
              <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs"
                onClick={() => setMdRaw(v => !v)}>
                {t(mdRaw ? 'detail.markdownRendered' : 'detail.markdownRaw')}
              </Button>
            </div>
            {md === null
              ? <p className="text-muted-foreground text-xs">{t('detail.markdownLoading')}</p>
              : 'error' in md
                ? <p className="text-muted-foreground text-xs">{t('detail.markdownError')}</p>
                : mdRaw
                  ? <pre className="bg-muted/40 rounded-md border p-2 font-mono text-xs break-words whitespace-pre-wrap">{md.text}</pre>
                  : (
                    <div className="bg-muted/40 rounded-md border p-3">
                      <Suspense fallback={<p className="text-muted-foreground text-xs">{t('detail.markdownLoading')}</p>}>
                        <Markdown text={md.text} />
                      </Suspense>
                    </div>
                  )}
          </div>
        )}

        {isEdit && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs uppercase">{t('detail.diff')}</p>
            <Diff oldS={d.input?.old_string} newS={d.input?.new_string} />
          </div>
        )}

        {event.tool === 'Bash' && d.input?.command && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs uppercase">{t('detail.command')}</p>
            <pre className="bg-muted/40 rounded-md border p-2 font-mono text-xs break-words whitespace-pre-wrap">{d.input.command}</pre>
          </div>
        )}

        {!isEdit && event.kind !== 'alert' && event.path && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs uppercase">
              {t('detail.diff')}
              {gitDiff?.available && gitDiff.against && (
                <span className="ml-2 normal-case">{t(AGAINST_KEY[gitDiff.against] ?? 'detail.diff')}</span>
              )}
            </p>
            {gitDiff === null
              ? <p className="text-muted-foreground text-xs">{t('detail.diffLoading')}</p>
              : gitDiff.available && gitDiff.text
                ? <>
                    <UnifiedDiff text={gitDiff.text} />
                    {gitDiff.truncated && <p className="text-muted-foreground text-xs">{t('feed.truncated')}</p>}
                  </>
                : <p className="text-muted-foreground text-xs">
                    {t(gitDiff.reason === 'NOT_A_REPO' ? 'detail.noGit'
                      : gitDiff.reason === 'NO_CHANGES' ? 'detail.noChanges'
                      : 'detail.noDiff')}
                  </p>}
          </div>
        )}

      </div>
      <Lightbox folderId={folder.id} path={zoom} onClose={() => setZoom(null)} />
    </ScrollArea>
  )
}
