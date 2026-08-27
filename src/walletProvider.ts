/**
 * WhatsOnChain-based wallet provider for BSV mainnet.
 *
 * This is the WALLET layer -- responsible for all network operations:
 *   - UTXO lookup (funding transactions)
 *   - Broadcasting signed transactions
 *   - Fetching raw transactions (for building inputs)
 *   - Fetching block headers (for SPV verification)
 *   - Fetching Merkle proofs (for proof chain construction)
 *   - Address history (for incoming token detection)
 *
 * The token protocol (tokenProtocol.ts) has NO dependency on this module.
 * Verification can be done offline with pre-fetched headers.
 */
import { Transaction } from '@bsv/sdk'
import type { MerkleProofEntry, MerklePathNode, BlockHeader as SpvBlockHeader } from './tokenProtocol'

// Use local proxy on localhost to avoid CORS issues
const WOC_BASE = (typeof location !== 'undefined' && location.hostname === 'localhost')
  ? '/woc/v1/bsv/main'
  : 'https://api.whatsonchain.com/v1/bsv/main'

// GorillaPool's BananaBlocks — an independent, miner-direct relay broadcast to ALONGSIDE WoC for resilience.
// WoC now front-ends ARC (stricter policy that can bounce non-standard covenant txs); GorillaPool is a permissive
// miner, so a covenant tx WoC rejects still has a home. Native REST broadcast: POST /tx/broadcast { rawtx }.
// Same localhost-proxy shape as WoC to dodge browser CORS in dev (see serve.mjs).
const BANANA_BASE = (typeof location !== 'undefined' && location.hostname === 'localhost')
  ? '/banana/api/v1'
  : 'https://bananablocks.com/api/v1'

// BananaBlocks' WhatsOnChain-compatible READ path (drop-in for WoC's /tx/{id}/proof/tsc and /block/{hash}/header),
// used for Merkle-proof retrieval. NOTE: its tsc `target` is the MERKLE ROOT, whereas WoC's is the block hash —
// so getMerkleProof adapts per source (see merkleProofBanana vs merkleProofWoC).
const BANANA_WOC_BASE = (typeof location !== 'undefined' && location.hostname === 'localhost')
  ? '/banana/api/v1/bsv/main'
  : 'https://bananablocks.com/api/v1/bsv/main'

// Orphan-guard poll: after a relay accepts, re-check the tx is actually visible; if it vanishes, re-broadcast.
const CONFIRM_POLL_TRIES = 3
const CONFIRM_POLL_INTERVAL_MS = 15_000

// Blocking parent-tx gate (before broadcasting a child that spends its output — e.g. edition TX2 spending
// collection TX1's change). Poll fast: an accepted tx usually shows in a relay mempool within a second or two.
// Two rounds with a single re-broadcast between them (idempotent). SPV → mempool visibility is enough; a child
// can safely spend an unconfirmed-but-seen parent, so there's no need to wait for a block.
const GATE_POLL_TRIES = 10
const GATE_POLL_INTERVAL_MS = 2_000

// ─── Types ──────────────────────────────────────────────────────────

export interface Utxo {
  txId: string
  outputIndex: number
  satoshis: number
  script: string
  /** Block height of the confirming tx (0 / undefined = unconfirmed). Used to order recovered holdings. */
  height?: number
}

export interface WalletBlockHeader extends SpvBlockHeader {
  hash: string
  timestamp: number
  prevHash: string
}

// ─── Rate Limiter (serializing queue) ────────────────────────────────

const MIN_REQUEST_DELAY = 350

/**
 * Serializing fetch queue. All API calls go through this single queue
 * so that concurrent async paths (balance refresh, incoming scan, auto-import)
 * cannot burst past the rate limit. Each request waits for the previous
 * one to complete + the minimum delay (350ms) before starting.
 * NOTE: This relies on global fetchQueue state; do not instantiate multiple providers.
 */
let fetchQueue: Promise<void> = Promise.resolve()

function queuedFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    fetchQueue = fetchQueue.then(async () => {
      try {
        const resp = await fetch(url, init)
        resolve(resp)
      } catch (err) {
        reject(err)
      }
      // Enforce delay AFTER the request completes (or fails)
      await new Promise(r => setTimeout(r, MIN_REQUEST_DELAY))
    })
  })
}

