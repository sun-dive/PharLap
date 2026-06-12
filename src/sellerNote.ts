// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP seller-note — a seller's MUTABLE promo note for a collection (review, bonuses, redemption
 * instructions). PLAN.md Step 2 (D3): the note lives OUTSIDE the frozen edition covenant, so a reseller
 * can overwrite it freely; the latest one a seller publishes wins.
 *
 *   PUBLISH  — the seller broadcasts a tiny tx with a NOTE output (locked to their own pubkey, keyed to
 *              the collection) + change. Because the funding/change touch the seller's address, the note
 *              is discoverable via that address's history (no indexer).
 *   RESOLVE  — given a seller's pubkey + collection, scan their address history newest-first and return
 *              the most recent matching NOTE. This runs in the same place the sales page resolves the
 *              seller's edition tip, so the storefront can show the current note to buyers.
 *
 * Delivery to the buyer at purchase (riding on the replicate notification output) is handled by the
 * edition builder; this module owns the standalone publish + resolve.
 */
import { Transaction, P2PKH, SatoshisPerKilobyte, PublicKey } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import { buildNoteScript, parseNoteScript } from './tokenCodec.ts'
import { PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding } from './collectionBuilder.ts'
import type { WalletProvider } from './walletProvider.ts'

/** Cap the note so it stays cheap and on the notification output comfortably. */
export const MAX_NOTE_BYTES = 280
/** Bound how far back we scan a seller's history looking for their latest note. */
const MAX_HISTORY_SCAN = 30

function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length
}

/** Publish (or overwrite) the seller's note for a collection. Returns the note tx id. */
export async function publishSellerNote(
  provider: WalletProvider, key: PrivateKey, collectionId: string, text: string,
): Promise<string> {
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error('note is empty')
  if (utf8Len(trimmed) > MAX_NOTE_BYTES) throw new Error(`note exceeds ${MAX_NOTE_BYTES} bytes`)
  const authorPub = key.toPublicKey().toString()

  const selected = selectFunding(await getSafeUtxos(provider), PHARLAP_OUTPUT_SATS + 500)
  const funding = await Promise.all(
    selected.map(async u => ({ utxo: u, sourceTx: await provider.getSourceTransaction(u.txId) })),
  )
  const tx = new Transaction()
  for (const f of funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(key),
    })
  }
  tx.addOutput({ lockingScript: buildNoteScript(authorPub, { collectionRef: collectionId, text: trimmed }), satoshis: PHARLAP_OUTPUT_SATS })
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(DEFAULT_FEE_PER_KB))
  await tx.sign()
  await provider.broadcast(tx.toHex())
  const txId = tx.id('hex')
  provider.registerPendingTx(txId, selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    (tx.outputs[1]?.satoshis ?? 0) > 0 ? { outputIndex: 1, satoshis: tx.outputs[1].satoshis ?? 0 } : undefined)
  return txId
}

/** The latest note a seller has published for a collection, or null. */
export async function resolveSellerNote(
  provider: WalletProvider, sellerPubKeyHex: string, collectionId: string,
): Promise<{ text: string; txId: string } | null> {
  const sellerAddress = PublicKey.fromString(sellerPubKeyHex).toAddress()
  let history: { txId: string; blockHeight: number }[]
  try { history = await provider.getAddressHistory(sellerAddress) } catch { return null }
  // Newest first: unconfirmed (height 0 → treated as newest), then descending block height.
  const ordered = [...history].sort((a, b) => (b.blockHeight || 1e12) - (a.blockHeight || 1e12)).slice(0, MAX_HISTORY_SCAN)
  const seller = sellerPubKeyHex.toLowerCase()
  const want = collectionId.toLowerCase()
  for (const { txId } of ordered) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    for (const o of tx.outputs) {
      const n = parseNoteScript(o.lockingScript)
      if (n && n.authorPubKeyHex.toLowerCase() === seller && n.fields.collectionRef.toLowerCase() === want) {
        return { text: n.fields.text, txId }
      }
    }
  }
  return null
}
