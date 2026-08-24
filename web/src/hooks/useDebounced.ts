import { useEffect, useState } from 'react'

/**
 * Trail a value by `ms`, so a burst settles into one update.
 *
 * Shared by the heat tree and the workspace's tree fetch: a build touching
 * hundreds of files must produce one refetch, not hundreds.
 */
export function useDebounced<T> (value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}
