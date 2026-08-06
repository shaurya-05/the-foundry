/**
 * Phase 6c — allowlist rejection tests (no Electron UI).
 * Mocks electron.shell so require() works under plain Node.
 */
const Module = require('module')
const originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
  if (id === 'electron') {
    return {
      shell: {
        openExternal: async (url) => ({ ok: true, url }),
      },
    }
  }
  return originalRequire.apply(this, arguments)
}

const {
  executeSystemAction,
  allowlistedOpenApps,
} = require('../lib/system-actions')

async function main() {
  const apps = allowlistedOpenApps().sort()
  console.log('allowlist', apps.join(','))
  if (apps.join(',') !== 'browser,calculator,explorer,notepad') {
    throw new Error('unexpected allowlist: ' + apps.join(','))
  }

  const bad = await executeSystemAction('open_app', 'powershell')
  console.log('reject_powershell', bad)
  if (bad.success) throw new Error('powershell should be rejected')

  const badPath = await executeSystemAction('open_app', 'C:\\Windows\\System32\\cmd.exe')
  console.log('reject_path', badPath)
  if (badPath.success) throw new Error('path should be rejected')

  const badAction = await executeSystemAction('run_shell', 'echo hi')
  console.log('reject_action', badAction)
  if (badAction.success) throw new Error('run_shell should be rejected')

  const badLock = await executeSystemAction('lock_screen', 'extra')
  console.log('reject_lock_param', badLock)
  if (badLock.success) throw new Error('lock_screen must reject params')

  const badUrl = await executeSystemAction('open_url', 'file:///c:/windows/system32/cmd.exe')
  console.log('reject_file_url', badUrl)
  if (badUrl.success) throw new Error('file URL should be rejected')

  const okUrl = await executeSystemAction('open_url', 'https://example.com')
  console.log('ok_url', okUrl)
  if (!okUrl.success) throw new Error('https URL should succeed (mocked)')

  // Real spawn of notepad — optional; skip if we want headless only.
  // Uncomment for live verify: const note = await executeSystemAction('open_app', 'notepad')

  console.log('PHASE6C_DESKTOP_ALLOWLIST_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
