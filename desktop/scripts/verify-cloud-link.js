/**
 * Headless Phase 7a cloud-link verification.
 * Run: npx electron scripts/verify-cloud-link.js
 *
 * Expects:
 * - CLOUD_SYNC_API_URL pointing at a separate real backend (prefer http://127.0.0.1:8000)
 * - LOCAL_API_URL pointing at a desktop SQLite backend with CLOUD_SYNC_ENABLED=1
 *   (prefer http://127.0.0.1:8010 so it doesn't collide with the cloud stack)
 *
 * Creates a throwaway cloud account, links, checks encrypted blob + status, unlinks.
 * Does NOT sync any project/task/idea rows.
 */
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const http = require('http')

const CLOUD_API = (process.env.CLOUD_SYNC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const LOCAL_API = (process.env.LOCAL_API_URL || 'http://127.0.0.1:8010').replace(/\/$/, '')

function requestJson(baseUrl, pathname, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const u = new URL(pathname, baseUrl + '/')
    const payload = body != null ? JSON.stringify(body) : null
    const reqHeaders = { accept: 'application/json', ...headers }
    if (payload) {
      reqHeaders['content-type'] = 'application/json'
      reqHeaders['content-length'] = Buffer.byteLength(payload)
    }
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method,
        headers: reqHeaders,
        timeout: 25000,
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
          resolve({ ok, status: res.statusCode || 0, data, error: ok ? null : (data?.detail || raw.slice(0, 200)) })
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

app.whenReady().then(async () => {
  const {
    linkCloudAccount,
    unlinkCloudAccount,
    encryptionStatus,
    encPath,
    plainPath,
    hasStoredLink,
  } = require('../lib/cloud-link')

  const stamp = Date.now()
  const cloudEmail = `phase7a-cloud-${stamp}@example.com`
  const localEmail = `phase7a-local-${stamp}@example.com`
  const password = `Phase7aTest!${stamp}`

  console.log('[verify] cloud API=', CLOUD_API)
  console.log('[verify] local API=', LOCAL_API)
  console.log('[verify] safeStorage available=', encryptionStatus().available)

  // Local desktop account on SQLite backend
  const localReg = await requestJson(LOCAL_API, '/api/auth/register', {
    method: 'POST',
    body: { email: localEmail, password, display_name: 'Phase7a Local' },
  })
  if (!localReg.ok) {
    console.error('[verify] FAIL local register:', localReg.error)
    app.exit(2)
    return
  }
  const localToken = localReg.data.access_token
  console.log('[verify] local workspace=', localReg.data.workspace_id)

  // Pre-status should be unlinked (or enabled:false if misconfigured)
  const pre = await requestJson(LOCAL_API, '/api/cloud-sync/status', {
    headers: { Authorization: `Bearer ${localToken}` },
  })
  console.log('[verify] pre status=', JSON.stringify(pre.data))
  if (!pre.ok || !pre.data?.enabled) {
    console.error('[verify] FAIL: local backend CLOUD_SYNC_ENABLED must be on')
    app.exit(3)
    return
  }
  if (pre.data.linked) {
    console.error('[verify] FAIL: unexpected already-linked state')
    app.exit(4)
    return
  }

  const linked = await linkCloudAccount({
    email: cloudEmail,
    password,
    mode: 'register',
    displayName: 'Phase7a Cloud',
    localAccessToken: localToken,
    cloudApiUrl: CLOUD_API,
    localApiUrl: LOCAL_API,
  })
  console.log('[verify] link ok=', linked.ok, 'encrypted=', linked.encrypted, 'cloud_ws=', linked.cloud_workspace_id)
  if (!linked.ok) {
    console.error('[verify] FAIL link:', linked.error)
    app.exit(5)
    return
  }

  const encExists = fs.existsSync(encPath())
  const plainExists = fs.existsSync(plainPath())
  console.log('[verify] enc file=', encExists, 'plain file=', plainExists)
  if (linked.encrypted) {
    if (!encExists || plainExists) {
      console.error('[verify] FAIL: expected encrypted blob only')
      app.exit(6)
      return
    }
    const raw = fs.readFileSync(encPath())
    const asText = raw.toString('utf8')
    if (asText.includes(cloudEmail) || asText.includes('access_token')) {
      console.error('[verify] FAIL: encrypted file appears to contain plaintext secrets')
      app.exit(7)
      return
    }
  }

  const post = await requestJson(LOCAL_API, '/api/cloud-sync/status', {
    headers: { Authorization: `Bearer ${localToken}` },
  })
  console.log('[verify] post status=', JSON.stringify(post.data))
  if (!post.data?.linked || post.data.cloud_workspace_id !== linked.cloud_workspace_id) {
    console.error('[verify] FAIL: status mismatch after link')
    app.exit(8)
    return
  }

  // Prove cloud identity is from the SEPARATE backend (different JWT secret / DB)
  if (linked.cloud_workspace_id === localReg.data.workspace_id) {
    console.error('[verify] FAIL: cloud workspace_id identical to local — not a separate account DB')
    app.exit(9)
    return
  }

  const un = await unlinkCloudAccount({
    localAccessToken: localToken,
    localApiUrl: LOCAL_API,
  })
  console.log('[verify] unlink ok=', un.ok, 'tokensCleared=', un.tokensCleared)
  if (!un.ok) {
    console.error('[verify] FAIL unlink:', un.error)
    app.exit(10)
    return
  }
  if (hasStoredLink()) {
    console.error('[verify] FAIL: token file still present after unlink')
    app.exit(11)
    return
  }

  const after = await requestJson(LOCAL_API, '/api/cloud-sync/status', {
    headers: { Authorization: `Bearer ${localToken}` },
  })
  console.log('[verify] after unlink status=', JSON.stringify(after.data))
  if (after.data?.linked) {
    console.error('[verify] FAIL: still linked after unlink')
    app.exit(12)
    return
  }

  console.log('[verify] Phase 7a cloud-link OK (no content sync performed)')
  console.log('[verify] cloud account used:', cloudEmail, '(throwaway)')
  app.exit(0)
})
