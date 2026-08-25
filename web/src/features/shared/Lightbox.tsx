import { useEffect } from 'react'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { FilePath } from './FilePath'
import { t } from '@/i18n'

/**
 * Full-size image overlay. Deliberately not the shadcn Dialog: that traps focus
 * and constrains width, and this is a viewer, not a form.
 */
export function Lightbox ({ folderId, path, onClose }: {
  folderId: string
  path: string | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!path) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [path, onClose])

  if (!path) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="bg-background/90 fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-8 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-5xl items-center gap-3">
        <FilePath path={path} className="min-w-0 flex-1 truncate text-xs" />
        <button onClick={onClose} aria-label={t('lightbox.close')}
          className="text-muted-foreground hover:text-foreground shrink-0">
          <X className="size-4" />
        </button>
      </div>
      <img
        src={api.fileUrl(folderId, path)}
        alt={path}
        onClick={e => e.stopPropagation()}
        className="max-h-[80vh] max-w-full rounded-md border object-contain"
      />
      <p className="text-muted-foreground/70 text-xs">{t('lightbox.hint')}</p>
    </div>
  )
}
