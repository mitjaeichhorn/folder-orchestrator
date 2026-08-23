# Epic 01: Watcher

## Context
Sits directly on top of the spine, one layer above the operating system. It is fed by macOS
FSEvents through `fs.watch`, and it feeds `emit()` from Epic 00 — nothing else may call the
watcher. It exists because the product's entire promise is "point it at a folder and see
everything", and this is the only component that actually sees anything.

## What
`server/watcher.js`: start and stop a recursive watch per enabled folder, turn the OS's
`rename`/`change` signals into contract-shaped events, debounce editor storms, and drop ignored
paths before they cost anything downstream.

- `startWatch(folder)` / `stopWatch(folderId)`, driven by the folders table on boot and by the
  CRUD routes at runtime
- `normalise(eventType, relPath)` → `created | modified | deleted | renamed | null`
- per-folder ignore matching: `.gitignore` if present, plus a hardcoded deny-list
- a per-folder counter feeding the `status` SSE frame (`fileCount`, `eventsPerMin`)

## Why
Without it there is no product. And without its *filter*, there is no usable product: a real
project on this machine is 21,734 files, 14,978 excluding `node_modules` and `.git`. A single
`npm install` unfiltered would push tens of thousands of rows through sqlite and SSE in seconds,
freeze the browser tab, and bury the four events the operator cared about.

## How
1. `fs.watch(folder.path, {recursive:true}, cb)`. **Verified on this machine** (Node v25.8, macOS):
   fires for directories created after the watch starts, to arbitrary depth. Do not add chokidar —
   its reason to exist is Linux, which is out of scope.
2. macOS reports only `rename` and `change`, and neither means what it says. `normalise()` must
   `stat()` the absolute path:
   - stat throws `ENOENT` → `deleted`
   - stat succeeds, path unknown to the seen-set → `created`
   - stat succeeds, path known → `modified`
   - `created` whose basename matches a `deleted` within 100ms → collapse to `renamed` with
     `detail.oldPath`
3. Debounce per path, 50ms trailing. Atomic-save editors emit temp-file + rename per keystroke-save;
   without this one save becomes 3–5 rows.
4. Ignore matching runs **before** stat, before debounce, before emit. Order matters — stat on
   20k `node_modules` paths is the cost being avoided. Deny-list: `node_modules`, `.git`, `dist`,
   `build`, `.next`, `.DS_Store`, `*.log`, `*.swp`, `*~`, `.vite`, `coverage`.
5. Directory events are emitted; directory *content* is not walked. FSEvents already recurses.
6. Backpressure ceiling: if one folder exceeds 500 events in 10s, stop emitting individual rows and
   emit one `modified` with `detail.collapsed: N` per second until the rate falls. Log the drop.

Migration strategy: none, new component. Risk is contained — the watcher only calls `emit()`, so a
bad watcher cannot corrupt the spine.

## Definition of Done
- [ ] Creating `w/a/b/c/d/deep.txt` five levels below the root, in a directory created *after* the watch started, produces exactly one `created` event
- [ ] Deleting that file produces exactly one `deleted` event and no `modified`
- [ ] `mv old.txt new.txt` produces one `renamed` event with `detail.oldPath === 'old.txt'`, not a delete plus a create
- [ ] Writing the same file 10 times within 50ms produces exactly one `modified` event
- [ ] `npm install` inside a watched folder produces **zero** events (deny-list) — measured, not assumed
- [ ] Watching `/Applications/MAMP/htdocs/prj-migration-assistant-v4` (21,734 files) and touching one file in `src/` produces one event, and resident memory stays under 150MB
- [ ] A folder's `.gitignore` patterns are honoured, including negations (`!keep.log`)
- [ ] `stopWatch` releases the handle — `lsof -p $PID | grep <folder>` is empty afterwards
- [ ] Deleting the watched root itself stops the watcher and logs it rather than throwing
- [ ] `node --test server/` passes, watcher tests included
- [ ] No path outside the watched root ever appears in an emitted event

## Test Plan
Level 1 (deterministic), `server/watcher.test.js` — real temp dirs under `os.tmpdir()`, real
`fs.watch`, no mocks (the OS behaviour *is* what is under test):
- deep create in a post-hoc directory → one `created`
- delete → `deleted`; stat-throws path is exercised directly
- rename collapse within window; two unrelated create+delete outside the window stay separate
- debounce: 10 writes in a tight loop → 1 event
- ignore matching, unit-level: deny-list, `.gitignore` parse, negation, nested `.gitignore`
- ordering: assert `stat` is not called for an ignored path (spy on a `statFn` injected for the test)
- rate ceiling: 600 synthetic events in 10s → collapsed frames, drop logged

