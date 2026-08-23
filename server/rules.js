import { globToRe } from './ignore.js'
import * as bus from './bus.js'
import { listRules, addRule, countRules } from './db.js'
import { log } from './log.js'

const COOLDOWN = 60000
const GLOBAL_CAP = 5
const GLOBAL_WINDOW = 10000

let db = null
let compiled = []
const firedAt = new Map()   // ruleId -> ts
const rings = new Map()     // ruleId -> [ts]
const suppressed = new Map()// ruleId -> count
let globalRing = []
const disabled = new Set()

export const DEFAULT_RULES = [
  { label: 'rule.env_changed', kinds: [], pathGlob: '**/.env*', actions: ['toast', 'badge'] },
  { label: 'rule.event_storm', kinds: [], pathGlob: '**', thresholdCount: 100, thresholdSeconds: 10, actions: ['toast'] },
  { label: 'rule.src_delete', kinds: ['deleted'], pathGlob: 'src/**', actions: ['badge'] }
]

export const SEED_VERSION = 1

export function init (database) {
  db = database
  // ponytail: PRAGMA user_version is the seeded marker — no extra table.
  // countRules()===0 cannot distinguish "never seeded" from "seeded then deleted",
  // and re-seeding rules the operator deleted is worse than not seeding at all.
  const v = db.prepare('PRAGMA user_version').get().user_version
  if (v < SEED_VERSION) {
    for (const r of DEFAULT_RULES) addRule(db, r)
    db.exec(`PRAGMA user_version = ${SEED_VERSION}`)
  }
  reload()
  bus.setMatcher(match)
}

export function reload () {
  compiled = listRules(db).filter(r => r.enabled && !disabled.has(r.id)).map(r => ({
    ...r, re: globToRe(r.pathGlob)
  }))
  return compiled.length
}

export function match (e, now = Date.now()) {
  if (e.kind === 'alert') return
  for (const r of compiled) {
    try {
      if (r.folderId && r.folderId !== e.folderId) continue
      if (r.kinds.length && !r.kinds.includes(e.kind)) continue
      if (e.path != null && !r.re.test(e.path)) continue
      if (e.path == null && r.pathGlob !== '**') continue

      if (r.thresholdCount) {
        const ring = (rings.get(r.id) || []).filter(t => now - t < r.thresholdSeconds * 1000)
        ring.push(now)
        rings.set(r.id, ring)
        if (ring.length < r.thresholdCount) continue
      }

      const last = firedAt.get(r.id) || 0
      if (now - last < COOLDOWN) {
        suppressed.set(r.id, (suppressed.get(r.id) || 0) + 1)
        continue
      }
      const s = suppressed.get(r.id) || 0
      if (s) { log('INFO', 'cooldown_suppressed', { rule_id: r.id, suppressed_count: s }); suppressed.set(r.id, 0) }
      firedAt.set(r.id, now)
      fire(r, e, now)
    } catch (err) {
      disabled.add(r.id)
      reload()
      log('ERROR', 'rule_threw', { rule_id: r.id, message: err.message })
    }
  }
}

function fire (r, e, now) {
  globalRing = globalRing.filter(t => now - t < GLOBAL_WINDOW)
  globalRing.push(now)
  const capped = globalRing.length > GLOBAL_CAP
  const alert = {
    folderId: e.folderId, ts: now, kind: 'alert', path: e.path, actor: 'unknown',
    sessionId: e.sessionId ?? null, tool: null,
    detail: { ruleId: r.id, label: r.label, matched: r.pathGlob, actions: r.actions, capped, event: { kind: e.kind, path: e.path } }
  }
  log('INFO', 'rule_fire', {
    rule_id: r.id, folder_id: e.folderId, event_kind: e.kind,
    matched_pattern: r.pathGlob, actions_taken: r.actions, capped
  })
  if (capped) log('WARN', 'toast_cap', { collapsed_count: globalRing.length - GLOBAL_CAP })
  bus.emit(alert)
}

export function _reset () {
  firedAt.clear(); rings.clear(); suppressed.clear(); disabled.clear(); globalRing = []
}
