/**
 * Phase 14 — does webkitSpeechRecognition hear anything while speechSynthesis
 * is actively speaking? Real Chromium evidence for barge-in failure modes.
 *
 * Open http://127.0.0.1:9877/ in system Chrome (not Electron / Cursor browser),
 * allow mic, click Start, say “hey hero” while TTS talks. Results POST to
 * /result and are written to desktop/scripts/barge-probe-last-result.json.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const RESULT_PATH = path.join(__dirname, 'barge-probe-last-result.json')

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>barge-in probe</title></head>
<body style="font-family:system-ui;padding:24px;max-width:720px">
<h1>Barge-in acoustic probe</h1>
<p>Allows mic, starts continuous recognition, then speaks a long TTS phrase.
Watch whether onInterim/onFinal fire <em>during</em> TTS vs after it ends.
Say “hey hero” or “hey h3ro” while it is speaking.</p>
<button id="go">Start probe (allow mic)</button>
<pre id="out" style="background:#111;color:#0f0;padding:12px;white-space:pre-wrap;min-height:200px"></pre>
<script>
const log = (m) => {
  const line = typeof m === 'string' ? m : JSON.stringify(m);
  console.log('[BARGE-PROBE]', line);
  const el = document.getElementById('out');
  el.textContent += line + '\\n';
};
window.__BARGE_EVENTS = [];
window.__BARGE_RESULT = null;

async function persist(result) {
  try {
    await fetch('/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    log('RESULT_SAVED_TO_SERVER');
  } catch (e) {
    log('RESULT_SAVE_FAILED: ' + e);
  }
}

document.getElementById('go').onclick = async () => {
  window.__BARGE_EVENTS = [];
  document.getElementById('out').textContent = '';
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) { log('NO_SPEECH_RECOGNITION'); return; }

  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    log('getUserMedia: ok');
  } catch (e) {
    log('getUserMedia FAILED: ' + e);
    return;
  }

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-GB';

  let phase = 'pre_tts';
  const push = (type, extra) => {
    const ev = { t: Date.now(), phase, type, ...extra };
    window.__BARGE_EVENTS.push(ev);
    log(ev);
  };

  rec.onresult = (ev) => {
    let interim = '', final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const p = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) final += p; else interim += p;
    }
    push('onresult', { interim, final });
  };
  rec.onerror = (ev) => push('onerror', { error: ev.error });
  rec.onend = () => {
    push('onend', {});
    if (phase !== 'done') {
      try { rec.start(); push('restart', {}); } catch (e) { push('restart_failed', { e: String(e) }); }
    }
  };

  try { rec.start(); push('rec_started', {}); }
  catch (e) { log('rec.start failed: ' + e); return; }

  await new Promise(r => setTimeout(r, 1500));
  phase = 'during_tts';
  push('tts_start', {});

  const utter = new SpeechSynthesisUtterance(
    'This is a long spoken reply from H3RO. I am still talking so you can try to interrupt me by saying hey hero or hey h3ro while I continue. ' +
    'Keep speaking over me if you can. One two three four five six seven eight nine ten. ' +
    'The quick brown fox jumps over the lazy dog. Almost done with this monologue.'
  );
  utter.rate = 1.0;
  await new Promise((resolve) => {
    utter.onend = () => { push('tts_end', {}); resolve(); };
    utter.onerror = () => { push('tts_error', {}); resolve(); };
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  });

  phase = 'after_tts';
  await new Promise(r => setTimeout(r, 4000));
  phase = 'done';
  try { rec.abort(); } catch (_) {}

  const during = window.__BARGE_EVENTS.filter(e => e.phase === 'during_tts');
  const result = {
    ua: navigator.userAgent,
    duringTtsEventTypes: during.map(e => e.type),
    duringTtsOnResult: during.filter(e => e.type === 'onresult').length,
    duringTtsOnError: during.filter(e => e.type === 'onerror').map(e => e.error),
    duringTtsOnEnd: during.filter(e => e.type === 'onend').length,
    preTtsOnResult: window.__BARGE_EVENTS.filter(e => e.phase === 'pre_tts' && e.type === 'onresult').length,
    afterTtsOnResult: window.__BARGE_EVENTS.filter(e => e.phase === 'after_tts' && e.type === 'onresult').length,
    all: window.__BARGE_EVENTS,
  };
  window.__BARGE_RESULT = result;
  log('SUMMARY');
  log({
    duringTtsOnResult: result.duringTtsOnResult,
    preTtsOnResult: result.preTtsOnResult,
    afterTtsOnResult: result.afterTtsOnResult,
    duringErrors: [...new Set(result.duringTtsOnError)],
  });
  await persist(result);
};
</script>
</body></html>`

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body)
        const slim = {
          savedAt: new Date().toISOString(),
          ua: parsed.ua,
          duringTtsOnResult: parsed.duringTtsOnResult,
          preTtsOnResult: parsed.preTtsOnResult,
          afterTtsOnResult: parsed.afterTtsOnResult,
          duringTtsOnEnd: parsed.duringTtsOnEnd,
          duringErrorsUnique: [...new Set(parsed.duringTtsOnError || [])],
          duringResultSamples: (parsed.all || [])
            .filter((e) => e.phase === 'during_tts' && e.type === 'onresult')
            .slice(0, 20),
          preResultSamples: (parsed.all || [])
            .filter((e) => e.phase === 'pre_tts' && e.type === 'onresult')
            .slice(0, 10),
        }
        fs.writeFileSync(RESULT_PATH, JSON.stringify(slim, null, 2))
        console.log('SAVED', RESULT_PATH, JSON.stringify(slim))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(String(e))
      }
    })
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(HTML)
})
server.listen(9877, '127.0.0.1', () => {
  console.log('BARGE_PROBE_URL=http://127.0.0.1:9877/')
  console.log('RESULT_PATH=' + RESULT_PATH)
})
