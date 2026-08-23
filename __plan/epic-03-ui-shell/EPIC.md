# Epic 03: UI shell

## Context
The top layer, and the only one a human touches. It is fed by the spine's HTTP + SSE surface and
feeds nothing but the operator's eyes. It exists to make the folder set manageable and to
establish the frame — sidebar, theme, translation layer, SSE connection — that Epics 04–06 fill
in. It ships no feed of its own.

## What
`web/` — Vite + React + Tailwind + shadcn/ui, stock dark theme:
- app shell: sidebar (folder list with live/idle status and event rate), header, main outlet
- add-folder dialog (path, name, ignore patterns, `.gitignore` toggle, event-type toggles)
- folder actions: pause/resume, remove
- `useStream(folderId)` — one `EventSource`, auto-reconnect with backoff, exposes events + status
- the i18n layer and the build-time check that keeps strings out of components

## Why
Without it the system is a curl session. Specifically: without the SSE hook built once here, each
of Epics 04, 05 and 06 opens its own `EventSource`, giving three connections per folder and three
different reconnect behaviours. And without the i18n layer installed *before* any UI is written,
every component in Epics 04–06 hardcodes English and needs an archaeology pass later.

## How
1. `npm create vite@latest web -- --template react-ts`, Tailwind, `npx shadcn@latest init` with
   the **stock dark theme**. No custom tokens, no theme switcher — the operator asked for stock.
2. `npx shadcn@latest add sidebar tabs table badge toggle-group dialog switch resizable scroll-area sonner input button`.
3. i18n: the smallest thing that satisfies the rule — `web/src/i18n/` with `t(key, vars)` reading
   a locale JSON, locale from `web/src/config.ts` (`VITE_LOCALE`, default documented, **never** a
   literal in the i18n setup). Dates and numbers via `Intl.DateTimeFormat`/`NumberFormat` with that
   same locale — no hand-written month names, no hardcoded `HH:mm`.
4. Enforcement, not intention: an ESLint rule (`react/jsx-no-literals`) scoped to
   `web/src/components/**` and `web/src/app/**`, wired into `npm run build`. It passes on day one
   because those directories start empty; it fails the moment Epic 04 hardcodes a label. Widen the
   glob as areas are cleaned — the scope list lives in `.eslintrc` with a comment saying so.
5. `useStream`: one `EventSource` per mounted folder id, held in a context so sibling components
   share it. Reconnect with 1s→30s backoff. Buffer to a bounded array (2000) — the browser tab is
   not the archive, sqlite is.
6. Vite dev proxy `/api` → `localhost:4000`. Production: `npm run build`, server serves `web/dist`
   statically. One origin, no CORS.

Migration strategy: none. This epic is additive and touches no server file.

## Definition of Done
- [ ] `npm run dev` in `web/` serves the shell at `localhost:5173`, proxying `/api` to the server
- [ ] The sidebar lists folders from `GET /api/folders` and reflects an add/remove without a page reload
- [ ] Add-folder rejects a non-existent path with the server's `400` surfaced as a visible message — not a silent no-op
- [ ] Add-folder rejects a duplicate path with a distinct, translated message
- [ ] Pause sets `enabled: false`; the sidebar row goes to `idle` and the stream stops appending for that folder
- [ ] Killing the server mid-session shows a disconnected state; restarting it reconnects within 30s **without a page reload**
- [ ] Two components consuming `useStream` for the same folder open exactly **one** `EventSource` — asserted in Network tab and in a test
- [ ] `npm run build` fails when a bare string literal is added to a component under the enforced globs — demonstrated by adding one, seeing red, removing it
- [ ] Zero user-facing strings in `web/src/components/**`; every one resolves through `t()`
- [ ] All timestamps render via `Intl` with the configured locale — `grep -rn "toLocaleTimeString()" web/src` finds no argument-less calls
- [ ] Stock shadcn dark theme — `git diff` on the generated theme files is empty
- [ ] No login screen, no account UI, no user menu anywhere (there is no user management)

## Test Plan
Level 1 (deterministic), `web/src/**/*.test.ts(x)` with `node --test` + Testing Library:
- `useStream`: single connection for two consumers; backoff schedule on repeated failure; bounded
  buffer drops oldest at 2000
