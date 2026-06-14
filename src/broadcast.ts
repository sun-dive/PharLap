// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP publisher broadcast ("Updates") — the pull/announcement channel (PLAN.md Addendum E).
 *
 * A publisher posts ONE public message anchored to a collection, locked to their OWN pubkey (the TX1
 * template lock key). Holders PULL it: they scan the publisher's address for `RECORD_MESSAGE` records
 * referencing a collection they hold, and read them. One flat-cost tx reaches every current holder, the
 * publisher needs no holder list, and free transfers don't break delivery (holders pull by collection).
 *
 * Public-only by design: a single broadcast can't be ECIES-encrypted to all holders at once. Private
 * 1:1 messages remain the (encrypted) job of messageCodec + the Messages tab.
 *
 * Mirrors sellerNote.ts (publish a collection-keyed record to your address; others resolve by scanning
 * it) — but uses RECORD_MESSAGE from the publisher and returns the full history, newest-first.
 */
import { Transaction, P2PKH, SatoshisPerKilobyte, PublicKey } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import { buildMessageScript, parseMessageScript } from './tokenCodec.ts'
import { buildEnvelope, openPublicEnvelope } from './messageCodec.ts'
import { PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding } from './collectionBuilder.ts'
import type { WalletProvider } from './walletProvider.ts'

/** Cap an announcement so it stays cheap and comfortably on one output. */
export const MAX_BROADCAST_BYTES = 480
/** Bound how far back we scan a publisher's history for their announcements. */
const MAX_BROADCAST_SCAN = 50

/** A resolved publisher announcement. */
export interface Broadcast {
  text: string
  txId: string
  /** Block height of the announcement tx (0 = unconfirmed/newest) — orders the feed. */
  height: number
}

/**
 * Publish a PUBLIC announcement to all holders of a collection: a single `RECORD_MESSAGE` keyed to the
 * collection, locked to the publisher's own pubkey. Returns the tx id. Only the real publisher's address
 * is ever scanned by holders, so this self-gates (an impostor's "broadcast" is never pulled).
 */
export async function publishBroadcast(
  provider: WalletProvider, key: PrivateKey, collectionId: string, text: string,
): Promise<string> {
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error('announcement is empty')
  if (new TextEncoder().encode(trimmed).length > MAX_BROADCAST_BYTES) {
    throw new Error(`announcement exceeds ${MAX_BROADCAST_BYTES} bytes`)
  }
  const pubHex = key.toPublicKey().toString()
  // Public envelope (encrypt:false → recipientPubKeyHex is unused; anyone can read it).
  const envelope = buildEnvelope({
    senderPriv: key, recipientPubKeyHex: pubHex, parts: [{ kind: 'text', text: trimmed }], encrypt: false,
  })

  const selected = selectFunding(await getSafeUtxos(provider), PHARLAP_OUTPUT_SATS + 600)
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
  // Locked to the publisher's own pubkey + keyed to the collection → discoverable on the publisher's address.
  tx.addOutput({
    lockingScript: buildMessageScript(pubHex, { ref: collectionId, envelope }),
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
 * Pull every public announcement a publisher has posted for a collection, newest-first. A broadcast is a
 * RECORD_MESSAGE that is locked to the publisher AND sent by the publisher (self-locked) AND keyed to the
 * collection — which cleanly distinguishes it from DMs the publisher may have received.
 */
export async function resolveBroadcasts(
  provider: WalletProvider, publisherPubKeyHex: string, collectionId: string,
): Promise<Broadcast[]> {
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
  if (heightByTx.size === 0) return []

  // Newest first (unconfirmed → top), capped so a busy publisher address stays cheap to scan.
  const ordered = [...heightByTx.entries()]
    .sort((a, b) => (b[1] || 1e12) - (a[1] || 1e12))
    .slice(0, MAX_BROADCAST_SCAN)

  const publisher = publisherPubKeyHex.toLowerCase()
  const want = collectionId.toLowerCase()
  const out: Broadcast[] = []
  for (const [txId, height] of ordered) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    for (const o of tx.outputs) {
      const m = parseMessageScript(o.lockingScript)
      if (m == null) continue
      if (m.recipientPubKeyHex.toLowerCase() !== publisher) continue   // locked to the publisher
      if (m.fields.ref.toLowerCase() !== want) continue                // for this collection
      const opened = openPublicEnvelope(m.fields.envelope)
      if (opened == null || opened.senderPubKeyHex.toLowerCase() !== publisher) continue // sent by the publisher
      const textPart = opened.parts.find(p => p.kind === 'text')
      if (textPart && textPart.kind === 'text') out.push({ text: textPart.text, txId, height })
    }
  }
  return out
}
