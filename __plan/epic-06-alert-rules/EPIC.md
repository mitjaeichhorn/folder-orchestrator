# Epic 06: Alert rules

## Context
The last layer, sitting on top of the event pipeline and the feed. It is fed by every emitted
event and feeds the operator's attention when they are not looking at the screen. It exists
because the north star's promise — "they find out too late" — is only kept if the tool can
interrupt, not just display.

## What
A rules table and a matcher: "when an event matches this pattern, do this." Rules are stored
server-side and evaluated in `emit()`, so a rule fires whether or not a browser is open.

- rule shape: `{id, folderId|null, kind[], pathGlob, threshold?, action}` where `action` is
  `toast` and/or `badge`
- threshold rules for rate: "more than N events in M seconds"
- the rules tab from the wireframe: list, add, toggle, delete
- three defaults seeded on first run: any change to `.env*`, >100 events in 10s, deletes under
  `src/**`

## Why
Without it the operator has to be watching the right tab at the right second. The concrete case
this exists for: an agent rewrites `.env` at 14:02, the operator notices at 17:30 while looking
for something else.

## How
1. `rules` table: `id, folder_id (nullable = all folders), kinds (JSON), path_glob, threshold_count,
   threshold_seconds, actions (JSON), enabled, created_at`.
2. Matcher runs inside `emit()`, after the ignore filter, before fan-out. **Reuses Epic 04's
   predicate** — the glob and kind matching are already written and already tested against the
   client. A second matcher is a second set of bugs.
3. Rate rules keep a per-rule ring of timestamps; a fire sets a 60s cooldown so one storm produces
   one alert, not four hundred.
4. Firing emits a `alert` SSE frame; the UI raises a `sonner` toast and increments the sidebar
   badge. Alerts are also written to the events table as `kind: 'alert'` so history survives a
   closed browser.
5. Rules UI: shadcn `table` + `dialog` + `switch`. Every string through `t()`.
6. No email, no webhook, no push, no notification service. Toast and badge. Adding a transport is
   a new epic with its own failure modes.

Migration strategy: rules are additive; a bad rule is disabled with the toggle, not a code change.
The seeded defaults are inserted only when the table is empty, so they never reappear after the
operator deletes them.

## Definition of Done
- [ ] Writing to `.env` in a watched folder raises exactly one toast, within 1s
- [ ] The rule fires with **no browser open**, and the alert is present in history on next load
- [ ] A rate rule (>100 in 10s) fires once during an `npm install`-scale storm, not repeatedly — cooldown verified
- [ ] Disabling a rule stops it firing immediately, with no restart
- [ ] Deleting all seeded rules and restarting does **not** re-seed them
- [ ] A rule scoped to one folder does not fire for another folder
- [ ] An invalid glob in a rule is rejected at save time with a translated message, never stored
- [ ] Rule evaluation adds under 1ms per event at 500 events/sec — measured, not assumed
- [ ] `kind: 'alert'` rows are visible in the activity feed like any other event
- [ ] Zero hardcoded strings; lint guard glob covers the rules UI
- [ ] `node --test server/` passes, matcher tests included

## Test Plan
Level 1 (deterministic), `server/rules.test.js` and `web/src/rules/*.test.tsx`:
- matcher: kind sets, glob matching, folder scoping, `folderId: null` meaning all — run through the
  **same** predicate fixtures as Epic 04, asserting identical results
- rate rule: 150 synthetic events in 10s → exactly one fire; a second storm after cooldown → one more
- cooldown boundary at 60s, both sides, injected clock
- seeding: empty table seeds three; non-empty table seeds none; deleted-then-restart seeds none
- invalid glob rejected at the API boundary, nothing written
- performance: 500 events × 20 rules under 1ms/event, asserted as a budget test

Level 2 (integration): activation task on real churn.
Level 3: none.

## Failure Mode

| If X fails | Y happens |
|---|---|
| A rule throws during evaluation | That rule is disabled for the process, `ERROR rule_threw` with the rule id, and **the event still emits**. Fails open — a broken rule must never stop the feed. |
| Matcher is slow | Budget test catches it in CI. At runtime, evaluation over 5ms logs `WARN rule_slow` with the rule id. |
| Toast transport unavailable (no browser) | Alert still written to the events table. The badge and history carry it. **Degrades, never drops.** |
| Storm triggers many rules at once | Per-rule cooldown bounds it; a global cap of 5 toasts per 10s applies, with the remainder collapsed into one "N more alerts" toast. Logged, never silent. |
| Rule references a deleted folder | Rule auto-disabled on folder delete, logged. Not deleted — the operator may re-add the folder. |
| Alert fires on an ignored path | Impossible by construction: the matcher runs **after** the ignore filter. Asserted in a test so the ordering cannot be refactored away. |

## Logging & Observability

| What to log | Destination | Format | Rotation |
|---|---|---|---|
| Every rule fire: ts, rule_id, folder_id, event_id, matched_pattern, actions_taken | `logs/orchestrator.jsonl` | JSONL | 10MB × 3 |
| Every rule evaluation at DEBUG: ts, rule_id, event_id, matched (bool), reason | same | JSONL | same |
| Cooldown suppression: ts, rule_id, suppressed_count | same | JSONL | same |
| Rule CRUD: ts, action, rule_id, payload | same | JSONL | same |
| Rule error / auto-disable: ts, rule_id, message, stack | same | JSONL | same |
| Global toast cap hit: ts, collapsed_count | same | JSONL | same |

Suppression is logged explicitly. A cooldown that silently ate an alert would be indistinguishable
from a rule that never matched — and the operator would trust the tool while it stayed quiet.

## Dependencies
- Epic 00 (spine): `emit()` — the matcher is inserted into it; plus the `alert` SSE frame.
- Epic 01 (watcher): the ignore filter, which must run **before** the matcher.
- Epic 04 (activity feed): the shared filter predicate, and the feed rendering `kind: 'alert'` rows.
- Epic 03 (UI shell): `sonner`, `t()`, the lint guard.

## Owner
- **Builds:** implementation agent, own worktree, but note it edits `emit()` in the spine — that
  file is shared, so this epic runs after 04 lands rather than beside it.
- **Advises:** planner on the default rule set and the cooldown value.
- **Validates:** reviewer agent + the activation run, especially the headless (no browser) fire.

## Activation Task

| What to execute | Expected output | Where output lands |
|---|---|---|
| With the browser **closed**, `echo "X=1" >> .env` in a watched folder; then open the dashboard | The alert is present in history and the sidebar badge shows it | `data/orchestrator.db` (`kind='alert'`); `logs/orchestrator.jsonl` rule-fire line; browser |
| With the browser open, run a real `npm install` in a watched folder | Exactly one rate-rule toast, not a stream; suppression count logged | browser + `grep cooldown logs/orchestrator.jsonl`, count recorded here |
| `node --test server/rules.test.js` budget case | Per-event evaluation under 1ms at 500 ev/s, number pasted here | terminal → this file |

Not complete until the browser-closed case has been run and the alert found in history.
