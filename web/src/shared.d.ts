declare module '@shared/glob.js' {
  export function globToRe (glob: string): RegExp
  export const ALL_KINDS: string[]
  export const IMAGE_EXTS: string[]
  export function isImagePath (p: unknown): boolean
  export const MARKDOWN_EXTS: string[]
  export function isMarkdownPath (p: unknown): boolean
  export const LINE_ALERT_AT: number
  export const LINE_ALERT_EXEMPT: string[]
  export function countsForLineAlert (p: unknown): boolean
  export function matchEvent (e: any, f?: {
    kinds?: string[]; pathGlob?: string; since?: number; actor?: string; sessionId?: string
  }): boolean
}
