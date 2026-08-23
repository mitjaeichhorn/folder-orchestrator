# T04 — Rate ceiling and status frames

## What
Backpressure: collapse event storms into summary rows, and emit the per-folder `status` frame the
sidebar reads.

## Dependencies
- Types: `Event` (`detail.collapsed`), the `status` SSE frame — contract doc
- Services: `emit` / `send` (Epic 00 T04), `log` (Epic 00 T03)
- Primitives: none
- Context: none
- Platform: none

## Files
- Modify: `server/watcher.js`

## How
Per folder, a ring of the last 10s of event timestamps. Above 500 in 10s, enter collapsed mode:
stop emitting individual rows, emit one `modified` per second with `detail.collapsed: N` and
`path: null`. Leave collapsed mode when the rate falls below the threshold for 2 consecutive
seconds. Log entry and exit with the dropped count — **a silently thinned feed reads as "nothing
happened", which is the one failure the operator cannot detect.**
`status` frame every 2s per folder: `{folderId, watching, fileCount, eventsPerMin}` via
`bus.send(folderId,'status',…)`. Only when subscribers exist — no work for an unwatched tab.

## Definition of Done
- [ ] 600 synthetic events in 10s → collapsed frames, not 600 rows
- [ ] Collapsed frames carry an accurate `detail.collapsed` count summing to the real total
- [ ] Mode exits after 2 quiet seconds and individual rows resume
- [ ] Entry and exit both logged with counts
- [ ] `status` arrives every 2s while subscribed, and stops when the last subscriber leaves
- [ ] `eventsPerMin` matches a manual count over a 60s window within ±5%

## Activation Task
Real `npm ci` in a watched folder with the deny-list temporarily disabled (to force a genuine
storm). Confirm collapsed frames, then `grep rate_ceiling logs/orchestrator.jsonl` and paste the
counts into `../EPIC.md`.
