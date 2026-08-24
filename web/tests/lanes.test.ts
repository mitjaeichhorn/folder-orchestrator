import { test } from 'node:test'
import assert from 'node:assert/strict'
import { laneOf, laneProfile, LANES, LANE_TONE } from '../src/features/lanes.ts'

test('a pathless event is the spine, not a lane', () => {
  // Bash, MCP calls and prompts name no file — 53% of events on this project.
  assert.equal(laneOf(null), 'spine')
  assert.equal(laneOf(undefined), 'spine')
  assert.equal(laneOf(''), 'spine')
})

test('tests are recognised by directory, suffix and conftest', () => {
  for (const p of [
    'web/tests/lanes.test.ts', 'server/db.test.js', 'src/__tests__/App.tsx',
    'a/b.spec.ts', 'import-pipeline/tests/unit/x.py', 'apps/tests/conftest.py'
  ]) assert.equal(laneOf(p), 'test', p)
})

test('planning is docs and markdown', () => {
  for (const p of ['__plan/epic-01/EPIC.md', 'docs/architecture.md', 'README.md',
                   '__documentation/source-of-truth/event-contract.md', 'specs/listing.md'])
    assert.equal(laneOf(p), 'planning', p)
})

test('everything else with a path is work', () => {
  for (const p of ['server/watcher.js', 'web/src/App.tsx', 'shared/glob.js',
                   'assets/base.css', 'apps/internal/routes.py'])
    assert.equal(laneOf(p), 'work', p)
})

test('a markdown file inside a test directory is a test, not a plan', () => {
  // Order matters: TEST_RE runs first precisely so a fixture does not read as
  // a plan and quietly inflate the planning lane.
  assert.equal(laneOf('web/tests/fixtures/sample.md'), 'test')
})

test('a doc-looking name that is really source stays in work', () => {
  assert.equal(laneOf('src/documentation.ts'), 'work', 'substring, not a directory')
  assert.equal(laneOf('src/markdown.tsx'), 'work')
})

test('the profile counts every event exactly once', () => {
  const events = [
    { path: 'docs/a.md' }, { path: 'server/x.js' }, { path: 'web/tests/y.test.ts' },
    { path: null }, { path: null }
  ]
  const p = laneProfile(events)
  assert.deepEqual(p, { planning: 1, work: 1, test: 1, spine: 2 })
  assert.equal(Object.values(p).reduce((a, b) => a + b, 0), events.length)
})

test('every lane has a tone, and the spine is not one of the columns', () => {
  for (const l of LANES) assert.ok(LANE_TONE[l], l)
  assert.equal(LANES.includes('spine' as never), false, 'the spine spans, it does not sit in a column')
  assert.ok(LANE_TONE.spine)
})

test('every mainstream test convention is recognised, not just the JS ones', () => {
  // The first rule knew only .test./.spec./tests/ and passed here by luck: this
  // repo's python tests happen to sit under tests/. Against the wider tree it
  // filed 18 real test files as work.
  for (const p of [
    'apps/foo/test_runner.py',        // pytest, outside a tests dir
    '__tools/apr/test_apr_isolation.py',
    'pkg/handler_test.go',            // go
    'lib/user_spec.rb',               // rspec by suffix
    'spec/models/user_spec.rb',       // rspec by directory
    'src/UserTest.java',              // junit
    'src/UserTest.kt',
    'web/src/thing_test.ts'
  ]) assert.equal(laneOf(p), 'test', p)
})

test('"test" as a substring never makes something a test', () => {
  // Anchored to path segments and extensions, never a bare substring.
  assert.equal(laneOf('src/latest/index.ts'), 'work', 'latest/ is not tests/')
  assert.equal(laneOf('web/src/features/contest.ts'), 'work')
  assert.equal(laneOf('server/protest.js'), 'work')
})

test('specs/ is planning but spec/ is rspec — singular and plural differ', () => {
  // Plural is almost always written specifications; singular is a test suite.
  assert.equal(laneOf('specs/dissolve-deploy-to-store/listing.md'), 'planning')
  assert.equal(laneOf('spec/models/user_spec.rb'), 'test')
})

test('a document about testing is planning, not a test', () => {
  assert.equal(laneOf('docs/testing-doctrine.md'), 'planning')
  assert.equal(laneOf('__documentation/test-scenarios.md'), 'planning')
})
