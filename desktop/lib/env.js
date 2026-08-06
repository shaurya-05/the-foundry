const fs = require('fs')
const path = require('path')
const { envFileCandidates } = require('./paths')

/**
 * Minimal KEY=VALUE parser (no export, no multiline). Skips comments/blank.
 * Does not log values — secrets stay out of the main-process console.
 */
function parseEnvFile(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  const text = fs.readFileSync(filePath, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function loadRawEnv() {
  const merged = {}
  for (const candidate of envFileCandidates()) {
    Object.assign(merged, parseEnvFile(candidate))
  }
  return merged
}

/**
 * Build the process env for the FastAPI sidecar.
 * Phase 1 still talks to Docker Desktop's postgres_prod / redis_prod on
 * host ports 5433 / 6380 (see docker-compose.local-prod.yml).
 */
function buildBackendEnv(raw, ports) {
  const postgresPassword =
    raw.POSTGRES_PASSWORD_LOCAL_PROD ||
    raw.POSTGRES_PASSWORD ||
    ''
  const jwtSecret = raw.JWT_SECRET_LOCAL_PROD || raw.JWT_SECRET || ''
  const adminPassword = raw.ADMIN_PASSWORD_LOCAL_PROD || raw.ADMIN_PASSWORD || ''

  const databaseUrl =
    raw.DATABASE_URL ||
    (postgresPassword
      ? `postgresql://foundry:${encodeURIComponent(postgresPassword)}@127.0.0.1:5433/foundry_db`
      : 'postgresql://foundry:foundry_secret@127.0.0.1:5433/foundry_db')

  const redisUrl = raw.REDIS_URL || 'redis://127.0.0.1:6380'

  const env = {
    ...process.env,
    ENVIRONMENT: raw.ENVIRONMENT || 'development',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    JWT_SECRET: jwtSecret || process.env.JWT_SECRET || 'change_me_in_production',
    ADMIN_PASSWORD: adminPassword,
    ALLOWED_ORIGINS: [
      `http://127.0.0.1:${ports.frontend}`,
      `http://localhost:${ports.frontend}`,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ].join(','),
    // Local Ollama on the host (same as compose host.docker.internal path,
    // but we are on the host already).
    USE_LOCAL_CLASSIFIER: raw.USE_LOCAL_CLASSIFIER || '1',
    USE_LOCAL_FACTUAL: raw.USE_LOCAL_FACTUAL || '1',
    USE_LOCAL_STRATEGIC: raw.USE_LOCAL_STRATEGIC || '1',
    USE_LOCAL_RESEARCH: raw.USE_LOCAL_RESEARCH || '1',
    USE_LOCAL_DOCUMENT: raw.USE_LOCAL_DOCUMENT || '1',
    OLLAMA_BASE_URL: raw.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
    OLLAMA_API_KEY: raw.OLLAMA_API_KEY || 'ollama-local',
    ANTHROPIC_API_KEY: raw.ANTHROPIC_API_KEY || '',
    VOYAGE_API_KEY: raw.VOYAGE_API_KEY || '',
    TAVILY_API_KEY: raw.TAVILY_API_KEY || '',
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  }

  return env
}

function buildFrontendEnv(ports) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(ports.frontend),
    HOSTNAME: '127.0.0.1',
  }
}

function resolvePorts(raw) {
  return {
    backend: Number(raw.DESKTOP_BACKEND_PORT || process.env.DESKTOP_BACKEND_PORT || 8000),
    frontend: Number(raw.DESKTOP_FRONTEND_PORT || process.env.DESKTOP_FRONTEND_PORT || 3000),
  }
}

module.exports = {
  loadRawEnv,
  buildBackendEnv,
  buildFrontendEnv,
  resolvePorts,
  parseEnvFile,
}
