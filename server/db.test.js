import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as db from './db.js'

/** A fresh database per test — the schema is applied on open. */
function fresh (t) {
  const d = mkdtempSync(join(tmpdir(), 'orchdb-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  return db.open(join(d, 'x.db'))
}

test('the sessions table is created on an existing database, no migration needed', t => {
  const D = fresh(t)
  const names = D.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  assert.ok(names.includes('sessions'), 'schema.sql uses IF NOT EXISTS, so reopening adds it')
})

test('a session records its branch and cwd, and a later record refines it', t => {
  const D = fresh(t)
  db.upsertSession(D, { id: 'S1', folderId: 'F', gitBranch: 'main', cwd: '/a', entrypoint: 'cli' })
  // a checkout: the branch changes, and this record carries no cwd
  db.upsertSession(D, { id: 'S1', folderId: 'F', gitBranch: 'feat/x' })
  const row = D.prepare('SELECT * FROM sessions WHERE id = ?').get('S1')
  assert.equal(row.git_branch, 'feat/x', 'the newer branch wins')
  assert.equal(row.cwd, '/a', 'COALESCE keeps what the newer record did not carry')
  assert.equal(row.entrypoint, 'cli')
})

test('a session with no id or no folder is not recorded', t => {
  const D = fresh(t)
  assert.equal(db.upsertSession(D, { id: null, folderId: 'F', gitBranch: 'main' }), false)
  assert.equal(db.upsertSession(D, { id: 'S', folderId: null, gitBranch: 'main' }), false)
  assert.equal(D.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
})

test('sessions() reports context beside the counts, and a session with none still appears', t => {
  const D = fresh(t)
  db.insertEvent(D, { folderId: 'F', ts: 10, kind: 'tool', actor: 'claude', sessionId: 'S1', tool: 'Bash' })
  db.insertEvent(D, { folderId: 'F', ts: 20, kind: 'tool', actor: 'claude', sessionId: 'S2', tool: 'Bash' })
  db.upsertSession(D, { id: 'S1', folderId: 'F', gitBranch: 'main', cwd: '/repo' })

  const rows = db.sessions(D, 'F')
  const s1 = rows.find(r => r.id === 'S1')
  const s2 = rows.find(r => r.id === 'S2')
  assert.equal(s1.gitBranch, 'main')
  assert.equal(s1.cwd, '/repo')
  assert.equal(s1.events, 1)
  // the LEFT JOIN is what keeps this row present rather than dropping it
  assert.equal(s2.gitBranch, null, 'a session we never saw context for is still listed')
  assert.equal(s2.events, 1)
})

test('two sessions on different branches stay distinct — the worktree case', t => {
  const D = fresh(t)
  db.insertEvent(D, { folderId: 'F', ts: 10, kind: 'modified', actor: 'claude', sessionId: 'A', path: 'src/api.ts' })
  db.insertEvent(D, { folderId: 'F', ts: 11, kind: 'modified', actor: 'claude', sessionId: 'B', path: 'src/api.ts' })
  db.upsertSession(D, { id: 'A', folderId: 'F', gitBranch: 'main', cwd: '/repo' })
  db.upsertSession(D, { id: 'B', folderId: 'F', gitBranch: 'admin-api-split', cwd: '/repo/.claude/worktrees/admin-api-split' })
  const byId = Object.fromEntries(db.sessions(D, 'F').map(r => [r.id, r]))
  assert.notEqual(byId.A.gitBranch, byId.B.gitBranch,
    'same relative path, two branches — which is the whole reason to store cwd and branch')
})

test('a session carries its Claude Code name, and a rename replaces it', t => {
  const D = fresh(t)
  db.upsertSession(D, { id: 'S1', folderId: 'F', aiTitle: 'Unrendered md code' })
  assert.equal(D.prepare('SELECT ai_title AS n FROM sessions WHERE id=?').get('S1').n, 'Unrendered md code')
  // a later record carries context but no title — the name must survive it
  db.upsertSession(D, { id: 'S1', folderId: 'F', gitBranch: 'main' })
  assert.equal(D.prepare('SELECT ai_title AS n FROM sessions WHERE id=?').get('S1').n, 'Unrendered md code')
  // Claude Code retitles a session as it goes
  db.upsertSession(D, { id: 'S1', folderId: 'F', aiTitle: 'Documentation into docs' })
  assert.equal(D.prepare('SELECT ai_title AS n FROM sessions WHERE id=?').get('S1').n, 'Documentation into docs')
})

test('sessions() returns the name, null when Claude Code has not chosen one yet', t => {
  const D = fresh(t)
  db.insertEvent(D, { folderId: 'F', ts: 10, kind: 'tool', actor: 'claude', sessionId: 'named', tool: 'Bash' })
  db.insertEvent(D, { folderId: 'F', ts: 11, kind: 'tool', actor: 'claude', sessionId: 'unnamed', tool: 'Bash' })
  db.upsertSession(D, { id: 'named', folderId: 'F', aiTitle: 'Formatting proposal' })
  const byId = Object.fromEntries(db.sessions(D, 'F').map(r => [r.id, r]))
  assert.equal(byId.named.aiTitle, 'Formatting proposal')
  assert.equal(byId.unnamed.aiTitle, null, 'a young session has no name — shown as none, not guessed')
})
