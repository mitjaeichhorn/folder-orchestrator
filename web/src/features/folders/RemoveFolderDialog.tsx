import { useState } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { api, type Folder } from '@/lib/api'
import { t } from '@/i18n'

/**
 * Removing a project stops watching it. It never touches the folder on disk —
 * this tool is read-only — and the dialog says so, because "remove" next to a
 * filesystem path reads as "delete" to anyone who has not read the README.
 */
export function RemoveFolderDialog ({ folder, onClose, onRemoved }: {
  folder: Folder | null
  onClose: () => void
  onRemoved: () => void
}) {
  const [purge, setPurge] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!folder) return
    setBusy(true)
    try {
      await api.removeFolder(folder.id, purge)
      onRemoved()
      onClose()
      setPurge(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={!!folder} onOpenChange={o => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('remove.title', { name: folder?.name ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{t('remove.body')}</span>
            <span className="text-muted-foreground block font-mono text-xs break-all">{folder?.path}</span>
            <span className="block font-medium">{t('remove.safe')}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={purge} onCheckedChange={setPurge} />
          <span>{t('remove.purge')}</span>
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('remove.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={confirm}>{t('remove.confirm')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
