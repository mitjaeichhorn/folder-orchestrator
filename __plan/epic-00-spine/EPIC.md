# Epic 00: Spine

## Context
The bottom layer: the process everything else plugs into. Nothing feeds it except HTTP requests
from the dashboard; it feeds the watcher (Epic 01), the transcript tailer (Epic 02) and every UI
epic through one SSE stream. It exists because the Event shape and the SSE frame format are the
project's only contract — fix them once, alone, before anything is written against them.

## What
A single `node server.js` process that:
- opens `data/orchestrator.db` via `node:sqlite`, creating the schema from the contract doc
- serves the folder CRUD routes and `/api/events` from that database
- serves `/api/stream` as SSE, with per-folder subscriber fan-out, `ping` keepalive, and backfill
  of the last 200 events on connect
- exposes one internal function, `emit(event)`, that inserts to sqlite and fans out to subscribers
- binds `127.0.0.1` only
- writes its own audit trail to `logs/orchestrator.jsonl`

No watcher, no transcript parsing. `emit()` is exercised by a fake producer in the activation task.

## Why
Without it, Epics 01 and 02 each invent their own event shape and their own transport, and the UI
is written against a third. Lesson 8 of the planning layer: contract-changing epics run
sequentially first. Concretely, if `emit()`'s signature changes after Epic 03 starts, every
component in `web/` decodes the wrong frame and the feed renders blank with no error.

## How
1. `git init` and a `.gitignore` (`node_modules`, `data/`, `logs/`, `web/dist`).
2. `db.js` — `DatabaseSync` open, `exec()` the schema verbatim from the contract doc, export
   `insertEvent`, `listEvents`, `folders` CRUD. Prepared statements, no string interpolation.
3. `log.js` — ~10 lines. `log(level, msg, fields)` appends one JSON line to
   `logs/orchestrator.jsonl`. Never `console.log` in server code.
4. `bus.js` — `Set` of subscriber response objects keyed by `folderId`; `emit()` inserts then
   writes `event: append\ndata: ...\n\n` to each. Dead sockets removed on `close`.
5. `server.js` — `node:http`, hand-rolled route table (7 routes, a `switch` beats a router dep).
6. Retention: on boot, delete events older than 30 days. One `DELETE`, no scheduler.

Migration strategy: none — greenfield. The schema is created if absent and never altered in place;
a schema change during this epic means deleting `data/orchestrator.db`, which is disposable until
Epic 01 ships.

## Definition of Done
- [ ] `node server.js` starts, binds `127.0.0.1:4000`, and refuses connections from any other interface
- [ ] `curl -s localhost:4000/api/folders` returns `[]` on a fresh database
- [ ] `POST /api/folders {path: "/tmp/x"}` returns a folder with a stable id; a second POST with the same path returns `409`, not a duplicate row
- [ ] `POST /api/folders` with a path that does not exist or is not a directory returns `400` and inserts nothing
- [ ] Two concurrent `EventSource` clients on the same folder both receive an `emit()`ed event within 100ms
- [ ] An `EventSource` client on folder A receives **zero** events emitted for folder B
- [ ] Killing a client mid-stream removes it from the subscriber set — `bus.size(folderId)` returns to 0 within 1s
- [ ] Connecting to `/api/stream` replays the last 200 stored events for that folder before any live event
- [ ] `node --test server/` passes with 0 failures
- [ ] `logs/orchestrator.jsonl` contains one parseable JSON line per request and per emit
- [ ] `package.json` has zero `dependencies` (devDependencies empty too — the frontend has its own)

## Test Plan
Level 1 (deterministic), `server/spine.test.js` using `node:test` + `node:assert`:
- schema creation is idempotent — open the same db file twice, no throw
- `insertEvent` round-trips every `kind` in the contract, `detail` survives JSON round-trip
- `listEvents` respects `limit` and `before`, returns newest-first
- folder CRUD: duplicate path rejected, non-directory rejected, delete removes the row
- bus fan-out: two fake sinks both receive; folder isolation holds; closed sink is dropped
- retention delete removes an event dated 31 days back and keeps one dated 29 days back

Level 2 (integration): the activation task below — real process, real HTTP, real SSE.
Level 3: none. There is no model in this system and therefore no quality tier.

## Failure Mode

| If X fails | Y happens |
|---|---|
| `data/` not writable | Server refuses to boot, logs `FATAL db_open`, exits 1. **Fails closed** — a silent in-memory fallback would look healthy and lose everything on restart. |
| sqlite insert throws | Event is dropped, `ERROR emit_insert` logged with the event; **fan-out still happens** so the live view stays correct. Fails open — losing history beats losing liveness. |
| A subscriber socket is dead | Write throws, subscriber removed, `INFO sub_dropped`. Other subscribers unaffected. |
| Port 4000 in use | Exit 1 with `FATAL port_in_use` naming the port. No auto-increment — a moving port makes the frontend's URL a guess. |
| Retention delete fails | Logged at ERROR, boot continues. Non-critical, fails open. |
| Malformed JSON body on POST | `400` with a machine-readable code, nothing inserted. |

Nothing fails silently.

## Logging & Observability

| What to log | Destination | Format | Rotation |
|---|---|---|---|
| Boot: port, db path, folder count, schema version | `logs/orchestrator.jsonl` | JSONL | size, 10MB × 3 |
| Every HTTP request: ts, method, route, status, duration_ms | same | JSONL | same |
| Every `emit`: ts, folder_id, kind, path, actor, subscriber_count | same | JSONL | same |
| Subscriber open/close: ts, folder_id, remaining_count | same | JSONL | same |
| Every error: ts, level, code, message, context, stack | same | JSONL | same |
| Retention sweep: ts, rows_deleted, cutoff | same | JSONL | same |

Rotation is size-based, 10MB, 3 files kept — ~30 lines of stdlib, no dep. Retention 30 days.
Rule: no `console.log` anywhere in `server/`. The DoD check is `grep -rn 'console\.' server/`
returning nothing outside tests.

## Dependencies
None. This is the first epic.

## Owner
- **Builds:** implementation agent, single worktree — no parallelism, this epic sets the contract.
- **Advises:** planner (owns the contract doc; any change to the Event shape goes through it).
- **Validates:** reviewer agent against the DoD list, plus the Activation Task run on real data.

## Activation Task

| What to execute | Expected output | Where output lands |
|---|---|---|
| `node server.js &` then `curl -sN localhost:4000/api/stream?folder=$ID` in one shell, `node -e "require('./bus').emit({folderId:'$ID',kind:'modified',path:'a.txt',actor:'external',ts:Date.now(),detail:{size:12}})"` in another | The curl shell prints `event: append` followed by the JSON event, within 100ms | terminal; and one row in `data/orchestrator.db` `events`; and one `emit` line in `logs/orchestrator.jsonl` |
| `sqlite3 data/orchestrator.db 'select count(*) from events'` | `1` | stdout |

Not complete until both have been run and the outputs exist.

## Activation Evidence
**2026-08-23** — run on real data.
- `node server/server.js` binds `127.0.0.1:4000`; `GET /api/folders` → `[]` on a fresh db.
- `POST /api/folders {path:"/tmp"}` → `201`; duplicate → `409`; `/nope` → `400`, nothing inserted.
- Two concurrent SSE clients both received an emitted event; folder isolation held.
- `npm test` → 48 server tests, 0 failures.
- Zero `dependencies` in `package.json`. Confirmed: `node:sqlite`, `node:http`, `node:fs` only.