/** queuedFetch with automatic retry on 429 (rate limited) responses. */
async function fetchWithRetry(url: string, init?: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await queuedFetch(url, init)
    if (resp.status !== 429 || attempt === maxRetries) return resp
    // Back off before retrying: 500ms, 1000ms, 1500ms
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
  }
  return queuedFetch(url, init) // unreachable, satisfies TS
}

// ─── Wallet Provider ────────────────────────────────────────────────

export class WalletProvider {
  private address: string
  private txCache = new Map<string, string>()
  // Parsed-tx cache: Transaction.fromHex is O(tx size) and re-parsing a big file-bearing TX1 (e.g. an
  // app-snapshot collection, ~300 KB) on every meta/name/publisher lookup can freeze the page. A tx's bytes
  // never change once broadcast, so caching the parsed object (parsed once) is safe and removes the hot spot.
  private parsedTxCache = new Map<string, Transaction>()

  /**
   * v05.22: Local pending UTXO tracking for consecutive transfers.
   *
   * When we broadcast a TX, the change output won't appear in WoC's UTXO list
   * until the TX is confirmed. This prevents consecutive fragment transfers
   * because the second transfer can't find funding UTXOs.
   *
   * Solution: Track pending UTXOs locally and combine with confirmed UTXOs.
   */
  private pendingUtxos = new Map<string, Utxo>()  // key: "txId:outputIndex"
  private spentOutpoints = new Set<string>()       // key: "txId:outputIndex"

  constructor(address: string) {
    this.address = address
  }

  getAddress(): string {
    return this.address
  }

  // ── Wallet Operations (UTXO model) ─────────────────────────────

  /**
   * Get spendable UTXOs from WoC's mempool-aware `/unspent/all` endpoint.
   *
   * This endpoint returns BOTH confirmed and unconfirmed UTXOs (so funding can be spent
   * before it confirms), and flags outputs already spent by a mempool tx
   * (`isSpentInMempoolTx`) — which we exclude so we never build a `txn-mempool-conflict`
   * double-spend, even across page reloads (WoC is the source of truth for mempool spends).
   *
   * Local `pendingUtxos`/`spentOutpoints` remain as a short-window supplement covering the
   * lag between our own broadcast and WoC reflecting it.
   */
  async getUtxos(): Promise<Utxo[]> {
    const address = this.getAddress()

    const mapRows = (data: any): Utxo[] => {
      const rows: any[] = Array.isArray(data?.result) ? data.result : (Array.isArray(data) ? data : [])
      return rows
        .filter((u: any) => u.isSpentInMempoolTx !== true) // never a UTXO already spent in the mempool
        .map((u: any) => ({
          txId: u.tx_hash as string,
          outputIndex: u.tx_pos as number,
          satoshis: u.value as number,
          script: '',
        }))
    }

    // Confirmed UTXOs (mempool-aware: flags + excludes mempool-spent outputs).
    const allResp = await fetchWithRetry(`${WOC_BASE}/address/${address}/unspent/all`)
    if (!allResp.ok) throw new Error(`WoC UTXO fetch failed: ${allResp.status}`)
    const confirmedUtxos = mapRows(await allResp.json())

    // Unconfirmed received UTXOs, so funding can be spent before it confirms (best-effort).
    let unconfirmedUtxos: Utxo[] = []
    try {
      const ucResp = await fetchWithRetry(`${WOC_BASE}/address/${address}/unconfirmed/unspent`)
      if (ucResp.ok) unconfirmedUtxos = mapRows(await ucResp.json())
    } catch { /* unconfirmed is best-effort */ }

    // Merge + dedupe by outpoint.
    const seen = new Set<string>()
    const onchain: Utxo[] = []
    for (const u of [...confirmedUtxos, ...unconfirmedUtxos]) {
      const k = `${u.txId}:${u.outputIndex}`
      if (seen.has(k)) continue
      seen.add(k)
      onchain.push(u)
    }

    const isSpent = (u: { txId: string; outputIndex: number }) =>
      this.spentOutpoints.has(`${u.txId}:${u.outputIndex}`)

    // Drop pending entries WoC now reports; exclude anything we've spent locally.
    for (const u of onchain) this.pendingUtxos.delete(`${u.txId}:${u.outputIndex}`)
    const available = onchain.filter(u => !isSpent(u))
    const pending = Array.from(this.pendingUtxos.values()).filter(u => !isSpent(u))

    console.debug(`getUtxos: ${onchain.length} on-chain (mempool-aware), ${this.spentOutpoints.size} spent locally, ${pending.length} pending = ${available.length + pending.length} available`)
    return [...available, ...pending]
  }

