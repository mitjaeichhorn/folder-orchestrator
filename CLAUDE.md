# prj25-folder-orchestrator

Read [north-star.md](north-star.md) first — it holds the product intent and the non-goals.

Monitors selected project folders to full depth and streams every file event, plus Claude Code
tool activity, to a local dashboard. macOS, localhost, single user.

## Hard constraints

- **No LLM.** Nothing in this codebase calls a model or an inference API. All labelling, diffing
  and alerting is deterministic. A feature that needs a model is out of scope, not a TODO.
  **Enforced**, not intended: `server/no-llm.test.js` scans every source file for inference
  endpoints and SDK names and asserts the server has zero runtime dependencies. Note the
  distinction it protects: some *displayed* strings were authored by an LLM upstream (Claude
  Code's own Bash `description`, sitting in the transcript before this app read it). Reading a
  stored field is not running a model. Generating one would be.
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
- **Only ~11% of Claude tool calls name a file.** `Edit`/`Write`/`Read`/`NotebookEdit` carry
  `file_path`; `Bash` and MCP tools carry none, and `Bash` is by far the most common. Measured,
  not guessed. Any file-centric view must therefore have an explicit home for pathless actions —
  never assign one to whichever file happened to change nearby.
- **The topic is the operator's prompt, verbatim.** Claude Code writes a `last-prompt` record;
  we slice it by character count and never by meaning. Tailing starts at EOF, so `primeTopics`
  reads back over the file to recover the current topic — without it, the topic is null until
  the next prompt and every restart loses it.
- **A tool call is recorded when it STARTS.** The transcript writes `tool_use` (with an `id`) at
  the start and `tool_result` (with `tool_use_id`) at the end — so a row can be shown while the
  work is still running, and closed with a real duration when the result lands. Rows from before
  this existed have no `detail.state`; `isRunning` requires `state === 'running'` precisely so
  old rows never animate.
- **Heat is measured in events-ago, not seconds.** The heatmap dims a branch only when other
  branches change. Nothing decays on a timer, so brightness answers "what is being worked on"
  rather than "how long ago was this".
- **The folder picker runs on the host, not in the browser.** `showDirectoryPicker` returns a
  handle, never a path, and the watcher needs a path. `/api/pick-folder` shells out to a *fixed*
  AppleScript via `execFile` — no shell, no interpolation, nothing the client sends reaches it.
- **The heat tree refetches only on structural change.** created/deleted/renamed change the
  shape; modified never does. Debounced, or a build refetches the tree hundreds of times.
- **`/api/file` is an allow-list.** Only image extensions, only inside the folder, and the
  symlink check realpaths *both* sides — on macOS the folder itself often sits under a symlink
  (`/var` → `/private/var`), and comparing a resolved file to an unresolved root rejects
  everything legitimate.

### Transcript format

JSONL, one object per line, appended live. Relevant shapes:
`type: "assistant"` with `message.content[]` blocks where `type === "tool_use"` (has `name`,
`input`); `type: "user"` for prompts; top-level `timestamp`, `sessionId`, `cwd`, `gitBranch`,
`toolUseResult`. Other `type` values (`queue-operation`, `ai-title`, `file-history-snapshot`, …)
are noise — ignore unknown types silently, the format changes without notice.

## UI conventions

- **Every column owns its own scroll.** A flex item defaults to `min-height: auto`, so it grows to
  its content and the whole page scrolls instead. Every level from `SidebarInset` down needs
  `min-h-0` + `overflow-hidden` for the inner scrollers to work. Verified by measuring
  `scrollHeight` vs `clientHeight` per column, not by eye — the layout looked fine while the page
  was scrolling as one.
- **Claude-originated rows carry the real Claude Code mark, not `⌘`.** `⌘` means "command key".
  The path is inlined in `ClaudeIcon.tsx` from thesvg.org/icon/claude-code, filled with
  `currentColor` and toned with Anthropic's `#D97757` — no asset request, no external host.
- **The view switch is not a filter.** Timeline / By topic stays in the feed column; the
  collapsible filter area holds the tabs, kind chips, path glob and time window.

- Stock shadcn dark theme. No custom tokens, no bespoke components, no theme switcher work.
- Components in use: `sidebar`, `tabs`, `table`, `badge`, `toggle-group`, `dialog`, `switch`,
  `resizable`, `scroll-area`, `sonner`.
- **No hardcoded user-facing strings.** Every label, empty state, error and timestamp format goes
  through the translation layer, locale read from config. Applies to the default language too.

## Testing

One runnable check per piece of non-trivial logic — the smallest thing that fails if it breaks.
No framework. Priority order: event normalisation (rename/change -> created/modified/deleted),
ignore-rule matching, transcript parsing, claude/external attribution join.
