// ─── Block Media Format (BMF) manifest ───────────────────────────────────────────────────────────
//
// A BMF manifest is the "recipe" for a composable video: a timeline that references media components
// (by on-chain txid, or by local name inside a .bmc) with start-time cues. See the spec at
// github.com/sun-dive/block-media-format. This parses both interchangeable encodings:
//
//   • JSON  — the pure on-chain form, carrying txid references:
//       { "bmf": 0, "audio": { "tx": "<txid>", "name": "supersonic.flac" }, "tempo": 110,
//         "scenes": [ { "t": 0.0, "tx": "<txid>", "name": "scene-01.webp" }, … ] }
//   • Cue   — LRC-compatible: `[mm:ss.cc]<name>` lines + optional `# key: value` headers.
//
// The player resolves each `tx` from chain (raw tx → the minted component's bytes) and sequences the
// scenes to the audio — a clip placed at N moments is one stored component + N cue lines. Reuse is free.

export const BMF_MIME = 'application/x.bmf'

export interface BmfRef { t: number; tx: string | null; name: string }
export interface BmfManifest {
  audio: { tx: string | null; name: string } | null
  tempo: number | null
  license: string | null       // reuse terms declared by the author, e.g. "CC BY 4.0"
  attribution: string | null   // who to credit, e.g. "Evidnus"
  scenes: BmfRef[]
}

const HEX64 = /^[0-9a-f]{64}$/i
// A reference may be a bare txid or an outpoint "txid:vout" — we resolve at the collection (genesis) txid.
function toTxid(s: unknown): string | null {
  const v = String(s ?? '').trim().split(':')[0].toLowerCase()
  return HEX64.test(v) ? v : null
}

/** LRC time "mm:ss.cc" (centiseconds) — the cue timestamp format the player already understands. */
export function fmtLrcTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  let cs = Math.round(sec * 100)
  const m = Math.floor(cs / 6000); cs -= m * 6000
  const s = Math.floor(cs / 100); cs -= s * 100
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** True if the mimeType/bytes look like a BMF manifest (JSON with a "bmf" key, or a cue with a bmf header). */
export function isBmf(mimeType: string | null | undefined, bytes?: number[]): boolean {
  if (mimeType === BMF_MIME || mimeType === 'application/vnd.blockmedia+json') return true
  if (bytes == null) return false
  const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 256))).replace(/^﻿/, '').trimStart()
  if (head.startsWith('{') && /"bmf"\s*:/.test(head)) return true // JSON form
  if (/^#\s*bmf\s*:/im.test(head)) return true                    // cue form with a `# bmf:` header
  return false
}

/** Parse a BMF manifest (JSON or cue) into audio + timed scenes. Returns null if it isn't a usable manifest. */
export function parseBmf(bytes: number[]): BmfManifest | null {
  const text = new TextDecoder().decode(new Uint8Array(bytes)).replace(/^﻿/, '').trim()
  if (text.startsWith('{')) {
    let j: { audio?: { tx?: unknown; name?: unknown }; tempo?: unknown; license?: unknown; attribution?: unknown; scenes?: { t?: unknown; tx?: unknown; name?: unknown }[] }
    try { j = JSON.parse(text) } catch { return null }
    if (j == null || !Array.isArray(j.scenes)) return null
    const scenes: BmfRef[] = []
    for (const s of j.scenes) {
      const t = Number(s?.t)
      if (!isFinite(t)) continue
      scenes.push({ t, tx: toTxid(s?.tx), name: String(s?.name ?? 'scene') })
    }
    if (scenes.length === 0) return null
    const audio = j.audio != null ? { tx: toTxid(j.audio.tx), name: String(j.audio.name ?? 'audio') } : null
    return {
      audio, tempo: isFinite(Number(j.tempo)) && Number(j.tempo) > 0 ? Number(j.tempo) : null,
      license: j.license != null ? String(j.license) : null,
      attribution: j.attribution != null ? String(j.attribution) : null,
      scenes: scenes.sort((a, b) => a.t - b.t),
    }
  }
  // Cue form: `[mm:ss.cc]name` scene lines + `# audio:`/`# tempo:`/`# license:`/`# attribution:` headers.
  const scenes: BmfRef[] = []
  let audioName: string | null = null
  let tempo: number | null = null
  let license: string | null = null
  let attribution: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^#\s*(audio|tempo|license|attribution)\s*:\s*(.+)$/i)
    if (h != null) {
      const key = h[1].toLowerCase(), val = h[2].trim()
      if (key === 'audio') audioName = val
      else if (key === 'tempo') { const v = Number(val); tempo = isFinite(v) && v > 0 ? v : null }
      else if (key === 'license') license = val
      else attribution = val
      continue
    }
    const m = line.match(/^\[(\d{1,2}):(\d{1,2}(?:\.\d{1,2})?)\](.+)$/)
    if (m != null) scenes.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), tx: null, name: m[3].trim() })
  }
  if (scenes.length === 0) return null
  return { audio: audioName != null ? { tx: null, name: audioName } : null, tempo, license, attribution, scenes: scenes.sort((a, b) => a.t - b.t) }
}
