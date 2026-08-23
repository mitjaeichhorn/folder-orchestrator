# T06 — Spine tests and activation

## What
`node:test` suite covering T02–T05, and the epic's activation run.

## Dependencies
- Types: `Event`, `Folder` — contract doc
- Services: `db`, `log`, `bus`, `server` (T02–T05)
- Primitives: none
- Context: none
- Platform: temp dirs under `os.tmpdir()`; no network beyond loopback

## Files
- Create: `server/spine.test.js`

## How
`node:test` + `node:assert/strict`, no framework. Fresh temp db per test via `t.after` cleanup.
Cover exactly the Level 1 list in `../EPIC.md` — schema idempotence, event round-trip per kind,
`listEvents` paging, folder CRUD error codes, bus fan-out + isolation + dead-sink removal,
retention boundary at 29/31 days.
Clock-dependent tests inject a `now()` — never `Date.now()` directly, or the retention boundary
test is flaky at midnight.
SSE tested against a real loopback server with a real `http.get`, asserting on the raw frame text.

## Definition of Done
- [ ] `npm test` → 0 failures, and every DoD checkbox in `../EPIC.md` maps to at least one test
- [ ] No test depends on wall-clock time or on test execution order
- [ ] Suite runs in under 10s
- [ ] Deleting `data/` and rerunning still passes (no fixture state carried between runs)

## Activation Task
The epic's Activation Task table, both rows, executed. Paste the `curl -sN` output and the
`select count(*)` result into `../EPIC.md` under a `## Activation Evidence` heading.
