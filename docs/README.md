# Documentation

Reference material for Folder Orchestrator. The [project README](../README.md) explains *why*
this exists; these files explain *how it works*.

| File | What's in it |
|---|---|
| [architecture.md](architecture.md) | The pipeline end to end — watcher, transcripts, bus, SSE, frontend |
| [data-model.md](data-model.md) | The Event contract, the SQLite schema, and the invariants both must hold |
| [api.md](api.md) | Every HTTP route and every SSE frame |
| [operations.md](operations.md) | Running it, environment variables, logs, retention, troubleshooting |
| [development.md](development.md) | Tests, hard constraints and how they're enforced, where to add code |

Two other files are load-bearing and live outside `docs/`:

- [north-star.md](../north-star.md) — product intent and non-goals. Read first.
- [CLAUDE.md](../CLAUDE.md) — the gotcha list. Every entry cost real time once; each records
  the measurement behind a decision, not the decision alone.

Images the README links to live here too: the recorded walkthrough is `demo.gif`, the stills
are in [screenshots/](screenshots/).
