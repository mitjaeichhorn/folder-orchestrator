# Folder Orchestrator — Implementation Plan

Read [north-star.md](../north-star.md) and
[__documentation/source-of-truth/event-contract.md](../__documentation/source-of-truth/event-contract.md)
before touching any epic.

## Epic Overview

| # | Epic | Category | Status | What's done | What's open | Depends on |
|---|---|---|---|---|---|---|
| 00 | [Spine](epic-00-spine/EPIC.md) — event contract, sqlite, SSE, folder CRUD | foundation | **done** | all DoD met, activation run | — | — |
| 01 | [Watcher](epic-01-watcher/EPIC.md) — recursive fs.watch, normalisation, ignore rules | foundation | **done** | all DoD met on the 21,734-file project | — | 00 |
| 02 | [Claude activity](epic-02-claude-activity/EPIC.md) — transcript tailer + attribution join | feature | **done** | attribution + free diff verified on a live session | — | 00, 01 |
| 03 | [UI shell](epic-03-ui-shell/EPIC.md) — Vite + shadcn dark, sidebar, add-folder, SSE client, i18n | ui | **done** | shell, i18n, lint guard proven failing | DOM-level tests for useStream | 00 |
| 04 | [Activity feed](epic-04-activity-feed/EPIC.md) — main table, filters, detail + diff panel | ui | **code-complete** | feed, filters, diff panel, one-line rows | virtualisation above 200 rows; 5k-row perf unmeasured | 01, 02, 03 |
| 05 | [Session view](epic-05-session-view/EPIC.md) — Claude session tab, files-touched | ui | **code-complete** | grouping, running/ended, files-touched, all unit-tested | file→feed link is a no-op stub | 02, 03 |
| 06 | [Alert rules](epic-06-alert-rules/EPIC.md) — rule matching + toasts | feature | **code-complete** | matcher, cooldown, seeding, toasts; 8 tests | browser-closed activation run not done | 04 |

## Dependency Graph

```
                 ┌──────────────┐
                 │ 00  Spine    │  ← contract-stabilising, must finish alone
                 └──────┬───────┘
              ┌─────────┴─────────┐
       ┌──────▼──────┐     ┌──────▼───────┐
       │ 01 Watcher  │     │ 03 UI shell  │   (parallel)
       └──────┬──────┘     └──────┬───────┘
       ┌──────▼──────────┐        │
       │ 02 Claude       │        │
       │    activity     │        │
       └──────┬──────────┘        │
              └────────┬──────────┘
                ┌──────▼────────┐   ┌──────────────┐
                │ 04 Activity   │   │ 05 Session   │  (parallel)
                │    feed       │   │    view      │
                └──────┬────────┘   └──────────────┘
                ┌──────▼────────┐
                │ 06 Alerts     │
                └───────────────┘
```

## Priority Order

**First:** 00 alone. It fixes the Event shape and the SSE frame format; every later epic is
written against it. Parallelising before it is stable produces code with the wrong signature.

**Then:** 01 and 03 in parallel — they touch disjoint files (`server/` vs `web/`). 02 follows 01.

**Then:** 04 and 05 in parallel. 06 last.

**Continuous:** the no-hardcoded-strings check (Epic 03 installs it, every UI epic widens its
scope), and the `logs/orchestrator.jsonl` audit trail (Epic 00 installs it, every epic writes to it).

## Added after the plan (post-build session)

Requested during the build, implemented with the same DoD discipline. Each is backed by tests.

| Feature | Where | Note |
|---|---|---|
| Topic grouping (`topic → file → actions`) | `transcripts.js`, `group-by-file.ts`, `Tree.tsx` | Topic is the operator's prompt, verbatim from `last-prompt`. Primed on startup so a restart keeps it. |
| Proportional timeline | `timeline.ts`, `Feed.tsx` | Row height carries elapsed time; dashed rule capped at 60s. |
| Muted directories | `FilePath.tsx` | Folder dim, filename bright, everywhere a path renders. |
| Image thumbnails + lightbox | `serve-file.js`, `Thumb.tsx`, `Lightbox.tsx` | `/api/file` is an extension allow-list, path-validated, realpath both sides. |
| Project heatmap column | `tree.js`, `heat.ts`, `HeatTree.tsx` | Heat in events-ago, not seconds. Dimming means other work happened. |
| Copy file / folder path | `DetailPanel.tsx` | Clipboard failure surfaces a toast rather than copying nothing. |
| Zero-LLM enforcement | `no-llm.test.js` | Scans sources for inference APIs; asserts no server deps. |

## Current Blockers (priority order)

1. Nothing is blocking. The system runs end to end: `npm start`, open `localhost:4000`.
2. Epic 04's virtualisation is not implemented — the feed renders every buffered row. Fine at
   the 2,000-row buffer cap; measure before raising it.
3. Epic 05's file→feed link is a stub (`onPickPath={() => {}}`). Wiring it means lifting the
   feed's filter state to the workspace.

## Last Audited

<!-- UPDATE THIS EVERY SESSION -->
**2026-08-23 (build session)** — all seven epics implemented, plus the post-plan features
above. **124 tests passing** (77 server + 47 web), 0 failures, stable across repeated runs. Activation runs completed
for Epics 00–03 against real data; evidence recorded in each EPIC.md. Server has **zero npm
dependencies**.

Five real bugs were found by the DoD checks and fixed — recorded in the epics:
rename-by-basename (should be inode); rules re-seeding after deletion (`PRAGMA user_version`
now marks it); a nested `setState` in the stream buffer that silently emptied the feed; the
symlink containment check comparing a realpath against an unresolved root, which refused every
legitimate file under macOS's `/var` symlink; and topics staying null forever because tailing
starts at EOF.

## Session-start protocol

1. Read this status table.
2. Run `npm test` — know what passes right now (expect 77 + 47).
3. `git log --oneline -10`.
4. Update the table if it is stale. **The table is the source of truth for project state.**
5. Then pick work.
