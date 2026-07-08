import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3000
const WOC_BASE = 'https://api.whatsonchain.com'

// Build first — these version defines MUST match build.mjs; without them __APP_VERSION__ is left
// un-replaced in the bundle and init() throws (ReferenceError → no buttons wire up).
const APP_VERSION = '0.1'
const buildId = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' } })()
const buildDate = new Date().toISOString().slice(0, 10)
await build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  outfile: 'bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
  target: 'es2020',
  define: {
    'global': 'window',
    '__APP_VERSION__': JSON.stringify(APP_VERSION),
    '__BUILD_ID__': JSON.stringify(buildId),
    '__BUILD_DATE__': JSON.stringify(buildDate),
  },
})
console.log(`Build complete: bundle.js (v${APP_VERSION} · ${buildId} · ${buildDate})`)

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.map':  'application/json',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
}

const server = http.createServer((req, res) => {
  // Proxy /woc/* to WhatsOnChain API
  if (req.url.startsWith('/woc/')) {
    const apiPath = req.url.slice(4) // strip "/woc"
    const options = {
      hostname: 'api.whatsonchain.com',
      path: apiPath,
      method: req.method,
      headers: {
        'Accept': req.headers.accept || '*/*',
        'User-Agent': 'MPT-Prototype/1.0',
      },
    }

    if (req.headers['content-type']) {
      options.headers['Content-Type'] = req.headers['content-type']
    }

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      })
      proxyRes.pipe(res)
    })

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message)
      res.writeHead(502)
      res.end('Proxy error')
    })

    // Forward request body (for POST like broadcast)
    req.pipe(proxyReq)
    return
  }

  // Proxy /banana/* to GorillaPool's BananaBlocks API (second broadcast relay; see walletProvider.broadcast)
  if (req.url.startsWith('/banana/')) {
    const apiPath = req.url.slice(7) // strip "/banana"
    const options = {
      hostname: 'bananablocks.com',
      path: apiPath,
      method: req.method,
      headers: {
        'Accept': req.headers.accept || '*/*',
        // BananaBlocks 403s non-browser User-Agents (e.g. python-urllib), so present a browser-like one.
        'User-Agent': 'Mozilla/5.0 (PharLap dev proxy)',
      },
    }

    if (req.headers['content-type']) {
      options.headers['Content-Type'] = req.headers['content-type']
    }

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      })
      proxyRes.pipe(res)
    })

    proxyReq.on('error', (err) => {
      console.error('BananaBlocks proxy error:', err.message)
      res.writeHead(502)
      res.end('Proxy error')
    })

    req.pipe(proxyReq)
    return
  }

  // Static file serving
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url)
  const ext = path.extname(filePath)

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`)
  console.log(`WoC API proxy at http://localhost:${PORT}/woc/...`)
  console.log(`BananaBlocks proxy at http://localhost:${PORT}/banana/...`)
  console.log('Press Ctrl+C to stop')
})
