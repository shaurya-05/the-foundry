/**
 * Headless BYOK validation checks (run: npx electron scripts/verify-byok.js).
 * Does not print key material.
 */
const { app } = require('electron')
const path = require('path')

app.whenReady().then(async () => {
  const byok = require('../lib/cloud-byok')
  console.log('[verify] safeStorage available:', byok.encryptionAvailable())

  const bad = await byok.validateAnthropicKey('sk-ant-definitely-invalid-key-000')
  console.log('[verify] invalid key ok=', bad.ok, 'error_present=', Boolean(bad.error))
  if (bad.ok) {
    console.error('[verify] FAIL: invalid key was accepted')
    app.exit(2)
    return
  }

  const real = process.env.ANTHROPIC_API_KEY_FOR_VERIFY || process.env.ANTHROPIC_API_KEY
  if (!real) {
    console.log('[verify] SKIP valid-key test (set ANTHROPIC_API_KEY_FOR_VERIFY to run it)')
    app.exit(0)
    return
  }

  const good = await byok.validateAnthropicKey(real)
  console.log('[verify] valid key ok=', good.ok)
  if (!good.ok) {
    console.error('[verify] FAIL valid key:', good.error)
    app.exit(3)
    return
  }

  // Save to a temp-ish path under desktop/data then confirm blob exists & no plaintext key in .env.desktop
  const saved = byok.saveAnthropicKey(real)
  console.log('[verify] saved via', saved.stored, 'path_exists=', require('fs').existsSync(saved.path))
  const loaded = byok.loadAnthropicKey()
  console.log('[verify] load round-trip match=', loaded === real.trim())
  const fs = require('fs')
  const plainLeak = fs.existsSync(path.join(__dirname, '..', 'data', 'anthropic_api_key.txt'))
  console.log('[verify] plaintext fallback file present=', plainLeak)
  if (saved.stored === 'encrypted' && plainLeak) {
    console.error('[verify] FAIL: plaintext file left beside encrypted blob')
    app.exit(4)
    return
  }
  console.log('[verify] BYOK validate+save OK')
  app.exit(0)
})