  /**
   * Register a pending transaction for local UTXO tracking.
   *
   * Call this after broadcasting a TX to enable consecutive transfers
   * before the TX is confirmed.
   *
   * @param txId - The broadcast transaction ID
   * @param spentInputs - Outpoints consumed by this TX [{txId, outputIndex}]
   * @param changeOutput - Change output created by this TX (if any)
   */
  registerPendingTx(
    txId: string,
    spentInputs: Array<{ txId: string; outputIndex: number }>,
    changeOutput?: { outputIndex: number; satoshis: number },
  ): void {
    // Mark spent inputs
    for (const input of spentInputs) {
      const key = `${input.txId}:${input.outputIndex}`
      this.spentOutpoints.add(key)
      // Also remove from pending if we're spending our own unconfirmed change
      this.pendingUtxos.delete(key)
    }

    // Track change output as pending UTXO
    if (changeOutput && changeOutput.satoshis > 0) {
      const key = `${txId}:${changeOutput.outputIndex}`
      this.pendingUtxos.set(key, {
        txId,
        outputIndex: changeOutput.outputIndex,
        satoshis: changeOutput.satoshis,
        script: '',
      })
      console.debug(`registerPendingTx: Added pending UTXO ${key.slice(0, 16)}... (${changeOutput.satoshis} sats)`)
    }

    console.debug(`registerPendingTx: TX ${txId.slice(0, 12)}... spent ${spentInputs.length} inputs, pending UTXOs: ${this.pendingUtxos.size}`)
  }

  /**
   * Clear spent outpoints for a confirmed transaction.
   *
   * Call this when a pending TX is confirmed to clean up tracking state.
   * Note: Pending UTXOs are auto-cleaned in getUtxos() when they appear confirmed.
   */
  clearConfirmedSpends(spentInputs: Array<{ txId: string; outputIndex: number }>): void {
    for (const input of spentInputs) {
      const key = `${input.txId}:${input.outputIndex}`
      this.spentOutpoints.delete(key)
    }
  }

  async getBalance(): Promise<number> {
    const utxos = await this.getUtxos()
    return utxos.reduce((sum, u) => sum + u.satoshis, 0)
  }

  // ── Broadcasting ──────────────────────────────────────────────

