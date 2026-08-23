# T04 — bus.js (emit + SSE fan-out)

## What
`emit(event)`: persist, then push to every subscriber of that folder. The single write path for
every event in the system.

## Dependencies
- Types: `Event` — contract doc
- Services: `db.insertEvent` (T02), `log` (T03)
- Primitives: none
- Context: none
- Platform: none

## Files
- Create: `server/bus.js`

## How
`subs = Map<folderId, Set<res>>`. `subscribe(folderId, res)` adds and registers
`res.on('close', …)` to remove. `emit(e)`: validate `kind` against the contract's enum (unknown
kind → `WARN unknown_kind`, still emitted); `insertEvent` inside try/catch — **on insert failure,
log ERROR and continue to fan-out** (liveness beats history, per the epic's failure table); then
write `event: append\ndata: ${JSON.stringify(e)}\n\n` to each subscriber, removing any that throws.
`send(folderId, type, payload)` for the `status` / `patch` / `alert` frames.
`ping` keepalive: one shared 25s interval writing `:ping\n\n` to all subscribers, not one timer
per subscriber.
Log every emit with `subscriber_count`.

## Definition of Done
- [ ] Two subscribers on one folder both receive an emit within 100ms
- [ ] A subscriber on folder A receives zero events for folder B
- [ ] A closed subscriber is removed; `subs.get(id).size` returns to 0 within 1s
- [ ] An insert throw is logged and fan-out still happens (assert with a stubbed failing db)
- [ ] One `ping` interval exists regardless of subscriber count
- [ ] Removing the last subscriber leaves no empty `Set` leaking in the map

## Activation Task
Two `curl -sN` clients on the same folder; one `emit()` from a third shell; both print the frame.
