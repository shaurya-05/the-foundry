const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')
const {
  frontendStandaloneDir,
  backendDir,
  bundledPythonDir,
  isPackaged,
} = require('./paths')

/** @typedef {{ pid: number, kill: () => Promise<void>, label: string }} Sidecar */

/**
 * Kill a process tree. On Windows, child processes (uvicorn workers, node)
 * often outlive a bare process.kill — taskkill /T is required.
 */
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve()
      return
    }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
      // Don't hang forever if taskkill itself wedges.
      setTimeout(resolve, 3000)
    } else {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* already gone */
      }
      setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
        resolve()
      }, 1500)
    }
  })
}

function wrapChild(child, label) {
  /** @type {Sidecar} */
  const sidecar = {
    pid: child.pid,
    label,
    kill: async () => {
      await killTree(child.pid)
    },
  }
  child.stdout?.on('data', (buf) => {
    process.stdout.write(`[${label}] ${buf}`)
  })
  child.stderr?.on('data', (buf) => {
    process.stderr.write(`[${label}] ${buf}`)
  })
  child.on('exit', (code, signal) => {
    console.log(`[${label}] exited code=${code} signal=${signal}`)
  })
  return sidecar
}

function resolvePythonExecutable() {
  const bundled = bundledPythonDir()
  const winBundled = path.join(bundled, 'python.exe')
  const nixBundled = path.join(bundled, 'bin', 'python3')
  if (process.platform === 'win32' && fs.existsSync(winBundled)) {
    return winBundled
  }
  if (fs.existsSync(nixBundled)) {
    return nixBundled
  }
  // Dev / Phase 1 fallback: system Python on PATH.
  return process.platform === 'win32' ? 'python' : 'python3'
}

function resolveNodeExecutable() {
  // Packaged Electron can run as Node via ELECTRON_RUN_AS_NODE.
  // In dev we prefer the real node on PATH (cleaner stack traces).
  if (isPackaged()) {
    return process.execPath
  }
  return 'node'
}

function startBackend(env, port) {
  const cwd = backendDir()
  const mainPy = path.join(cwd, 'app', 'main.py')
  if (!fs.existsSync(mainPy)) {
    throw new Error(
      `Backend not found at ${cwd}. Run "npm run prepare:resources" in desktop/ first.`,
    )
  }
  const python = resolvePythonExecutable()
  const args = [
    '-m',
    'uvicorn',
    'app.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ]
  console.log(`[backend] spawning: ${python} ${args.join(' ')} (cwd=${cwd})`)
  const child = spawn(python, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.on('error', (err) => {
    console.error(`[backend] failed to spawn: ${err.message}`)
  })
  return wrapChild(child, 'backend')
}

function startFrontend(env, port) {
  const cwd = frontendStandaloneDir()
  const serverJs = path.join(cwd, 'server.js')
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `Next.js standalone server.js not found at ${cwd}. ` +
        `Run "npm run prepare:resources" in desktop/ first.`,
    )
  }
  const node = resolveNodeExecutable()
  const spawnEnv = { ...env }
  if (isPackaged()) {
    spawnEnv.ELECTRON_RUN_AS_NODE = '1'
  }
  console.log(`[frontend] spawning: ${node} server.js (cwd=${cwd}, port=${port})`)
  const child = spawn(node, ['server.js'], {
    cwd,
    env: spawnEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.on('error', (err) => {
    console.error(`[frontend] failed to spawn: ${err.message}`)
  })
  return wrapChild(child, 'frontend')
}

function waitForHttp(url, { timeoutMs = 90000, intervalMs = 400 } = {}) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) {
          resolve()
          return
        }
        retry()
      })
      req.on('error', retry)
      req.setTimeout(2000, () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`))
        return
      }
      setTimeout(attempt, intervalMs)
    }
    attempt()
  })
}

async function stopAll(sidecars) {
  const list = (sidecars || []).filter(Boolean)
  console.log(`[desktop] stopping ${list.length} sidecar(s)...`)
  await Promise.all(list.map((s) => s.kill()))
  console.log('[desktop] sidecars stopped')
}

module.exports = {
  startBackend,
  startFrontend,
  waitForHttp,
  stopAll,
  killTree,
  resolvePythonExecutable,
  resolveNodeExecutable,
}
