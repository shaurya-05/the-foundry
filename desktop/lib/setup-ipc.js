/**
 * IPC bridge for the Ollama first-run setup window.
 * Call registerSetupIpc({ onContinue }) once from main.js after app ready.
 */
const { ipcMain } = require('electron')
const {
  checkReachable,
  missingModels,
  pullModel,
  openDownloadPage,
  REQUIRED_MODELS,
} = require('./ollama')

let registered = false

function registerSetupIpc({ onContinue }) {
  if (registered) return
  registered = true

  ipcMain.handle('ollama:check-status', async () => {
    const { reachable, installedModels } = await checkReachable()
    const missing = reachable ? missingModels(installedModels) : [...REQUIRED_MODELS]
    return {
      reachable,
      installedModels,
      missing,
      required: [...REQUIRED_MODELS],
    }
  })

  ipcMain.handle('ollama:pull-model', async (event, tag) => {
    if (typeof tag !== 'string' || !REQUIRED_MODELS.includes(tag)) {
      throw new Error(`Refusing to pull unknown model tag: ${tag}`)
    }
    await pullModel(tag, (line) => {
      try {
        event.sender.send('ollama:pull-progress', { tag, ...line })
      } catch {
        /* sender may have navigated away */
      }
    })
    return { ok: true, tag }
  })

  ipcMain.handle('ollama:open-download-page', async () => {
    await openDownloadPage()
    return { ok: true }
  })

  ipcMain.handle('ollama:continue', async () => {
    if (typeof onContinue === 'function') {
      await onContinue()
    }
    return { ok: true }
  })
}

module.exports = { registerSetupIpc }
