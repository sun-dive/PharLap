/**
 * Curator image-sample helper (shells out to ImageMagick/GraphicsMagick/PHP-GD).
 *  - imageBackend() probes a tool or returns null, never throws
 *  - makeSamples() emits a watermarked + a clean low-res WebP (functional test skips where no tool is installed)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageBackend, makeSamples } from '../src/imageSamples.ts'

const be = imageBackend()
const hasConvert = be != null && (be.kind === 'im' || be.kind === 'gm') // can also CREATE a test source

test('imageBackend: probes a tool or returns null, never throws', () => {
  const b = imageBackend()
  assert.ok(b === null || ['im', 'gm', 'phpimagick', 'phpgd'].includes(b.kind))
})

test('makeSamples: emits watermarked + clean WebP from a source', { skip: hasConvert ? false : 'no ImageMagick/GraphicsMagick on this host' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'imstest-'))
  try {
    const srcPath = join(dir, 'src.png')
    const pre = be!.kind === 'gm' ? ['convert'] : []
    spawnSync(be!.cmd, [...pre, '-size', '800x1000', 'gradient:navy-orange', srcPath]) // 4:5 gradient
    const src = Array.from(readFileSync(srcPath))
    const ok = makeSamples(src, dir, 'card.webp', 'clean.webp', { domain: 'nft.sale', maxDim: 640, quality: 80 })
    assert.equal(ok, true)
    for (const f of ['card.webp', 'clean.webp']) {
      const p = join(dir, f)
      assert.ok(existsSync(p), `${f} written`)
      const bytes = readFileSync(p)
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF', `${f} is RIFF`)
      assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP', `${f} is WEBP`)
      assert.ok(bytes.length > 100, `${f} non-trivial`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
