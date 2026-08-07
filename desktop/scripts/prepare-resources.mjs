/**
 * Prepare desktop/resources for Electron packaging / local Electron runs.
 *
 * 1. Build Next.js with output:'standalone' and localhost API/WS URLs
 * 2. Copy standalone + static + public into desktop/resources/frontend
 * 3. Copy backend source into desktop/resources/backend
 * 4. Optionally mirror a portable Python runtime if DESKTOP_PYTHON_SRC is set
 *
 * Usage:
 *   node scripts/prepare-resources.mjs
 *   node scripts/prepare-resources.mjs --build-only   # frontend build only
 *   node scripts/prepare-resources.mjs --skip-build   # copy existing .next/standalone
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const frontendRoot = path.join(repoRoot, 'frontend')
const backendRoot = path.join(repoRoot, 'backend')
const resourcesRoot = path.join(desktopRoot, 'resources')

const args = new Set(process.argv.slice(2))
const skipBuild = args.has('--skip-build')
const buildOnly = args.has('--build-only')

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true })
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true })
}

function run(cmd, cmdArgs, opts) {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}`)
  const r = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  })
  if (r.status !== 0) {
    throw new Error(`Command failed (${r.status}): ${cmd} ${cmdArgs.join(' ')}`)
  }
}

function buildFrontend() {
  console.log('[prepare] Building Next.js standalone (localhost API/WS)...')
  // NEXT_PUBLIC_* are baked into the client bundle at build time.
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:8000',
    NEXT_PUBLIC_WS_URL: 'ws://127.0.0.1:8000',
  }
  run('npm', ['run', 'build'], { cwd: frontendRoot, env })
}

function findStandaloneServerJs(standaloneRoot) {
  const direct = path.join(standaloneRoot, 'server.js')
  if (fs.existsSync(direct)) return direct

  // Walk a few levels for mis-rooted traces (lockfile above the repo).
  const stack = [standaloneRoot]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === 'server.js') {
        // Prefer the app server.js (sibling package.json), skip node_modules.
        if (!full.includes(`${path.sep}node_modules${path.sep}`)) return full
      }
      if (entry.isDirectory() && entry.name !== 'node_modules') stack.push(full)
    }
  }
  return null
}

function stageFrontend() {
  const standalone = path.join(frontendRoot, '.next', 'standalone')
  const serverJs = findStandaloneServerJs(standalone)
  if (!serverJs) {
    throw new Error(
      `Missing server.js under ${standalone}. Ensure next.config.mjs has output: 'standalone' and build succeeded.`,
    )
  }

  const standaloneAppDir = path.dirname(serverJs)
  const dest = path.join(resourcesRoot, 'frontend')
  console.log(`[prepare] Staging frontend from ${standaloneAppDir} -> ${dest}`)
  rmrf(dest)
  mkdirp(dest)
  copyDir(standaloneAppDir, dest)

  // Next standalone does not include static/ or public/ — copy them in.
  const staticSrc = path.join(frontendRoot, '.next', 'static')
  const staticDest = path.join(dest, '.next', 'static')
  if (fs.existsSync(staticSrc)) {
    mkdirp(path.dirname(staticDest))
    copyDir(staticSrc, staticDest)
  } else {
    console.warn('[prepare] WARNING: frontend/.next/static missing')
  }

  const publicSrc = path.join(frontendRoot, 'public')
  const publicDest = path.join(dest, 'public')
  if (fs.existsSync(publicSrc)) {
    copyDir(publicSrc, publicDest)
  }

  if (!fs.existsSync(path.join(dest, 'server.js'))) {
    throw new Error('Staging failed: server.js not at resources/frontend/server.js')
  }
  console.log('[prepare] Frontend staged OK')
}

function stageBackend() {
  const dest = path.join(resourcesRoot, 'backend')
  console.log(`[prepare] Staging backend -> ${dest}`)
  rmrf(dest)
  mkdirp(dest)

  // Copy app package + requirements; skip caches and local envs.
  const skip = new Set([
    '__pycache__',
    '.venv',
    '.venv312',
    'venv',
    '.pytest_cache',
    '.mypy_cache',
    '.env',
  ])

  function walkCopy(srcDir, destDir) {
    mkdirp(destDir)
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      if (entry.name.startsWith('.venv')) continue
      if (entry.name.endsWith('.pyc')) continue
      const s = path.join(srcDir, entry.name)
      const d = path.join(destDir, entry.name)
      if (entry.isDirectory()) walkCopy(s, d)
      else fs.copyFileSync(s, d)
    }
  }

  walkCopy(backendRoot, dest)
  console.log('[prepare] Backend staged OK')
}

function stagePythonHint() {
  /**
   * Optional portable Python for either platform. In practice neither Windows
   * nor macOS packaging sets DESKTOP_PYTHON_SRC today — both rely on system
   * Python on PATH (python / python3 via resolvePythonExecutable). If
   * DESKTOP_PYTHON_SRC points at a pre-built runtime directory, copy it into
   * resources/python; otherwise leave a README stub.
   */
  const dest = path.join(resourcesRoot, 'python')
  const src = process.env.DESKTOP_PYTHON_SRC
  rmrf(dest)
  mkdirp(dest)

  if (src && fs.existsSync(src)) {
    console.log(`[prepare] Copying portable Python from ${src}`)
    copyDir(src, dest)
    fs.writeFileSync(
      path.join(dest, 'README.txt'),
      'Bundled Python runtime for FOUND3RY desktop sidecars.\n',
    )
  } else {
    fs.writeFileSync(
      path.join(dest, 'README.txt'),
      [
        'No portable Python was bundled.',
        'The packaged app uses system Python on PATH (python / python3 -m uvicorn).',
        'Optional: set DESKTOP_PYTHON_SRC to a portable runtime directory to bundle one.',
        'This is unused in the default Windows and macOS packaging paths today.',
        '',
      ].join('\n'),
    )
    console.log(
      '[prepare] No DESKTOP_PYTHON_SRC — packaged app will use system Python on PATH',
    )
  }
}

function main() {
  mkdirp(resourcesRoot)

  if (!skipBuild) {
    buildFrontend()
  } else {
    console.log('[prepare] --skip-build: using existing frontend/.next/standalone')
  }

  if (buildOnly) {
    console.log('[prepare] --build-only: done after frontend build')
    return
  }

  stageFrontend()
  stageBackend()
  stagePythonHint()
  console.log('[prepare] Done. resources/ ready for Electron / electron-builder.')
}

try {
  main()
} catch (err) {
  console.error('[prepare] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
}
