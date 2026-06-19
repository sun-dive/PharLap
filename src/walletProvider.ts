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

  async broadcast(rawHex: string): Promise<string> {
    const resp = await queuedFetch(`${WOC_BASE}/tx/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: rawHex }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Broadcast failed (${resp.status}): ${text}`)
    }
    const txId = (await resp.text()).replace(/"/g, '')
    // Cache the raw hex of what we just broadcast so a spend of one of its outputs (transfer / replicate /
    // burn of a freshly-created edition) can be built immediately, without waiting for WoC to index the tx.
    this.txCache.set(txId, rawHex)
    return txId
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

  // ── Block Headers (feeds into SPV verification) ───────────────

  /** WoC-reported confirmation of a tx: its block height + block time (unix seconds), or null if unconfirmed
   *  (mempool) or not found. For provenance display only — not an SPV proof (use getMerkleProof for that). */
  async getTxConfirmation(txId: string): Promise<{ blockHeight: number; time: number } | null> {
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
    const resp = await fetchWithRetry(`${WOC_BASE}/tx/${txId}/proof/tsc`)
    if (!resp.ok) {
      console.debug(`getMerkleProof: WoC returned ${resp.status} for ${txId.slice(0, 12)}...`)
      return null
    }

    const raw = await resp.json()
    console.debug('getMerkleProof: raw response:', JSON.stringify(raw).slice(0, 200))
    const data = Array.isArray(raw) ? raw[0] : raw
    if (!data || !data.target) {
      console.debug('getMerkleProof: no target in proof data:', data)
      return null
    }

    const nodes: string[] = data.nodes ?? []
    const index: number = data.index ?? 0
    const path: MerklePathNode[] = []

    let idx = index
    for (const node of nodes) {
      if (node === '*') {
        idx = idx >> 1
        continue
      }
      const position: 'L' | 'R' = (idx % 2 === 0) ? 'R' : 'L'
      path.push({ hash: node, position })
      idx = idx >> 1
    }

    const blockHash = data.target
    const headerResp = await fetchWithRetry(`${WOC_BASE}/block/${blockHash}/header`)
    if (!headerResp.ok) return null
    const header = await headerResp.json()

    return {
      txId,
      blockHeight: header.height,
      merkleRoot: header.merkleroot,
      path,
    }
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * © BSV Association
 *
 * Open BSV License Version 5 – granted by BSV Association, Grafenauweg 6, 6300
 * Zug, Switzerland (CHE-427.008.338) ("Licensor"), to you as a user (henceforth
 * "You", "User" or "Licensee").
 *
 * For the purposes of this license, the definitions below have the following
 * meanings:
 *
 * "Bitcoin Protocol" means the protocol implementation, cryptographic rules,
 * network protocols, and consensus mechanisms in the Bitcoin White Paper as
 * described here https://protocol.bsvblockchain.org.
 *
 * "Bitcoin White Paper" means the paper entitled 'Bitcoin: A Peer-to-Peer
 * Electronic Cash System' published by 'Satoshi Nakamoto' in October 2008.
 *
 * "BSV Blockchains" means:
 *   (a) the Bitcoin blockchain containing block height #556767 with the hash
 *       "000000000000000001d956714215d96ffc00e0afda4cd0a96c96f8d802b1662b" and
 *       that contains the longest honest persistent chain of blocks which has been
 *       produced in a manner which is consistent with the rules set forth in the
 *       Network Access Rules; and
 *   (b) the test blockchains that contain the longest honest persistent chains of
 *       blocks which has been produced in a manner which is consistent with the
 *       rules set forth in the Network Access Rules.
 *
 * "Network Access Rules" or "Rules" means the set of rules regulating the
 * relationship between BSV Association and the nodes on BSV based on the Bitcoin
 * Protocol rules and those set out in the Bitcoin White Paper, and available here
 * https://bsvblockchain.org/network-access-rules.
 *
 * "Software" means the software the subject of this licence, including any/all
 * intellectual property rights therein and associated documentation files.
 *
 * BSV Association grants permission, free of charge and on a non-exclusive and
 * revocable basis, to any person obtaining a copy of the Software to deal in the
 * Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
 * Software, and to permit persons to whom the Software is furnished to do so,
 * subject to and conditioned upon the following conditions:
 *
 * 1 - The text "© BSV Association," and this license shall be included in all
 * copies or substantial portions of the Software.
 * 2 - The Software, and any software that is derived from the Software or parts
 * thereof, must only be used on the BSV Blockchains.
 *
 * For the avoidance of doubt, this license is granted subject to and conditioned
 * upon your compliance with these terms only. In the event of non-compliance, the
 * license shall extinguish and you can be enjoined from violating BSV's
 * intellectual property rights (incl. damages and similar related claims).
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES REGARDING ENTITLEMENT,
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS THEREOF BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 * ─────────────────────────────────────────────────────────────────────────────
 */
