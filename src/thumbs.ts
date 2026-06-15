// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * NFT-card thumbnails.
 *
 * A thumbnail is a pure DISPLAY convenience, derived in-browser from a collection's already-public cover
 * image (or public image file) and cached in localStorage. NOTHING extra goes on-chain: a thumbnail is
 * fully regenerable from public data, so it belongs in a disposable local cache, not the permanent ledger
 * (which we keep as lean as possible). Browser-only (canvas + createImageBitmap + localStorage); the fetch
 * + source-selection lives in app.ts, this module owns the cache + the downscale.
 */
const PREFIX = 'p:thumb:'
const MAX_EDGE = 256 // longest thumbnail edge, px
const NONE = '-' // negative-cache marker: "this collection has no thumbnailable image"

/** Cached data-URL for a collection, or null if uncached or known to have no image. */
export function cachedThumb(collectionId: string): string | null {
  try { const v = localStorage.getItem(PREFIX + collectionId); return v != null && v !== NONE ? v : null } catch { return null }
}

/** Whether this collection has already been resolved (a real thumb or a negative) — skip re-fetching. */
export function thumbResolved(collectionId: string): boolean {
  try { return localStorage.getItem(PREFIX + collectionId) != null } catch { return false }
}

function store(collectionId: string, value: string): void {
  try { localStorage.setItem(PREFIX + collectionId, value) } catch { /* quota: thumbnails are disposable */ }
}

/** Record that a collection has no thumbnailable image, so we stop retrying it. */
export function cacheNoThumb(collectionId: string): void { store(collectionId, NONE) }

/**
 * Downscale image bytes to a cached thumbnail data-URL (WebP). Returns null — without caching — if the
 * bytes aren't a decodable image, so the caller can try another source or fall back to a placeholder.
 */
export async function makeThumb(collectionId: string, bytes: number[], mimeType: string): Promise<string | null> {
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return null
  try {
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType || 'application/octet-stream' })
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx == null) { bmp.close?.(); return null }
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const url = canvas.toDataURL('image/webp', 0.8)
    store(collectionId, url)
    return url
  } catch { return null }
}
