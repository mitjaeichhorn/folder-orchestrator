/**
 * The open project lives in the URL so a reload — or a bookmark, or a second
 * tab — lands on the same folder instead of silently falling back to the first.
 *
 * Kept as a hash rather than a path: the server serves index.html for unknown
 * paths, but a hash never reaches the server at all, so there is nothing to
 * misroute and no history entry per selection unless we ask for one.
 */
export const FOLDER_KEY = 'folder'

export function folderFromHash (hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const v = new URLSearchParams(raw).get(FOLDER_KEY)
  return v && v.trim() ? v : null
}

export function hashForFolder (folderId: string | null): string {
  if (!folderId) return ''
  return `#${new URLSearchParams({ [FOLDER_KEY]: folderId })}`
}

/** Which folder to open: the URL wins, then the last one, then the first. */
export function pickFolder (
  available: Array<{ id: string }>, fromUrl: string | null, previous: string | null
): string | null {
  if (fromUrl && available.some(f => f.id === fromUrl)) return fromUrl
  if (previous && available.some(f => f.id === previous)) return previous
  return available[0]?.id ?? null
}
