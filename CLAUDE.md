# Folder Orchestrator

Read [north-star.md](north-star.md) first — it holds the product intent and the non-goals.
Reference documentation is in [docs/](docs/): [architecture](docs/architecture.md), [data model](docs/data-model.md), [API](docs/api.md), [operations](docs/operations.md), [development](docs/development.md).
This file is the gotcha list, not the reference — it records what cost time, not what exists.

Monitors selected project folders to full depth and streams every file event, plus Claude Code
tool activity, to a local dashboard. macOS, localhost, single user.

## Hard constraints

- **Project-agnostic, enforced.** No project name, branch name or machine-specific absolute path
  belongs in code, comments, tests or docs. The measurements behind every threshold here are worth
  keeping — "the five longest files were all append-only logs" is why a rule exists — but the NAMES
  are not: a tool carrying one operator's folder names reads as theirs, and on a public repository
  it publishes what they were working on. Say "a 14,000-file project", never which one.
  `server/agnostic.test.js` scans every tracked file for `/Users/…`, a local dev root, and the
  operator's own project-prefix naming scheme. It found a leaked example path in `docs/api.md` on
  its first run — and then caught this very paragraph for spelling the forbidden prefix out while
  describing it, which is why the guard builds its patterns from concatenated parts. Watched-folder names in the database are DATA, not code, and are untouched by this.

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

- **The rename window is 500ms, and that is safe because matching is by inode.** Under heavy
  filesystem load FSEvents can deliver the delete and the create hundreds of ms apart, and a
  narrow window reports a rename as delete+create. An inode reappearing at a different path IS a
  rename, so widening cannot pair unrelated files.
- **macOS only reports `rename` / `change`.** Neither means what it says. `stat()` the path to
  decide created / modified / deleted. Missing path = deleted.
- **Ignore rules are load-bearing, not a preference.** A real project here is 21,734 files;
  14,978 excluding `node_modules` and `.git`. Filter *before* the event reaches SQLite or SSE,
  never in the UI.
- **Editors fire event storms.** One save can produce several events (atomic write = temp file +
  rename). Debounce per path (~50ms) at the source.
- **Content wraps, tags crop.** A truncated path hides its TAIL — the filename, the one part that
  identifies it — so `…/internal/rou…` was the least useful 40 characters on offer; row content is
  therefore never cropped. Paths have no spaces, so `break-words` alone will not split them: it
  takes `overflow-wrap: anywhere`. A session-name badge is a TAG, not content — one line, ellipsis,
  full name in the `title` — because a wrapping pill changes the row's height for a label that is
  the same on every row of that agent's work. Rows are variable height either way, so the feed is
  taller than it was; that is the trade.
- **The row's pill names the AGENT, and its FORM carries the attribution.** It used to read
  "claude" or "during", which was nearly free of information — a tool row is Claude by definition —
  while *which* of several agents did it was shown nowhere. The pill now says the session's name,
  and the distinction the old label carried survives as its shape: solid for a hard path join,
  outline for co-occurrence. A row with no session at all falls back to the actor word rather than
  rendering an empty pill. The column is `w-32`, set in the `<colgroup>` — widening the `<td>`
  alone does nothing under `table-fixed`.
- **Several agents work in one repo, and the feed used to read as one stream.** Measured: three
  concurrent sessions on this project inside an hour, four within a day. Every tool event already
  carried `session_id` and nothing showed it. The chip's colour is assigned by SORTED ORDER, never
  by hashing the id — a hash can put two of three sessions in the same colour, which is precisely
  the failure the chip exists to prevent. The palette (teal, fuchsia, cyan, pink, lime-200) avoids
  every hue already carrying meaning; past five sessions it wraps, which is documented rather than
  silent. The chip appears only when more than one session is present.
- **Claude Code names its own sessions, in `ai-title` records the parser used to discard.** Three
  of this project's four sessions had names sitting on disk — "Formatting proposal", "Unrendered md
  code", "Documentation into docs as md files" — while the UI showed hex. The name is generated by
  a model UPSTREAM and is in the file before this app opens it: reading a stored field is not
  running one, the same distinction the Bash `description` already relies on, and `no-llm.test.js`
  asserts it is read and never derived. Recovered in `primeTopics` for the same reason topics are —
  tailing starts at EOF and an `ai-title` record is occasional, so without reading back every
  existing session stays nameless until Claude Code happens to retitle it.
