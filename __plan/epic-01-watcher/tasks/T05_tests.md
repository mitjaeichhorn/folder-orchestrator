# T05 — Watcher tests and activation

## What
`node:test` suite for T01–T04 and the epic's activation run on the real 21k-file project.

## Dependencies
- Types: `Event`, `Folder` — contract doc
- Services: `ignore`, `normalise`, `watcher` (T01–T04)
- Primitives: none
- Context: none
- Platform: real temp dirs under `os.tmpdir()` and **real `fs.watch`** — the OS behaviour is what
  is under test, so it must not be mocked. Injected `statFn`/`now()` are for the decision logic only.

## Files
- Create: `server/watcher.test.js`

## How
Cover exactly the Level 1 list in `../EPIC.md`. Each filesystem test gets its own temp root,
removed in `t.after`.
`fs.watch` is asynchronous and the OS coalesces: assert with a bounded wait-for-condition helper
(poll to 2s), never a fixed `sleep`, or the suite is flaky on a loaded machine.
Ordering assertion (ignore before stat) uses a spied `statFn` — that ordering is a performance
invariant and a refactor will silently break it.

## Definition of Done
- [ ] `npm test` → 0 failures; every DoD checkbox in `../EPIC.md` maps to at least one test
- [ ] No fixed sleeps; all waits are condition-polled
- [ ] Suite passes 10 consecutive runs (`for i in {1..10}; do npm test || break; done`)
- [ ] Temp dirs cleaned up — `ls $TMPDIR | grep orch` empty after the run

## Activation Task
The epic's three activation rows executed against the real 21,734-file project. Paste the event
count, the zero-events-during-`npm install` result, and the RSS number into `../EPIC.md` under
`## Activation Evidence`.
