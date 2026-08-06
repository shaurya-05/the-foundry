/**
 * Desktop cloud BYOK (bring-your-own-key) helpers — Phase 4.
 * Validates + stores an Anthropic API key (safeStorage when available),
 * and returns env overlays that disable local Ollama and enable
 * CLOUD_BYOK_PROVIDER=anthropic for the backend sidecar.
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const { app, safeStorage } = require('electron')

const PROVIDER = 'anthropic'
const ENC_FILENAME = 'anthropic_api_key.enc'
const PLAIN_FILENAME = 'anthropic_api_key.txt'
const VALIDATE_MODEL = 'claude-haiku-4-5-20251001'

function dataDir() {
  // Prefer desktop/data next to the app in monorepo/dev; fall back to userData.
  const candidates = [
    path.join(__dirname, '..', 'data'),
    path.join(app.getPath('userData'), 'data'),
  ]
  const dir = candidates[0]
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function encPath() {
  return path.join(dataDir(), ENC_FILENAME)
}

function plainPath() {
  return path.join(dataDir(), PLAIN_FILENAME)
}

/**
 * Cheap real Anthropic Messages API call (max_tokens: 1) to verify the key.
 * @param {string} apiKey
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
function validateAnthropicKey(apiKey) {
  return new Promise((resolve) => {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      resolve({ ok: false, error: 'API key is empty' })
      return
    }
    const body = JSON.stringify({
      model: VALIDATE_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
        timeout: 20000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true })
            return
          }
          let detail = raw.slice(0, 240)
          try {
            const parsed = JSON.parse(raw)
            detail = parsed?.error?.message || parsed?.message || detail
          } catch {
            /* keep raw slice */
          }
          resolve({
            ok: false,
            error: `Anthropic rejected the key (HTTP ${res.statusCode}): ${detail}`,
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: 'Timed out contacting Anthropic' })
    })
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message || String(err) })
    })
    req.write(body)
    req.end()
  })
}

/**
 * Persist a validated key. Prefer Electron safeStorage encryption.
 * @param {string} apiKey
 */
function saveAnthropicKey(apiKey) {
  const trimmed = String(apiKey || '').trim()
  if (!trimmed) throw new Error('Cannot save empty API key')

  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })

  if (safeStorage.isEncryptionAvailable()) {
    const blob = safeStorage.encryptString(trimmed)
    fs.writeFileSync(encPath(), blob)
    // Remove any prior plaintext fallback so we don't leave both around.
    try {
      if (fs.existsSync(plainPath())) fs.unlinkSync(plainPath())
    } catch {
      /* ignore */
    }
    console.log('[cloud-byok] saved Anthropic key via safeStorage (encrypted)')
    return { stored: 'encrypted', path: encPath() }
  }

  console.warn(
    '[cloud-byok] safeStorage.isEncryptionAvailable()=false — falling back to plaintext key file in desktop/data/',
  )
  fs.writeFileSync(plainPath(), trimmed, { encoding: 'utf8', mode: 0o600 })
  try {
    if (fs.existsSync(encPath())) fs.unlinkSync(encPath())
  } catch {
    /* ignore */
  }
  return { stored: 'plaintext', path: plainPath() }
}

/**
 * @returns {string|null}
 */
function loadAnthropicKey() {
  try {
    if (fs.existsSync(encPath()) && safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(encPath())
      return safeStorage.decryptString(buf)
    }
    if (fs.existsSync(plainPath())) {
      return fs.readFileSync(plainPath(), 'utf8').trim()
    }
    // Encrypted blob present but safeStorage unavailable — can't decrypt.
    if (fs.existsSync(encPath())) {
      console.warn('[cloud-byok] encrypted key present but safeStorage unavailable')
    }
  } catch (err) {
    console.warn('[cloud-byok] loadAnthropicKey failed:', err.message || err)
  }
  return null
}

function hasStoredAnthropicKey() {
  return Boolean(loadAnthropicKey())
}

/**
 * Env overlay for the backend sidecar when the user chose cloud BYOK.
 * Mutually exclusive with local Ollama (all USE_LOCAL_*=0).
 */
function cloudByokBackendEnv() {
  const key = loadAnthropicKey()
  if (!key) {
    throw new Error('No saved Anthropic API key — complete cloud setup first')
  }
  return {
    CLOUD_BYOK_PROVIDER: PROVIDER,
    ANTHROPIC_API_KEY: key,
    USE_LOCAL_CLASSIFIER: '0',
    USE_LOCAL_FACTUAL: '0',
    USE_LOCAL_STRATEGIC: '0',
    USE_LOCAL_RESEARCH: '0',
    USE_LOCAL_DOCUMENT: '0',
  }
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

module.exports = {
  PROVIDER,
  validateAnthropicKey,
  saveAnthropicKey,
  loadAnthropicKey,
  hasStoredAnthropicKey,
  cloudByokBackendEnv,
  encryptionAvailable,
}
