import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segmentsOf, sharesPrefix, prefixDepth } from '../src/features/shared/path-prefix.ts'

test('each segment carries everything up to and including itself', () => {
  const s = segmentsOf('a/b/c.ts')
  assert.deepEqual(s.map(x => x.prefix), ['a', 'a/b', 'a/b/c.ts'])
  assert.deepEqual(s.map(x => x.name), ['a', 'b', 'c.ts'])
})

test('only the last segment is the file', () => {
  const s = segmentsOf('a/b/c.ts')
  assert.deepEqual(s.map(x => x.isFile), [false, false, true])
  assert.deepEqual(segmentsOf('README.md').map(x => x.isFile), [true])
})

test('a prefix matches whole segments, never a leading substring', () => {
  // these trees are full of names sharing a first word — startsWith would be wrong
  assert.equal(sharesPrefix('apps/service_alpha/x.py', 'apps/app'), false)
  assert.equal(sharesPrefix('apps/service_alpha/x.py', 'apps/service_alpha'), true)
  assert.equal(sharesPrefix('apps/service_alpha', 'apps/service_alpha'), true,
    'the folder itself is under itself')
})

test('a sibling branch does not match', () => {
  assert.equal(sharesPrefix('a/b/c.ts', 'a/x'), false)
  assert.equal(sharesPrefix('a/b/c.ts', 'a/b'), true)
})

test('depth says how many leading segments to highlight', () => {
  assert.equal(prefixDepth('a/b/c/d.ts', 'a/b'), 2)
  assert.equal(prefixDepth('a/b/c/d.ts', 'a/b/c'), 3)
  assert.equal(prefixDepth('a/b/c/d.ts', 'z'), 0, 'no match, nothing to highlight')
})

test('empty and absent inputs are safe', () => {
  assert.deepEqual(segmentsOf(''), [])
  assert.equal(sharesPrefix('a/b.ts', null), false)
  assert.equal(sharesPrefix('', 'a'), false)
  assert.equal(prefixDepth('a/b.ts', undefined), 0)
})
