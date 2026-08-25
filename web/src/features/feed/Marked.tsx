import { splitOn } from './entities'

/**
 * Tints the names that recur across the rows on screen, so a run of commands
 * chasing one branch or one file reads as one thing.
 *
 * A neutral tint, never a hue: the colour rules already spend white→yellow→orange
 * on recency, sky→violet→rose on churn and blue-400 on locate, and a fourth signal
 * in any of those families would read as one of them.
 */
export function Marked ({ text, marks }: { text: string; marks: string[] }) {
  if (!marks.length) return <>{text}</>
  return (
    <>
      {splitOn(text, marks).map((p, i) => p.mark
        ? <span key={i} className="bg-foreground/10 rounded-sm px-0.5">{p.t}</span>
        : <span key={i}>{p.t}</span>)}
    </>
  )
}
