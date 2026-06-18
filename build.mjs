import { build } from 'esbuild'
import { execSync } from 'node:child_process'

// Base version: bump manually only at real milestones. The build id (git short hash + date) auto-updates
// every build, so individual fixes need no version edits.
const APP_VERSION = '0.1'
const buildId = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' } })()
const buildDate = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

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
