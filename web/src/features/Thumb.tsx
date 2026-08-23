import { useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Thumbnail for an image event. A deleted file has no bytes to show, and a
 * broken <img> renders as a torn-page glyph that reads like an error — so a
 * failed load collapses to nothing instead.
 */
export function Thumb ({ folderId, path, className, size = 20 }: {
  folderId: string
  path: string
  className?: string
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={api.fileUrl(folderId, path)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      style={size ? { height: size, width: size } : undefined}
      className={cn('bg-muted rounded-sm border', size ? 'shrink-0 object-cover' : '', className)}
    />
  )
}