- add-folder form: validation states, server error surfaced, success closes the dialog
- i18n: `t()` returns the key itself for a missing translation (visible, not blank); `Intl`
  formatting honours a non-default locale in config
- lint enforcement: a fixture component with a literal fails the rule (assert on the linter, so the
  guard itself is tested, not assumed)

Level 2 (integration): activation task below — real server, real browser.
Level 3: none.

## Failure Mode

| If X fails | Y happens |
|---|---|
| Server unreachable at load | Shell renders with an explicit disconnected banner and an empty folder list. **Never a blank page** — a blank page is indistinguishable from "no activity". |
| SSE drops | Backoff reconnect; banner shows reconnecting with the attempt count. On reconnect, backfill from `/api/events` closes the gap. Fails open. |
| A malformed SSE frame arrives | That frame dropped, `console.warn` in dev only, stream continues. |
| A translation key is missing | The key string renders. Visible and greppable; **never** falls back to a hardcoded English literal, which would hide the bug. |
| Locale config absent | Falls back to the documented default, logged once at startup in dev. |
| Buffer hits 2000 | Oldest dropped, and the UI says so ("older events in history") rather than silently truncating. |

## Logging & Observability

Browser-side, so the destination differs — but the rule holds: structured, never bare
`console.log` in shipped code.

| What to log | Destination | Format | Rotation |
|---|---|---|---|
| SSE lifecycle: connect, disconnect, reconnect attempt N, backoff ms | browser console via a `log()` wrapper, dev only | structured object | n/a |
| API errors: route, status, body | same, all environments | structured object | n/a |
| Buffer eviction: count dropped | same, dev only | structured object | n/a |
| Missing translation key | same, dev only, once per key | structured object | n/a |

Server-side observability for this epic comes free: every request the UI makes is already logged
by Epic 00 with route, status and duration, so a broken screen is diagnosable from
`logs/orchestrator.jsonl` alone.

## Dependencies
- Epic 00 (spine): `/api/folders` CRUD, `/api/events`, `/api/stream`, the Event contract.
- No dependency on Epics 01/02 — the shell is testable against an empty database and a fake
  producer, which is why it runs in parallel with 01.

## Owner
- **Builds:** implementation agent, own worktree (`web/` only — disjoint from Epic 01's `server/`).
- **Advises:** planner on the i18n enforcement scope; operator on nothing, the theme is stock.
- **Validates:** reviewer agent against the DoD, especially the single-EventSource and
  no-hardcoded-strings items — both are the kind that silently regress.

## Activation Task

| What to execute | Expected output | Where output lands |
|---|---|---|
| `node server.js` + `npm --prefix web run dev`, then add `/Applications/MAMP/htdocs/prj25-folder-orchestrator` through the dialog | Folder appears in the sidebar; one row in the `folders` table; `POST /api/folders 201` in the log | browser at `localhost:5173`; `data/orchestrator.db`; `logs/orchestrator.jsonl` |
| Kill the server, wait 10s, restart it | Banner goes disconnected then connected, no page reload | browser |
| Add `<div>Hello</div>` to a component under the enforced glob, run `npm --prefix web run build` | Build fails on the lint rule, naming the file and line | terminal — paste the failure into this epic as proof the guard is live |

Not complete until the guard has been seen to fail on a real literal.

## Activation Evidence
**2026-08-23** — run against the live server.

- Shell renders at `localhost:4000` (production build served by the Node process) and at
  `localhost:5173` in dev via the Vite proxy.
- Folder added through the dialog; sidebar updated without a reload.
- **Lint guard proven live.** Adding `<p className="text-sm">Alert when...</p>` to
  `src/features/Rules.tsx` failed the build:
  `31:32  error  Strings not allowed in JSX files: "Alert when..."  react/jsx-no-literals`
  Reverting restored a green build. The guard is enforcement, not intention.
- 99 `en` keys, 46 `de` keys; untranslated keys fall back to `en`, missing keys render the key.
- `web` test suite: 17 tests, 0 failures.

**Bug found and fixed during this epic:** `setEvicted` was called *inside* the `setEvents`
updater. React updaters must be pure, so the nested update was dropped and the feed rendered
empty while `status` frames still arrived — the failure looked like "no activity" rather than
an error. The buffer now lives in a ref and both `setState` calls take plain values.
