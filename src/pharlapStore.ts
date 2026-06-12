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
  /** Covenant edition fields (present only for edition tokens). */
  kind?: 'edition'
  /** Edition locking script (hex) — needed to replicate/transfer the covenant. */
  lockHex?: string
  /** Edition terms (for rebuilding replicate/transfer txs). */
  creatorPubKeyHashHex?: string
  creatorFeeSats?: number
  holderFeeSats?: number
  /** Seller's promo note captured at purchase (the note that was current when this copy was bought). */
  sellerNote?: string
  /** Optional buyer bonus captured with the note: an external link or a redeemable code. */
  bonusKind?: 'link' | 'code'
  bonusValue?: string
  /** Block height of the acquiring tx (0/undefined = unconfirmed/newest) — orders the display, esp. after recovery. */
  heightHint?: number
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

  /** Empty the cache (e.g. on wallet switch — holdings are rebuildable from the WIF + chain). */
  clear(): void {
    this.write([])
  }

  /** Add a token if not already present (dedup by outpoint). Returns true if added. */
  add(token: {
    txId: string
    outputIndex: number
    collectionId: string
    stateData: string
    collectionName?: string
    addedAt?: string
    kind?: 'edition'
    lockHex?: string
    creatorPubKeyHashHex?: string
    creatorFeeSats?: number
    holderFeeSats?: number
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
      kind: token.kind,
      lockHex: token.lockHex,
      creatorPubKeyHashHex: token.creatorPubKeyHashHex,
      creatorFeeSats: token.creatorFeeSats,
      holderFeeSats: token.holderFeeSats,
    })
    this.write(tokens)
    return true
  }

  /** Update the cached collection name of a stored token (e.g. once resolved from TX1). */
  setCollectionName(txId: string, outputIndex: number, collectionName: string): void {
    const k = outpointKey({ txId, outputIndex })
    const tokens = this.list().map(t => (outpointKey(t) === k ? { ...t, collectionName } : t))
    this.write(tokens)
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
