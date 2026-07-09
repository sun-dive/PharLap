// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP preview clip — a publisher's PUBLIC "listen before you buy" audio sample for a collection.
 *
 * Mirrors the seller-note publish/resolve pattern (publish-to-self on the publisher's own address, keyed to a
 * collection, resolved by scanning that address newest-first) but carries a binary audio payload (an mp3 clip)
 * in its own RECORD_PREVIEW output instead of the 3 KB text note. Public/plaintext — any prospective buyer, and
 * the nft.sale curator (which holds no key), plays it with no decryption. The publisher makes the clip in their
 * DAW and uploads the finished mp3; PHAR LAP does not trim or transcode.
 *
 *   PUBLISH  — the publisher broadcasts a tx with a PREVIEW output (locked to their own pubkey, keyed to the
 *              collection) + change. It's a large output, so funding is sized to the clip's fee (unlike a note).
 *   RESOLVE  — given the publisher's pubkey + collection, scan their address history newest-first for the most
 *              recent matching PREVIEW. The sales page + curator use this to surface the sample.
 */
import { Transaction, P2PKH, SatoshisPerKilobyte, PublicKey } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import { buildPreviewScript, parsePreviewScript } from './tokenCodec.ts'
import { PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding } from './collectionBuilder.ts'
import type { WalletProvider } from './walletProvider.ts'

/** Cap the preview clip. A 30 s mp3 is ~300–500 KB; 1 MB leaves generous headroom while bounding the tx fee
 *  (~100 k sat at the floor rate for a 1 MB payload). The publisher supplies a finished, already-small clip. */
export const MAX_PREVIEW_BYTES = 1_048_576
/** How far back to scan a publisher's history for their latest preview. */
const MAX_HISTORY_SCAN = 30

export interface PreviewClip {
  /** Audio MIME (e.g. 'audio/mpeg' for mp3). */
  mimeType: string
  bytes: number[]
}

/** Publish (or overwrite) the publisher's preview clip for a collection. Returns the tx id. */
export async function publishPreview(
  provider: WalletProvider, key: PrivateKey, collectionId: string, clip: PreviewClip,
): Promise<string> {
  if (clip.bytes.length === 0) throw new Error('preview clip is empty')
  if (clip.bytes.length > MAX_PREVIEW_BYTES) throw new Error(`preview exceeds ${MAX_PREVIEW_BYTES} bytes`)
  const mimeType = clip.mimeType || 'audio/mpeg'
  const publisherPub = key.toPublicKey().toString()

  // The PREVIEW output makes this a large tx, so its fee scales with the payload — size the funding target to it
  // (tx.fee() computes the exact fee afterwards; selection just needs to pick enough UTXOs). Mirrors createCollection.
  const estBytes = 300 + clip.bytes.length
  const estFee = Math.ceil((estBytes * DEFAULT_FEE_PER_KB) / 1000)
  const target = PHARLAP_OUTPUT_SATS + estFee + Math.max(1000, Math.ceil(estFee * 0.1))
  const selected = selectFunding(await getSafeUtxos(provider), target)
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
    lockingScript: buildPreviewScript(publisherPub, { collectionRef: collectionId, mimeType, previewBytes: clip.bytes }),
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

/** The latest preview clip a publisher has posted for a collection, or null. Verifies the PREVIEW was authored
 *  by `publisherPubKeyHex` (the collection's publisher key) — so a stranger can't inject a fake sample. */
export async function resolvePreview(
  provider: WalletProvider, publisherPubKeyHex: string, collectionId: string,
): Promise<(PreviewClip & { txId: string }) | null> {
  const address = PublicKey.fromString(publisherPubKeyHex).toAddress()

  const heightByTx = new Map<string, number>()
  try {
    for (const h of await provider.getAddressHistory(address)) heightByTx.set(h.txId, h.blockHeight || 0)
  } catch { /* best-effort */ }
  try {
    for (const txId of await provider.getRecentTxIdsForAddress(address)) {
      if (!heightByTx.has(txId)) heightByTx.set(txId, 0) // mempool / unconfirmed
    }
  } catch { /* best-effort */ }
  if (heightByTx.size === 0) return null

  // Newest first: unconfirmed (height 0 → +inf), then descending block height.
  const ordered = [...heightByTx.entries()]
    .sort((a, b) => (b[1] || 1e12) - (a[1] || 1e12))
    .slice(0, MAX_HISTORY_SCAN)
    .map(([txId]) => txId)

  const pub = publisherPubKeyHex.toLowerCase()
  const want = collectionId.toLowerCase()
  for (const txId of ordered) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    for (const o of tx.outputs) {
      const p = parsePreviewScript(o.lockingScript)
      if (p && p.publisherPubKeyHex.toLowerCase() === pub && p.fields.collectionRef.toLowerCase() === want) {
        return { mimeType: p.fields.mimeType, bytes: p.fields.previewBytes, txId }
      }
    }
  }
  return null
}
