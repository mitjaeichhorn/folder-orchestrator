declare module '@shared/glob.js' {
  export function globToRe (glob: string): RegExp
  export const ALL_KINDS: string[]
  export function matchEvent (e: any, f?: {
    kinds?: string[]; pathGlob?: string; since?: number; actor?: string; sessionId?: string
  }): boolean
}
