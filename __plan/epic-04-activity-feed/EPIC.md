# Epic 04: Activity feed

## Context
The main screen, sitting on top of the UI shell and consuming the merged event stream from the
watcher and the transcript tailer. It feeds the alert rules epic (which reuses its matching) and
the operator's attention. It exists because everything upstream is plumbing until something is
legible on screen — this is the screen the operator leaves open all day.

## What
The feed view from the wireframe: a virtualised event table, filter chips by kind, a path/glob
filter, a time-window selector, auto-scroll with a pause-on-scroll-up, and a detail panel showing
the selected event — including the diff for `Edit` events, straight from `old_string`/`new_string`.

## Why
Without it there is no product the operator can use, only a database. And without its *filtering*,
the feed shows a real project's churn as an unreadable blur — the noise-is-the-enemy principle
from the north star fails at exactly the moment the tool would otherwise pay off.

## How
1. Table via shadcn `table`, rows from `useStream` + a `/api/events` backfill on mount. Virtualise
   above 200 rows — plain windowing, no table library.
2. Filters are **client-side over the buffer, plus a server query on change**: chips set state, the
   state produces a `/api/events?kind=&path=&since=` refetch, and the live stream is filtered
   through the same predicate. One predicate function, used in both places — two predicates drift.
3. Auto-scroll: pinned to bottom by default; scrolling up pins the view and shows an "N new" pill.
   This is the single interaction that decides whether the screen is usable while busy.
4. Detail panel: metadata always; for `kind: 'tool'` with `tool: 'Edit'`, render `old_string` /
   `new_string` as a side-by-side line diff. **Line-level only** — a character-level diff is a
   dependency and an algorithm for a panel the operator glances at.
5. Row actions: open in editor (`vscode://file/...`), reveal in Finder (`open -R` via a server
   route), mute this path (appends to the folder's ignore list).
6. Every string through `t()`; every timestamp through `Intl` with the configured locale. The lint
   guard from Epic 03 covers these files — widen its glob to include them in the same commit.

Migration strategy: none, additive.

## Definition of Done
- [ ] Feed renders the last 200 events on mount, newest first, within 500ms
- [ ] A live event appears in under 200ms from the `emit()` on the server
- [ ] Filter chips (`created`/`modified`/`deleted`/`renamed`/`tool`) filter both the backfill and the live stream identically — asserted with the same predicate under test
- [ ] The path filter accepts a glob (`src/**/*.tsx`) and matches identically to the server's matcher
- [ ] `actor` is visually distinguishable at a glance: `claude` rows carry a badge, `external` rows do not
- [ ] Selecting an `Edit` tool event shows a line diff with correct added/removed counts matching `detail.linesAdded`/`linesRemoved`
- [ ] An `Edit` with a 4KB-truncated string shows a truncation marker rather than a silently short diff
- [ ] Scrolling up pauses auto-scroll and shows an accurate new-event count; scrolling to bottom resumes
- [ ] 5,000 buffered rows scroll at 60fps and memory stays flat over 30 minutes of live churn
- [ ] "Mute this path" adds the pattern to the folder's ignore list and the very next matching event does not arrive
- [ ] Zero hardcoded strings; `npm run build` lint guard passes with these files inside its glob
- [ ] No user/owner/avatar column anywhere — there is one operator and no user management

## Test Plan
Level 1 (deterministic), `web/src/feed/*.test.tsx`:
- the shared filter predicate: each kind, glob matching, time window, combinations — the same test
  data run through the server matcher and the client matcher, asserting identical output
- diff rendering: known old/new pair → expected added/removed line counts; truncated input →
  marker present
- auto-scroll state machine: pinned → unpinned on scroll-up → new-count increments → repinned on
  bottom; assert the count is exact, not approximate
- virtualisation: 5,000 rows renders a bounded number of DOM nodes

Level 2 (integration): activation task — real churn from a real build.
Level 3: none.

## Failure Mode

| If X fails | Y happens |
|---|---|
| Backfill request fails | Live stream still renders; a banner says history is unavailable and offers retry. **Fails open toward liveness** — the live view is the point. |
| An event has an unknown `kind` | Row renders with the raw kind as its label rather than being dropped. Dropping would hide a contract change; showing it makes the mismatch obvious. |
| `detail` missing fields for a diff | Panel shows metadata and an explicit "no diff available", never an empty box. |
| Event rate exceeds render budget | Rows batch per animation frame; the collapsed-summary rows from Epic 01's rate ceiling are rendered as such ("N events collapsed") — **never silently thinned**. |
| Client and server filter disagree | Caught by the shared-predicate test in CI, not at runtime. This is why there is one predicate. |
| Editor deep link fails (no VS Code) | Action shows a failure toast with the path copied to clipboard. |

## Logging & Observability

| What to log | Destination | Format | Rotation |
|---|---|---|---|
| Filter change: active kinds, path pattern, window, resulting server query | browser structured log, dev only | object | n/a |
| Backfill: route, count returned, duration_ms | browser structured log, all envs | object | n/a |
| Render budget exceeded: frame duration, rows pending | browser, dev only | object | n/a |
| Mute action: pattern added, folder id | **server** side via `PATCH /api/folders` — already logged by Epic 00 | JSONL | 10MB × 3 |

Every filter the operator applies is reconstructable from the server's request log alone, since
each filter change issues a logged `/api/events` query with its parameters.

## Dependencies
- Epic 03 (UI shell): `useStream`, the shell layout, `t()`, the lint guard.
- Epic 01 (watcher): `created`/`modified`/`deleted`/`renamed` events and the rate-ceiling
  collapsed frames this view must render honestly.
- Epic 02 (claude activity): `tool` events, the `actor` label, and `detail.input.old_string` /
  `new_string` — the diff panel has no other source.

## Owner
- **Builds:** implementation agent, own worktree.
- **Advises:** planner on the shared-predicate rule (it is the one thing that will otherwise rot).
- **Validates:** reviewer agent + the activation run under real build churn.

## Activation Task

| What to execute | Expected output | Where output lands |
|---|---|---|
| With this project watched, run a real `npm run build` in it and watch the feed | Build output files appear as `created`/`modified` rows in real time; `dist/` rows absent (ignored) | browser; `data/orchestrator.db` |
| Run a Claude Code session that performs one `Edit`, then select that row | Detail panel shows the correct line diff with counts matching `detail` | browser — screenshot pasted into this epic |
| Apply a `src/**` path filter during churn | Row count drops and matches `select count(*) from events where path glob 'src/*'` for the same window | browser + sqlite, both numbers recorded here |

Not complete until the two counts have been compared on real data and match.
