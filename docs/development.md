# Development

## Hard constraints

These are enforced, not intended. Breaking one fails a test.

**No LLM.** Nothing calls a model or an inference API. Every label, diff and alert is
deterministic. `server/no-llm.test.js` scans every source file for inference endpoints and SDK
names and asserts the server has zero runtime dependencies. A feature that needs a model is out
of scope, not a TODO.

Note the distinction it protects: some *displayed* strings were authored by a model upstream —
Claude Code writes its own `description` for each Bash call, and that text sits in the transcript
before this app reads it. Reading a stored field is not running a model.

**No npm dependencies in the server.** Node stdlib only: `node:fs`, `node:http`, `node:sqlite`,
`node:path`. Frontend dependencies are fine. Adding a server dependency needs an explicit reason.

**Read-only against watched folders.** Never write, move or delete inside a watched tree.

**No user management.** No accounts, no login, no sessions, no roles. Bind to `127.0.0.1` and that
is the entire security model. Anything starting with "who is allowed to…" is out of scope.

**macOS only.**

## Tests

No framework. `node --test` on the server, `node --experimental-strip-types --test` on the web
side.

```bash
npm test                       # both
node --test server/*.test.js   # server only
npm --prefix web test          # web only
npm --prefix web run build     # eslint + tsc + vite build
```

One runnable check per piece of non-trivial logic — the smallest thing that fails if it breaks.
Priority order: event normalisation, ignore-rule matching, transcript parsing, the attribution
join.

| Test | Covers |
|---|---|
| `server/no-llm.test.js` | the no-LLM and no-dependency constraints |
| `server/watcher.test.js` | debounce, rate ceiling, ignore filtering, status |
| `server/spine.test.js` | db, bus, SSE fan-out, routes |
| `server/transcripts.test.js` | record parsing, topics, plumbing filter, attribution, usage dedupe |
| `server/containment.test.js` | the `during-claude` window and its ambiguity rules |
| `server/rules.test.js` | matching, thresholds, cooldown, global cap |
| `server/tree.test.js` | walk, caps, line counting and its prefilters |
| `server/diff.test.js`, `serve-file.test.js`, `pick-folder.test.js` | git diff, path containment, the picker |
| `web/tests/markdown-safety.test.ts` | asserts `rehype-raw` is absent and no `rehypePlugins` prop exists |
| `web/tests/gradient.test.ts` | ramp interpolation, clamping, and that ramps stay hue-disjoint |
| `web/tests/i18n.test.ts` | no hardcoded user-facing strings |
| the rest of `web/tests/` | churn, cost, heat, timeline, grouping, url state, line badges |

## Where code goes

```
server.js        routes and boot
db.js            every query
bus.js           the one emit path
watcher.js       filesystem
transcripts.js   Claude Code
web/src/features one concern per file — pure logic in .ts, UI in .tsx
shared/          anything both server and web need
```

Keep it at roughly this file count. A new concern goes into an existing file until it genuinely
hurts.

## Conventions

**Strings go through `t()`.** English only, one bundle, no plan for a second. The indirection
stays because it is what keeps copy out of components, and there's a test enforcing it. Dates and
numbers go through `Intl` with `config.locale`.

**One gradient method.** `web/src/features/gradient.ts`. A new ramp is a list of stops, never new
interpolation code. Colour only, never element opacity — opacity fades the background with the
text and silently weakens exactly the cold branches a highlight exists to reveal.

**Stock shadcn dark theme.** No custom tokens, no bespoke components, no theme switcher.

**Every column owns its own scroll.** A flex item defaults to `min-height: auto`, so every level
from `SidebarInset` down needs `min-h-0` + `overflow-hidden` or the page scrolls as one.

**A module reachable from `web/tests/` needs explicit `.ts` extensions on its runtime imports.**
Node's type-stripping resolver won't guess them while Vite is happy either way — so an
extensionless import passes `npm run build` and fails only in the test run.

## Before changing the event shape

[`__documentation/source-of-truth/event-contract.md`](../__documentation/source-of-truth/event-contract.md)
is the contract. Changing it is a contract change: edit that file first, then the schema, then the
producers, then `web/src/lib/api.ts`.

Two things are load-bearing there and easy to break by accident:

- `during_tool_event_id` has **no foreign key on purpose**. Retention deletes parents, and a
  dangling pointer must degrade to "renders flat", never to a constraint error.
- Unknown transcript record types are skipped **silently**. The JSONL format changes without
  notice; throwing on an unrecognised `type` breaks the tailer for everything else in the file.

## Read this too

[CLAUDE.md](../CLAUDE.md) holds the gotcha list — every entry cost real time once, and each
records the measurement behind a decision rather than just the decision. Skim it before touching
the watcher, the transcript parser, or anything to do with colour.
