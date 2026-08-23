import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTree } from './tree.js'
import {
  countsForLineAlert, LINE_ALERT_AT, LINE_ALERT_EXEMPT,
  LINE_MEASURE_EXEMPT, LINE_BADGE_EXEMPT, isExecutablePath, isBadgeExempt
} from '../shared/glob.js'

const tmp = t => {
  const d = mkdtempSync(join(tmpdir(), 'orchl-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  return d
}
const lines = n => 'x'.repeat(20).concat('\n').repeat(n)
const filesOf = (nodes, out = []) => {
  for (const n of nodes ?? []) n.d === 0 ? out.push(n) : filesOf(n.c, out)
  return out
}

test('markdown, json and html are never measured; all four stay unbadged', () => {
  for (const ext of ['.md', '.markdown', '.json', '.jsonl', '.html', '.htm']) {
    assert.equal(countsForLineAlert(`a/b${ext}`), false, ext)
    assert.equal(countsForLineAlert(`a/b${ext.toUpperCase()}`), false, `${ext} uppercase`)
  }
  for (const ext of ['.py', '.pyi', '.md', '.json', '.jsonl', '.html']) {
    assert.equal(isBadgeExempt(`a/b${ext}`), true, `${ext} must not carry the default badge`)
  }
  assert.deepEqual([...LINE_ALERT_EXEMPT].sort(), [...new Set(LINE_ALERT_EXEMPT)].sort(),
    'a duplicated extension means two people added the same exemption')
})

test('source files are measured', () => {
  for (const p of ['a/b.ts', 'a/b.tsx', 'a/b.js', 'x.css', 'x.go']) {
    assert.equal(countsForLineAlert(p), true, p)
  }
})

test('a file with no extension is not judged', () => {
  // Makefile, LICENSE, a shell script without a suffix — nothing to reason about.
  assert.equal(countsForLineAlert('Makefile'), false)
  assert.equal(countsForLineAlert(''), false)
  assert.equal(countsForLineAlert(null), false)
})

test('the tree reports a line count only for files over the threshold path', t => {
  const d = tmp(t)
  writeFileSync(join(d, 'big.ts'), lines(LINE_ALERT_AT + 5))
  writeFileSync(join(d, 'small.ts'), lines(10))
  writeFileSync(join(d, 'big.py'), lines(LINE_ALERT_AT + 5))
  writeFileSync(join(d, 'big.json'), lines(LINE_ALERT_AT + 5))
  const byName = Object.fromEntries(
    filesOf(buildTree({ id: 'f', path: d }).children).map(n => [n.n, n]))

  assert.equal(byName['big.ts'].l, LINE_ALERT_AT + 5, 'a long source file is counted')
  assert.equal(byName['big.py'].l, LINE_ALERT_AT + 5, 'python is measured, just not badged')
  assert.equal(byName['big.json'].l, undefined, 'json is exempt')
  // small.ts is under the byte prefilter, so it is legitimately unmeasured —
  // absent means "not judged", which the client must not read as "short".
  assert.equal(byName['small.ts'].l, undefined)
})

test('a binary file is skipped rather than having its NUL bytes counted', t => {
  const d = tmp(t)
  const buf = Buffer.alloc(50_000)
  for (let i = 0; i < buf.length; i++) buf[i] = i % 256      // includes 0x00 and 0x0a
  writeFileSync(join(d, 'blob.bin'), buf)
  const [node] = filesOf(buildTree({ id: 'f', path: d }).children)
  assert.equal(node.l, undefined, 'binary noise must not be reported as ~195 lines')
})

test('the byte prefilter cannot produce a false negative', t => {
  // A file of N lines is at least N bytes, so skipping under LINE_ALERT_AT bytes
  // can never hide a file over LINE_ALERT_AT lines. The tightest possible case:
  // every line empty.
  const d = tmp(t)
  writeFileSync(join(d, 'tight.ts'), '\n'.repeat(LINE_ALERT_AT + 1))
  const [node] = filesOf(buildTree({ id: 'f', path: d }).children)
  assert.equal(node.l, LINE_ALERT_AT + 1)
})

test('the count survives a subdirectory walk', t => {
  const d = tmp(t)
  mkdirSync(join(d, 'src'))
  writeFileSync(join(d, 'src', 'deep.ts'), lines(LINE_ALERT_AT + 1))
  const [node] = filesOf(buildTree({ id: 'f', path: d }).children)
  assert.equal(node.p, 'src/deep.ts')
  assert.equal(node.l, LINE_ALERT_AT + 1)
})

test('python is measured even though it is not badged by default', () => {
  // The two lists exist precisely so the executables filter can show long python
  // while the default view keeps the operator's "except python" rule.
  assert.equal(countsForLineAlert('a/b.py'), true, 'must be counted')
  assert.equal(isBadgeExempt('a/b.py'), true, 'must not be badged by default')
  assert.equal(isExecutablePath('a/b.py'), true, 'must appear under executables')
})

test('the executable list is code, not markup, styles, data or locks', () => {
  for (const p of ['a.ts', 'a.tsx', 'a.js', 'a.py', 'a.go', 'a.rs', 'a.sh', 'a.rb', 'a.php']) {
    assert.equal(isExecutablePath(p), true, p)
  }
  // measured on prj04-ecommerce: these are what the filter exists to drop —
  // four vendored base.css copies and a lock file, long because generated.
  for (const p of ['assets/base.css', 'uv.lock', 'sections/section.liquid',
                   'x.json', 'x.md', 'x.html', 'x.yaml', 'x.svg', 'x.toml']) {
    assert.equal(isExecutablePath(p), false, p)
  }
})

test('a dot in a directory name is not an extension', () => {
  assert.equal(isExecutablePath('my.dir/README'), false)
  assert.equal(countsForLineAlert('my.dir/README'), false)
  assert.equal(isExecutablePath('my.dir/run.sh'), true)
})

test('the exempt lists do not overlap — a file is measured or it is not', () => {
  const overlap = LINE_MEASURE_EXEMPT.filter(e => LINE_BADGE_EXEMPT.includes(e))
  assert.deepEqual(overlap, [], 'an extension in both lists is measured and unbadged by accident')
})

test('a long python file gets a count in the tree', t => {
  const d = tmp(t)
  writeFileSync(join(d, 'big.py'), lines(LINE_ALERT_AT + 3))
  writeFileSync(join(d, 'big.md'), lines(LINE_ALERT_AT + 3))
  const byName = Object.fromEntries(
    filesOf(buildTree({ id: 'f', path: d }).children).map(n => [n.n, n]))
  assert.equal(byName['big.py'].l, LINE_ALERT_AT + 3, 'python is now counted')
  assert.equal(byName['big.md'].l, undefined, 'markdown still is not')
})
