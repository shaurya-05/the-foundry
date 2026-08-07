/**
 * IPC for Phase 7a cloud account linking — main app window only.
 */
const { ipcMain } = require('electron')
const { loadRawEnv, resolvePorts } = require('./env')
const {
  cloudApiBase,
  localApiBase,
  linkCloudAccount,
  unlinkCloudAccount,
  encryptionStatus,
  hasStoredLink,
  loadLinkBlob,
} = require('./cloud-link')

let registered = false

function registerCloudLinkIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('cloud-link:encryption-status', async () => encryptionStatus())

  ipcMain.handle('cloud-link:status', async () => {
    const blob = loadLinkBlob()
    return {
      hasStoredLink: hasStoredLink(),
      encryption: encryptionStatus(),
      cloud_workspace_id: blob?.cloud_workspace_id || null,
      cloud_user_id: blob?.cloud_user_id || null,
      cloud_email: blob?.cloud_email || null,
      cloud_api_url: blob?.cloud_api_url || null,
      linked_at: blob?.linked_at || null,
    }
  })

  ipcMain.handle('cloud-link:link', async (_event, payload) => {
    const raw = loadRawEnv()
    const ports = resolvePorts(raw)
    const cloudApiUrl = (payload && payload.cloudApiUrl) || cloudApiBase(raw)
    if (!cloudApiUrl) {
      return {
        ok: false,
        error: 'Cloud sync is disabled (CLOUD_SYNC_ENABLED is off)',
      }
    }
    return linkCloudAccount({
      email: payload?.email,
      password: payload?.password,
      mode: payload?.mode,
      displayName: payload?.displayName,
      localAccessToken: payload?.localAccessToken,
      cloudApiUrl,
      localApiUrl: localApiBase(ports),
    })
  })

  ipcMain.handle('cloud-link:unlink', async (_event, payload) => {
    const raw = loadRawEnv()
    const ports = resolvePorts(raw)
    return unlinkCloudAccount({
      localAccessToken: payload?.localAccessToken,
      localApiUrl: localApiBase(ports),
    })
  })
}

module.exports = { registerCloudLinkIpc }
