# T02 — Event normalisation

## What
`normalise(rawType, relPath, folder, seen)` → `{kind, detail} | null`. Turns the OS's
`rename`/`change` into the contract's five filesystem kinds.

## Dependencies
- Types: `Event` (`kind`, `detail`) — contract doc
- Services: `node:fs` (`statSync`), `shouldIgnore` (T01), `log` (Epic 00 T03)
- Primitives: none
- Context: none
- Platform: **macOS only** — `fs.watch` emits only `rename` and `change`, and neither means what
  its name says. This whole task exists because of that.

## Files
- Create: `server/normalise.js`

## How
Order is load-bearing: `shouldIgnore` → debounce → `statSync` → decide. Never stat an ignored path.
- `statSync` throws `ENOENT` → `deleted`
- stat ok, `seen` set lacks the path → `created`, add to `seen`, `detail: {size, mtime}`
- stat ok, path in `seen` → `modified`, `detail: {size, mtime}`
- stat throws anything else → `null`, `ERROR stat_failed`
Rename collapse: keep a 100ms window of pending `deleted`; a `created` whose basename matches a
pending `deleted` collapses to `renamed` with `detail.oldPath`, cancelling both.
Debounce: 50ms trailing per path, `Map<path, Timeout>`, cleared on fire. Assert the map empties.
Inject `statFn` and `now()` for tests — never call `Date.now()` or `fs.statSync` directly from the
decision function.
Log every decision at DEBUG with a `why` field (`stat_enoent` / `seen_miss` / `seen_hit` /
`rename_collapse`).

## Definition of Done
- [ ] Deep create in a directory made after watch start → exactly one `created`
- [ ] Delete → exactly one `deleted`, no trailing `modified`
- [ ] `mv a.txt b.txt` → one `renamed` with `detail.oldPath === 'a.txt'`
- [ ] An unrelated delete and create 500ms apart stay two events, not a rename
- [ ] 10 writes to one path within 50ms → one `modified`
- [ ] Debounce map is empty after the last timer fires
- [ ] Ignored paths never reach `statFn` — asserted with a spy
- [ ] Every emitted decision carries a `why` in the DEBUG log

## Activation Task
Against a real temp tree: create 5 levels deep, modify, rename, delete. `ORCH_DEBUG=1` and paste
the four DEBUG lines with their `why` values into `../EPIC.md`.
