/**
 * Tiny static file server for Phase 5 local update-feed verification.
 * Serves a directory of electron-builder artifacts (latest.yml + installer).
 *
 * Usage:
 *   node scripts/serve-update-feed.js [dir] [port]
 * Default: desktop/release-feed  on 9876
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release-feed'))
const port = Number(process.argv[3] || 9876)

const mime = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.json': 'application/json',
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  const rel = urlPath === '/' ? '/latest.yml' : urlPath
  const filePath = path.normalize(path.join(root, rel))
  if (!filePath.startsWith(root)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log('[feed]', req.method, urlPath, '-> 404')
      res.writeHead(404)
      res.end('not found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    console.log('[feed]', req.method, urlPath, '->', data.length, 'bytes')
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Access-Control-Allow-Origin': '*',
    })
    res.end(data)
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[feed] serving ${root}`)
  console.log(`[feed] http://127.0.0.1:${port}/`)
  console.log('[feed] (local only — not GitHub)')
})
