const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const { loadRawEnv, buildBackendEnv, buildFrontendEnv, resolvePorts } = require('./lib/env')
const { startBackend, startFrontend, waitForHttp, stopAll } = require('./lib/sidecars')

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null
/** @type {Array<{ pid: number, kill: () => Promise<void>, label: string }>} */
let sidecars = []
let shuttingDown = false

async function createWindow(frontendUrl) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'FOUND3RY',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  await mainWindow.loadURL(frontendUrl)
}

async function boot() {
  const raw = loadRawEnv()
  const ports = resolvePorts(raw)
  const frontendUrl = `http://127.0.0.1:${ports.frontend}`

  const backendEnv = buildBackendEnv(raw, ports)
  const frontendEnv = buildFrontendEnv(ports)

  try {
    const backend = startBackend(backendEnv, ports.backend)
    const frontend = startFrontend(frontendEnv, ports.frontend)
    sidecars = [backend, frontend]

    console.log(`[desktop] waiting for backend http://127.0.0.1:${ports.backend}/api/health`)
    await waitForHttp(`http://127.0.0.1:${ports.backend}/api/health`, {
      timeoutMs: 120000,
    })
    console.log(`[desktop] waiting for frontend ${frontendUrl}`)
    await waitForHttp(frontendUrl, { timeoutMs: 120000 })

    await createWindow(frontendUrl)
  } catch (err) {
    console.error('[desktop] boot failed:', err)
    await stopAll(sidecars)
    sidecars = []
    dialog.showErrorBox(
      'FOUND3RY failed to start',
      `${err instanceof Error ? err.message : String(err)}\n\n` +
        'Phase 1 still requires Docker Desktop with postgres_prod + redis_prod ' +
        'healthy (ports 5433 / 6380), and a working Python with backend ' +
        'requirements installed (or desktop/resources/python from prepare).',
    )
    app.quit()
  }
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await stopAll(sidecars)
  } finally {
    sidecars = []
  }
}

app.whenReady().then(boot)

app.on('window-all-closed', async () => {
  await shutdown()
  app.quit()
})

app.on('before-quit', (event) => {
  if (shuttingDown) return
  // Ensure sidecars die even on Alt+F4 / tray quit paths.
  event.preventDefault()
  shutdown().finally(() => {
    app.exit(0)
  })
})

// Last-resort: if the main process is killed hard, Windows job objects aren't
// attached here — Phase 1 relies on before-quit + window-all-closed + taskkill /T.
process.on('exit', () => {
  // sync best-effort; async kill may not finish
  for (const s of sidecars) {
    try {
      if (process.platform === 'win32' && s.pid) {
        require('child_process').spawnSync(
          'taskkill',
          ['/pid', String(s.pid), '/T', '/F'],
          { stdio: 'ignore', windowsHide: true },
        )
      }
    } catch {
      /* ignore */
    }
  }
})
