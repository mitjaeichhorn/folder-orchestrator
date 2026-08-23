import { execFile } from 'node:child_process'
import { log } from './log.js'

// The browser cannot hand a server an absolute path — showDirectoryPicker returns
// a handle, not a path. But the server runs on the same Mac as the browser, so it
// can open the real Finder dialog. Fixed script, no interpolation: nothing the
// client sends ever reaches AppleScript.
const SCRIPT = `
try
  tell application "System Events" to activate
  set f to choose folder with prompt "Select a project folder to monitor"
  return POSIX path of f
on error number -128
  return "__CANCELLED__"
end try`

export const CANCELLED = '__CANCELLED__'
export const TIMEOUT_MS = 120000

/** Resolves { path } | { cancelled: true } | { error }. Never throws. */
export function pickFolder () {
  return new Promise(resolve => {
    if (process.platform !== 'darwin') {
      return resolve({ error: 'UNSUPPORTED_PLATFORM' })
    }
    execFile('osascript', ['-e', SCRIPT], { timeout: TIMEOUT_MS }, (err, stdout) => {
      const out = String(stdout ?? '').trim()
      if (err) {
        // killed on timeout, or no window server (headless / ssh session)
        const code = err.killed ? 'TIMEOUT' : 'PICKER_UNAVAILABLE'
        log('WARN', 'pick_folder', { code, message: err.message })
        return resolve({ error: code })
      }
      if (out === CANCELLED || !out) {
        log('INFO', 'pick_folder', { outcome: 'cancelled' })
        return resolve({ cancelled: true })
      }
      // osascript returns a trailing slash on folders; the watcher wants it bare
      const path = out.replace(/\/+$/, '')
      log('INFO', 'pick_folder', { outcome: 'picked', path })
      resolve({ path })
    })
  })
}
