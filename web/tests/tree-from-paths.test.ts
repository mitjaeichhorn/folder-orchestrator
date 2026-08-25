import { test } from 'node:test'
import assert from 'node:assert/strict'
import { treeFromPaths } from '../src/features/heat/tree-from-paths.ts'

test('nested paths become a tree, with shared prefixes merged', () => {
  const t = treeFromPaths(['a/b/c.ts', 'a/b/d.ts', 'a/e.ts'])
  assert.equal(t.length, 1)
  assert.equal(t[0].p, 'a')
  assert.equal(t[0].d, 1)
  const b = t[0].c!.find(n => n.n === 'b')!
  assert.equal(b.d, 1)
  assert.deepEqual(b.c!.map(n => n.n), ['c.ts', 'd.ts'])
  assert.ok(t[0].c!.some(n => n.n === 'e.ts' && n.d === 0))
})

test('every node carries its full path, which is what heat is keyed on', () => {
  const t = treeFromPaths(['pipeline/tests/unit/test_x.py'])
  const walk = (ns: any[], out: string[] = []): string[] => {
    for (const n of ns) { out.push(n.p); if (n.c) walk(n.c, out) }
    return out
  }
  assert.deepEqual(walk(t), [
    'pipeline',
    'pipeline/tests',
    'pipeline/tests/unit',
    'pipeline/tests/unit/test_x.py'
  ])
})

test('directories sort before files, matching the server walk', () => {
  const t = treeFromPaths(['z.ts', 'a/b.ts'])
  assert.deepEqual(t.map(n => n.n), ['a', 'z.ts'])
})

test('a path that is also a prefix of another becomes a directory', () => {
  // a mkdir event and then a file inside it
  const t = treeFromPaths(['docs', 'docs/plan.md'])
  assert.equal(t[0].d, 1)
  assert.equal(t[0].c!.length, 1)
})

test('empty, duplicate and leading-slash paths do not break the shape', () => {
  const t = treeFromPaths(['a/b.ts', 'a/b.ts', '', '/a/c.ts'])
  assert.equal(t.length, 1)
  assert.deepEqual(t[0].c!.map(n => n.n).sort(), ['b.ts', 'c.ts'])
})

test('no cap: the tree covers every path it is given', () => {
  // The whole point — the server tree is capped and truncated exactly where the
  // active files were, so this path must never be lossy.
  const many = Array.from({ length: 5000 }, (_, i) => `pkg${i % 50}/sub/file${i}.ts`)
  const t = treeFromPaths(many)
  const count = (ns: any[]): number => ns.reduce((n, x) => n + 1 + (x.c ? count(x.c) : 0), 0)
  assert.equal(t.length, 50)
  assert.equal(count(t), 50 + 50 + 5000, 'every directory and file present')
})
