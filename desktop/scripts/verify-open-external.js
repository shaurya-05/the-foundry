const { app, shell } = require('electron')

app.whenReady().then(async () => {
  try {
    const ok = await shell.openExternal('https://ollama.com/download')
    console.log('[verify] openExternal returned', ok)
  } catch (err) {
    console.error('[verify] openExternal failed', err)
    app.exit(1)
    return
  }
  setTimeout(() => app.quit(), 800)
})
