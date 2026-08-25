import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type Folder } from '@/lib/api'
import { t } from '@/i18n'

const ERRORS: Record<string, string> = {
  DUPLICATE: 'add.errorDuplicate',
  ENOTDIR_OR_MISSING: 'add.errorMissing',
  PATH_REQUIRED: 'add.errorRequired',
  UNSUPPORTED_PLATFORM: 'add.errorPickerPlatform',
  PICKER_UNAVAILABLE: 'add.errorPickerUnavailable',
  TIMEOUT: 'add.errorPickerTimeout'
}

export function AddFolderDialog ({ open, onOpenChange, onAdded }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onAdded: (f: Folder) => void
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [ignore, setIgnore] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)

  // The dialog opens on the host, not in the browser — a browser folder picker
  // returns a handle, never a path, and the watcher needs a path.
  const browse = async () => {
    setPicking(true); setError(null)
    try {
      const r = await api.pickFolder()
      if (r.cancelled) return
      if (r.path) { setPath(r.path); if (!name) setName(r.path.split('/').filter(Boolean).pop() ?? '') }
    } catch (err: any) {
      setError(ERRORS[err.code] ?? 'add.errorPickerUnavailable')
    } finally {
      setPicking(false)
    }
  }

  const submit = async () => {
    if (!path.trim()) { setError('add.errorRequired'); return }
    setBusy(true); setError(null)
    try {
      const f = await api.addFolder({
        path: path.trim(),
        name: name.trim() || undefined,
        ignore: ignore.split(',').map(s => s.trim()).filter(Boolean)
      })
      onAdded(f)
      onOpenChange(false)
      setPath(''); setName(''); setIgnore('')
    } catch (err: any) {
      setError(ERRORS[err.code] ?? 'add.errorUnknown')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{t('add.title')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="path">{t('add.path')}</Label>
            <div className="flex gap-2">
              <Input id="path" value={path} placeholder={t('add.pathPlaceholder')}
                onChange={e => setPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit() }} />
              <Button variant="outline" onClick={browse} disabled={picking} className="shrink-0">
                <FolderOpen className="size-4" />
                {picking ? t('add.browsing') : t('add.browse')}
              </Button>
            </div>
            {picking && <p className="text-muted-foreground text-xs">{t('add.browseHint')}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">{t('add.name')}</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ignore">{t('add.ignore')}</Label>
            <Input id="ignore" value={ignore} placeholder={t('add.ignorePlaceholder')}
              onChange={e => setIgnore(e.target.value)} />
            <p className="text-muted-foreground text-xs">{t('add.ignoreHint')}</p>
          </div>
          {error && <p className="text-destructive text-sm" role="alert">{t(error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('add.cancel')}</Button>
          <Button onClick={submit} disabled={busy}>{t('add.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
