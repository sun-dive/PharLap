// Curator-only (Node): make low-res sample images by shelling out to a host image tool — NOT @napi-rs/canvas
// (a 33 MB native module that OOM-killed the memory-capped cron). These tools run as SEPARATE processes (cheap,
// off the Node heap), so this is safe in the cron. From one HQ source we emit two WebP derivatives:
//   • watermarked low-res (domain overlay) → crawlers, bots, OG/social cards
//   • clean low-res → the browser canvas mix-and-match (design × prop, client-side)
//
// Portability chain (whichever the host has — matters for turnkey/DFY buyers' hosts):
//   1. ImageMagick    (`magick` / `convert`)         — CLI
//   2. GraphicsMagick (`gm convert`)                  — near-identical CLI
//   3. PHP-Imagick    (`php` + the imagick ext)       — ImageMagick engine via PHP (best quality; text needs a font)
//   4. PHP-GD         (`php` + the gd ext)            — the universal net; built-in-font text always renders
//
// Imported ONLY by the curator, never by the browser app bundle (uses child_process + fs).
import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// IM/GM need an explicit font file or they may pick a glyph-less one (Latin text → tofu boxes). These sans TTFs
// are near-universal on Linux shared hosts; first one present wins. None found → skip the watermark text (clean
// still renders, and the PHP-GD fallback uses a compiled-in font that always works).
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf',
  '/usr/share/fonts/gnu-free/FreeSans.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
]
let _font: string | null | undefined
function usableFont(): string | null {
  if (_font !== undefined) return _font
  for (const p of FONT_CANDIDATES) if (existsSync(p)) return (_font = p)
  return (_font = null)
}

export type ImageBackend = { kind: 'im' | 'gm' | 'phpimagick' | 'phpgd'; cmd: string }

let _backend: ImageBackend | null | undefined
/** Probe once for an available image tool (ImageMagick → GraphicsMagick → PHP-Imagick → PHP-GD), or null. */
export function imageBackend(): ImageBackend | null {
  if (_backend !== undefined) return _backend
  for (const cmd of ['magick', 'convert']) if (probe(cmd, ['-version'])) return (_backend = { kind: 'im', cmd })
  if (probe('gm', ['-version'])) return (_backend = { kind: 'gm', cmd: 'gm' })
  if (probe('php', ['-r', 'exit(extension_loaded("imagick")?0:1);'])) return (_backend = { kind: 'phpimagick', cmd: 'php' })
  if (probe('php', ['-r', 'exit(extension_loaded("gd")?0:1);'])) return (_backend = { kind: 'phpgd', cmd: 'php' })
  return (_backend = null)
}
function probe(cmd: string, args: string[]): boolean {
  try { return spawnSync(cmd, args, { stdio: 'ignore', timeout: 5000 }).status === 0 } catch { return false }
}
function run(cmd: string, args: string[]): boolean {
  try { return spawnSync(cmd, args, { stdio: 'ignore', timeout: 30000 }).status === 0 } catch { return false }
}

export interface SampleOpts {
  /** Watermark text (usually the site domain, e.g. "nft.sale"). */
  domain: string
  /** Longest edge of the output (never upscales — only shrinks). */
  maxDim?: number
  /** WebP quality 1..100. */
  quality?: number
}

/**
 * From HQ source bytes, write BOTH a watermarked low-res (`wmOut`) and a clean low-res (`cleanOut`) WebP under
 * `outDir`. Returns true on success. The source is a transient temp file (never served, deleted after). No-ops to
 * false if no image tool is available (caller keeps the raw cover).
 */
export function makeSamples(srcBytes: number[], outDir: string, wmOut: string, cleanOut: string, opts: SampleOpts): boolean {
  const be = imageBackend()
  if (be == null) return false
  const max = opts.maxDim ?? 800
  const q = opts.quality ?? 82
  const dir = mkdtempSync(join(tmpdir(), 'mkb-'))
  const src = join(dir, 'src') // extension-less; the tools sniff the format
  try {
    writeFileSync(src, Buffer.from(srcBytes))
    const clean = join(outDir, cleanOut)
    const wm = join(outDir, wmOut)
    if (be.kind === 'phpimagick') return phpScript(be.cmd, PHP_IMAGICK, src, clean, wm, max, q, opts.domain)
    if (be.kind === 'phpgd') return phpScript(be.cmd, PHP_GD, src, clean, wm, max, q, opts.domain)
    return convertClean(be, src, clean, max, q) && convertWatermark(be, src, wm, max, q, opts.domain)
  } catch { return false }
  finally { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } }
}

