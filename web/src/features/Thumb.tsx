import { useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Thumbnail for an image event. A deleted file has no bytes to show, and a
 * broken <img> renders as a torn-page glyph that reads like an error — so a
 * failed load collapses to nothing instead.
 */
export function Thumb ({ folderId, path, className, size = 20, onOpen }: {
  folderId: string
  path: string
  className?: string
  size?: number
  onOpen?: (path: string) => void
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const img = (
    <img
      src={api.fileUrl(folderId, path)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      style={size ? { height: size, width: size } : undefined}
      className={cn('bg-muted rounded-sm border', size ? 'shrink-0 object-cover' : '', className)}
    />
  )
  if (!onOpen) return img
  return (
    <button
      // stopPropagation: opening the image must not also select the row
      onClick={e => { e.stopPropagation(); onOpen(path) }}
      className="shrink-0 cursor-zoom-in leading-none"
      aria-label={path}
    >
      {img}
    </button>
  )
}
