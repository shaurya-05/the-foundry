/**
 * Preload for the MAIN app window only (Phase 6c).
 * Exposes a single narrow API for allowlisted system actions.
 * Do not merge setup APIs here — setup uses preload.js separately.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('foundrySystemActions', {
  /**
   * @param {string} action
   * @param {string} [target]
   * @returns {Promise<{ success: boolean, detail: string }>}
   */
  execute: (action, target) =>
    ipcRenderer.invoke('system-action:execute', { action, target }),
})
