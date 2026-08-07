/**
 * Desktop cloud account linking — Phase 7a.
 *
 * Makes a real login/register HTTPS (or HTTP for local test) call against
 * CLOUD_SYNC_API_URL (a separate backend instance), stores the resulting
 * tokens via Electron safeStorage, and records the pairing on the local
 * desktop backend via POST /api/cloud-sync/link.
 *
 * No content sync happens here — tokens + pairing only.
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { URL } = require('url')
const { app, safeStorage } = require('electron')

const ENC_FILENAME = 'cloud_link.enc'
const PLAIN_FILENAME = 'cloud_link.json'

function dataDir() {
  const dir = path.join(__dirname, '..', 'data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function encPath() {
  return path.join(dataDir(), ENC_FILENAME)
}

function plainPath() {
  return path.join(dataDir(), PLAIN_FILENAME)
}

function cloudApiBase(rawEnv) {
  const enabled = String(rawEnv.CLOUD_SYNC_ENABLED || process.env.CLOUD_SYNC_ENABLED || '0').toLowerCase()
  if (['0', 'false', 'no', 'off', ''].includes(enabled)) {
    return null
  }
  return (
    rawEnv.CLOUD_SYNC_API_URL ||
    process.env.CLOUD_SYNC_API_URL ||
    'https://api.found3ry.com'
  ).replace(/\/$/, '')
}

function localApiBase(ports) {
  const port = ports && ports.backend ? ports.backend : 8000
  return `http://127.0.0.1:${port}`
}

/**
 * JSON request against an absolute base URL + path.
 * Supports http and https (localhost Docker tests use http).
 */
function requestJson(baseUrl, pathname, { method = 'GET', body, headers = {}, timeoutMs = 25000 } = {}) {
  return new Promise((resolve) => {
    let u
    try {
      u = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')
    } catch (err) {
      resolve({ ok: false, status: 0, error: `Invalid URL: ${err.message || err}` })
      return
    }
    const lib = u.protocol === 'https:' ? https : http
    const payload = body != null ? JSON.stringify(body) : null
    const reqHeaders = {
      accept: 'application/json',
      ...headers,
    }
    if (payload) {
      reqHeaders['content-type'] = 'application/json'
      reqHeaders['content-length'] = Buffer.byteLength(payload)
    }
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: reqHeaders,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let data = null
          try {
            data = raw ? JSON.parse(raw) : null
          } catch {
            data = { raw: raw.slice(0, 400) }
          }
          const ok = !!(res.statusCode && res.statusCode >= 200 && res.statusCode < 300)
          resolve({
            ok,
            status: res.statusCode || 0,
            data,
            error: ok
              ? null
              : (data && (data.detail || data.error || data.message)) ||
                `HTTP ${res.statusCode}: ${raw.slice(0, 200)}`,
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, error: 'Request timed out' })
    })
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, error: err.message || String(err) })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function saveLinkBlob(blob) {
  const json = JSON.stringify(blob)
  fs.mkdirSync(dataDir(), { recursive: true })
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(json)
    fs.writeFileSync(encPath(), enc)
    try {
      if (fs.existsSync(plainPath())) fs.unlinkSync(plainPath())
    } catch {
      /* ignore */
    }
    console.log('[cloud-link] saved cloud tokens via safeStorage (encrypted)')
    return { encrypted: true }
  }
  console.warn(
    '[cloud-link] safeStorage unavailable — falling back to plaintext cloud_link.json (dev only)',
  )
  fs.writeFileSync(plainPath(), json, 'utf8')
  return { encrypted: false }
}

function loadLinkBlob() {
  try {
    if (fs.existsSync(encPath())) {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('[cloud-link] encrypted blob present but safeStorage unavailable')
        return null
      }
      const raw = fs.readFileSync(encPath())
      const json = safeStorage.decryptString(raw)
      return JSON.parse(json)
    }
    if (fs.existsSync(plainPath())) {
      return JSON.parse(fs.readFileSync(plainPath(), 'utf8'))
    }
  } catch (err) {
    console.warn('[cloud-link] load failed:', err.message || err)
  }
  return null
}

