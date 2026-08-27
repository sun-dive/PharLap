// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
/**
 * Smart gzip for on-chain payloads — applied wherever bytes go on-chain (embedded edition files, message
 * envelopes), gated by "keep ONLY if smaller". Uses the platform-native CompressionStream (browsers + Node
 * 18+), so zero dependencies. ALWAYS compress BEFORE encrypting — ciphertext is random and won't compress.
 *
 * Two guards keep it safe everywhere: (1) known already-compressed formats (woff2/png/jpg/webp/mp3/…) are
 * skipped outright — gzip saves ~nothing on them but would force every consumer through a decompress step, so
 * they're stored RAW and stay directly usable (a woff2 atom drops straight into @font-face); (2) everything
 * else is kept ONLY if it actually shrank. Text/markup (svg/json) shrinks 50–90%; short payloads stay raw.
 */

/** Below this, gzip's ~18-byte header/footer can only enlarge — don't bother. */
const MIN_COMPRESS = 64

/** Already-compressed payloads — gzip yields ~nothing (sometimes a byte or two, sometimes larger) but forces a
 *  decompress step on every consumer. Store RAW so the bytes are directly reusable. Matched by MIME or filename
 *  extension (browsers report font/media MIME inconsistently). SVG/JSON/text are deliberately absent — they
 *  compress well and should. */
const PRECOMPRESSED_MIME = new Set<string>([
  'font/woff2', 'font/woff', 'application/font-woff2', 'application/font-woff', 'application/x-font-woff',
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/flac',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'application/zip', 'application/gzip', 'application/x-gzip', 'application/x-zip-compressed', 'application/pdf',
])
const PRECOMPRESSED_EXT = new Set<string>([
  'woff2', 'woff', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'heic', 'heif',
  'mp3', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'mp4', 'webm', 'mov', 'zip', 'gz', 'pdf',
])

/** True when a payload is already compressed (by MIME or filename ext) → skip gzip, store raw. */
export function isPrecompressed(mimeType?: string, fileName?: string): boolean {
  const mt = mimeType != null ? mimeType.split(';')[0].trim().toLowerCase() : ''
  if (mt !== '' && PRECOMPRESSED_MIME.has(mt)) return true
  const ext = fileName != null ? (/\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase() ?? '') : ''
  return ext !== '' && PRECOMPRESSED_EXT.has(ext)
}

async function run(bytes: number[], stream: CompressionStream | DecompressionStream): Promise<number[]> {
  const writer = stream.writable.getWriter()
  void writer.write(new Uint8Array(bytes))
  void writer.close()
  const buf = await new Response(stream.readable).arrayBuffer()
  return Array.from(new Uint8Array(buf))
}

/** Gzip `bytes`, returning the compressed form ONLY if it actually shrinks. Pass `mimeType`/`fileName` so
 *  already-compressed formats (woff2/png/jpg/…) are stored RAW — directly reusable, no decompress for consumers. */
export async function compressIfSmaller(
  bytes: number[], mimeType?: string, fileName?: string,
): Promise<{ bytes: number[]; compressed: boolean }> {
  if (isPrecompressed(mimeType, fileName) || bytes.length < MIN_COMPRESS || typeof CompressionStream === 'undefined') {
    return { bytes, compressed: false }
  }
  const z = await run(bytes, new CompressionStream('gzip'))
  return z.length < bytes.length ? { bytes: z, compressed: true } : { bytes, compressed: false }
}

/** Decompress gzip bytes produced by compressIfSmaller. */
export async function decompress(bytes: number[]): Promise<number[]> {
  return run(bytes, new DecompressionStream('gzip'))
}
