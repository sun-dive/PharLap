// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP local token store.
 *
 * PushDrop token outputs are not WoC-address-indexed, so the wallet tracks its own token
 * outpoints locally (tokens it mints, and tokens it discovers via the notification scan).
 * Backed by localStorage in the browser; an injectable KV makes it unit-testable.
 */
export interface StoredToken {
  txId: string
  outputIndex: number
  /** Collection ID = TX1 txid (the token's tx1Ref). */
  collectionId: string
  /** Mutable per-UTXO state (hex). */
  stateData: string
  /** Cached collection name from TX1 (display convenience). */
  collectionName?: string
  status: 'active' | 'sent'
  addedAt: string
}

export interface KVStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'p:tokens'

function outpointKey(t: { txId: string; outputIndex: number }): string {
  return `${t.txId}:${t.outputIndex}`
}

export class PharLapStore {
  private kv: KVStore

  constructor(kv?: KVStore) {
    const fallback = (globalThis as unknown as { localStorage?: KVStore }).localStorage
    if (kv == null && fallback == null) {
      throw new Error('PharLapStore: no KV store available (localStorage missing)')
    }
    this.kv = kv ?? (fallback as KVStore)
  }

  list(): StoredToken[] {
    const raw = this.kv.getItem(STORAGE_KEY)
    if (raw == null || raw === '') return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as StoredToken[]) : []
    } catch {
      return []
    }
  }

  private write(tokens: StoredToken[]): void {
    this.kv.setItem(STORAGE_KEY, JSON.stringify(tokens))
  }

  /** Add a token if not already present (dedup by outpoint). Returns true if added. */
  add(token: {
    txId: string
    outputIndex: number
    collectionId: string
    stateData: string
    collectionName?: string
    addedAt?: string
  }): boolean {
    const tokens = this.list()
    const k = outpointKey(token)
    if (tokens.some(t => outpointKey(t) === k)) return false
    tokens.push({
      txId: token.txId,
      outputIndex: token.outputIndex,
      collectionId: token.collectionId,
      stateData: token.stateData,
      collectionName: token.collectionName,
      status: 'active',
      addedAt: token.addedAt ?? new Date().toISOString(),
    })
    this.write(tokens)
    return true
  }

  /** Mark a token as sent (spent in a transfer); kept for history. */
  markSent(txId: string, outputIndex: number): void {
    const k = outpointKey({ txId, outputIndex })
    const tokens = this.list().map(t => (outpointKey(t) === k ? { ...t, status: 'sent' as const } : t))
    this.write(tokens)
  }

  remove(txId: string, outputIndex: number): void {
    const k = outpointKey({ txId, outputIndex })
    this.write(this.list().filter(t => outpointKey(t) !== k))
  }

  /** Active (held) tokens. */
  active(): StoredToken[] {
    return this.list().filter(t => t.status === 'active')
  }
}
