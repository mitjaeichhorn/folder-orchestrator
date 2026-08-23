import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTree } from './tree.js'
import { countsForLineAlert, LINE_ALERT_AT, LINE_ALERT_EXEMPT } from '../shared/glob.js'

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

test('python, markdown, json and html are exempt however long they are', () => {
  for (const ext of ['.py', '.pyi', '.md', '.markdown', '.json', '.jsonl', '.html', '.htm']) {
    assert.equal(countsForLineAlert(`a/b${ext}`), false, ext)
    assert.equal(countsForLineAlert(`a/b${ext.toUpperCase()}`), false, `${ext} uppercase`)
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
  assert.equal(byName['big.py'].l, undefined, 'python is exempt, so it is never measured')
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