Level 2 (integration): the activation task — real 21k-file project, real editor save.
Level 3: none.

## Failure Mode

| If X fails | Y happens |
|---|---|
| `fs.watch` throws on start (bad path, permissions) | Folder marked `watching: false`, reason in the `status` SSE frame, `ERROR watch_start` logged. Other folders unaffected. **Fails open** — one bad folder must not take the process down. |
| Watched root deleted while running | Watcher stops itself, `status` goes `watching: false`, `WARN root_vanished`. No throw, no crash. |
| `stat()` throws something other than ENOENT | Event dropped, `ERROR stat_failed` with path. Fails open. |
| `.gitignore` unparseable | Deny-list still applies, `.gitignore` skipped, `WARN gitignore_parse`. **Fails safe toward filtering**, never toward flooding. |
| Event rate exceeds ceiling | Collapse to summary rows, `WARN rate_ceiling` with the count dropped. Never silent — a silently truncated feed reads as "nothing happened". |
| Debounce timer leaks | Bounded by design: one timer per in-flight path, cleared on fire. Test asserts the map empties. |

## Logging & Observability

| What to log | Destination | Format | Rotation |
|---|---|---|---|
| Watch start/stop: ts, folder_id, path, file_count, duration_ms | `logs/orchestrator.jsonl` | JSONL | 10MB × 3 |
| Every ignored-path *class* (aggregate per minute, not per path): ts, folder_id, ignored_count, top_patterns | same | JSONL | same |
| Normalisation decision at DEBUG: ts, raw_event, path, decided_kind, why (`stat_enoent`, `seen_set_miss`, `rename_collapse`) | same | JSONL | same |
| Rate ceiling hit: ts, folder_id, events_in_window, dropped | same | JSONL | same |
| Every error: ts, code, path, message, stack | same | JSONL | same |

Ignored paths are logged **aggregated**, never per path — per-path logging would recreate the
flood in the log file. The `why` field on every normalisation decision is what makes a
misclassified event diagnosable without reproducing it.

## Dependencies
- Epic 00 (spine): `emit()`, `log()`, the folders table, the Event contract.

## Owner
- **Builds:** implementation agent, own worktree (`server/watcher.js` only).
- **Advises:** planner on the ignore-rule defaults; they are load-bearing, not cosmetic.
- **Validates:** reviewer agent + the 21k-file activation run. The memory and event-count numbers
  in the DoD must be pasted into the epic as measured values before it closes.

## Activation Task

| What to execute | Expected output | Where output lands |
|---|---|---|
| Add `/Applications/MAMP/htdocs/prj-migration-assistant-v4` as a folder, then `touch` one file in its `src/` | Exactly one `modified` row for that path, `actor: 'external'` | `data/orchestrator.db`; visible in `curl -sN localhost:4000/api/stream?folder=$ID` |
| `npm install --dry-run` (or a real `npm ci`) inside that folder | Zero new rows | `select count(*) from events` unchanged |
| `ps -o rss= -p $(pgrep -f 'node server.js')` after 10 minutes watching | < 150000 (KB) | stdout, pasted into this epic |

Not complete until all three have been run against the real 21,734-file project and the numbers
recorded here.

## Activation Evidence
**2026-08-23** — run against `/Applications/MAMP/htdocs/prj-migration-assistant-v4`.

| Measure | Value |
|---|---|
| Raw file count | 21,734 |
| Excluding `node_modules` + `.git` | 14,978 |
| Excluding the full deny-list | 11,218 |
| **Actually watched** (deny-list + that project's `.gitignore`) | **3,998** |
| Initial walk duration | < 2s |
| `touch` one file in `src/` | exactly 1 `modified` row, `actor: external` |
| 300 writes into `node_modules/` | **0 events** |
| RSS after the run | 59–70 MB (budget: 150 MB) |

The gap between 11,218 and 3,998 is that project's own `.gitignore`, honoured as designed.

**Bug found and fixed during this epic:** rename detection was keyed on basename, which
by definition changes during a rename. Now keyed on inode, which a rename preserves.
`seen` became `Map<relPath, ino>` and the initial walk records inodes so renames of
pre-existing files are detected too.

**Ignore-list addition:** atomic-save editors write `foo.md.tmp.77` then rename. The `*.tmp`
glob did not catch it; `*.tmp.*` and `*.crswap` were added after seeing the noise live.
