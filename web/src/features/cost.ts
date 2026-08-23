import type { OrchEvent } from '@/lib/api'

/**
 * Which rows cost no tokens.
 *
 * A row is free when nothing about it passed through a model. Filesystem events
 * come from `fs.watch` and alerts come from our own rules, so both are free by
 * construction — not by measurement, and not by a threshold that could drift.
 * Tool calls and prompts are Claude turns: the command text goes up and the
 * result comes back, and both are billed.
 *
 * Note what this does NOT claim. A free row can still be the *consequence* of an
 * expensive call — the files a `Bash` run wrote are free rows nested under a
 * billed parent. The cost sits on the call, never on what it touched. That is
 * the same separation the attribution join keeps: the filesystem event is
 * evidence of work, not the work itself.
 *
 * Wall time is free too, which is the counter-intuitive half: a 90s test run
 * bills exactly what a 0.1s one does, because nothing accrues while a command
 * executes. So the hatch marks rows, and the duration beside a call is a
 * separate reading — long is not the same as expensive.
 *
 * Kept free of runtime imports so it stays directly testable, like `authored.ts`.
 */

/** Kinds that originate from a Claude turn, and therefore cost tokens. */
const BILLED_KINDS = new Set(['tool', 'prompt'])

/** Did this row cost zero tokens? */
export function isFree (e: Pick<OrchEvent, 'kind'>): boolean {
  return !BILLED_KINDS.has(e.kind)
}

/**
 * Diagonal hatch plus muted text.
 *
 * The stripes are a background *image*, so the row's own background colour still
 * shows between them — hover and selection keep reading through the hatch rather
 * than being covered by it. Muting is a text colour, not element opacity, for
 * the reason `gradient.ts` records: opacity would also dilute the hatch and any
 * highlight layered on the row.
 */
export const FREE_ROW_CLASS = 'orch-free text-muted-foreground'
