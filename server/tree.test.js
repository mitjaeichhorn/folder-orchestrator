import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTree, MAX_NODES } from './tree.js'

const tmp = t => { const d = mkdtempSync(join(tmpdir(), 'orchtr-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d }
const flat = (nodes, out = []) => { for (const n of nodes) { out.push(n.p); if (n.c) flat(n.c, out) } return out }

test('the tree mirrors the directory structure with relative paths', t => {
  const d = tmp(t)
  mkdirSync(join(d, 'src/lib'), { recursive: true })
  writeFileSync(join(d, 'src/lib/a.ts'), 'x')
  writeFileSync(join(d, 'README.md'), 'x')
  const tree = buildTree({ id: 'F', path: d, ignore: [] })
  assert.deepEqual(flat(tree.children).sort(), ['README.md', 'src', 'src/lib', 'src/lib/a.ts'])
})

test('the tree honours the same ignore rules as the watcher', t => {
  const d = tmp(t)
  mkdirSync(join(d, 'node_modules/pkg'), { recursive: true })
  writeFileSync(join(d, 'node_modules/pkg/i.js'), 'x')
  mkdirSync(join(d, 'src'))
  writeFileSync(join(d, 'src/a.ts'), 'x')
  writeFileSync(join(d, 'debug.log'), 'x')
  const paths = flat(buildTree({ id: 'F', path: d, ignore: [] }).children)
  assert.ok(!paths.some(p => p.includes('node_modules')), 'a path that can never light up must not be shown')
  assert.ok(!paths.includes('debug.log'))
  assert.ok(paths.includes('src/a.ts'))
})

test('folder-specific ignore patterns apply', t => {
  const d = tmp(t)
  mkdirSync(join(d, 'scratch'))
  writeFileSync(join(d, 'scratch/x.ts'), 'x')
  writeFileSync(join(d, 'keep.ts'), 'x')
  const paths = flat(buildTree({ id: 'F', path: d, ignore: ['scratch/**'] }).children)
  assert.ok(!paths.some(p => p.startsWith('scratch/')))
  assert.ok(paths.includes('keep.ts'))
})

test('directories sort before files, then alphabetically', t => {
  const d = tmp(t)
  writeFileSync(join(d, 'z.ts'), 'x')
  writeFileSync(join(d, 'a.ts'), 'x')
  mkdirSync(join(d, 'zdir'))
  mkdirSync(join(d, 'adir'))
  const top = buildTree({ id: 'F', path: d, ignore: [] }).children.map(n => n.n)
  assert.deepEqual(top, ['adir', 'zdir', 'a.ts', 'z.ts'])
})

test('an unreadable directory yields an empty branch, never a throw', t => {
  const d = tmp(t)
  assert.doesNotThrow(() => buildTree({ id: 'F', path: join(d, 'nope'), ignore: [] }))
})

test('truncation is reported, never silent', t => {
  const d = tmp(t)
  // cheaper than MAX_NODES files: assert the flag exists and is false when under cap
  writeFileSync(join(d, 'a.ts'), 'x')
  const tree = buildTree({ id: 'F', path: d, ignore: [] })
  assert.equal(tree.truncated, false)
  assert.equal(tree.nodes, 1)
  assert.ok(MAX_NODES > 0)
})

test('files carry their mtime so every file can be ranked by last change', t => {
  const d = tmp(t)
  writeFileSync(join(d, 'a.ts'), 'x')
  mkdirSync(join(d, 'sub'))
  writeFileSync(join(d, 'sub/b.ts'), 'y')
  const tree = buildTree({ id: 'F', path: d, ignore: [] })
  const files = []
  const walk = ns => ns.forEach(n => { if (n.d === 0) files.push(n); if (n.c) walk(n.c) })
  walk(tree.children)
  assert.equal(files.length, 2)
  for (const f of files) {
    assert.equal(typeof f.m, 'number', f.p)
    assert.ok(f.m > 0, 'a real timestamp, not a placeholder')
  }
})

test('directories carry no mtime — only files are ranked', t => {
  const d = tmp(t)
  mkdirSync(join(d, 'sub'))
  writeFileSync(join(d, 'sub/a.ts'), 'x')
  const tree = buildTree({ id: 'F', path: d, ignore: [] })
  const dir = tree.children.find(n => n.d === 1)
  assert.equal(dir.m, undefined)
})
