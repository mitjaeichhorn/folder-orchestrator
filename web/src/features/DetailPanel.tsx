import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api, type OrchEvent, type Folder } from '@/lib/api'
import { isImagePath } from '@shared/glob.js'
import { Thumb } from './Thumb'
import { Lightbox } from './Lightbox'
import { toast } from 'sonner'
import { t, fmtDateTime } from '@/i18n'

function Diff ({ oldS, newS }: { oldS?: { text?: string; truncated?: boolean }; newS?: { text?: string; truncated?: boolean } }) {
  if (!oldS && !newS) return <p className="text-muted-foreground text-sm">{t('detail.noDiff')}</p>
  const removed = (oldS?.text ?? '').split('\n')
  const added = (newS?.text ?? '').split('\n')
  return (
    <div className="bg-muted/40 overflow-x-auto rounded-md border font-mono text-xs">
      {removed.filter(Boolean).map((l, i) => (
        <div key={`r${i}`} className="whitespace-pre px-2 text-rose-400">- {l}</div>
      ))}
      {added.filter(Boolean).map((l, i) => (
        <div key={`a${i}`} className="whitespace-pre px-2 text-emerald-400">+ {l}</div>
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
    return <p className="text-muted-foreground p-8 text-center text-sm">{t('detail.none')}</p>
  }
  const d = event.detail ?? {}
  const isEdit = event.kind === 'tool' && (event.tool === 'Edit' || event.tool === 'MultiEdit')
  const abs = event.path ? `${folder.path}/${event.path}` : null

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <div>
          <p className="font-mono text-sm break-all">{event.path ?? t(`kind.${event.kind}`)}</p>
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

        {event.path && isImagePath(event.path) && event.kind !== 'deleted' && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs uppercase">{t('detail.preview')}</p>
            <div className="bg-muted/40 flex justify-center rounded-md border p-2">
              <Thumb folderId={folder.id} path={event.path} size={0} onOpen={setZoom}
                className="h-auto max-h-72 w-auto max-w-full object-contain" />
            </div>
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
            <pre className="bg-muted/40 overflow-x-auto rounded-md border p-2 font-mono text-xs">{d.input.command}</pre>
          </div>
        )}

        {!isEdit && event.tool !== 'Bash' && event.kind !== 'alert' && (
          <p className="text-muted-foreground text-sm">{t('detail.noDiff')}</p>
        )}

        {abs && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { window.location.href = `vscode://file/${abs}` }}>
              {t('detail.openEditor')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => api.reveal(abs)}>{t('detail.reveal')}</Button>
            <Button size="sm" variant="outline" onClick={() => copy(abs, 'detail.copiedFile')}>
              <Copy className="size-3" />{t('detail.copyFile')}
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => copy(abs.slice(0, abs.lastIndexOf('/')) || folder.path, 'detail.copiedFolder')}>
              <Copy className="size-3" />{t('detail.copyFolder')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onMute(event.path!)}>{t('detail.mute')}</Button>
          </div>
        )}
      </div>
      <Lightbox folderId={folder.id} path={zoom} onClose={() => setZoom(null)} />
    </ScrollArea>
  )
}
