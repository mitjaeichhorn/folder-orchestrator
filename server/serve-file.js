import { statSync, createReadStream, realpathSync } from 'node:fs'
import { join, resolve, extname, sep } from 'node:path'
import { log } from './log.js'

// Only these are ever served. An allow-list, never a deny-list: the point is that
// this route can never be talked into returning .env, a key, or source code.
export const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp'
}
export const MAX_BYTES = 8 * 1024 * 1024

export const isImage = p => !!IMAGE_MIME[extname(String(p ?? '')).toLowerCase()]

// The client decides whether to request a thumbnail from the same list.
export { IMAGE_EXTS, isImagePath } from '../shared/glob.js'

const safeRealpath = p => { try { return realpathSync(p) } catch { return p } }

/**
 * Resolve a folder-relative path to an absolute one, or throw.
 * Rejects traversal, absolute paths and symlink escapes — the check is on the
 * REAL path, so a symlink inside the folder pointing at /etc/passwd is refused.
 */
export function resolveInside (folderPath, relPath) {
  if (typeof relPath !== 'string' || !relPath) throw Object.assign(new Error('bad path'), { code: 'BAD_PATH' })
  if (relPath.includes('\0')) throw Object.assign(new Error('bad path'), { code: 'BAD_PATH' })
  const root = resolve(folderPath)
  const abs = resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw Object.assign(new Error('outside folder'), { code: 'OUTSIDE' })
  }
  let st
  try { st = statSync(abs) } catch { throw Object.assign(new Error('missing'), { code: 'MISSING' }) }
  if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'NOT_FILE' })
  // Symlink escape check. Both sides must be real paths: on macOS the folder
  // itself often sits under one (/var -> /private/var), so comparing a resolved
  // file against an unresolved root rejects every legitimate file.
  const realRoot = safeRealpath(root)
  const real = safeRealpath(abs)
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw Object.assign(new Error('symlink escape'), { code: 'OUTSIDE' })
  }
  return { abs, size: st.size, mtime: st.mtimeMs }
}

export function serveImage (res, folder, relPath) {
  let info
  try {
    info = resolveInside(folder.path, relPath)
  } catch (err) {
    log('WARN', 'file_denied', { folder_id: folder.id, path: relPath, code: err.code })
    res.writeHead(err.code === 'MISSING' ? 404 : 403).end()
    return err.code === 'MISSING' ? 404 : 403
  }
  const mime = IMAGE_MIME[extname(info.abs).toLowerCase()]
  if (!mime) {
    log('WARN', 'file_denied', { folder_id: folder.id, path: relPath, code: 'NOT_IMAGE' })
    res.writeHead(415).end()
    return 415
  }
  if (info.size > MAX_BYTES) { res.writeHead(413).end(); return 413 }
  res.writeHead(200, {
    'content-type': mime,
    'content-length': info.size,
    'cache-control': 'no-cache',
    // a served file is data, never a document with privileges
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff'
  })
  createReadStream(info.abs).pipe(res)
  return 200
}
