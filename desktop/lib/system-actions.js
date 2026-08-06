/**
 * Phase 6c — fixed allowlist of local system actions.
 *
 * No path parameters. No arbitrary commands. Callers may only request
 * action + (for open_app) a keyed name from OPEN_APP_ALLOWLIST.
 * set_volume is intentionally omitted for v1 (no robust dependency-free
 * Windows volume API without fragile key-simulation or native modules).
 */
const { spawn } = require('child_process')
const { shell } = require('electron')

/** @type {Record<string, { label: string, file: string, args?: string[] }>} */
const OPEN_APP_ALLOWLIST = {
  notepad: { label: 'Notepad', file: 'notepad.exe', args: [] },
  calculator: { label: 'Calculator', file: 'calc.exe', args: [] },
  explorer: { label: 'File Explorer', file: 'explorer.exe', args: [] },
  // Opens the user's default browser to a blank page (no arbitrary path).
  browser: { label: 'Default browser', file: '__browser__', args: [] },
}

const ACTIONS = new Set(['open_app', 'lock_screen', 'open_url'])

/**
 * @param {string} action
 * @param {string | undefined | null} target
 * @returns {Promise<{ success: boolean, detail: string }>}
 */
async function executeSystemAction(action, target) {
  if (!ACTIONS.has(action)) {
    return { success: false, detail: `Action not allowlisted: ${action}` }
  }

  if (action === 'lock_screen') {
    if (target) {
      return { success: false, detail: 'lock_screen accepts no parameters' }
    }
    return lockScreen()
  }

  if (action === 'open_app') {
    const key = String(target || '').trim().toLowerCase()
    const entry = OPEN_APP_ALLOWLIST[key]
    if (!entry) {
      return {
        success: false,
        detail: `open_app target not allowlisted: ${key || '(empty)'}. Allowed: ${Object.keys(OPEN_APP_ALLOWLIST).join(', ')}`,
      }
    }
    return openAllowlistedApp(entry)
  }

  if (action === 'open_url') {
    const url = String(target || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      return { success: false, detail: 'open_url requires an http(s) URL' }
    }
    try {
      await shell.openExternal(url)
      return { success: true, detail: `Opened URL: ${url}` }
    } catch (err) {
      return {
        success: false,
        detail: `Failed to open URL: ${err && err.message ? err.message : String(err)}`,
      }
    }
  }

  return { success: false, detail: `Unhandled action: ${action}` }
}

/**
 * @param {{ label: string, file: string, args?: string[] }} entry
 */
function openAllowlistedApp(entry) {
  if (entry.file === '__browser__') {
    return shell
      .openExternal('about:blank')
      .then(() => ({ success: true, detail: `Opened ${entry.label}` }))
      .catch((err) => ({
        success: false,
        detail: `Failed to open ${entry.label}: ${err && err.message ? err.message : String(err)}`,
      }))
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(entry.file, entry.args || [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      })
      child.on('error', (err) => {
        resolve({
          success: false,
          detail: `Failed to open ${entry.label}: ${err && err.message ? err.message : String(err)}`,
        })
      })
      // Detached apps often don't emit 'spawn' reliably on all Node versions —
      // unref immediately; treat launch attempt as success if spawn() didn't throw.
      child.unref()
      resolve({ success: true, detail: `Opened ${entry.label}` })
    } catch (err) {
      resolve({
        success: false,
        detail: `Failed to open ${entry.label}: ${err && err.message ? err.message : String(err)}`,
      })
    }
  })
}

function lockScreen() {
  return new Promise((resolve) => {
    try {
      const child = spawn(
        'rundll32.exe',
        ['user32.dll,LockWorkStation'],
        { detached: true, stdio: 'ignore', windowsHide: true, shell: false },
      )
      child.on('error', (err) => {
        resolve({
          success: false,
          detail: `Failed to lock screen: ${err && err.message ? err.message : String(err)}`,
        })
      })
      child.unref()
      resolve({ success: true, detail: 'Locked the screen' })
    } catch (err) {
      resolve({
        success: false,
        detail: `Failed to lock screen: ${err && err.message ? err.message : String(err)}`,
      })
    }
  })
}

function allowlistedOpenApps() {
  return Object.keys(OPEN_APP_ALLOWLIST)
}

module.exports = {
  executeSystemAction,
  allowlistedOpenApps,
  OPEN_APP_ALLOWLIST,
  ACTIONS,
}
