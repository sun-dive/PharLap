// Parse a lyric text block (extracted from an MP3 USLT frame or a FLAC LYRICS comment) for the player.
// If any line carries one or more [mm:ss(.xx)] LRC timestamps, the result is SYNCED — one entry per
// timestamp, sorted by time — for karaoke-style highlighting. Otherwise it's the plain non-empty lines
// (t = -1). LRC metadata tags like [ti:…]/[ar:…]/[offset:…] are ignored (they aren't mm:ss). null = nothing.

export interface ParsedLyrics { synced: boolean; lines: { t: number; text: string }[] }

export function parseLyrics(raw: string | null): ParsedLyrics | null {
  if (raw == null || raw.trim() === '') return null
  const rawLines = raw.replace(/\r/g, '').split('\n')
  const tsRe = /\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
  const synced: { t: number; text: string }[] = []
  for (const line of rawLines) {
    tsRe.lastIndex = 0
    const times: number[] = []
    let m: RegExpExecArray | null
    while ((m = tsRe.exec(line)) != null) times.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')))
    if (times.length > 0) {
      const text = line.replace(/\[[^\]]*\]/g, '').trim()
      for (const t of times) synced.push({ t, text })
    }
  }
  if (synced.length > 0) { synced.sort((a, b) => a.t - b.t); return { synced: true, lines: synced } }
  const plain = rawLines.map(l => l.trim()).filter(l => l !== '').map(text => ({ t: -1, text }))
  return plain.length > 0 ? { synced: false, lines: plain } : null
}
