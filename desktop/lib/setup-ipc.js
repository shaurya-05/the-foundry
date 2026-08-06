/**
 * IPC bridge for the first-run setup window (Ollama local + cloud BYOK).
 * Call registerSetupIpc({ onContinue }) once from main.js after app ready.
 *
 * onContinue(opts?: { mode?: 'local' | 'cloud' })
 */
const { ipcMain } = require('electron')
const {
  checkReachable,
  missingModels,
  pullModel,
  openDownloadPage,
  REQUIRED_MODELS,
} = require('./ollama')
const {
  validateAnthropicKey,
  saveAnthropicKey,
  hasStoredAnthropicKey,
  encryptionAvailable,
} = require('./cloud-byok')

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

  ipcMain.handle('ollama:continue', async (_event, opts) => {
    if (typeof onContinue === 'function') {
      await onContinue(opts && typeof opts === 'object' ? opts : { mode: 'local' })
    }
    return { ok: true }
  })

  // ─── Cloud BYOK ──────────────────────────────────────────────────────────

  ipcMain.handle('byok:encryption-status', async () => ({
    available: encryptionAvailable(),
    hasStoredKey: hasStoredAnthropicKey(),
  }))

  ipcMain.handle('byok:validate-key', async (_event, apiKey) => {
    if (typeof apiKey !== 'string') {
      return { ok: false, error: 'API key must be a string' }
    }
    return validateAnthropicKey(apiKey)
  })

  ipcMain.handle('byok:save-key', async (_event, apiKey) => {
    if (typeof apiKey !== 'string') {
      throw new Error('API key must be a string')
    }
    // Refuse to persist without a successful validation in the same session
    // — caller must validate first; we re-validate here as a hard gate.
    const check = await validateAnthropicKey(apiKey)
    if (!check.ok) {
      throw new Error(check.error || 'Key validation failed')
    }
    return saveAnthropicKey(apiKey)
  })
}

module.exports = { registerSetupIpc }
