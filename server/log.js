import { appendFileSync, statSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DIR = process.env.ORCH_LOG_DIR || join(process.cwd(), 'logs')
const FILE = join(DIR, 'orchestrator.jsonl')
const MAX = 10 * 1024 * 1024
const DEBUG = process.env.ORCH_DEBUG === '1'
let warned = false

function rotate () {
  try {
    if (!existsSync(FILE) || statSync(FILE).size < MAX) return
    for (let i = 3; i >= 1; i--) {
      const from = i === 1 ? FILE : `${FILE}.${i - 1}`
      if (existsSync(from)) renameSync(from, `${FILE}.${i}`)
    }
  } catch { /* rotation failure must not block logging */ }
}

export function log (level, code, fields = {}) {
  if (level === 'DEBUG' && !DEBUG) return
  const line = JSON.stringify({ ts: Date.now(), level, code, ...fields }) + '\n'
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
    rotate()
    appendFileSync(FILE, line)
  } catch (err) {
    // ponytail: one stderr fallback, not a retry queue. A localhost tool that
    // cannot write its log should say so once and keep serving.
    if (!warned) { warned = true; process.stderr.write(`log_unavailable ${err.message}\n`) }
  }
}

export const logFile = FILE
