/* First-run setup — local Ollama (Phase 3) + cloud BYOK choice (Phase 4). */

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

async function continueApp(mode) {
  showSkip(false)
  panel.innerHTML = `<p class="status">Starting FOUND3RY…</p><p class="detail">Launching local backend and UI.</p>`
  try {
    await api.continueToApp({ mode: mode || 'local' })
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

// ─── Top-level choice (Phase 4) ─────────────────────────────────────────────

function renderChoice() {
  showSkip(false)
  panel.innerHTML = `
    <p class="status">How should FOUND3RY run AI?</p>
    <p class="detail">
      Local models need Ollama and a capable GPU. Cloud uses your own Anthropic API key
      (bring-your-own-key — we never proxy or bill for tokens).
    </p>
    <div class="choice-grid">
      <button type="button" class="choice-card" id="pick-local">
        <span class="choice-title">Run models locally</span>
        <span class="choice-desc">Ollama + qwen2.5 on this machine. Free after download; needs GPU headroom.</span>
      </button>
      <button type="button" class="choice-card" id="pick-cloud">
        <span class="choice-title">Use your own cloud API key</span>
        <span class="choice-desc">Anthropic Claude for all chat tiers. You pay Anthropic directly.</span>
      </button>
    </div>
    <p class="hint"><button type="button" class="linkish" id="back-skip-choice">Skip for now</button> — chat may fail until a path is configured.</p>
  `
  document.getElementById('pick-local').onclick = () => runCheck()
  document.getElementById('pick-cloud').onclick = () => renderCloudKey()
  document.getElementById('back-skip-choice').onclick = () => continueApp('local')
}

function renderCloudKey() {
  showSkip(false)
  panel.innerHTML = `
    <p class="status">Anthropic API key</p>
    <p class="detail">
      Paste a key from
      <span class="mono">console.anthropic.com</span>.
      We’ll verify it with a tiny Claude Haiku call before saving.
      Stored with OS encryption when available (never written into your chat history).
    </p>
    <label class="field">
      <span class="field-label">API key</span>
      <input type="password" id="api-key" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" />
    </label>
    <div class="actions">
      <button type="button" class="btn-primary" id="save-cloud">Save &amp; continue</button>
      <button type="button" class="btn-secondary" id="back-choice">Back</button>
    </div>
    <p class="status-line hidden" id="cloud-status"></p>
    <p class="error hidden" id="cloud-error"></p>
  `

  const input = document.getElementById('api-key')
  const saveBtn = document.getElementById('save-cloud')
  const statusEl = document.getElementById('cloud-status')
  const errEl = document.getElementById('cloud-error')

  document.getElementById('back-choice').onclick = () => renderChoice()

  saveBtn.onclick = async () => {
    const key = input.value
    errEl.classList.add('hidden')
    statusEl.classList.remove('hidden', 'ready')
    statusEl.textContent = 'Verifying key with Anthropic…'
    saveBtn.disabled = true
    input.disabled = true
    try {
      const result = await api.byokValidateKey(key)
      if (!result.ok) {
        statusEl.classList.add('hidden')
        errEl.textContent = result.error || 'Validation failed'
        errEl.classList.remove('hidden')
        saveBtn.disabled = false
        input.disabled = false
        return
      }
      statusEl.textContent = 'Key valid — saving…'
      await api.byokSaveKey(key)
      statusEl.classList.add('ready')
      statusEl.textContent = 'Saved. Starting FOUND3RY…'
      await api.continueToApp({ mode: 'cloud' })
    } catch (err) {
      statusEl.classList.add('hidden')
      errEl.textContent = err.message || String(err)
      errEl.classList.remove('hidden')
      saveBtn.disabled = false
      input.disabled = false
    }
  }

  input.focus()
}

// ─── Phase 3 local Ollama flow (unchanged behavior once entered) ────────────

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
      <button type="button" class="btn-secondary" id="back-choice-local">Back</button>
    </div>
  `
  document.getElementById('open-download').onclick = async () => {
    await api.openDownloadPage()
  }
  document.getElementById('recheck').onclick = () => runCheck()
  document.getElementById('back-choice-local').onclick = () => renderChoice()
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
      <button type="button" class="btn-secondary" id="back-choice-missing">Back</button>
    </div>
    <p class="error hidden" id="pull-error"></p>
  `

  document.getElementById('pull').onclick = () => pullAll(missing)
  document.getElementById('back-choice-missing').onclick = () => renderChoice()
}

function renderReady(autoContinue) {
  showSkip(false)
  panel.innerHTML = `
    <p class="status ready">Ready</p>
    <p class="detail">Ollama is running and all required models are installed.</p>
  `
  if (autoContinue) {
    setTimeout(() => continueApp('local'), 700)
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
        <button type="button" class="btn-secondary" id="back-choice-err">Back</button>
      </div>
    `
    showSkip(true)
    document.getElementById('recheck').onclick = () => runCheck()
    document.getElementById('back-choice-err').onclick = () => renderChoice()
  }
}

skipBtn.onclick = () => continueApp('local')

if (!api) {
  panel.innerHTML = `<p class="status">Setup API missing</p><p class="detail">preload.js did not expose foundryOllamaSetup.</p>`
} else {
  renderChoice()
}
