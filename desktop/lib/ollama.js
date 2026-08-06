/**
 * Ollama detection + model pull helpers for the desktop first-run setup.
 * Talks to Ollama's native local API (not the OpenAI-compat /v1 surface).
 * Main-process only — no renderer/UI code here.
 */
const http = require('http')

/** Single source of truth for the three desktop model tags. */
const REQUIRED_MODELS = Object.freeze([
  'qwen2.5:3b-instruct', // CLASSIFIER
  'qwen2.5:7b-instruct', // FACTUAL
  'qwen2.5:14b-instruct', // STRATEGIC (+ RESEARCH + DOCUMENT reuse)
])

const OLLAMA_HOST = '127.0.0.1'
const OLLAMA_PORT = 11434
const TAGS_PATH = '/api/tags'
const PULL_PATH = '/api/pull'
const CHECK_TIMEOUT_MS = 2000

/**
 * Map REQUIRED_MODELS → backend env var names so env.js doesn't hardcode tags.
 */
function modelEnvDefaults() {
  const [classifier, factual, strategic] = REQUIRED_MODELS
  return {
    OLLAMA_CLASSIFIER_MODEL: classifier,
    OLLAMA_FACTUAL_MODEL: factual,
    OLLAMA_STRATEGIC_MODEL: strategic,
    OLLAMA_RESEARCH_MODEL: strategic,
    OLLAMA_DOCUMENT_MODEL: strategic,
  }
}

function requestJson(method, path, { body, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null
    const req = http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Ollama ${method} ${path} → HTTP ${res.statusCode}: ${raw.slice(0, 200)}`))
            return
          }
          try {
            resolve(raw ? JSON.parse(raw) : {})
          } catch (err) {
            reject(new Error(`Ollama ${path}: invalid JSON (${err.message})`))
          }
        })
      },
    )
    req.on('error', reject)
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Ollama ${path} timed out after ${timeoutMs}ms`))
      })
    }
    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * GET /api/tags with a short timeout.
 * @returns {Promise<{ reachable: boolean, installedModels: string[] }>}
 */
async function checkReachable() {
  try {
    const data = await requestJson('GET', TAGS_PATH, { timeoutMs: CHECK_TIMEOUT_MS })
    const models = Array.isArray(data.models) ? data.models : []
    const installedModels = models
      .map((m) => (m && typeof m.name === 'string' ? m.name : null))
      .filter(Boolean)
    return { reachable: true, installedModels }
  } catch {
    return { reachable: false, installedModels: [] }
  }
}

/**
 * @param {string[]} installedModels
 * @returns {string[]}
 */
function missingModels(installedModels) {
  const installed = new Set(installedModels || [])
  // Exact tag match. Also accept "name:tag" when Ollama returns a digest
  // variant — require the full REQUIRED tag string to be present as-is.
  return REQUIRED_MODELS.filter((tag) => !installed.has(tag))
}

/**
 * POST /api/pull with stream:true. Invokes onProgress for each NDJSON line.
 * @param {string} tag
 * @param {(line: object) => void} [onProgress]
 */
function pullModel(tag, onProgress) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ name: tag, stream: true })
    const req = http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: PULL_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Accept: 'application/x-ndjson, application/json',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            reject(
              new Error(
                `Ollama pull ${tag} → HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`,
              ),
            )
          })
          return
        }

        let buffer = ''
        let settled = false
        const finish = (err) => {
          if (settled) return
          settled = true
          if (err) reject(err)
          else resolve()
        }

        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          buffer += chunk
          let nl
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (!line) continue
            let parsed
            try {
              parsed = JSON.parse(line)
            } catch {
              continue
            }
            if (typeof onProgress === 'function') {
              try {
                onProgress(parsed)
              } catch {
                /* ignore renderer callback errors */
              }
            }
            if (parsed.error) {
              finish(new Error(String(parsed.error)))
              req.destroy()
              return
            }
            if (parsed.status === 'success') {
              finish()
            }
          }
        })
        res.on('end', () => {
          if (settled) return
          // Some Ollama builds end the stream without a final success line
          // after the last progress event — treat clean close as success
          // unless we already saw an error.
          finish()
        })
        res.on('error', finish)
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function openDownloadPage() {
  // Lazy-require so checkReachable/pullModel stay testable from plain Node.
  const { shell } = require('electron')
  return shell.openExternal('https://ollama.com/download')
}

module.exports = {
  REQUIRED_MODELS,
  modelEnvDefaults,
  checkReachable,
  missingModels,
  pullModel,
  openDownloadPage,
}
