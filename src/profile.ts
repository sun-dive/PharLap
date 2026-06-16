// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP self-published profile (display alias + small avatar).
 *
 * A key publishes ONE `RECORD_PROFILE` PushDrop output locked to its own pubkey, on its own address — the
 * same publish-to-self / resolve-by-scan pattern as broadcasts and seller notes. Anyone can resolve a key's
 * profile by deriving its address and scanning for the newest RECORD_PROFILE (latest-by-height wins), so a
 * reader sees a key's @name + face even without a prior message. Self-gated: only that key funds txs on its
 * address, so an impostor can't plant a profile there.
 *
 * The avatar is a SMALL pre-downscaled image (see thumbs.downscaleToAvatar) — published once, never per
 * message, so it doesn't bloat ordinary messaging.
 */
import { Transaction, P2PKH, SatoshisPerKilobyte, PublicKey } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import { buildProfileScript, parseProfileScript, type ProfileFields } from './tokenCodec.ts'
import { PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding } from './collectionBuilder.ts'
import type { WalletProvider } from './walletProvider.ts'

/** Bound how far back we scan a key's history for its latest profile. */
const MAX_PROFILE_SCAN = 30

/** Publish (or update) your profile: a RECORD_PROFILE output locked to your pubkey, on your address. */
export async function publishProfile(
  provider: WalletProvider, key: PrivateKey,
  profile: { alias?: string; avatar?: { mimeType: string; bytes: number[] } },
): Promise<string> {
  const pubHex = key.toPublicKey().toString()
  const fields: ProfileFields = {
    alias: profile.alias, avatarMimeType: profile.avatar?.mimeType, avatarBytes: profile.avatar?.bytes,
  }
  const avatarLen = profile.avatar?.bytes.length ?? 0
  const estFee = Math.ceil(((350 + avatarLen) * DEFAULT_FEE_PER_KB) / 1000)
  const selected = selectFunding(await getSafeUtxos(provider), PHARLAP_OUTPUT_SATS + estFee + 600)
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
  tx.addOutput({ lockingScript: buildProfileScript(pubHex, fields), satoshis: PHARLAP_OUTPUT_SATS })
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(DEFAULT_FEE_PER_KB))
  await tx.sign()
  await provider.broadcast(tx.toHex())
  const txId = tx.id('hex')
  provider.registerPendingTx(txId, selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    (tx.outputs[1]?.satoshis ?? 0) > 0 ? { outputIndex: 1, satoshis: tx.outputs[1].satoshis ?? 0 } : undefined)
  return txId
}

/** Resolve a key's latest published profile by scanning its address, or null if it has none. */
export async function resolveProfile(provider: WalletProvider, ownerPubKeyHex: string): Promise<ProfileFields | null> {
  const address = PublicKey.fromString(ownerPubKeyHex).toAddress()
  const heightByTx = new Map<string, number>()
  try { for (const h of await provider.getAddressHistory(address)) heightByTx.set(h.txId, h.blockHeight || 0) } catch { return null }
  try { for (const txId of await provider.getRecentTxIdsForAddress(address)) if (!heightByTx.has(txId)) heightByTx.set(txId, 0) } catch { /* best-effort */ }
  if (heightByTx.size === 0) return null

  const owner = ownerPubKeyHex.toLowerCase()
  const ordered = [...heightByTx.entries()]
    .sort((a, b) => (b[1] || 1e12) - (a[1] || 1e12)) // newest first; unconfirmed → top
    .slice(0, MAX_PROFILE_SCAN)
  for (const [txId] of ordered) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    for (const o of tx.outputs) {
      const p = parseProfileScript(o.lockingScript)
      if (p != null && p.ownerPubKeyHex.toLowerCase() === owner) return p.fields // newest-first → first hit is latest
    }
  }
  return null
}
