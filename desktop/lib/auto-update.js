/**
 * Background auto-update via electron-updater (Phase 5).
 *
 * Production config uses the GitHub provider (see package.json build.publish).
 * For local verification, set FOUND3RY_UPDATE_FEED_URL to a generic feed
 * base URL (e.g. http://127.0.0.1:9876/) — never contacts GitHub in that mode.
 *
 * Failures are logged only — never dialogs. Update-downloaded offers
 * Restart now / Later; Later leaves install for the next quit/restart.
 */
const { dialog, app } = require('electron')
const { autoUpdater } = require('electron-updater')

let started = false

function configureUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Local fake-feed verification only. Production leaves this unset and
  // uses build.publish (GitHub) from the packaged app-update.yml.
  const feed = process.env.FOUND3RY_UPDATE_FEED_URL
  if (feed && typeof feed === 'string' && feed.trim()) {
    const url = feed.trim().replace(/\/?$/, '/')
    autoUpdater.setFeedURL({ provider: 'generic', url })
    console.log('[auto-update] using generic feed (local verify):', url)
  }

  autoUpdater.on('error', (err) => {
    console.log(
      '[auto-update] check/download error (non-fatal):',
      err && err.message ? err.message : String(err),
    )
  })

  autoUpdater.on('checking-for-update', () => {
    console.log('[auto-update] checking for update…')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-update] update available:', info && info.version)
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log(
      '[auto-update] no update available (current',
      app.getVersion(),
      ', remote',
      info && info.version,
      ')',
    )
  })

  autoUpdater.on('download-progress', (p) => {
    if (p && typeof p.percent === 'number') {
      console.log(
        '[auto-update] download progress:',
        `${p.percent.toFixed(1)}%`,
        `(${Math.round(p.transferred / 1024 / 1024)}/${Math.round(p.total / 1024 / 1024)} MB)`,
      )
    }
  })

  autoUpdater.on('update-downloaded', async (info) => {
    console.log('[auto-update] update downloaded:', info && info.version)
    try {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'FOUND3RY update ready',
        message: `Version ${info && info.version ? info.version : 'a new release'} is ready to install.`,
        detail: 'Restart now to apply the update, or choose Later to install the next time FOUND3RY quits.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (result.response === 0) {
        // Silent NSIS install: the user already confirmed via our dialog.
        // isSilent=true, isForceRunAfter=true
        autoUpdater.quitAndInstall(true, true)
      } else {
        console.log('[auto-update] user chose Later — will install on next quit')
      }
    } catch (err) {
      console.log(
        '[auto-update] dialog failed (non-fatal):',
        err && err.message ? err.message : String(err),
      )
    }
  })
}

/**
 * Call once after the main BrowserWindow is shown. Non-blocking; errors stay in logs.
 * @param {import('electron').BrowserWindow | null} [mainWindow]
 */
function checkForUpdatesInBackground(mainWindow) {
  if (started) return
  started = true

  // Dev (`electron .`) has no packaged update metadata — skip quietly unless
  // an explicit local feed URL is set for Phase 5 verification.
  if (!app.isPackaged && !process.env.FOUND3RY_UPDATE_FEED_URL) {
    console.log('[auto-update] skipped (unpackaged, no FOUND3RY_UPDATE_FEED_URL)')
    return
  }

  try {
    configureUpdater()
  } catch (err) {
    console.log(
      '[auto-update] configure failed (non-fatal):',
      err && err.message ? err.message : String(err),
    )
    return
  }

  const delayMs = Number(process.env.FOUND3RY_UPDATE_CHECK_DELAY_MS || 5000)
  let ran = false
  const run = () => {
    if (ran) return
    ran = true
    try {
      console.log('[auto-update] starting background check (app', app.getVersion(), ')')
      autoUpdater.checkForUpdates().catch((err) => {
        console.log(
          '[auto-update] checkForUpdates rejected (non-fatal):',
          err && err.message ? err.message : String(err),
        )
      })
    } catch (err) {
      console.log(
        '[auto-update] checkForUpdates threw (non-fatal):',
        err && err.message ? err.message : String(err),
      )
    }
  }

  // Prefer waiting until the window is visible so boot/chat aren't contended.
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible()) {
      setTimeout(run, delayMs)
    } else {
      mainWindow.once('ready-to-show', () => setTimeout(run, delayMs))
      // Fallback if ready-to-show already fired before we attached.
      setTimeout(run, delayMs + 2000)
    }
  } else {
    setTimeout(run, delayMs)
  }
}

module.exports = {
  checkForUpdatesInBackground,
}
