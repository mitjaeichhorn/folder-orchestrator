import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * A markdown file rendered inside the detail panel.
 *
 * **Raw HTML stays off.** A watched folder can hold any repository you happened
 * to clone, so its markdown is untrusted input to this page. `react-markdown`
 * ignores embedded HTML unless `rehype-raw` is added — so the safe behaviour is
 * the default behaviour, and the guard is simply never installing that plugin.
 * Do not add it here.
 *
 * GFM is on, because every markdown file in a dev repo is GFM in practice —
 * without it this project's own CLAUDE.md renders its stack table as a wall of
 * pipes. Note that `remark-gfm` is a *parser* extension, not an HTML one: it
 * adds tables, strikethrough, task lists and autolinks, and changes nothing
 * about the raw-HTML rule above.
 *
 * Loaded through `lazy()` by the caller: the parser is ~100kb and the bundle is
 * already over Vite's warning threshold, so it must not be in the initial chunk
 * for a feature most rows never use.
 *
 * Styling is explicit rather than a typography plugin — there is one screen of
 * it, and the alternative is a build dependency for a single panel.
 */
export default function Markdown ({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: p => <h1 className="mt-3 text-sm font-semibold" {...p} />,
          h2: p => <h2 className="mt-3 text-xs font-semibold uppercase" {...p} />,
          h3: p => <h3 className="text-muted-foreground mt-2 text-xs font-semibold" {...p} />,
          h4: p => <h4 className="text-muted-foreground mt-2 text-xs font-semibold" {...p} />,
          p: p => <p className="text-xs" {...p} />,
          ul: p => <ul className="list-disc space-y-0.5 pl-4" {...p} />,
          ol: p => <ol className="list-decimal space-y-0.5 pl-4" {...p} />,
          li: p => <li className="text-xs" {...p} />,
          // An inline `code` gets a chip; a fenced block is wrapped in <pre>,
          // which supplies its own box — nesting a second one reads as a bug.
          code: p => <code className="bg-muted rounded px-1 font-mono text-[11px]" {...p} />,
          pre: p => (
            <pre className="bg-muted/40 overflow-x-auto rounded-md border p-2 font-mono text-[11px] [&>code]:bg-transparent [&>code]:p-0" {...p} />
          ),
          blockquote: p => <blockquote className="border-muted-foreground/40 text-muted-foreground border-l-2 pl-3" {...p} />,
          // A wide table must scroll inside its own box, never widen the panel.
          table: p => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]" {...p} />
            </div>
          ),
          th: p => <th className="border px-1.5 py-0.5 text-left font-semibold" {...p} />,
          td: p => <td className="border px-1.5 py-0.5 align-top" {...p} />,
          hr: () => <hr className="border-border my-3" />,
          // Links point outside the app; a target without noreferrer hands the
          // opener to whatever the file links to.
          a: p => <a className="text-sky-400 underline" target="_blank" rel="noopener noreferrer" {...p} />,
          img: p => <img className="h-auto max-w-full rounded" {...p} />
        }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
