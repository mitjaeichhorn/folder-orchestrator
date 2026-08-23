import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileDiff } from './diff.js'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' })

function repo (t) {
  const d = mkdtempSync(join(tmpdir(), 'orchd-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  git(d, 'init', '-q')
  git(d, 'config', 'user.email', 'x@y.z')
  git(d, 'config', 'user.name', 'x')
  return { id: 'F', path: d, ignore: [] }
}

test('a file changed outside any tool still diffs, via git', async t => {
  const f = repo(t)
  writeFileSync(join(f.path, 'a.txt'), 'one\ntwo\n')
  git(f.path, 'add', '.'); git(f.path, 'commit', '-qm', 'init')
  appendFileSync(join(f.path, 'a.txt'), 'three\n')       // nobody's Edit tool did this
  const d = await fileDiff(f, 'a.txt')
  assert.equal(d.available, true)
  assert.equal(d.source, 'git')
  assert.match(d.text, /^\+three$/m)
})

test('a committed-but-unmodified file reports no changes rather than a fake diff', async t => {
  const f = repo(t)
  writeFileSync(join(f.path, 'a.txt'), 'one\n')
  git(f.path, 'add', '.'); git(f.path, 'commit', '-qm', 'init')
  const d = await fileDiff(f, 'a.txt')
  assert.equal(d.available, false)
  assert.equal(d.reason, 'NO_CHANGES')
})

test('an untracked new file diffs against nothing', async t => {
  const f = repo(t)
  writeFileSync(join(f.path, 'seed.txt'), 'x')
  git(f.path, 'add', '.'); git(f.path, 'commit', '-qm', 'init')
  writeFileSync(join(f.path, 'brand-new.txt'), 'hello\n')
  const d = await fileDiff(f, 'brand-new.txt')
  assert.equal(d.available, true)
  assert.equal(d.against, 'untracked')
  assert.match(d.text, /\+hello/)
})

test('a deleted file still diffs — missing bytes are not a missing diff', async t => {
  const f = repo(t)
  writeFileSync(join(f.path, 'gone.txt'), 'bye\n')
  git(f.path, 'add', '.'); git(f.path, 'commit', '-qm', 'init')
  rmSync(join(f.path, 'gone.txt'))
  const d = await fileDiff(f, 'gone.txt')
  assert.equal(d.available, true)
  assert.match(d.text, /-bye/)
})

test('a non-repo folder says so instead of erroring', async t => {
  const d = mkdtempSync(join(tmpdir(), 'orchd-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  writeFileSync(join(d, 'a.txt'), 'x')
  const r = await fileDiff({ id: 'F', path: d, ignore: [] }, 'a.txt')
  assert.equal(r.available, false)
  assert.equal(r.reason, 'NOT_A_REPO')
})

test('traversal out of the folder is refused before git is asked anything', async t => {
  const f = repo(t)
  const r = await fileDiff(f, '../../../etc/passwd')
  assert.equal(r.available, false)
  assert.equal(r.reason, 'OUTSIDE')
})

test('a filename that looks like a flag is not treated as one', async t => {
  const f = repo(t)
  writeFileSync(join(f.path, 'seed.txt'), 'x')
  git(f.path, 'add', '.'); git(f.path, 'commit', '-qm', 'init')
  const r = await fileDiff(f, '--upload-pack=touch /tmp/pwned')
  assert.equal(r.available, false, 'must not execute, must not throw')
})

test('a huge diff is truncated and says so', async t => {
  const f = repo(t)
  writeFileSync(join(f.path, 'big.txt'), 'seed\n')
  git(f.path, 'add', '.'); git(f.path, 'commit', '-qm', 'init')
  writeFileSync(join(f.path, 'big.txt'), Array.from({ length: 40000 }, (_, i) => `line ${i}`).join('\n'))
  const d = await fileDiff(f, 'big.txt')
  assert.equal(d.available, true)
  assert.equal(d.truncated, true)
  assert.ok(d.text.length <= 200 * 1024)
})

test('a subdirectory path diffs correctly', async t => {
  const f = repo(t)
  mkdirSync(join(f.path, 'apps/docs'), { recursive: true })
  writeFileSync(join(f.path, 'apps/docs/touchpoints.md'), 'a\n')
  git(f.path, 'add', '.'); git(f.path, 'commit', '-qm', 'init')
  writeFileSync(join(f.path, 'apps/docs/touchpoints.md'), 'a\nb\n')
  const d = await fileDiff(f, 'apps/docs/touchpoints.md')
  assert.equal(d.available, true)
  assert.match(d.text, /\+b/)
})
