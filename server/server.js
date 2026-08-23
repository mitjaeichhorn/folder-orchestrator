import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { exec } from 'node:child_process'
import * as db from './db.js'
import * as bus from './bus.js'
import * as watcher from './watcher.js'
import * as transcripts from './transcripts.js'
import * as rules from './rules.js'
import { serveImage } from './serve-file.js'
import { buildTree } from './tree.js'
import { log } from './log.js'

const PORT = Number(process.env.ORCH_PORT || 4000)
const HOST = '127.0.0.1' // the entire security model. There is no user management.
const DB_PATH = process.env.ORCH_DB || join(process.cwd(), 'data', 'orchestrator.db')
const WEB = join(process.cwd(), 'web', 'dist')
const MAX_BODY = 64 * 1024

const database = db.open(DB_PATH)
bus.init(database)
transcripts.init(database)
rules.init(database)

const json = (res, code, body) => {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) })
  res.end(s)
  return code
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    let n = 0
    const chunks = []
    req.on('data', c => {
      n += c.length
      if (n > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' })); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
      catch { reject(Object.assign(new Error('bad json'), { code: 'BAD_JSON' })) }
    })
    req.on('error', reject)
  })
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

function serveStatic (url, res) {
  if (!existsSync(WEB)) return false
  const clean = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
  let file = join(WEB, clean === '/' ? 'index.html' : clean)
  if (!file.startsWith(WEB)) return false
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB, 'index.html')
  if (!existsSync(file)) return false
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
  return true
}

function startFolder (folder) {
  watcher.startWatch(folder)
  transcripts.startTail(folder)
}
function stopFolder (id) {
  watcher.stopWatch(id)
  transcripts.stopTail(id)
}

