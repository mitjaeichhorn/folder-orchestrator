/**
 * Row height carries elapsed time: a row is taller when more time passed since
 * the event below it. The dashed rule under the timestamp is that duration made
 * visible, so a burst of work looks dense and a pause looks like a pause.
 */
export const PX_PER_SECOND = 3
export const MIN_GAP_PX = 0
export const MAX_GAP_PX = 180          // ponytail: hard cap. A 2h pause is not 21,600px.
export const CAP_SECONDS = MAX_GAP_PX / PX_PER_SECOND   // 60s

/** Pixels of dash to draw for a gap. Always finite, always within the cap. */
export function gapPx (deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return MIN_GAP_PX
  return Math.min(MAX_GAP_PX, Math.round((deltaMs / 1000) * PX_PER_SECOND))
}

/** True when the real gap is longer than the cap can show — the UI must say so. */
export const isCapped = (deltaMs: number) =>
  Number.isFinite(deltaMs) && deltaMs / 1000 > CAP_SECONDS

/** Compact duration label. Character formatting only — no locale words. */
export function fmtGap (deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return ''
  const s = Math.round(deltaMs / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
}

/**
 * Gaps for a newest-first list: gaps[i] is the time between rows[i+1] (older)
 * and rows[i]. The last row has no predecessor in view, so its gap is 0.
 */
export function gaps (tsNewestFirst: number[]): number[] {
  return tsNewestFirst.map((ts, i) =>
    i + 1 < tsNewestFirst.length ? Math.max(0, ts - tsNewestFirst[i + 1]) : 0)
}
