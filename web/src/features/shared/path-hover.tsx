import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * The folder the pointer is currently on, shared by every path on screen.
 *
 * A context rather than props: `FilePath` is rendered by six components across
 * four views, several of them nested two or three levels deep inside a row or a
 * tile. Threading a hover value through all of that would be about fifteen prop
 * additions to say one thing, and every new view would have to remember to pass
 * it. Consuming it where it is used means every path everywhere gets this for
 * free — including ones not written yet.
 */
interface PathHover {
  prefix: string | null
  setPrefix: (p: string | null) => void
}

const Ctx = createContext<PathHover>({ prefix: null, setPrefix: () => {} })

export function PathHoverProvider ({ children, onChange }: {
  children: ReactNode
  /** Mirrored outward so the heat tree can reveal the same folder. */
  onChange?: (p: string | null) => void
}) {
  const [prefix, set] = useState<string | null>(null)
  const value = useMemo(() => ({
    prefix,
    setPrefix: (p: string | null) => { set(p); onChange?.(p) }
  }), [prefix, onChange])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePathHover = () => useContext(Ctx)
