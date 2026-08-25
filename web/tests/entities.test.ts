import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recurring, namesIn, splitOn } from '../src/features/feed/entities.ts'

// The measured case: fourteen consecutive Bash rows from one investigation, which
// rendered as fourteen unrelated grey lines because the names tying them together
// sat at a different offset in every row.
const RUN = [
  'cd /home/dev/work/demo-app; echo "=== package.json scripts (split branch) ==="; git show feat/some-branch:admin/package.json',
  'The stale _EXCLUSIVE_ACCEPT pointers',
  'cd /home/dev/work/demo-app; echo "=== uncommitted api.ts diff on HEAD ==="; git diff -- admin/src/lib/api.ts | head -40',
  'cd /home/dev/work/demo-app; echo "=== legacy.ts head ==="; git show feat/some-branch:admin/src/lib/api/legacy.ts | head',
  'cd /home/dev/work/demo-app; echo "=== index.ts ==="; git show feat/some-branch:admin/src/lib/api/index.ts',
  'Every reference to the deleted gate',
  'cd /home/dev/work/demo-app; MB=$(git merge-base HEAD feat/some-branch); echo "merge-base: $(git log --oneline -1 $MB)"',
  'echo "=== exported consts in api.ts ==="; grep -n \'^export const \\|^export function \' admin/src/lib/api.ts',
  'git branch -a --contains f8cf9735 2>/dev/null; echo "--- current branch merge-base ---"; git log --oneline -1 f8cf9735',
  'git log --oneline -8 -- admin/src/lib/api.ts; echo "--- branches with lib/api ---"; git branch -a',
  'The stale _EXCLUSIVE_ACCEPT pointers again after the rebase',
]

test('the names threaded through the run are the ones that surface', () => {
  const marks = recurring(RUN)
  assert.ok(marks.includes('feat/some-branch'), marks.join(' | '))
  assert.ok(marks.includes('admin/src/lib/api.ts'), marks.join(' | '))
  assert.ok(marks.includes('_EXCLUSIVE_ACCEPT'), marks.join(' | '))
})

test('a name in exactly one row is not a thread', () => {
  // package.json and legacy.ts each appear once in the run above.
  const marks = recurring(RUN)
  assert.ok(!marks.includes('admin/package.json'), 'one row is a coincidence, not a link')
  assert.ok(!marks.includes('admin/src/lib/api/legacy.ts'))
})

test('counting is by row, not by occurrence', () => {
  // Three mentions, one row: says nothing about what the run was about.
  const once = ['api/thing.ts api/thing.ts api/thing.ts', 'unrelated']
  assert.deepEqual(recurring(once), [])
})

test('verbs, flags and prose never qualify — only name shapes do', () => {
  assert.deepEqual(namesIn('git diff --stat -- HEAD'), ['HEAD'])
  assert.deepEqual(namesIn('checking the deleted gate for stale pointers'), [])
})

test('splitOn is loss-free, whatever it marks', () => {
  const label = 'git show feat/some-branch:admin/src/lib/api.ts'
  const parts = splitOn(label, recurring(RUN))
  assert.equal(parts.map(p => p.t).join(''), label, 'a highlight must never eat a character')
  assert.ok(parts.some(p => p.mark), 'and it must actually mark something here')
})

test('no marks means one unmarked part, not an empty render', () => {
  assert.deepEqual(splitOn('ls -la', []), [{ t: 'ls -la', mark: false }])
})