const server = createServer(async (req, res) => {
  const t0 = Date.now()
  const url = new URL(req.url, `http://${HOST}`)
  const p = url.pathname
  let status = 200
  try {
    // --- folders
    if (p === '/api/folders' && req.method === 'GET') {
      status = json(res, 200, db.listFolders(database).map(f => ({ ...f, status: watcher.status(f.id) })))
    } else if (p === '/api/folders' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.path) status = json(res, 400, { code: 'PATH_REQUIRED' })
      else {
        try {
          const f = db.addFolder(database, body)
          startFolder(f)
          status = json(res, 201, { ...f, status: watcher.status(f.id) })
        } catch (err) {
          status = json(res, err.code === 'DUPLICATE' ? 409 : 400, { code: err.code || 'BAD_REQUEST' })
        }
      }
    } else if (p.startsWith('/api/folders/') && req.method === 'PATCH') {
      const id = p.split('/')[3]
      const f = db.patchFolder(database, id, await readBody(req))
      if (!f) status = json(res, 404, { code: 'NOT_FOUND' })
      else {
        if (f.enabled) startFolder(f); else stopFolder(f.id)
        status = json(res, 200, { ...f, status: watcher.status(f.id) })
      }
    } else if (p.startsWith('/api/folders/') && req.method === 'DELETE') {
      const id = p.split('/')[3]
      stopFolder(id)
      const ok = db.removeFolder(database, id, url.searchParams.get('purge') === '1')
      status = ok ? 204 : 404
      res.writeHead(status).end()

    // --- events
    } else if (p === '/api/events' && req.method === 'GET') {
      const kinds = url.searchParams.get('kinds')?.split(',').filter(Boolean)
      status = json(res, 200, db.listEvents(database, {
        folderId: url.searchParams.get('folder'),
        limit: Number(url.searchParams.get('limit') || 200),
        before: url.searchParams.get('before') ? Number(url.searchParams.get('before')) : undefined,
        sessionId: url.searchParams.get('session') || undefined,
        kinds
      }))
    } else if (p === '/api/sessions' && req.method === 'GET') {
      status = json(res, 200, db.sessions(database, url.searchParams.get('folder')))

    // --- rules
    } else if (p === '/api/rules' && req.method === 'GET') {
      status = json(res, 200, db.listRules(database))
    } else if (p === '/api/rules' && req.method === 'POST') {
      const body = await readBody(req)
      try { globToReCheck(body.pathGlob) } catch { return void (status = json(res, 400, { code: 'BAD_GLOB' })) }
      const r = db.addRule(database, body); rules.reload()
      status = json(res, 201, r)
    } else if (p.startsWith('/api/rules/') && req.method === 'PATCH') {
      const r = db.patchRule(database, p.split('/')[3], await readBody(req))
      rules.reload()
      status = r ? json(res, 200, r) : json(res, 404, { code: 'NOT_FOUND' })
    } else if (p.startsWith('/api/rules/') && req.method === 'DELETE') {
      db.removeRule(database, p.split('/')[3]); rules.reload()
      status = 204; res.writeHead(204).end()

    } else if (p === '/api/tree' && req.method === 'GET') {
      const folder = db.getFolder(database, url.searchParams.get('folder'))
      status = folder ? json(res, 200, buildTree(folder)) : json(res, 404, { code: 'NOT_FOUND' })

    // --- image bytes, allow-listed extensions only, never leaves the folder
    } else if (p === '/api/file' && req.method === 'GET') {
      const folder = db.getFolder(database, url.searchParams.get('folder'))
      if (!folder) { status = 404; res.writeHead(404).end() }
      else status = serveImage(res, folder, url.searchParams.get('path'))

    // --- reveal (read-only shell-out, no writes into the watched tree)
    } else if (p === '/api/reveal' && req.method === 'POST') {
      const { path: target } = await readBody(req)
      if (target) exec(`open -R ${JSON.stringify(target)}`)
      status = json(res, 200, { ok: true })

    // --- SSE
    } else if (p === '/api/stream' && req.method === 'GET') {
      const folderId = url.searchParams.get('folder')
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      res.flushHeaders?.()
      // backfill BEFORE subscribing so there is no gap at the seam
      for (const e of db.listEvents(database, { folderId, limit: 200 }).reverse()) {
        res.write(`event: append\ndata: ${JSON.stringify(e)}\n\n`)
      }
      res.write(`event: status\ndata: ${JSON.stringify(watcher.status(folderId))}\n\n`)
      bus.subscribe(folderId, res)
      log('INFO', 'req', { method: req.method, route: '/api/stream', status: 200, duration_ms: Date.now() - t0 })
      return
    } else if (serveStatic(url, res)) {
      status = 200
    } else {
      status = json(res, 404, { code: 'NOT_FOUND' })
    }
  } catch (err) {
    status = err.code === 'TOO_LARGE' ? 413 : err.code === 'BAD_JSON' ? 400 : 500
    log('ERROR', 'req_failed', { route: p, code: err.code, message: err.message, stack: err.stack })
    if (!res.headersSent) json(res, status, { code: err.code || 'INTERNAL' })
  }
  log('INFO', 'req', { method: req.method, route: p, status, duration_ms: Date.now() - t0 })
})

function globToReCheck (g) { if (g != null && typeof g !== 'string') throw new Error('bad glob') }

server.on('error', err => {
  if (err.code === 'EADDRINUSE') { log('FATAL', 'port_in_use', { port: PORT }); process.exit(1) }
  log('FATAL', 'server_error', { message: err.message }); process.exit(1)
})

server.listen(PORT, HOST, () => {
  let swept = 0
  try { swept = db.sweepRetention(database, 30) } catch (err) { log('ERROR', 'retention', { message: err.message }) }
  const folders = db.listFolders(database)
  for (const f of folders) if (f.enabled) startFolder(f)
  watcher.startTicker()
  log('INFO', 'boot', { port: PORT, db_path: DB_PATH, folder_count: folders.length, retention_deleted: swept })
  process.stderr.write(`folder-orchestrator on http://${HOST}:${PORT}\n`)
})

export { server, database }