  /** POST the same signed tx to both relays; resolves with the name of the FIRST to accept, rejects
   *  (AggregateError) only if ALL reject. Shared by the initial broadcast and the orphan-guard re-broadcast. */
  private relayBroadcast(rawHex: string): Promise<string> {
    const relays: Array<{ name: string, url: string, body: unknown }> = [
      { name: 'WoC', url: `${WOC_BASE}/tx/raw`, body: { txhex: rawHex } },
      { name: 'BananaBlocks', url: `${BANANA_BASE}/tx/broadcast`, body: { rawtx: rawHex } },
    ]
    // Promise.any resolves on the first acceptance; rejects only if ALL reject.
    return Promise.any(relays.map(async r => {
      const resp = await queuedFetch(r.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r.body),
      })
      if (!resp.ok) throw new Error(`${r.name} ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
      return r.name
    }))
  }

  async broadcast(rawHex: string, opts: { awaitSeen?: boolean } = {}): Promise<string> {
    // The txid is deterministic from the signed tx, so compute it locally instead of trusting a relay's echo —
    // an ARC-style relay can return 200 + a txid for a tx it later orphans (see bitcoin-sv/arc #1006).
    const txId = Transaction.fromHex(rawHex).id('hex')

    // Fan the SAME signed tx out to two independent relays and succeed on the FIRST acceptance. WoC front-ends
    // ARC (stricter policy — can bounce non-standard covenant txs); GorillaPool's BananaBlocks routes straight to
    // a permissive miner. Same tx → same txid, so sending to both carries no double-spend risk: it just gives the
    // tx two independent shots at a miner and removes WoC as a single point of failure. A relay CORS-blocked or
    // down in one environment simply loses its race; the other carries the tx (graceful degradation).
    try {
      const winner = await this.relayBroadcast(rawHex)
      console.info(`[broadcast] ${txId} accepted by ${winner}`)
    } catch (agg) {
      const errs = (agg as AggregateError)?.errors?.map(e => String((e as Error)?.message ?? e)) ?? [String(agg)]
      throw new Error(`Broadcast rejected by all relays (${txId}): ${errs.join(' | ')}`)
    }

    // Cache the raw hex of what we just broadcast so a spend of one of its outputs (transfer / replicate /
    // burn of a freshly-created edition) can be built immediately, without waiting for a relay to index the tx.
    this.txCache.set(txId, rawHex)

    // A relay can accept a tx (200 + txid) then silently drop it without mining — arc #1006 saw txs sit in
    // ORPHAN_MEMPOOL until re-broadcast. If a CHILD tx will spend this tx's output in the same mint (edition TX2
    // over collection TX1's change), the caller passes awaitSeen: we BLOCK until the tx is actually visible in a
    // relay mempool before returning, so the child can never race ahead of its unconfirmed parent (which the node
    // rejects as "Missing inputs"). awaitInMempool throws if it never appears, so the caller aborts BEFORE
    // broadcasting the child — no orphaned child tx. Standalone txs just get the non-blocking background guard.
    if (opts.awaitSeen) await this.awaitInMempool(txId, rawHex)
    else void this.confirmLanded(txId, rawHex).catch(() => {})
    return txId
  }

  /** Which relay (if any) currently reports this tx as present (mempool or mined). BananaBlocks is checked first —
   *  it's independent and non-pruning, so it holds the more complete mempool view. */
  private async visibleOn(txId: string): Promise<string | null> {
    const relays: Array<[string, string]> = [
      ['BananaBlocks', `${BANANA_BASE}/tx/${txId}`],
      ['WoC', `${WOC_BASE}/tx/${txId}/hex`],
    ]
    const seen = await Promise.all(relays.map(async ([name, url]) => {
      try { return (await fetch(url)).ok ? name : null } catch { return null }
    }))
    return seen.find(Boolean) ?? null
  }

  /** Poll the relays until a just-broadcast tx is visible; if neither reports it after a short grace window,
   *  re-broadcast once. Non-blocking and best-effort — the caller already holds the deterministic txid. Used as
   *  the background orphan-guard for standalone txs (those with no child spending them in the same batch). */
  private async confirmLanded(txId: string, rawHex: string): Promise<void> {
    for (let i = 0; i < CONFIRM_POLL_TRIES; i++) {
      await new Promise(r => setTimeout(r, CONFIRM_POLL_INTERVAL_MS))
      const on = await this.visibleOn(txId)
      if (on) { console.info(`[broadcast] ${txId} confirmed live in mempool (seen by ${on})`); return }
    }
    const secs = Math.round(CONFIRM_POLL_TRIES * CONFIRM_POLL_INTERVAL_MS / 1000)
    console.warn(`[broadcast] ${txId} not visible on any relay after ~${secs}s — re-broadcasting (possible ARC orphan, arc #1006)`)
    try { const w = await this.relayBroadcast(rawHex); console.info(`[broadcast] ${txId} re-broadcast, accepted by ${w}`) }
    catch { console.error(`[broadcast] ${txId} re-broadcast rejected by all relays`) }
  }

  /** BLOCKING parent-tx gate: wait until txId is visible in a relay mempool so a child tx can safely spend its
   *  output. Polls on a fast cadence (a just-accepted tx usually surfaces within a second or two); the first check
   *  is immediate, so the common case returns near-instantly. If it stalls for a full window, re-broadcast once
   *  (idempotent — same txid, no double-spend) then poll again — this recovers the ARC-orphan case that first
   *  bit the suited-up mint. Throws if it never appears, so the caller aborts before broadcasting the child (no
   *  orphaned child tx). SPV: mempool visibility is all the child needs — no block wait. */
  private async awaitInMempool(txId: string, rawHex: string): Promise<void> {
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < GATE_POLL_TRIES; i++) {
        const on = await this.visibleOn(txId)
        if (on) { console.info(`[broadcast] parent ${txId} in mempool (seen by ${on}) — child tx clear to broadcast`); return }
        await new Promise(r => setTimeout(r, GATE_POLL_INTERVAL_MS))
      }
      if (round === 0) {
        const secs = Math.round(GATE_POLL_TRIES * GATE_POLL_INTERVAL_MS / 1000)
        console.warn(`[broadcast] parent ${txId} not in any mempool after ~${secs}s — re-broadcasting (possible ARC orphan, arc #1006)`)
        try { const w = await this.relayBroadcast(rawHex); console.info(`[broadcast] parent ${txId} re-broadcast, accepted by ${w}`) }
        catch { /* keep polling — the original acceptance may still surface on a relay */ }
      }
    }
    throw new Error(`Parent tx ${txId} never appeared in a relay mempool — aborting before the dependent tx to avoid "Missing inputs". Please retry the mint.`)
  }

  // ── Raw Transactions ──────────────────────────────────────────

  async getRawTransaction(txId: string): Promise<string> {
    const cached = this.txCache.get(txId)
    if (cached) return cached
    const resp = await fetchWithRetry(`${WOC_BASE}/tx/${txId}/hex`)
    if (!resp.ok) throw new Error(`WoC raw TX fetch failed: ${resp.status}`)
    const hex = await resp.text()
    this.txCache.set(txId, hex)
    return hex
  }

  async getSourceTransaction(txId: string): Promise<Transaction> {
    const cached = this.parsedTxCache.get(txId)
    if (cached) return cached
    const hex = await this.getRawTransaction(txId)
    const tx = Transaction.fromHex(hex)
    this.parsedTxCache.set(txId, tx)
    return tx
  }

  /**
   * Fetch ONE output's locking-script hex via WoC, STREAMING the body and bailing the moment it exceeds
   * `maxBytes` — so the sales page can read a collection's small storefront/template outputs without pulling
   * a large embedded content file (e.g. a 40 MB audio track). Returns the hex; the sentinel 'oversized' if it
   * blew the cap (skipped without downloading the body); or null if the output doesn't exist (past the last
   * index). Hex is 2 chars/byte, so the byte cap is doubled internally.
   */
  async getOutputScriptHexCapped(txId: string, index: number, maxBytes = 512 * 1024): Promise<string | 'oversized' | null> {
    const resp = await fetchWithRetry(`${WOC_BASE}/tx/${txId}/out/${index}/hex`)
    if (resp.status === 404) return null
    if (!resp.ok) throw new Error(`WoC output fetch failed: ${resp.status}`)
    const capHex = maxBytes * 2
    // Fast path: a known Content-Length lets us skip a huge output without reading any of the body.
    const cl = Number(resp.headers.get('content-length') ?? 0)
    if (cl > capHex) { try { await resp.body?.cancel() } catch { /* ignore */ } return 'oversized' }
    // Stream with a cap (also covers chunked / missing Content-Length): abort the moment we exceed it.
    const reader = resp.body?.getReader()
    if (reader == null) { const t = (await resp.text()).trim(); return t.length > capHex ? 'oversized' : (t || null) }
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (received > capHex) { try { await reader.cancel() } catch { /* ignore */ } return 'oversized' }
      chunks.push(value)
    }
    let total = 0; for (const c of chunks) total += c.length
    const buf = new Uint8Array(total); let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length }
    const hex = new TextDecoder().decode(buf).trim()
    return hex.length === 0 ? null : hex
  }

  // ── Block Headers (feeds into SPV verification) ───────────────

  /** Relay-reported confirmation of a tx: its block height + block time (unix seconds), or null if unconfirmed
   *  (mempool) or not found. For provenance display only — not an SPV proof (use getMerkleProof for that).
   *  Prefers BananaBlocks (GorillaPool — independent + non-pruning, so a more complete/reliable index than WoC,
   *  which now sits behind the BSVA/pruning landscape), falling back to WoC if BananaBlocks is unavailable. */
  async getTxConfirmation(txId: string): Promise<{ blockHeight: number; time: number } | null> {
    // Primary: BananaBlocks native /tx/{id} → { block_height, block_time, confirmations }.
    try {
      const resp = await fetchWithRetry(`${BANANA_BASE}/tx/${txId}`)
      if (resp.ok) {
        const d = await resp.json()
        const h = (d?.block_height ?? 0) as number
        return h > 0 ? { blockHeight: h, time: (d?.block_time ?? 0) as number } : null // known; null ⇒ mempool
      }
    } catch { /* fall back to WoC below */ }
    // Fallback: WoC /tx/hash/{id} → { blockheight, blocktime }.
    const resp = await fetchWithRetry(`${WOC_BASE}/tx/hash/${txId}`)
    if (!resp.ok) return null
    const d = await resp.json()
    const h = (d?.blockheight ?? 0) as number
    if (h <= 0) return null // unconfirmed / mempool
    return { blockHeight: h, time: (d?.blocktime ?? d?.time ?? 0) as number }
  }

  /** Current chain tip height (for approximate time-bucketing of activity by block-height delta). */
  async getChainHeight(): Promise<number> {
    const resp = await fetchWithRetry(`${WOC_BASE}/chain/info`)
    if (!resp.ok) throw new Error(`WoC chain info fetch failed: ${resp.status}`)
    const data = await resp.json()
    return (data?.blocks ?? 0) as number
  }

  async getBlockHeader(height: number): Promise<WalletBlockHeader> {
    const hashResp = await fetchWithRetry(`${WOC_BASE}/block/height/${height}`)
    if (!hashResp.ok) throw new Error(`WoC block height fetch failed: ${hashResp.status}`)
    const hashBody = await hashResp.text()

    // WoC may return just the hash string or a full block JSON object
    let blockHash: string
    try {
      const parsed = JSON.parse(hashBody)
      blockHash = typeof parsed === 'string' ? parsed : parsed.hash
    } catch {
      blockHash = hashBody.replace(/"/g, '')
    }

    // If we got the full block object, we can extract the header directly
    // without a second API call
    try {
      const parsed = JSON.parse(hashBody)
      if (typeof parsed === 'object' && parsed.merkleroot) {
        return {
          height,
          merkleRoot: parsed.merkleroot,
          hash: parsed.hash,
          timestamp: parsed.time,
          prevHash: parsed.previousblockhash,
        }
      }
    } catch {
      // Not JSON, proceed with separate header fetch
    }

    const headerResp = await fetchWithRetry(`${WOC_BASE}/block/${blockHash}/header`)
    if (!headerResp.ok) throw new Error(`WoC block header fetch failed: ${headerResp.status}`)
    const hdr = await headerResp.json()

    return {
      height,
      merkleRoot: hdr.merkleroot,
      hash: hdr.hash,
      timestamp: hdr.time,
      prevHash: hdr.previousblockhash,
    }
  }

  // ── Address History ───────────────────────────────────────────

  async getAddressHistory(address: string = this.getAddress()): Promise<{ txId: string; blockHeight: number }[]> {
    const resp = await fetchWithRetry(`${WOC_BASE}/address/${address}/history`)
    // WoC returns 404 for an address it has never seen — i.e. a brand-new wallet with zero
    // transactions. That's an empty history, not a failure; treat it as [] so fresh wallets
    // (e.g. a gift recipient) load and can claim instead of throwing on first run.
    if (resp.status === 404) return []
    if (!resp.ok) throw new Error(`WoC history fetch failed: ${resp.status}`)
    const data = await resp.json()
    if (!Array.isArray(data)) return []
    return data.map((entry: any) => ({
      txId: entry.tx_hash as string,
      blockHeight: (entry.height ?? 0) as number,
    }))
  }

  // ── Script-hash UTXOs (find covenant outputs not at our address) ──

  /**
   * Unspent outputs paying a given script hash. Edition covenant outputs are locked to an owner pubkey
   * embedded in a custom script, NOT to a P2PKH address, so they aren't in any address's UTXO set — but
   * their exact script is deterministically derivable (covenant.buildHolderEditionScript), and WoC indexes
   * by script hash. This is how the sales page resolves a holder's current spendable edition.
   *
   * Uses the MEMPOOL-AWARE `/unspent/all` (confirmed + unconfirmed, flags mempool-spent) so a just-acquired
   * edition — and the note/bonus that rode in on its tx — resolves immediately, before confirmation; falls
   * back to the confirmed-only `/unspent` if `/all` isn't available. `scriptHash` is SHA-256(scriptBytes)
   * byte-reversed (Electrum/WoC convention).
   */
  async getUnspentByScriptHash(scriptHash: string): Promise<Utxo[]> {
    const mapRows = (data: any): Utxo[] => {
      const rows: any[] = Array.isArray(data?.result) ? data.result : (Array.isArray(data) ? data : [])
      return rows
        .filter((u: any) => u.isSpentInMempoolTx !== true)
        .map((u: any) => ({ txId: u.tx_hash as string, outputIndex: u.tx_pos as number, satoshis: u.value as number, script: '', height: u.height as number }))
    }
    const all = await fetchWithRetry(`${WOC_BASE}/script/${scriptHash}/unspent/all`)
    if (all.ok) return mapRows(await all.json())
    const resp = await fetchWithRetry(`${WOC_BASE}/script/${scriptHash}/unspent`)
    if (!resp.ok) throw new Error(`WoC script-unspent fetch failed: ${resp.status}`)
    return mapRows(await resp.json())
  }

  /**
   * Mempool-aware txids touching an address, via `/unspent/all` (confirmed + unconfirmed outputs).
   * A just-broadcast tx's change output appears here before it confirms, so this surfaces a freshly
   * published seller-note (its change pays the seller's address) that `/history` hasn't indexed yet.
   */
  async getRecentTxIdsForAddress(address: string): Promise<string[]> {
    const out = new Set<string>()
    try {
      const r = await fetchWithRetry(`${WOC_BASE}/address/${address}/unspent/all`)
      if (r.ok) {
        const data = await r.json()
        const rows: any[] = Array.isArray(data?.result) ? data.result : (Array.isArray(data) ? data : [])
        for (const u of rows) if (u.tx_hash) out.add(u.tx_hash as string)
      }
    } catch { /* best-effort */ }
    return [...out]
  }

  // ── Merkle Proofs (feeds into proof chain construction) ───────

  async getMerkleProof(txId: string): Promise<MerkleProofEntry | null> {
    // Prefer BananaBlocks (independent + non-pruning → a more complete proof index than WoC); fall back to WoC.
    // The two return DIFFERENT tsc `target`s — BananaBlocks = merkle root, WoC = block hash — so each has its own
    // adapter below. Both anchor merkleRoot to the block HEADER (not the proof's self-reported target).
    return (await this.merkleProofBanana(txId)) ?? (await this.merkleProofWoC(txId))
  }

  /** TSC `nodes` + tx `index` → L/R sibling path ('*' = duplicate-up, no sibling). Shared by both sources. */
  private tscPath(nodes: string[], index: number): MerklePathNode[] {
    const path: MerklePathNode[] = []
    let idx = index
    for (const node of nodes) {
      if (node === '*') { idx = idx >> 1; continue }
      path.push({ hash: node, position: (idx % 2 === 0) ? 'R' : 'L' })
      idx = idx >> 1
    }
    return path
  }

  /** BananaBlocks: tsc `target` is the MERKLE ROOT. Take the block hash from the native tx record, read the
   *  header (trusted source of merkleroot + height), and require the header's root to equal the proof's target
   *  — so the path is anchored to a header, not to the relay's self-reported root. */
  private async merkleProofBanana(txId: string): Promise<MerkleProofEntry | null> {
    try {
      const pResp = await fetchWithRetry(`${BANANA_WOC_BASE}/tx/${txId}/proof/tsc`)
      if (!pResp.ok) return null
      const raw = await pResp.json()
      const data = Array.isArray(raw) ? raw[0] : raw
      if (!data?.target) return null
      const path = this.tscPath(data.nodes ?? [], data.index ?? 0)

      const txResp = await fetchWithRetry(`${BANANA_BASE}/tx/${txId}`)
      if (!txResp.ok) return null
      const blockHash = (await txResp.json())?.block_hash as string | undefined
      if (!blockHash) return null

      const hResp = await fetchWithRetry(`${BANANA_WOC_BASE}/block/${blockHash}/header`)
      if (!hResp.ok) return null
      const header = await hResp.json()
      if (header?.merkleroot !== data.target) { // integrity gate: path root must match the header's root
        console.debug(`getMerkleProof(banana): merkleroot mismatch for ${txId.slice(0, 12)}…`)
        return null
      }
      return { txId, blockHeight: header.height, merkleRoot: header.merkleroot, path }
    } catch { return null }
  }

  /** WoC: tsc `target` IS the block hash → its header gives merkleroot + height directly. */
  private async merkleProofWoC(txId: string): Promise<MerkleProofEntry | null> {
    const resp = await fetchWithRetry(`${WOC_BASE}/tx/${txId}/proof/tsc`)
    if (!resp.ok) { console.debug(`getMerkleProof(woc): ${resp.status} for ${txId.slice(0, 12)}…`); return null }
    const raw = await resp.json()
    const data = Array.isArray(raw) ? raw[0] : raw
    if (!data?.target) return null
    const path = this.tscPath(data.nodes ?? [], data.index ?? 0)
    const headerResp = await fetchWithRetry(`${WOC_BASE}/block/${data.target}/header`)
    if (!headerResp.ok) return null
    const header = await headerResp.json()
    return { txId, blockHeight: header.height, merkleRoot: header.merkleroot, path }
  }
}

