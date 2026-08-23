# North Star

## The one sentence

**Point it at a folder and see, live, everything that happens inside it — including what Claude Code is doing — without asking anyone or anything.**

## Who it's for

One developer (the operator), on one Mac, running several projects at once with Claude Code
sessions going in parallel. They lose track of which agent touched which file, and they find out
too late.

## What "done" feels like

Add a folder. Two seconds later, files scrolling. Save a file in your editor — it appears. Claude
edits a file in another window — it appears, labelled `claude`, with the diff. Something touches
`.env` — a toast. Nothing to configure, nothing to install per project.

## Principles

1. **Zero LLM.** Nothing in this product calls a model. Every label, diff, and alert is
   deterministic parsing of files and JSON. If a feature needs inference, it is out of scope.
2. **Zero server dependencies.** Node stdlib only on the backend. Every dependency added is a
   thing that breaks at 3am for a localhost tool.
3. **Observation only, never mutation.** The orchestrator reads. It never writes into a watched
   folder, never kills a session, never edits a file. Read-only is the safety model.
4. **Zero per-project setup.** Watching a folder requires touching only the orchestrator, never
   the watched project. No hooks to install, no config files to drop in.
5. **Live beats complete.** A dropped event is annoying. A two-second lag makes the tool useless.
   Latency wins over guarantees.
6. **Noise is the enemy.** 21,734 files in a real project. A feed that shows everything shows
   nothing. Filtering is a feature, not a setting.

## Non-goals

- Not a git client. Not a CI dashboard. Not a code reviewer.
- No user management of any kind — no accounts, no login, no roles. It binds to localhost and
  stays there; that is the whole security story.
- Not cross-platform. macOS only — the watcher leans on FSEvents on purpose.
- Not a Claude Code controller. It watches sessions; it does not drive them.

## How we'll know it works

The operator leaves it open on a second monitor all day instead of opening it when something has
already gone wrong.
