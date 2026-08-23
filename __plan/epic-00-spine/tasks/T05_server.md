# T05 — server.js (routes + SSE + boot)

## What
The HTTP surface from the contract doc, bound to `127.0.0.1:4000`, plus boot sequence.

## Dependencies
- Types: `Event`, `Folder` — contract doc
- Services: `db` (T02), `log` (T03), `bus.subscribe`/`send` (T04)
- Primitives: none
- Context: none
- Platform: none

## How
`node:http` server, hand-rolled `switch` route table — 7 routes do not need a router.
`server.listen(4000, '127.0.0.1')` — the host argument is the entire security model, do not omit it.
Port in use → `FATAL port_in_use`, `exit 1`. No auto-increment.
`/api/stream`: headers `text/event-stream`, `no-cache`, `keep-alive`; `flushHeaders()`; backfill
the last 200 events via `listEvents` **before** `subscribe()` so no live event is missed in the gap;
then subscribe.
Every request wrapped to log `{method, route, status, duration_ms}`.
Boot: open db, `sweepRetention(30)` in try/catch (failure is non-fatal), log
`{port, db_path, folder_count}`.
Serve `web/dist` statically when it exists; 404 otherwise. Bodies capped at 64KB.
**No auth middleware, no session, no cookie** — there is no user management.

## Files
- Create: `server/server.js`

## Definition of Done
- [ ] `curl localhost:4000/api/folders` → `[]`; the same request to the machine's LAN IP is refused
- [ ] `POST /api/folders` valid → 201 + body; duplicate → 409; missing/non-dir path → 400; nothing inserted on either error
- [ ] `PATCH`/`DELETE` behave per the contract; `?purge=1` drops that folder's events
- [ ] `/api/stream` replays 200 events, then live events, with no gap and no duplicate at the seam
- [ ] Port already bound → exits 1 with `FATAL port_in_use` naming 4000
- [ ] Every request produces exactly one log line with a status and a duration
- [ ] A 100KB body → 413, not a hang
- [ ] `grep -rniE 'auth|login|session_token|passport' server/` is empty

## Activation Task
`node server/server.js`, then the full curl sequence: list → add → stream → emit → delete.
Each step's status and the resulting log lines pasted into the epic.
