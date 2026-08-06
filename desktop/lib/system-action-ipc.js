/**
 * IPC for Phase 6c system actions — main app window only.
 */
const { ipcMain } = require('electron')
const { executeSystemAction } = require('./system-actions')

let registered = false

function registerSystemActionIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('system-action:execute', async (_event, payload) => {
    const action = payload && payload.action
    const target = payload && payload.target
    if (typeof action !== 'string') {
      return { success: false, detail: 'action is required' }
    }
    try {
      return await executeSystemAction(action, target)
    } catch (err) {
      return {
        success: false,
        detail: err && err.message ? err.message : String(err),
      }
    }
  })
}

module.exports = { registerSystemActionIpc }