function clearLinkBlob() {
  for (const p of [encPath(), plainPath()]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
}

function hasStoredLink() {
  return fs.existsSync(encPath()) || fs.existsSync(plainPath())
}

function encryptionStatus() {
  return {
    available: safeStorage.isEncryptionAvailable(),
    hasStoredLink: hasStoredLink(),
    encPath: encPath(),
    usingEncryptedFile: fs.existsSync(encPath()),
    usingPlaintextFile: fs.existsSync(plainPath()),
  }
}

/**
 * Decrypt stored cloud tokens for the backend sidecar env (Phase 7b).
 * Returns empty strings when unlinked — never throws.
 */
function getStoredCloudTokens() {
  const blob = loadLinkBlob()
  if (!blob) {
    return {
      access_token: '',
      refresh_token: '',
      cloud_api_url: '',
    }
  }
  return {
    access_token: blob.access_token ? String(blob.access_token) : '',
    refresh_token: blob.refresh_token ? String(blob.refresh_token) : '',
    cloud_api_url: blob.cloud_api_url ? String(blob.cloud_api_url) : '',
  }
}

/**
 * Env overlay for the backend sidecar — cloud sync tokens from safeStorage.
 * Safe to merge always; empty when unlinked.
 */
function cloudLinkBackendEnv() {
  const tokens = getStoredCloudTokens()
  return {
    CLOUD_SYNC_ACCESS_TOKEN: tokens.access_token,
    CLOUD_SYNC_REFRESH_TOKEN: tokens.refresh_token,
  }
}

/**
 * Link flow: cloud auth → encrypt tokens → POST local /api/cloud-sync/link
 *
 * @param {{
 *   email: string,
 *   password: string,
 *   mode?: 'login' | 'register',
 *   displayName?: string,
 *   localAccessToken: string,
 *   cloudApiUrl: string,
 *   localApiUrl: string,
 * }} opts
 */
async function linkCloudAccount(opts) {
  const email = String(opts.email || '').trim()
  const password = String(opts.password || '')
  const mode = opts.mode === 'register' ? 'register' : 'login'
  const cloudApiUrl = String(opts.cloudApiUrl || '').replace(/\/$/, '')
  const localApiUrl = String(opts.localApiUrl || '').replace(/\/$/, '')
  const localAccessToken = String(opts.localAccessToken || '').trim()

  if (!email || !password) {
    return { ok: false, error: 'Email and password are required' }
  }
  if (!cloudApiUrl) {
    return { ok: false, error: 'CLOUD_SYNC_API_URL is not configured' }
  }
  if (!localAccessToken) {
    return { ok: false, error: 'Local session token missing — sign in to the desktop account first' }
  }
  if (!localApiUrl) {
    return { ok: false, error: 'Local API URL missing' }
  }

  const authPath = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
  const body =
    mode === 'register'
      ? { email, password, display_name: opts.displayName || email.split('@')[0] }
      : { email, password }

  console.log(`[cloud-link] ${mode} against ${cloudApiUrl}${authPath}`)
  const cloudRes = await requestJson(cloudApiUrl, authPath, { method: 'POST', body })
  if (!cloudRes.ok) {
    return {
      ok: false,
      error: cloudRes.error || 'Cloud authentication failed',
      status: cloudRes.status,
      cloudApiUrl,
    }
  }

  const data = cloudRes.data || {}
  const cloudWorkspaceId = data.workspace_id
  const cloudUserId = data.user_id
  if (!data.access_token || !cloudWorkspaceId || !cloudUserId) {
    return {
      ok: false,
      error: 'Cloud auth response missing tokens or identity fields',
      cloudApiUrl,
    }
  }

  const blob = {
    version: 1,
    cloud_api_url: cloudApiUrl,
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    cloud_user_id: cloudUserId,
    cloud_workspace_id: cloudWorkspaceId,
    cloud_email: data.email || email,
    linked_at: new Date().toISOString(),
  }
  const stored = saveLinkBlob(blob)

  const linkRes = await requestJson(localApiUrl, '/api/cloud-sync/link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${localAccessToken}` },
    body: {
      cloud_workspace_id: cloudWorkspaceId,
      cloud_user_id: cloudUserId,
      cloud_email: blob.cloud_email,
    },
  })
  if (!linkRes.ok) {
    // Roll back tokens if local pairing failed — avoid half-linked state.
    clearLinkBlob()
    return {
      ok: false,
      error: `Cloud auth succeeded but local pairing failed: ${linkRes.error || linkRes.status}`,
      cloudApiUrl,
    }
  }

  return {
    ok: true,
    encrypted: stored.encrypted,
    cloud_workspace_id: cloudWorkspaceId,
    cloud_user_id: cloudUserId,
    cloud_email: blob.cloud_email,
    cloud_api_url: cloudApiUrl,
    linked_at: blob.linked_at,
    status: linkRes.data,
  }
}

/**
 * @param {{ localAccessToken: string, localApiUrl: string }} opts
 */
async function unlinkCloudAccount(opts) {
  const localAccessToken = String(opts.localAccessToken || '').trim()
  const localApiUrl = String(opts.localApiUrl || '').replace(/\/$/, '')
  clearLinkBlob()
  if (localAccessToken && localApiUrl) {
    const res = await requestJson(localApiUrl, '/api/cloud-sync/unlink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${localAccessToken}` },
    })
    if (!res.ok) {
      return {
        ok: false,
        error: res.error || 'Local unlink failed (tokens were still cleared)',
        tokensCleared: true,
      }
    }
    return { ok: true, tokensCleared: true, status: res.data }
  }
  return { ok: true, tokensCleared: true }
}

module.exports = {
  cloudApiBase,
  localApiBase,
  linkCloudAccount,
  unlinkCloudAccount,
  loadLinkBlob,
  clearLinkBlob,
  hasStoredLink,
  encryptionStatus,
  getStoredCloudTokens,
  cloudLinkBackendEnv,
  encPath,
  plainPath,
  requestJson,
}
