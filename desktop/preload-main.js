/**
 * Preload for the MAIN app window (Phase 6c system actions + Phase 7a cloud link).
 * Narrow, named APIs only — no generic ipcRenderer passthrough.
 * Setup window continues to use preload.js separately.
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

contextBridge.exposeInMainWorld('foundryCloudLink', {
  encryptionStatus: () => ipcRenderer.invoke('cloud-link:encryption-status'),
  status: () => ipcRenderer.invoke('cloud-link:status'),
  /**
   * @param {{
   *   email: string,
   *   password: string,
   *   mode?: 'login' | 'register',
   *   displayName?: string,
   *   localAccessToken: string,
   * }} opts
   */
  link: (opts) => ipcRenderer.invoke('cloud-link:link', opts),
  /**
   * @param {{ localAccessToken: string }} opts
   */
  unlink: (opts) => ipcRenderer.invoke('cloud-link:unlink', opts),
})