// ─── ImageMagick / GraphicsMagick (shared `convert`-style CLI) ───────
function imArgs(be: ImageBackend, args: string[]): { cmd: string; args: string[] } {
  return be.kind === 'gm' ? { cmd: be.cmd, args: ['convert', ...args] } : { cmd: be.cmd, args }
}
function convertClean(be: ImageBackend, src: string, out: string, max: number, q: number): boolean {
  const { cmd, args } = imArgs(be, [src, '-resize', `${max}x${max}>`, '-quality', String(q), out])
  return run(cmd, args)
}
function convertWatermark(be: ImageBackend, src: string, out: string, max: number, q: number, domain: string): boolean {
  const font = usableFont()
  // No usable font → a tofu watermark is worse than none; just emit the clean resize as the cover.
  if (!font) return convertClean(be, src, out, max, q)
  // Shrink (never upscale), pin the font, then a solid corner tag + a faint centred tag. Hex-alpha fills and
  // `-draw text` both parse in IM and GM.
  const small = String(Math.max(11, Math.round(max * 0.045)))
  const big = String(Math.max(20, Math.round(max * 0.11)))
  const { cmd, args } = imArgs(be, [
    src, '-resize', `${max}x${max}>`, '-font', font,
    '-gravity', 'SouthEast', '-fill', '#ffffffa6', '-pointsize', small, '-draw', `text 10,8 "${domain}"`,
    '-gravity', 'Center', '-fill', '#ffffff2b', '-pointsize', big, '-draw', `text 0,0 "${domain}"`,
    '-quality', String(q), out,
  ])
  return run(cmd, args)
}

// ─── PHP fallbacks (universal on PHP shared hosts) ───────────────────
// Both scripts take: <in> <clean-out> <wm-out> <maxDim> <quality> <domain>. Clean is mandatory; the watermark is
// best-effort (falls back to copying the clean if text rendering isn't available), so a cover always results.
function phpScript(php: string, script: string, src: string, clean: string, wm: string, max: number, q: number, domain: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'mkbphp-'))
  const file = join(dir, 's.php')
  try {
    writeFileSync(file, `<?php\n${script}\n`)
    return run(php, [file, src, clean, wm, String(max), String(q), domain])
  } catch { return false }
  finally { try { unlinkSync(file); rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } }
}

// GD: load → scale to maxDim → clean webp; then stamp the domain with the BUILT-IN font (no TTF needed).
const PHP_GD = `
$src=$argv[1];$clean=$argv[2];$wm=$argv[3];$max=(int)$argv[4];$q=(int)$argv[5];$dom=$argv[6];
if(!function_exists('imagewebp')){exit(2);}
$d=file_get_contents($src);$im=@imagecreatefromstring($d);if(!$im){exit(1);}
$w=imagesx($im);$h=imagesy($im);$s=min(1,$max/max($w,$h));$nw=max(1,(int)round($w*$s));$nh=max(1,(int)round($h*$s));
$r=imagescale($im,$nw,$nh);if(!$r){$r=$im;}
imagewebp($r,$clean,$q);
$c=imagecolorallocatealpha($r,255,255,255,40);imagestring($r,5,$nw-strlen($dom)*9-10,$nh-20,$dom,$c);
$f=imagecolorallocatealpha($r,255,255,255,100);imagestring($r,5,(int)($nw/2-strlen($dom)*4.5),(int)($nh/2-8),$dom,$f);
imagewebp($r,$wm,$q);exit(0);`.trim()

// Imagick: ImageMagick engine via PHP. Clean always; watermark best-effort (annotate needs a font → catch & copy).
const PHP_IMAGICK = `
$src=$argv[1];$clean=$argv[2];$wm=$argv[3];$max=(int)$argv[4];$q=(int)$argv[5];$dom=$argv[6];
try{$im=new Imagick($src);$im->setImageFormat('webp');$im->resizeImage($max,$max,Imagick::FILTER_LANCZOS,1,true);
$im->setImageCompressionQuality($q);$im->writeImage($clean);}catch(Exception $e){exit(1);}
try{$w=$im->getImageWidth();
$d=new ImagickDraw();$d->setFillColor(new ImagickPixel('rgba(255,255,255,0.65)'));$d->setFontSize(max(11,(int)round($w*0.045)));$d->setGravity(Imagick::GRAVITY_SOUTHEAST);$im->annotateImage($d,10,8,0,$dom);
$d2=new ImagickDraw();$d2->setFillColor(new ImagickPixel('rgba(255,255,255,0.17)'));$d2->setFontSize(max(20,(int)round($w*0.11)));$d2->setGravity(Imagick::GRAVITY_CENTER);$im->annotateImage($d2,0,0,0,$dom);
$im->writeImage($wm);}catch(Exception $e){@copy($clean,$wm);}
exit(0);`.trim()
