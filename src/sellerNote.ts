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
import { buildNoteScript, parseNoteScript, type NoteFields, type BonusKind } from './tokenCodec.ts'
import { PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding } from './collectionBuilder.ts'
import type { WalletProvider } from './walletProvider.ts'

/** Cap the note so it stays cheap and rides comfortably on the notification/propagation output. Raised
 *  280→560 (2026-06-26), then 560→2048 (2026-07-05) to fit a full listing "story" + terms: the extra bytes
 *  per resale are negligible on BSV, and the full text is on-chain + search-engine-indexable even when the
 *  UI truncates the visible portion. */
export const MAX_NOTE_BYTES = 2048
/** Bound how far back we scan a seller's history looking for their latest note. */
const MAX_HISTORY_SCAN = 30

function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length
}

/** A resolved seller note: a listing heading + description (text) + tags + optional buyer bonus. */
export interface SellerNote {
  text: string
  /** Seller-authored listing heading (updatable; distinct from the immutable collection title). */
  heading?: string
  /** Category tags (slug-like, no leading '#'). */
  tags?: string[]
  bonusKind?: BonusKind
  bonusValue?: string
}

/** Bound the heading / joined tags so the note stays small enough to ride on a notification output. */
const MAX_HEADING_BYTES = 120
const MAX_TAGS_BYTES = 160

/** True if a note carries anything worth recording/propagating (description, heading, tags, or a bonus). */
export function noteHasContent(n: SellerNote): boolean {
  return (n.text?.trim().length ?? 0) > 0 || (n.bonusValue?.trim().length ?? 0) > 0 ||
    (n.heading?.trim().length ?? 0) > 0 || (n.tags != null && n.tags.length > 0)
}

/** Publish (or overwrite) the seller's note for a collection, with an optional bonus. Returns the note tx id. */
export async function publishSellerNote(
  provider: WalletProvider, key: PrivateKey, collectionId: string, note: SellerNote,
): Promise<string> {
  const trimmed = note.text.trim()
  const heading = note.heading?.trim()
  const tags = note.tags?.map(t => t.replace(/^#+/, '').trim()).filter(Boolean)
  const bonusValue = note.bonusValue?.trim()
  if (trimmed.length === 0 && !bonusValue && !heading && !(tags && tags.length > 0)) throw new Error('note is empty')
  if (utf8Len(trimmed) > MAX_NOTE_BYTES) throw new Error(`note exceeds ${MAX_NOTE_BYTES} bytes`)
  if (heading != null && utf8Len(heading) > MAX_HEADING_BYTES) throw new Error(`heading exceeds ${MAX_HEADING_BYTES} bytes`)
  if (tags != null && utf8Len(tags.join(' ')) > MAX_TAGS_BYTES) throw new Error(`tags exceed ${MAX_TAGS_BYTES} bytes`)
  if (bonusValue && utf8Len(bonusValue) > MAX_NOTE_BYTES) throw new Error(`bonus exceeds ${MAX_NOTE_BYTES} bytes`)
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
  tx.addOutput({
    lockingScript: buildNoteScript(authorPub, {
      collectionRef: collectionId, text: trimmed,
      ...(heading ? { heading } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
      ...(bonusValue ? { bonusKind: note.bonusKind, bonusValue } : {}),
    }),
    satoshis: PHARLAP_OUTPUT_SATS,
  })
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(DEFAULT_FEE_PER_KB))
  await tx.sign()
  await provider.broadcast(tx.toHex())
  const txId = tx.id('hex')
  provider.registerPendingTx(txId, selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    (tx.outputs[1]?.satoshis ?? 0) > 0 ? { outputIndex: 1, satoshis: tx.outputs[1].satoshis ?? 0 } : undefined)
  return txId
}

/**
 * Read a note that rode IN on a transaction (the on-chain echo carried by a sale/transfer), for a given
 * collection — used for hands-off propagation: when a holder resells, the note attached to the tx that
 * gave them their edition is re-attached to the new sale unless they've published their own.
 */
export function readNoteFromTx(tx: Transaction, collectionId: string): SellerNote | null {
  const want = collectionId.toLowerCase()
  for (const o of tx.outputs) {
    const n = parseNoteScript(o.lockingScript)
    if (n && n.fields.collectionRef.toLowerCase() === want) {
      return { text: n.fields.text, heading: n.fields.heading, tags: n.fields.tags, bonusKind: n.fields.bonusKind, bonusValue: n.fields.bonusValue }
    }
  }
  return null
}

/** The latest note a seller has published for a collection, or null. */
export async function resolveSellerNote(
  provider: WalletProvider, sellerPubKeyHex: string, collectionId: string,
): Promise<(SellerNote & { txId: string }) | null> {
  const sellerAddress = PublicKey.fromString(sellerPubKeyHex).toAddress()

  // Candidates: confirmed history (with heights) UNIONed with mempool-aware txids (the just-published
  // note's change output surfaces here before `/history` indexes it). Unconfirmed → height 0 → ranked newest.
  const heightByTx = new Map<string, number>()
  try {
    for (const h of await provider.getAddressHistory(sellerAddress)) heightByTx.set(h.txId, h.blockHeight || 0)
  } catch { /* best-effort */ }
  try {
    for (const txId of await provider.getRecentTxIdsForAddress(sellerAddress)) {
      if (!heightByTx.has(txId)) heightByTx.set(txId, 0) // mempool / unconfirmed
    }
  } catch { /* best-effort */ }
  if (heightByTx.size === 0) return null

  // Newest first: unconfirmed (height 0 → +inf), then descending block height.
  const ordered = [...heightByTx.entries()]
    .sort((a, b) => (b[1] || 1e12) - (a[1] || 1e12))
    .slice(0, MAX_HISTORY_SCAN)
    .map(([txId]) => txId)

  const seller = sellerPubKeyHex.toLowerCase()
  const want = collectionId.toLowerCase()
  for (const txId of ordered) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    for (const o of tx.outputs) {
      const n = parseNoteScript(o.lockingScript)
      if (n && n.authorPubKeyHex.toLowerCase() === seller && n.fields.collectionRef.toLowerCase() === want) {
        return { text: n.fields.text, heading: n.fields.heading, tags: n.fields.tags, bonusKind: n.fields.bonusKind, bonusValue: n.fields.bonusValue, txId }
      }
    }
  }
  return null
}
