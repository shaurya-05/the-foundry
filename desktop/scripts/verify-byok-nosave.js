const { app } = require('electron')
const fs = require('fs')
const path = require('path')

app.whenReady().then(async () => {
  const byok = require('../lib/cloud-byok')
  const enc = path.join(__dirname, '..', 'data', 'anthropic_api_key.enc')
  const plain = path.join(__dirname, '..', 'data', 'anthropic_api_key.txt')
  for (const p of [enc, plain]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
  }

  const bad = await byok.validateAnthropicKey('sk-ant-definitely-invalid')
  console.log('invalid_ok', bad.ok)
  console.log('enc_after_invalid_validate', fs.existsSync(enc))

  let overlayErr = ''
  try {
    byok.cloudByokBackendEnv()
  } catch (e) {
    overlayErr = e.message
  }
  console.log('overlay_without_key', overlayErr)

  console.log('safeStorage', byok.encryptionAvailable())
  app.exit(bad.ok ? 1 : 0)
})
