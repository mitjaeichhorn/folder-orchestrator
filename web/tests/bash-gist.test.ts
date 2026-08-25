import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bashGist } from '../src/features/feed/bash-gist.ts'

// The measured case: every Bash row in the feed opened with a `cd` into the
// project and an `echo` banner, so the truncated label showed only scaffolding.
test('the verb survives truncation; the scaffolding does not', () => {
  const cmd = 'cd /home/dev/work/demo-app; echo "=== index.ts ==="; '
    + 'git show feat/some-branch:admin/src/lib/api/index.ts'
  const gist = bashGist(cmd)
  assert.ok(gist.startsWith('git show'), gist)
  assert.ok(!gist.includes('cd '), 'the folder is already named by the row')
})

test('a stripped segment is counted, never silently dropped', () => {
  assert.equal(bashGist('ls -la; wc -l api.ts'), 'ls -la  +1')
})

test('a variable name in front of the verb is scaffolding too', () => {
  assert.equal(bashGist('MB=$(git merge-base HEAD feat/x)'), 'git merge-base HEAD feat/x')
})

test('a command that is only scaffolding still says something', () => {
  assert.equal(bashGist('cd /tmp'), 'cd /tmp')
})

test('a heredoc body is data, not twenty-one commands', () => {
  // Measured on live rows: this read as `python3 - <<'EOF'  +21`.
  const cmd = "python3 - <<'EOF'\nimport os\nfor a in b:\n  print(a)\nEOF"
  assert.equal(bashGist(cmd), "python3 - <<'EOF'")
})
