// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP encrypted config backup.
 *
 * Most of the wallet's local state is already recoverable from the WIF + chain (holdings rebuild via
 * Check-incoming; your own alias/avatar live in your published profile). The one thing that ISN'T is your
 * **address book** — your private labels for other people's keys. This backs that up (plus your alias and UI
 * prefs) so it survives a device change.
 *
 * A backup is a `RECORD_CONFIG` PushDrop posted to your OWN address, carrying an **ECIES-to-self** message
 * envelope (only your key decrypts it) of the config JSON — same publish-to-self / resolve-by-scan pattern as
 * profiles, but private. Each contact carries an `updatedAt`, so restore can merge newest-wins per contact.
 *
 * Honest limit: no tombstones — a contact deleted on one device can reappear when another device restores an
 * older backup that still listed it. (Deletions don't propagate via restore.)
 */
import { Transaction, P2PKH, SatoshisPerKilobyte, PublicKey } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import { buildConfigScript, parseConfigScript } from './tokenCodec.ts'
import { buildEnvelope, openEnvelope } from './messageCodec.ts'
import { PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding } from './collectionBuilder.ts'
import type { WalletProvider } from './walletProvider.ts'

/** Bound how far back we scan your address for the latest backup. */
const MAX_CONFIG_SCAN = 30
const CONFIG_SCHEMA = 1

/** The backed-up config blob. `contacts` maps pubKeyHex → label; `contactsAt` maps pubKeyHex → updatedAt (ms). */
export interface ConfigBlob {
  schema: number
  alias?: string
  aliasAt?: number
  contacts: Record<string, string>
  contactsAt: Record<string, number>
  prefs?: Record<string, string>
  savedAt: number
}

/** Publish (or update) your encrypted config backup. Returns the tx id. */
export async function publishConfigBackup(
  provider: WalletProvider, key: PrivateKey,
  cfg: { alias?: string; aliasAt?: number; contacts: Record<string, string>; contactsAt: Record<string, number>; prefs?: Record<string, string> },
  savedAt: number,
): Promise<string> {
  const pubHex = key.toPublicKey().toString()
  const blob: ConfigBlob = { schema: CONFIG_SCHEMA, alias: cfg.alias, aliasAt: cfg.aliasAt, contacts: cfg.contacts, contactsAt: cfg.contactsAt, prefs: cfg.prefs, savedAt }
  // ECIES to SELF (encrypt:true, recipient = own pubkey) → only this key decrypts. Compressed inside buildEnvelope.
  const envelope = await buildEnvelope({
    senderPriv: key, recipientPubKeyHex: pubHex, parts: [{ kind: 'text', text: JSON.stringify(blob) }], encrypt: true,
  })
  const estFee = Math.ceil(((350 + envelope.length) * DEFAULT_FEE_PER_KB) / 1000)
  const selected = selectFunding(await getSafeUtxos(provider), PHARLAP_OUTPUT_SATS + estFee + 600)
  const funding = await Promise.all(selected.map(async u => ({ utxo: u, sourceTx: await provider.getSourceTransaction(u.txId) })))
  const tx = new Transaction()
  for (const f of funding) {
    tx.addInput({ sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex, unlockingScriptTemplate: new P2PKH().unlock(key) })
  }
  tx.addOutput({ lockingScript: buildConfigScript(pubHex, { envelope }), satoshis: PHARLAP_OUTPUT_SATS }) // [0] config record (self-locked, encrypted)
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), change: true })                       // [1] change
  await tx.fee(new SatoshisPerKilobyte(DEFAULT_FEE_PER_KB))
  await tx.sign()
  await provider.broadcast(tx.toHex())
  const txId = tx.id('hex')
  provider.registerPendingTx(txId, selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    (tx.outputs[1]?.satoshis ?? 0) > 0 ? { outputIndex: 1, satoshis: tx.outputs[1].satoshis ?? 0 } : undefined)
  return txId
}

/** Resolve your latest config backup from your own address, and decrypt it with your key. Null if none. */
export async function resolveConfigBackup(provider: WalletProvider, key: PrivateKey): Promise<ConfigBlob | null> {
  const pubHex = key.toPublicKey().toString()
  const address = PublicKey.fromString(pubHex).toAddress()
  const heightByTx = new Map<string, number>()
  try { for (const h of await provider.getAddressHistory(address)) heightByTx.set(h.txId, h.blockHeight || 0) } catch { /* best-effort */ }
  try { for (const txId of await provider.getRecentTxIdsForAddress(address)) if (!heightByTx.has(txId)) heightByTx.set(txId, 0) } catch { /* best-effort */ }
  if (heightByTx.size === 0) return null
  const ordered = [...heightByTx.entries()].sort((a, b) => (b[1] || 1e12) - (a[1] || 1e12)).slice(0, MAX_CONFIG_SCAN)
  const mine = pubHex.toLowerCase()
  for (const [txId] of ordered) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    for (const o of tx.outputs) {
      const c = parseConfigScript(o.lockingScript)
      if (c == null || c.ownerPubKeyHex.toLowerCase() !== mine) continue // self-locked = your own backup
      const opened = await openEnvelope(c.fields.envelope, key)
      if (opened == null || opened.senderPubKeyHex.toLowerCase() !== mine) continue // sent by you
      const textPart = opened.parts.find(p => p.kind === 'text')
      if (textPart == null || textPart.kind !== 'text') continue
      try {
        const blob = JSON.parse(textPart.text) as ConfigBlob
        if (blob != null && typeof blob === 'object' && blob.contacts != null) return blob // newest valid one wins
      } catch { /* malformed — keep scanning older ones */ }
    }
  }
  return null
}

/** Merge a restored backup into local state, NEWEST-WINS per contact. Pure; returns the merged result + a
 *  count of entries the backup contributed (added or updated), so the UI can report what changed. */
export function mergeConfig(
  local: { alias?: string; aliasAt?: number; contacts: Record<string, string>; contactsAt: Record<string, number> },
  backup: ConfigBlob,
): { alias?: string; aliasAt?: number; contacts: Record<string, string>; contactsAt: Record<string, number>; changed: number } {
  const contacts = { ...local.contacts }
  const contactsAt = { ...local.contactsAt }
  let changed = 0
  for (const [pk, name] of Object.entries(backup.contacts)) {
    const bAt = backup.contactsAt?.[pk] ?? backup.savedAt ?? 0
    const lAt = contactsAt[pk] ?? (contacts[pk] != null ? 0 : -1)
    if (lAt < 0 || bAt > lAt) { // not present locally, or the backup's label is newer
      if (contacts[pk] !== name || contactsAt[pk] !== bAt) changed++
      contacts[pk] = name
      contactsAt[pk] = bAt
    }
  }
  // Alias: newest-wins too.
  let alias = local.alias, aliasAt = local.aliasAt
  if (backup.alias != null && (backup.aliasAt ?? backup.savedAt ?? 0) > (local.aliasAt ?? -1)) {
    alias = backup.alias; aliasAt = backup.aliasAt ?? backup.savedAt
  }
  return { alias, aliasAt, contacts, contactsAt, changed }
}
