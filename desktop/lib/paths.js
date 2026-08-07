const path = require('path')
const { app } = require('electron')

/**
 * Resolve filesystem locations for sidecars.
 *
 * Dev (unpackaged): monorepo roots — frontend/.next/standalone + backend/
 * Packaged: process.resourcesPath extras copied by electron-builder.
 */
function isPackaged() {
  return app.isPackaged
}

function repoRoot() {
  // desktop/ -> repo root
  return path.resolve(__dirname, '..', '..')
}

function frontendStandaloneDir() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'frontend')
  }
  // Prefer prepared resources if present (after npm run prepare:resources),
  // otherwise the Next build output in the monorepo.
  const prepared = path.join(__dirname, '..', 'resources', 'frontend')
  const fromRepo = path.join(repoRoot(), 'frontend', '.next', 'standalone')
  const fs = require('fs')
  if (fs.existsSync(path.join(prepared, 'server.js'))) return prepared
  return fromRepo
}

function backendDir() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'backend')
  }
  const prepared = path.join(__dirname, '..', 'resources', 'backend')
  const fromRepo = path.join(repoRoot(), 'backend')
  const fs = require('fs')
  if (fs.existsSync(path.join(prepared, 'app', 'main.py'))) return prepared
  return fromRepo
}

function bundledPythonDir() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'python')
  }
  return path.join(__dirname, '..', 'resources', 'python')
}

/**
 * Stable, update-independent storage location (e.g. ~/Library/Application
 * Support/FOUND3RY on macOS, %APPDATA%/FOUND3RY on Windows). Replacing the
 * .app bundle (a manual dmg drag, or an auto-update) deletes everything
 * under resourcesPath, including any file living next to the backend --
 * the desktop SQLite database must NOT live there or every update wipes it.
 */
function userDataDir() {
  return app.getPath('userData')
}

function envFileCandidates() {
  const candidates = []

  // 1. Next to the executable (packaged install / win-unpacked)
  try {
    candidates.push(path.join(path.dirname(app.getPath('exe')), '.env.desktop'))
  } catch {
    /* app may not be ready in some unit contexts */
  }

  // 2. Walk up from exe / desktop dir looking for monorepo env (Phase 1)
  const seeds = []
  try {
    seeds.push(path.dirname(app.getPath('exe')))
  } catch {
    /* ignore */
  }
  seeds.push(path.resolve(__dirname, '..')) // desktop/
  seeds.push(path.resolve(__dirname, '..', '..')) // repo root when unpackaged

  for (const seed of seeds) {
    let dir = seed
    for (let i = 0; i < 6; i++) {
      candidates.push(path.join(dir, '.env.desktop'))
      candidates.push(path.join(dir, '.env.local-prod'))
      candidates.push(path.join(dir, '.env'))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  // De-dupe while preserving order
  return [...new Set(candidates)]
}

module.exports = {
  isPackaged,
  repoRoot,
  frontendStandaloneDir,
  backendDir,
  bundledPythonDir,
  userDataDir,
  envFileCandidates,
}
