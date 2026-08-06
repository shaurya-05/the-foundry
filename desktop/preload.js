/**
 * Preload for the Ollama first-run setup window.
 * Exposes ONLY the named setup API — no generic ipcRenderer / require / fs.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('foundryOllamaSetup', {
  checkStatus: () => ipcRenderer.invoke('ollama:check-status'),

  /**
   * Pull one model. Progress events arrive via onPullProgress(callback).
   * @param {string} tag
   */
  pullModel: (tag) => ipcRenderer.invoke('ollama:pull-model', tag),

  /**
   * Register a progress listener. Returns an unsubscribe function.
   * Callback receives { tag, status, completed?, total?, error?, ... }.
   */
  onPullProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const handler = (_event, data) => {
      callback(data)
    }
    ipcRenderer.on('ollama:pull-progress', handler)
    return () => {
      ipcRenderer.removeListener('ollama:pull-progress', handler)
    }
  },

  openDownloadPage: () => ipcRenderer.invoke('ollama:open-download-page'),

  continueToApp: () => ipcRenderer.invoke('ollama:continue'),
})
