// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * Smart gzip for on-chain payloads — applied wherever bytes go on-chain (embedded edition files, message
 * envelopes), gated by "keep ONLY if smaller". Uses the platform-native CompressionStream (browsers + Node
 * 18+), so zero dependencies. ALWAYS compress BEFORE encrypting — ciphertext is random and won't compress.
 *
 * The keep-if-smaller rule makes this safe to apply everywhere: text/markup shrinks 50–90%; already-compressed
 * media (jpg/png/mp4/pdf/zip) and short payloads (DMs, notes) just fail the test and stay raw — a no-op.
 */

/** Below this, gzip's ~18-byte header/footer can only enlarge — don't bother. */
const MIN_COMPRESS = 64

async function run(bytes: number[], stream: CompressionStream | DecompressionStream): Promise<number[]> {
  const writer = stream.writable.getWriter()
  void writer.write(new Uint8Array(bytes))
  void writer.close()
  const buf = await new Response(stream.readable).arrayBuffer()
  return Array.from(new Uint8Array(buf))
}

/** Gzip `bytes`, returning the compressed form ONLY if it's actually smaller (else the input, untouched). */
export async function compressIfSmaller(bytes: number[]): Promise<{ bytes: number[]; compressed: boolean }> {
  if (bytes.length < MIN_COMPRESS || typeof CompressionStream === 'undefined') return { bytes, compressed: false }
  const z = await run(bytes, new CompressionStream('gzip'))
  return z.length < bytes.length ? { bytes: z, compressed: true } : { bytes, compressed: false }
}

/** Decompress gzip bytes produced by compressIfSmaller. */
export async function decompress(bytes: number[]): Promise<number[]> {
  return run(bytes, new DecompressionStream('gzip'))
}
