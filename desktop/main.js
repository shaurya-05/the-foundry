const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const { loadRawEnv, buildBackendEnv, buildFrontendEnv, resolvePorts } = require('./lib/env')
const { startBackend, startFrontend, waitForHttp, stopAll } = require('./lib/sidecars')
const { registerSetupIpc } = require('./lib/setup-ipc')
const { cloudByokBackendEnv } = require('./lib/cloud-byok')
const { checkForUpdatesInBackground } = require('./lib/auto-update')
const { registerSystemActionIpc } = require('./lib/system-action-ipc')

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null
/** @type {import('electron').BrowserWindow | null} */
let setupWindow = null
/** @type {Array<{ pid: number, kill: () => Promise<void>, label: string }>} */
let sidecars = []
let shuttingDown = false
/** True while leaving setup and starting sidecars — suppress window-all-closed quit. */
let continuingFromSetup = false
let sidecarsStarted = false

const setupPreloadPath = path.join(__dirname, 'preload.js')
const mainPreloadPath = path.join(__dirname, 'preload-main.js')

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 680,
    minWidth: 440,
    minHeight: 480,
    title: 'FOUND3RY Setup',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c0d10',
    webPreferences: {
      preload: setupPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  setupWindow.once('ready-to-show', () => {
    setupWindow?.show()
  })

  setupWindow.on('closed', () => {
    setupWindow = null
  })

  setupWindow.loadFile(path.join(__dirname, 'setup', 'index.html'))
}

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
      preload: mainPreloadPath,
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

/**
 * Existing Phase 1/2 sidecar boot — unchanged behavior once called.
 * @param {Record<string, string>} [envOverlay] merged after buildBackendEnv (cloud BYOK).
 */
async function startSidecarsAndWindow(envOverlay) {
  const raw = loadRawEnv()
  const ports = resolvePorts(raw)
  const frontendUrl = `http://127.0.0.1:${ports.frontend}`

  const backendEnv = {
    ...buildBackendEnv(raw, ports),
    ...(envOverlay || {}),
  }
  const frontendEnv = buildFrontendEnv(ports)

  try {
    const backend = startBackend(backendEnv, ports.backend)
    const frontend = startFrontend(frontendEnv, ports.frontend)
    sidecars = [backend, frontend]
    sidecarsStarted = true

    console.log(`[desktop] waiting for backend http://127.0.0.1:${ports.backend}/api/health`)
    await waitForHttp(`http://127.0.0.1:${ports.backend}/api/health`, {
      timeoutMs: 120000,
    })
    console.log(`[desktop] waiting for frontend ${frontendUrl}`)
    await waitForHttp(frontendUrl, { timeoutMs: 120000 })

    await createWindow(frontendUrl)

    // Phase 5: non-blocking update check after the main window exists.
    checkForUpdatesInBackground(mainWindow)

    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.close()
    }
  } catch (err) {
    console.error('[desktop] boot failed:', err)
    await stopAll(sidecars)
    sidecars = []
    sidecarsStarted = false
    dialog.showErrorBox(
      'FOUND3RY failed to start',
      `${err instanceof Error ? err.message : String(err)}\n\n` +
        'Desktop expects SQLite + in-memory cache by default (no Docker). ' +
        'Also needs a working Python with backend requirements installed, ' +
        'and either Ollama (local path) or a validated Anthropic API key (cloud BYOK).',
    )
    app.quit()
  }
}

/**
 * @param {{ mode?: 'local' | 'cloud' }} [opts]
 */
async function onSetupContinue(opts) {
  if (continuingFromSetup || sidecarsStarted) return
  continuingFromSetup = true
  try {
    let overlay = null
    if (opts && opts.mode === 'cloud') {
      overlay = cloudByokBackendEnv()
      console.log('[desktop] continuing with cloud BYOK overlay (USE_LOCAL_*=0)')
    }
    await startSidecarsAndWindow(overlay)
  } finally {
    continuingFromSetup = false
  }
}

async function boot() {
  registerSetupIpc({ onContinue: onSetupContinue })
  registerSystemActionIpc()
  createSetupWindow()
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
  if (continuingFromSetup) return
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
