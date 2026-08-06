/* Ollama first-run setup renderer — uses window.foundryOllamaSetup from preload. */

const api = window.foundryOllamaSetup
const panel = document.getElementById('panel')
const skipBtn = document.getElementById('skip')

function showSkip(visible) {
  skipBtn.classList.toggle('hidden', !visible)
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function pct(completed, total) {
  if (!total || total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
}

async function continueApp() {
  showSkip(false)
  panel.innerHTML = `<p class="status">Starting FOUND3RY…</p><p class="detail">Launching local backend and UI.</p>`
  try {
    await api.continueToApp()
  } catch (err) {
    panel.innerHTML = `<p class="status">Could not continue</p><p class="error">${escapeHtml(err.message || String(err))}</p>`
    showSkip(true)
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderChecking() {
  showSkip(false)
  panel.innerHTML = `<p class="status">Checking for Ollama…</p><p class="detail">Looking for a local Ollama server on port 11434.</p>`
}

function renderNotReachable() {
  showSkip(true)
  panel.innerHTML = `
    <p class="status">Ollama isn’t running</p>
    <p class="detail">
      FOUND3RY needs <strong>Ollama</strong> installed and running for local AI models.
      Download it from the official site, install it, then come back and check again.
      We won’t download or run the installer for you.
    </p>
    <div class="actions">
      <button type="button" class="btn-primary" id="open-download">Open download page</button>
      <button type="button" class="btn-secondary" id="recheck">I’ve installed it — check again</button>
    </div>
  `
  document.getElementById('open-download').onclick = async () => {
    await api.openDownloadPage()
  }
  document.getElementById('recheck').onclick = () => runCheck()
}

function renderMissing(missing) {
  showSkip(true)
  const items = missing
    .map(
      (tag) => `
      <li data-tag="${escapeHtml(tag)}">
        <div class="model-row">
          <span class="model-name">${escapeHtml(tag)}</span>
          <span class="model-meta" data-meta>Waiting</span>
        </div>
        <div class="bar" data-bar><span></span></div>
      </li>`,
    )
    .join('')

  panel.innerHTML = `
    <p class="status">Download required models</p>
    <p class="detail">
      Ollama is running, but ${missing.length} model${missing.length === 1 ? '' : 's'} still need
      to be pulled. This uses Ollama’s own download API — progress below is real bytes transferred.
    </p>
    <ul class="model-list">${items}</ul>
    <div class="actions">
      <button type="button" class="btn-primary" id="pull">Download models</button>
    </div>
    <p class="error hidden" id="pull-error"></p>
  `

  document.getElementById('pull').onclick = () => pullAll(missing)
}

function renderReady(autoContinue) {
  showSkip(false)
  panel.innerHTML = `
    <p class="status ready">Ready</p>
    <p class="detail">Ollama is running and all required models are installed.</p>
  `
  if (autoContinue) {
    setTimeout(() => continueApp(), 700)
  }
}

async function pullAll(missing) {
  const btn = document.getElementById('pull')
  const errEl = document.getElementById('pull-error')
  btn.disabled = true
  showSkip(false)
  errEl.classList.add('hidden')

  const unsub = api.onPullProgress((data) => {
    const li = panel.querySelector(`li[data-tag="${CSS.escape(data.tag)}"]`)
    if (!li) return
    const meta = li.querySelector('[data-meta]')
    const bar = li.querySelector('[data-bar]')
    const fill = bar.querySelector('span')
    const p = pct(data.completed, data.total)

    if (data.error) {
      meta.textContent = 'Error'
      bar.classList.remove('indeterminate')
      return
    }

    if (typeof p === 'number') {
      bar.classList.remove('indeterminate')
      fill.style.width = `${p}%`
      meta.textContent = `${p}% · ${formatBytes(data.completed)} / ${formatBytes(data.total)}`
    } else {
      bar.classList.add('indeterminate')
      fill.style.width = ''
      meta.textContent = data.status || 'Working…'
    }

    if (data.status === 'success') {
      bar.classList.remove('indeterminate')
      fill.style.width = '100%'
      meta.textContent = 'Done'
    }
  })

  try {
    for (const tag of missing) {
      const li = panel.querySelector(`li[data-tag="${CSS.escape(tag)}"]`)
      if (li) {
        li.querySelector('[data-meta]').textContent = 'Starting…'
        li.querySelector('[data-bar]').classList.add('indeterminate')
      }
      await api.pullModel(tag)
      if (li) {
        const bar = li.querySelector('[data-bar]')
        bar.classList.remove('indeterminate')
        bar.querySelector('span').style.width = '100%'
        li.querySelector('[data-meta]').textContent = 'Done'
      }
    }
    unsub()
    renderReady(true)
  } catch (err) {
    unsub()
    errEl.textContent = err.message || String(err)
    errEl.classList.remove('hidden')
    btn.disabled = false
    showSkip(true)
  }
}

async function runCheck() {
  renderChecking()
  try {
    const status = await api.checkStatus()
    if (!status.reachable) {
      renderNotReachable()
      return
    }
    if (status.missing && status.missing.length > 0) {
      renderMissing(status.missing)
      return
    }
    renderReady(true)
  } catch (err) {
    panel.innerHTML = `
      <p class="status">Check failed</p>
      <p class="error">${escapeHtml(err.message || String(err))}</p>
      <div class="actions">
        <button type="button" class="btn-secondary" id="recheck">Try again</button>
      </div>
    `
    showSkip(true)
    document.getElementById('recheck').onclick = () => runCheck()
  }
}

skipBtn.onclick = () => continueApp()

if (!api) {
  panel.innerHTML = `<p class="status">Setup API missing</p><p class="detail">preload.js did not expose foundryOllamaSetup.</p>`
} else {
  runCheck()
}