- **`gitBranch` and `cwd` come free off the same records and are what separate worktrees.** Two
  agents can edit the same *relative* path on different branches. Stored in a `sessions` table
  upserted only when a value actually changes — a transcript line is parsed per record, and an
  unconditional upsert would be a database write per line. Context only accrues for records tailed
  after this existed; older sessions show nothing rather than a guess.
- **Attribution is a join, not a fact.** The filesystem does not say who wrote a file. A row is
  labelled `claude` only when a transcript tool call matches the same path within a short time
  window. When there's no match, say `external` — never guess.
- **Diffs come from two sources, and most files need the second one.** `Edit`/`MultiEdit` tool
  calls carry `old_string` / `new_string` — free, exact, scoped to that one call. Everything
  else (Bash, a formatter, the operator's editor) carries nothing, and that is the majority:
  `/api/diff` asks git instead. This is working-tree-vs-HEAD, **not** the diff of one event, so
  the panel labels which. Claude Code also keeps per-session backups under
  `~/.claude/file-history/<sessionId>/<hash>@vN` (named in `file-history-delta` records) — a
  third source if a project is ever not a git repo.
- **Only ~11% of Claude tool calls name a file.** `Edit`/`Write`/`Read`/`NotebookEdit` carry
  `file_path`; `Bash` and MCP tools carry none, and `Bash` is by far the most common. Measured,
  not guessed. Any file-centric view must therefore have an explicit home for pathless actions —
  never assign one to whichever file happened to change nearby.
- **Claude Code writes `user` records to itself, and they are not prompts.** `/compact` alone
  emits four — `<command-name>`, a caveat, `<local-command-stdout>`, and the continuation
  preamble the next session opens with. They arrive on exactly the same record shape as a real
  prompt, so they rendered as raw XML in the feed AND became topics, filing every later action
  under `<command-name>/compact`. `isOperatorPrompt` matches the wrapper tags rather than the
  prose inside them: the tags are structure and stable, the wording is not. Measured over two
  transcripts: 69 real prompts to 5 of these.
- **The topic is the operator's prompt, verbatim.** Claude Code writes a `last-prompt` record;
  we slice it by character count and never by meaning. Tailing starts at EOF, so `primeTopics`
  reads back over the file to recover the current topic — without it, the topic is null until
  the next prompt and every restart loses it.
- **A tool call is recorded when it STARTS.** The transcript writes `tool_use` (with an `id`) at
  the start and `tool_result` (with `tool_use_id`) at the end — so a row can be shown while the
  work is still running, and closed with a real duration when the result lands. Rows from before
  this existed have no `detail.state`; `isRunning` requires `state === 'running'` precisely so
  old rows never animate.
- **Token usage is on disk already.** Every assistant record carries a `message.usage` block
  (input, output, thinking, cache read/creation). Joined to the topic we already track, that
  answers "which task cost the most" with no extra instrumentation. It lives in its own
  `token_usage` table, not the event stream — 500+ usage rows would drown the feed. `message_id`
  is UNIQUE and the insert is `OR IGNORE`, so re-reading a transcript never double-counts.
- **First tail reads the WHOLE transcript.** Tailing starts at EOF, so history is invisible
  otherwise — and for token accounting, history is the entire feature. The full pass is
  idempotent thanks to the dedupe above.
- **Repeated file events are real, not a bug.** A tool that writes a file then formats it emits
  two genuine events ~200ms apart; at second-resolution they read as a duplicated row. The feed
  collapses consecutive same path+kind+actor rows inside 2s into one carrying a count. Never drop
  the data — the count is what makes the repetition visible. Tool, prompt and alert rows are
  never collapsed: each is separate work, however close together.
- **Heat stamps a BURST once, on its directory.** A wholesale directory appearing is one thing
  happening, not N things: creating a git worktree inside a watched folder wrote 500 files in a
  second, lit 202 paths, and left "Active only" showing most of the tree — the map answered
  "what was checked out" rather than "what is being worked on". `heatPaths` runs the *same*
  `collapseBursts` the feed uses, deliberately not a second implementation, so the two views
  agree on what counts as one action. A burst at the project root has `dir === ''` and stamps
  nothing: stamping `''` would mark every path in the tree.
- **An "active" branch is one still INSIDE THE GRADE, not merely one that was touched.** It used
  to be membership in the stamp map, independent of how far a path had dimmed — and that was
  indistinguishable from the grade while the client held ~200 events: measured, 31 stamped and 31
  graded. Raising the SSE backfill to 1000 for the proposition rules turned that into 88 stamped
  against the same 31, so 57 paths sat at the muted floor: present, grey, carrying no signal, and
  pushing the ones that did off the screen. `inGrade` keys visibility to `heatOf > MIN_HEAT`, which
  also makes the tree independent of how much history the client happens to hold — the same work
  looks the same at a buffer of 200 or 2000. Because every ancestor of a touched path is stamped,
  filtering still preserves the whole route to a changed file, with no descendant search.
- **The heat ramp is white -> yellow -> orange -> muted grey**, interpolated in OKLab so the
  midpoints stay even instead of going muddy the way sRGB blending does. Pure white means the
  path was touched by the most recent event; the grey floor means untouched.
- **"Being worked on right now" has two sources, and the obvious one is nearly useless.** A tool
  call that names a file (`Edit`/`Write`/`Read`) finishes in milliseconds, while the calls that
  run long (`Bash`, MCP) name no file — so pulsing only named paths would pulse almost nothing.
  `runningPaths` therefore also includes files the watcher saw change *while* a call was in
  flight. Note what that claims: the change happened during a running command, not that the
  command caused it. Co-occurrence, not causation — the same restraint the attribution join uses.
- **A heat-tree file opens the panel only if we have an event for it.** The panel describes an
  *event* — diff, actor, duration — while the tree lists every file in the project, including ones
  the watcher never saw change. Those render as inert `div`s rather than buttons, so there is no
  click that silently does nothing: measured with "Active only" off, 30 of 158 leaves are openable.
  `newestEventByPath` compares `ts` (then `id`) rather than array position, because the stream
  arrives oldest-first while the feed reverses it — "first match wins" would be right for one
  caller and quietly wrong for the other.
- **Only the top THREE grades pulse — white, yellow, orange.** A path can sit in the `running` set
  while having cooled into the muted tail: the call that named it is still open, but a dozen other
  things have happened since, so it is no longer where the work is, and pulsing there draws the eye
  to the coldest thing on screen. `shouldPulse` takes the same `share` the colour uses, so the
  animation and the hue can never disagree about which grade a row is in, and `PULSE_FLOOR` is read
  off `HEAT_STOPS` rather than written as a number — change the ramp and the boundary moves with it.
  Measured: the share is still 0.5 at half of `HEAT_SPAN` and crosses the 0.4 floor at about 25 of
  40 events.
- **Only a FILE pulses as "being edited".** Directories emit their own filesystem events — a
  mkdir writes an event whose path IS the directory — so pulsing on path alone lights up a whole
  branch. `shouldPulse` requires `node.d === 0`.
- **A restart orphans in-flight tool calls.** They are written `running` and closed when the
  result is tailed; tailing resumes at EOF, so results written before the restart are never seen
  and those rows claim to be running forever — which also drags the work-in-progress window back
  hours and pulses everything. Boot sweeps them to `unknown`, never `done`: we cannot know how
  they ended. `runningSince` additionally ignores anything past the stall cap.
- **Heat is measured in events-ago, not seconds.** The heatmap dims a branch only when other
  branches change. Nothing decays on a timer, so brightness answers "what is being worked on"
  rather than "how long ago was this".
- **The folder picker runs on the host, not in the browser.** `showDirectoryPicker` returns a
  handle, never a path, and the watcher needs a path. `/api/pick-folder` shells out to a *fixed*
  AppleScript via `execFile` — no shell, no interpolation, nothing the client sends reaches it.
- **Long-file counting is prefiltered three ways, and the cheap ones matter.** Counting lines
  means reading files, so the walk filters by extension, then by size — a file under 1000 bytes
  cannot hold 1000 newlines, which is a bound rather than a guess — then probes for a NUL byte.
  Without that last one a SQLite file and a browser cache blob topped the list with their binary
  noise counted as lines. Cached on path+size, because the tree refetches on every structural
  change: 591ms cold, 170ms warm on a 4,783-file project. `.jsonl` is exempt with `.json` —
  a line-delimited log is thousands of lines by definition, and the five longest files in the
  test project were all append-only logs.
- **Length tiers are discrete steps, not a ramp — and they run hotter toward yellow.** Three
  steps (muted / orange >2000 / yellow >3000) say "long", "longer", "worst" and nothing finer;
  interpolating would give 2,001 and 2,002 lines different colours, a distinction with no
  meaning, which is why this does not go through `gradient.ts`. Yellow outranking orange is the
  reverse of a traffic light and deliberate: it matches the heat ramp's own white -> yellow ->
  orange -> grey. Note the cost — that ramp and these badges now share a hue family and can be
  on screen together, which the colour rules otherwise forbid. They are separated by column and
  by shape (a pill, never a tree row), not by hue.
- **The PATH is the locate control; there is no per-row button any more.** Hovering any segment —
  folder or filename — lights that prefix in every other path on screen and reveals it in the heat
  tree. The old `FolderTree` button was kept always-visible-but-dim because "hidden-until-hover made
  the feature undiscoverable, there was nothing on screen to aim at"; that reasoning applied to a
  14px target and does not survive the whole path becoming one. `FilePath` reads the hovered prefix
  from a CONTEXT rather than props: it is rendered by six components across four views, several
  nested two or three levels inside a row or tile, so threading it would be ~15 prop additions to
  say one thing and every new view would have to remember.
- **Prefix matching is per SEGMENT, never `startsWith`.** These trees contain `app`,
  sibling directories whose names share a leading word; a string prefix lights all of them when you
  point at the first. Verified live on such a tree: hovering the longer name stops there.
- **One locate affordance deliberately survives** — the "Show in project tree" button in the
  proposition panel. It is a considered action in an off-canvas, not row furniture, and it is what
  keeps `feed.locate`, `chainOf`, `revealPredicate` and the `LOCATE_*` classes reachable from `src`.
  `LOCATE_ICON_TONE` is now referenced only by tests; both live call sites hardcode the blue.
- **The heat tree marks a long file with an icon, and its base tier CANNOT be muted.** Same rule
  and same ranking as By file — it calls `showsLineBadge` rather than restating the threshold — but
  the tones are `lineIconTone`, not `lineTone`. Reusing `lineTone` shipped an invisible alert: its
  base tier is `text-muted-foreground`, which is fine on a pill that carries the number and
  measured `oklch(0.708 0 0)` as a bare 10px glyph at the panel edge. The base tier is where most
  flagged files live — 130 over 1,000 lines against far fewer above 2,000 — so nearly every mark was
  invisible. Floor lifted to amber, size to 12px. Lucide icons take no `title` prop; it goes on a
  wrapper span.
- **The long-file badge is one rule; the exemption lives in the FILTER.** Showing the count
  everywhere but exempting python from the badge left the feed, By topic and the detail panel
  permanently blank — measured live, all five long files present in the feed were `.py`, and the
  panel for a 1,648-line `test_runner.py` showed nothing. Only By file has filters, so only By
  file can express "not python"; a rule that hides the answer where it cannot be un-hidden is a
  bug, not a rule. The tree is fetched ONCE in `Workspace` and the path→lines map passed down —
  `FileList` used to fetch its own copy, so four surfaces cost one request fewer than one did.
- **Measuring a file and badging it are two lists, not one.** Python is counted but carries no
  badge in the default view — the operator's call — which is exactly why the executables filter
  can show it: 40 of that project's 58 long executables are `.py`, and a single exemption list
  would have made them unreachable rather than merely unbadged. `isExecutablePath` is what
  separates code from generated bulk: it drops four vendored `base.css` copies and a `uv.lock`
  that are long because they are generated, not because anyone should split them.
- **The tree fetch that carries LINE COUNTS refetches on modifications too.** The heat tree only
  needs the shape, so it refetches on created/deleted/renamed — but a file crossing 1,000 lines is a
  *modification*, and sharing that trigger left the badge stale until something happened to be
  created or deleted. Debounced 1.5s, or a build refetches once per file it touches; the server's
  per-file cache means only the changed file is re-read.
- **The line cache keys on path + size + MTIME.** Size alone looks sufficient and is not: an edit
  can leave the byte count identical — swapping a character, or rewriting a line to the same length
  — and a size-only key then serves the old count forever. Pinned by a test that rewrites a file to
  an identical size and asserts the count changes.
- **The tree is NOT capped by node count, and the cap it used to have was guarding nothing.** A
  12,000-node ceiling cut the walk off mid-alphabet on a 16,000-file project: it spent the budget on
  the alphabetically early directories and never reached the ones where the work was, so
  **all 60** of the most recently changed paths fell outside the result and the heat panel read
  "0 paths — nothing has changed yet" while the feed scrolled. The first measurement said the full
  walk was ~175,000 nodes, which argued for keeping the cap — but that was measured WITHOUT the
  ignore rules. With them applied it is 16,184 nodes in 209ms; the deny-dirs and `.gitignore` do the
  real work. Uncapped costs 2.07MB and 254ms warm. `MAX_DEPTH` stays as a loop guard: the deepest
  real tree here is 9.
- **"Active only" builds its tree from the EVENTS, not from `/api/tree`.** Independent of anything
  the walk reaches, which is what makes the view immune to a repeat of the above.
- **The heat tree refetches only on structural change.** created/deleted/renamed change the
  shape; modified never does. Debounced, or a build refetches the tree hundreds of times.
- **Markdown from a watched folder is untrusted input to our page.** A watched tree can be any
  repo you cloned, and markdown permits embedded HTML. `react-markdown` drops raw HTML unless
  `rehype-raw` is added — so the safe behaviour is the default one, and the control is a test
  asserting that plugin is absent from `package.json` and that no `rehypePlugins` prop exists.
  `remark-gfm` is fine: it is a *parser* extension (tables, task lists), not an HTML one, and
  without it this file's own stack table renders as a wall of pipes.
- **`/api/file` is an allow-list.** Image extensions plus markdown, only inside the folder, and the
  symlink check realpaths *both* sides — on macOS the folder itself often sits under a symlink
  (`/var` → `/private/var`), and comparing a resolved file to an unresolved root rejects
  everything legitimate.

### Transcript format

JSONL, one object per line, appended live. Relevant shapes:
`type: "assistant"` with `message.content[]` blocks where `type === "tool_use"` (has `name`,
`input`); `type: "user"` for prompts; top-level `timestamp`, `sessionId`, `cwd`, `gitBranch`,
`toolUseResult`. Other `type` values (`queue-operation`, `ai-title`, `file-history-snapshot`, …)
are noise — ignore unknown types silently, the format changes without notice.

- **Propositions are the one place the app INTERPRETS its own data, and the rules were mostly
  deleted rather than tuned.** "Tokens spent with no writes" fired on topics with zero events —
  usage is read from the whole transcript while events are only this folder, so it measured
  bookkeeping. "Consecutive failing calls" found 0 of 76 errors retried with identical input.
  "Repeated identical command" found 1 in 7,349 events. What survived is mostly not "the agent is
  stuck" but structural strain: files too long, files two agents fight over.
- **`stalled` is the only rule asked in the PRESENT TENSE, and that is why it exists.** As a
  retrospective rule it fired 41 times and resolved 41 times, longest after 60 minutes — so I
  deleted it. That measurement could not have found a counterexample: an unresolved stretch is by
  definition still open and never in the history. Three conditions, each removing a different false
  positive — long since a write, calls still landing, and those calls SPANNING a stretch. Without
  the third it reported 602-minute stalls that were mornings, because work resumes with a few Bash
  calls before anything is written. The minutes reported are time SPENT working, measured over the
  current unbroken run of calls, not time since the last write; across a break those differ by ten
  hours.
- **Alerts anchor by PATH, never by event id.** The feed collapses consecutive writes to one file,
  so a churned file's anchor event is precisely the one most likely to have been merged away and
  never rendered. Keyed on the id, not one band ever appeared.
- **The SSE backfill has to cover the window the client's rules reason over.** It was 200 events
  against a client buffer of 2000; at 200 no alert rule could ever fire. 1000 events is ~450KB per
  connection, measured.

- **`features/` is grouped by view, and the `.ts` / `.tsx` split inside it is LOAD-BEARING.** The
  test runner is `node --experimental-strip-types --test`, which cannot load `.tsx` — so a module a
  test needs must be `.ts`, and must import by relative path, never through the `@/` alias Vite
  resolves and Node does not. That constraint is why the codebase keeps extracting logic into a
  plain module beside its component (`lines.ts` / `LineBadge.tsx`, `lane-layout.ts` /
  `LaneView.tsx`). It is the testable-core boundary, enforced by the toolchain rather than by
  discipline.
- **Moving files breaks more than imports.** The reorganisation rewrote 125 import statements
  cleanly and still left three failures: two `await import()` calls, which are not `from` clauses,
  and a `readFileSync` path in the markdown safety test. Grep for the old paths as STRINGS, not just
  as imports — and note one fixture legitimately contains `features/contest.ts`, which must not be
  rewritten.

## UI conventions

- **Every column owns its own scroll.** A flex item defaults to `min-height: auto`, so it grows to
  its content and the whole page scrolls instead. Every level from `SidebarInset` down needs
  `min-h-0` + `overflow-hidden` for the inner scrollers to work. Verified by measuring
  `scrollHeight` vs `clientHeight` per column, not by eye — the layout looked fine while the page
  was scrolling as one.
- **Claude-originated rows carry the real Claude Code mark, not `⌘`.** `⌘` means "command key".
  The path is inlined in `ClaudeIcon.tsx` from thesvg.org/icon/claude-code, filled with
  `currentColor` and toned with Anthropic's `#D97757` — no asset request, no external host.
- **The sidebar rate is polled; nothing pushes it.** `/api/folders` carries each folder's
  status, but it was fetched once at load, so every row froze at whatever the rate was when the
  tab opened and an actively-worked project read `idle` indefinitely. SSE status frames only
  cover the OPEN folder, so the other rows have no live source at all. The poll merges the
  status field alone — re-running the loader would also re-pick the active folder, letting a
  timer fight the operator's own selection — and runs at the server's 10s `RATE_WINDOW`, since
  a faster poll resamples the same window and shows noise rather than news.
- **The open project lives in the URL hash.** A reload, a bookmark or a second tab lands on the
  same folder. A hash rather than a path because the server serves index.html for unknown paths —
  a hash never reaches it, so there is nothing to misroute. A URL naming a folder that no longer
  exists falls back to the previous selection, then the first; it never blanks the screen.
- **In the lane view the TILE and the TIME are separate elements, and that is the whole point.**
  While they were one box, the tile's minimum readable height was also the floor on expressible
  duration — everything from 0 to ~3s rendered identically. Split, the tile owns legibility and the
  connector owns duration, so the scale starts at one second. The connector measures back to the
  previous tile IN ITS OWN LANE, never to the row above: Work landing every few seconds while Test
  climbs past ten minutes is the picture, and a per-row gap would print one number three times.
- **Time hangs DOWNWARD from each tile, newest still on top.** The connector under a tile is the
  wait that preceded it, measured to the previous tile in the same lane, which sits below it — read
  the tile, then read down to see how long it took to arrive. `laneRows` still computes gaps
  oldest-first because a gap is only definable against a predecessor; the row list is reversed for
  display. Now is the CEILING, so each lane opens with the silence since it last did anything,
  still growing. Same anchor as every other view: pinned to the top.
- **Same-millisecond events in one lane collapse to a `×n` tile, for a mechanical reason.**
  `watcher.js` stamps `ts` when its 50ms debounce FLUSHES, so paths changed by one operation are
  written with one identical timestamp — measured, 6% of events here and 31% on the larger project
  share an exact millisecond, in clusters up to 12. Same millisecond means one action. Rendering it
  as N tiles each claiming `0.0s` would invent N events from one batch, and ordering inside such a
  cluster comes only from insertion order, which is not causal.
- **The lane view's spine is half the data, not a leftover.** Planning / work / test are columns,
  but ~half of all events name no file at all — 53% here, 45% on a larger project — because `Bash`,
  MCP calls and prompts carry no path. Those render FULL WIDTH, which is what ties the three lanes
  to one clock. A design that put them in a fourth column, or dropped them, would hide half the
  session. Measured lane switching between consecutive sided events is 22% here and 10% on the
  larger project, which is why the view reads as blocks rather than confetti.
- **The test lane must know more than `.test.`.** The first rule knew only the JS conventions plus
  `tests/`, and passed on this repo purely because its python tests happen to live under `tests/`.
  Measured against the wider tree it filed **18 real test files as work** and missed pytest's
  `test_*.py`, Go's `*_test.go`, RSpec's `spec/` and `*_spec.rb`, and JUnit's `*Test.java`. Note
  what that near-miss looked like: the observed percentages barely moved after the fix, because
  those files were dormant during the sample — a broken rule can look correct while nobody touches
  the files it gets wrong. `spec/` matches but `specs/` does not: singular is RSpec, plural is
  written specifications. Every pattern is anchored to a path segment or an extension, never a bare
  substring, so `latest/`, `contest.ts` and `testing-doctrine.md` stay put.
- **Lane classification is the first thing here that INTERPRETS rather than reports.** "This file
  is planning" is a convention, not an observation — unlike every other label in this app, which
  joins one observation to another. The rules are therefore small, ordered and in one file:
  `test` is checked before `planning` so a `.md` fixture in a test directory does not inflate the
  planning lane, and before `work` because a test is work by any other measure. Still zero model:
  it is path matching, the same machinery the ignore rules use.
- **The heat header's fold controls only exist while the filter is off.** Under "Active only"
  every folder rendered is active by construction, so "collapse the inactive ones" has nothing to
  act on and reads as a broken button — measured on a 16,000-file tree: filter off it takes 1,754
  open folders down to 5; filter on the tree does not move. It is hidden rather than disabled,
  because a control that cannot act should not be on screen. Note also what it is NOT: it was
  mistaken for a "show the whole tree" button, which is the *switch*. The unfold icon beside it is
  that undo, and the switch now carries a title saying which is which.
- **The view switch is not a filter.** Timeline / By topic stays in the feed column; the
  collapsible filter area holds the tabs, kind chips, path glob and time window.

- Stock shadcn dark theme. No custom tokens, no bespoke components, no theme switcher work.
- Components in use: `sidebar`, `tabs`, `table`, `badge`, `toggle-group`, `dialog`, `switch`,
  `resizable`, `scroll-area`, `sonner`.
- **English only, but strings still go through `t()`.** There is one bundle and no plan for a
  second. The indirection stays because it is what keeps copy out of components — adding a locale
  later becomes a new JSON file rather than an archaeology pass through every screen — and the
  lint guard that enforces it is the same mechanism. Dates and numbers go through `Intl`.

## Colour ramps

There is **one** gradient method — `web/src/features/gradient.ts`. A new ramp is a
list of stops, never new interpolation code. The rules it encodes:

- Stops run hot → cold, `at` is a position on the 0..1 scale, and callers
  normalise their own units first (`shareOf`) so the ramp never knows what it
  measures.
- Interpolation is `color-mix(in oklab, …)`; endpoints return their stop verbatim
  so "fully hot" is exactly the declared colour.
- Input is clamped including non-finite — a ramp must never emit `NaN%`, which
  renders as nothing.
- **Colour only, never element opacity.** Opacity fades the background as well as
  the text, which silently weakened the locate highlight on precisely the cold
  branches it exists to reveal: a 12% band resolved to under 6%. Measured, not
  theoretical.
- Two ramps that can appear together must not share a hue family — two signals in
  one colour read as one signal. Recency is white→yellow→orange→grey, churn is
  sky→violet→rose, locate is blue-400, and there are tests asserting they stay
  disjoint.

## Gotchas that cost time once

- **index.html must not be cached.** It names the content-hashed bundle, so a cached copy
  silently serves the previous build — changes appear to have no effect and you debug code that
  is not running. Served `no-cache, must-revalidate`; hashed assets are `immutable`.
- **`table-fixed` takes its widths from the FIRST row.** The feed's first row is a
  `colSpan={5}` running indicator whenever a call is in flight, so the browser could not derive
  per-column widths and split the table into five equal columns — a layout that collapsed only
  while something was running, which is why it looked intermittent. A `<colgroup>` pins the
  widths regardless of what the first row happens to be.
- **A module reachable from `web/tests/` must use explicit `.ts` extensions on its
  runtime imports.** Node's type-stripping resolver will not guess them, while Vite
  is happy either way — so an extensionless import passes `npm run build` and fails
  only in the test run.
- **shadcn components hardcode variant-scoped classes.** `SheetContent` carries
  `data-[side=right]:sm:max-w-sm`; a plain `sm:max-w-2xl` loses to it and tailwind-merge will not
  dedupe across different variants. Override using the same variant form.

## Testing

One runnable check per piece of non-trivial logic — the smallest thing that fails if it breaks.
No framework. Priority order: event normalisation (rename/change -> created/modified/deleted),
ignore-rule matching, transcript parsing, claude/external attribution join.
