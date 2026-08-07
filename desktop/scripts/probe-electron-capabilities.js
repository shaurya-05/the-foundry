/**
 * Phase 13 probe — load over http://127.0.0.1 (secure context), log every
 * session permission request/check, mirror desktop/main.js sandbox + grants.
 *
 * CI=1 skips interactive showDirectoryPicker (hangs headless runners).
 */
const http = require('http')
const { app, BrowserWindow, session } = require('electron')

const IS_CI = process.env.CI === 'true' || process.env.CI === '1'

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>phase13-probe</title></head>
<body><pre id="out">probing…</pre>
<script>
window.__PHASE13_CI = ${IS_CI ? 'true' : 'false'};
window.__PHASE13_RUN = async () => {
  const out = {
    href: location.href,
    isSecureContext: window.isSecureContext,
    ci: window.__PHASE13_CI,
    userAgent: navigator.userAgent,
    hasSpeechRecognition: typeof window.SpeechRecognition !== 'undefined',
    hasWebkitSpeechRecognition: typeof window.webkitSpeechRecognition !== 'undefined',
    isSpeechRecognitionSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    showDirectoryPicker: typeof window.showDirectoryPicker,
    showOpenFilePicker: typeof window.showOpenFilePicker,
    mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    permissions: {},
    stt: { startThrew: null, firstEvent: null, error: null, resultFired: false, endFired: false, timedOut: false },
    getUserMedia: { ok: false, error: null, skipped: false },
    showDirectoryPickerCall: { ok: false, error: null, skipped: false },
  };

  if (navigator.permissions && navigator.permissions.query) {
    for (const name of ['microphone', 'camera', 'notifications']) {
      try {
        const s = await navigator.permissions.query({ name });
        out.permissions[name] = s.state;
      } catch (e) {
        out.permissions[name] = 'query_failed:' + (e && e.name ? e.name : e);
      }
    }
  }

  if (out.isSpeechRecognitionSupported) {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-GB';
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        out.stt.timedOut = true;
        out.stt.firstEvent = out.stt.firstEvent || 'timeout';
        try { rec.abort(); } catch (_) {}
        resolve();
      }, 8000);
      rec.onerror = (ev) => {
        out.stt.error = String(ev && ev.error ? ev.error : ev);
        out.stt.firstEvent = out.stt.firstEvent || 'onerror';
        clearTimeout(timer);
        resolve();
      };
      rec.onresult = () => {
        out.stt.resultFired = true;
        out.stt.firstEvent = out.stt.firstEvent || 'onresult';
        clearTimeout(timer);
        resolve();
      };
      rec.onend = () => { out.stt.endFired = true; };
      try { rec.start(); }
      catch (e) {
        out.stt.startThrew = String(e && e.message ? e.message : e);
        out.stt.firstEvent = 'start_threw';
        clearTimeout(timer);
        resolve();
      }
    });
    try { rec.abort(); } catch (_) {}
  }

  if (out.mediaDevices) {
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('getUserMedia_timeout_5s')), 5000)),
      ]);
      out.getUserMedia.ok = true;
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      out.getUserMedia.error = String(e && e.name ? e.name + ': ' + e.message : e);
    }
  }

  if (window.__PHASE13_CI) {
    out.showDirectoryPickerCall.skipped = true;
    out.showDirectoryPickerCall.error = 'skipped_on_ci';
  } else if (typeof window.showDirectoryPicker === 'function') {
    try {
      await window.showDirectoryPicker({ mode: 'read' });
      out.showDirectoryPickerCall.ok = true;
    } catch (e) {
      out.showDirectoryPickerCall.error = String(e && e.name ? e.name + ': ' + e.message : e);
    }
  }

  return out;
};
</script></body></html>`

const permissionLog = []

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(PAGE)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/`

  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    permissionLog.push({ type: 'request', permission, details: details || null })
    callback(permission === 'media' || permission === 'fileSystem')
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    permissionLog.push({ type: 'check', permission, requestingOrigin, details: details || null })
    return permission === 'media' || permission === 'fileSystem'
  })

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  await win.loadURL(url)
  const result = await Promise.race([
    win.webContents.executeJavaScript('window.__PHASE13_RUN()', true),
    new Promise((_, rej) => setTimeout(() => rej(new Error('executeJavaScript_timeout_25s')), 25000)),
  ])
  result.electronPermissionLog = permissionLog

  console.log('PHASE13_PROBE_RESULT=' + JSON.stringify(result))
  console.log(JSON.stringify(result, null, 2))

  server.close()
  app.exit(0)
}).catch((err) => {
  console.error('PHASE13_PROBE_FAILED', String(err && err.stack ? err.stack : err))
  app.exit(1)
})
