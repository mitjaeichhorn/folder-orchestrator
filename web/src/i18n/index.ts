import { config } from '@/config'
import en from './locales/en.json'
import de from './locales/de.json'

type Dict = Record<string, string>
const BUNDLES: Record<string, Dict> = { en, de: { ...de } }
const FALLBACK = 'en'
const missing = new Set<string>()

const dict = (): Dict => BUNDLES[config.locale] ?? BUNDLES[FALLBACK]

export function t (key: string, vars?: Record<string, string | number>): string {
  let s = dict()[key] ?? BUNDLES[FALLBACK][key]
  if (s === undefined) {
    // Visible and greppable. Never fall back to a hardcoded English literal —
    // that would hide the missing key instead of surfacing it.
    if (import.meta.env.DEV && !missing.has(key)) {
      missing.add(key)
      console.warn(JSON.stringify({ code: 'i18n_missing', key, locale: config.locale }))
    }
    return key
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

const timeFmt = new Intl.DateTimeFormat(config.locale, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
})
const dateTimeFmt = new Intl.DateTimeFormat(config.locale, { dateStyle: 'medium', timeStyle: 'medium' })
const numFmt = new Intl.NumberFormat(config.locale)

export const fmtTime = (ts: number) => timeFmt.format(ts)
export const fmtDateTime = (ts: number) => dateTimeFmt.format(ts)
export const fmtNum = (n: number) => numFmt.format(n)

export function fmtAgo (ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return t('time.justNow')
  if (s < 60) return t('time.secondsAgo', { n: s })
  if (s < 3600) return t('time.minutesAgo', { n: Math.floor(s / 60) })
  return t('time.hoursAgo', { n: Math.floor(s / 3600) })
}
