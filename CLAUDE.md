# prj25-folder-orchestrator

Read [north-star.md](north-star.md) first — it holds the product intent and the non-goals.

Monitors selected project folders to full depth and streams every file event, plus Claude Code
tool activity, to a local dashboard. macOS, localhost, single user.

## Hard constraints

- **No LLM.** Nothing in this codebase calls a model or an inference API. All labelling, diffing
  and alerting is deterministic. A feature that needs a model is out of scope, not a TODO.
- **No npm dependencies in the server.** Node stdlib only (`node:fs`, `node:http`, `node:sqlite`,
  `node:path`). Frontend deps are fine. Adding a server dep needs an explicit reason in the PR.
- **Read-only against watched folders.** Never write, move, or delete inside a watched tree.
- **macOS only.** `fs.watch` recursive does not exist on Linux; we accept that.
- **No user management.** No accounts, no login, no sessions, no roles, no permissions table.
  One operator, one machine. Bind to `127.0.0.1` and that is the entire security model. Anything
  that starts with "who is allowed to…" is out of scope.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Watcher | `fs.watch(dir, {recursive:true})` | FSEvents-backed, one stream per tree, full depth, zero deps |
| Claude activity | tail `~/.claude/projects/<slug>/*.jsonl` | zero per-project setup, works retroactively |
| Transport | SSE (`text/event-stream` + `EventSource`) | one-directional, native both ends, no ws lib |
| Storage | `node:sqlite` | built into Node 25, no dep |
| Frontend | Vite + React + Tailwind + **shadcn/ui, stock dark theme** | operator's standing choice |

Verified on this machine (Node v25.8): recursive watch fires for directories created *after* the
watch starts, to arbitrary depth. `node:sqlite` is present. Don't re-litigate these.

## Layout

```
server.js     watch trees + tail transcripts -> normalise -> sqlite -> SSE
db.js         node:sqlite, events table, index on (folder_id, ts)
web/          Vite + React + shadcn
```

Keep it at this file count. New concerns go into an existing file until it genuinely hurts.

## Things that will bite you

- **macOS only reports `rename` / `change`.** Neither means what it says. `stat()` the path to
  decide created / modified / deleted. Missing path = deleted.
- **Ignore rules are load-bearing, not a preference.** A real project here is 21,734 files;
  14,978 excluding `node_modules` and `.git`. Filter *before* the event reaches SQLite or SSE,
  never in the UI.
- **Editors fire event storms.** One save can produce several events (atomic write = temp file +
  rename). Debounce per path (~50ms) at the source.
- **Attribution is a join, not a fact.** The filesystem does not say who wrote a file. A row is
  labelled `claude` only when a transcript tool call matches the same path within a short time
  window. When there's no match, say `external` — never guess.
- **Diffs are free, so don't compute them.** `Edit` tool calls in the transcript carry
  `old_string` / `new_string`. Use those. No git, no snapshotting, no model.

### Transcript format

JSONL, one object per line, appended live. Relevant shapes:
`type: "assistant"` with `message.content[]` blocks where `type === "tool_use"` (has `name`,
`input`); `type: "user"` for prompts; top-level `timestamp`, `sessionId`, `cwd`, `gitBranch`,
`toolUseResult`. Other `type` values (`queue-operation`, `ai-title`, `file-history-snapshot`, …)
are noise — ignore unknown types silently, the format changes without notice.

## UI conventions

- Stock shadcn dark theme. No custom tokens, no bespoke components, no theme switcher work.
- Components in use: `sidebar`, `tabs`, `table`, `badge`, `toggle-group`, `dialog`, `switch`,
  `resizable`, `scroll-area`, `sonner`.
- **No hardcoded user-facing strings.** Every label, empty state, error and timestamp format goes
  through the translation layer, locale read from config. Applies to the default language too.

## Testing

One runnable check per piece of non-trivial logic — the smallest thing that fails if it breaks.
No framework. Priority order: event normalisation (rename/change -> created/modified/deleted),
ignore-rule matching, transcript parsing, claude/external attribution join.
