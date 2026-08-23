# Epic 05: Session view

## Context
A sibling tab to the activity feed, one layer up from the transcript tailer. It is fed only by
Epic 02's `tool` and `prompt` events and feeds nothing downstream. It exists because the feed
answers "what changed" chronologically, while the operator's other question is "what is this agent
*doing*" — a session-shaped question the flat feed cannot answer.

## What
The per-session view from the wireframe: session header (id, start, running/ended, tool-call count,
files-touched count), the tool call timeline with durations and results, and a files-touched list
that links back into the feed.

## Why
Without it, reconstructing one agent's work means eyeballing a chronological feed with three
sessions interleaved. The specific failure: two Claude sessions running in sibling folders, both
editing shared code, and no way to tell which one did what without reading raw JSONL by hand.

## How
1. Group `tool`/`prompt` events by `sessionId`; a session is "running" when its newest event is
   under 60s old — a heuristic, and labelled as one in the UI ("last activity 12s ago"), not
   presented as certainty.
2. Timeline: shadcn `table`, one row per tool call — time, tool, target (path or command), result
   (`exitCode`, `durationMs`), all from `detail`.
3. Files touched: distinct paths across the session's tool events; clicking one filters the
   activity feed to that path (reuses Epic 04's predicate, adds nothing new).
4. Session list lives in the sidebar under the folder, most recent first, capped at 10 with a
   "show all" that queries the server.
5. Truncate `Bash` commands and `prompt` text at render, full value in a tooltip. No summarisation
   of any kind — there is no model in this product.

Migration strategy: none, additive and read-only.

## Definition of Done
- [ ] Sessions list shows every distinct `sessionId` for the folder, most recent first
- [ ] A running session updates live as tool calls arrive, without a refetch
- [ ] Tool-call rows show tool name, target, and result; `Bash` rows show the command and exit code
- [ ] Files-touched list is de-duplicated and matches `select distinct path from events where session_id=?`
- [ ] Clicking a file filters the activity feed to that path — no second filter implementation
- [ ] A session that ends (no events for 60s) flips to "ended" and stops claiming to be running
- [ ] The running/ended state is presented as last-activity-based, not as a fact about the process
- [ ] A folder with zero sessions shows a translated empty state, not a blank panel
- [ ] Zero hardcoded strings; lint guard glob widened to cover these files
- [ ] Nothing in this view can start, stop, or send anything to a Claude session (read-only invariant)

## Test Plan
Level 1 (deterministic), `web/src/session/*.test.tsx`:
- grouping: mixed events from three sessions → three groups, correct ordering
- running/ended boundary at 60s, both sides, using an injected clock (never wall time)
- files-touched dedup against a fixture with repeated paths
- empty state renders when the session list is empty
- `Bash` row renders command + exit code; a tool with no `detail.exitCode` renders without one
  rather than showing `undefined`

Level 2 (integration): activation task — two concurrent real sessions.
Level 3: none.

## Failure Mode

| If X fails | Y happens |
|---|---|
| `sessionId` missing on an event | Event grouped under an "unattributed" pseudo-session rather than dropped. Dropping would hide a tailer bug. |
| Session has tool events but no prompt | Renders normally; the prompt is not required. Fails open. |
| Two sessions share a `sessionId` (should be impossible) | Rendered merged, `WARN duplicate_session` in the browser log. Degrades visibly. |
| Transcript tailer is off for the folder | View shows a translated "no session data" state explaining transcripts are unavailable — not an error, and not an empty box. |
| Very long `Bash` command or prompt | Truncated at render with full text in a tooltip. Never re-flows the layout. |

## Logging & Observability

| What to log | Destination | Format | Rotation |
|---|---|---|---|
| Session grouping: session count, event count, unattributed count | browser structured log, dev only | object | n/a |
| Running/ended transition: session_id, last_event_ts, decided_state | browser structured log, dev only | object | n/a |
| Show-all query: route, session_id, count | server request log (Epic 00) | JSONL | 10MB × 3 |

The unattributed count is the number that matters — a rising count means Epic 02's parser has
drifted from the transcript format, and it is visible without opening a transcript.

## Dependencies
- Epic 02 (claude activity): `tool` and `prompt` events, `sessionId`, `detail.exitCode` /
  `durationMs` / `input`.
- Epic 03 (UI shell): shell layout, tabs, `t()`, `useStream`, the lint guard.
- Epic 04 (activity feed): the filter predicate, reused for the file→feed link. **Not** the feed
  component itself — these two views stay independent.

## Owner
- **Builds:** implementation agent, own worktree (disjoint from Epic 04's files).
- **Advises:** planner on the running/ended heuristic and how honestly it is labelled.
- **Validates:** reviewer agent + the two-concurrent-session activation run.

## Activation Task

| What to execute | Expected output | Where output lands |
|---|---|---|
| Run two Claude Code sessions in two watched folders simultaneously, each editing files | Two sessions listed, each showing only its own tool calls; no cross-contamination | browser — screenshot into this epic |
| Compare the files-touched list against `select distinct path from events where session_id=?` | Identical sets | browser + sqlite, both recorded here |
| Let one session idle 90s | It flips to "ended" with a last-activity timestamp | browser |

Not complete until run with two genuinely concurrent sessions.
