// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP message transactions (Messaging v1).
 *
 * A message is delivered like a token transfer: a RECORD_MESSAGE PushDrop output locked to the
 * recipient's pubkey, plus a 1-sat P2PKH notification to the recipient's address (the discovery
 * breadcrumb — the PushDrop output itself is not WoC-address-indexed). The recipient finds it with
 * scanIncomingMessages and opens the envelope with their private key.
 *
 *   in:   sender funding (P2PKH)
 *   out0: message PushDrop → recipient pubkey   (RECORD_MESSAGE record, 1 sat)
 *   out1: notification     → recipient address  (1 sat P2PKH, default-on)
 *   out2: change
 *
 * buildMessageTx is pure/offline (explicit funding) so it can be Spend-validated without the network.
 */
import { Transaction, P2PKH, SatoshisPerKilobyte, PublicKey } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import { buildMessageScript, parseMessageScript } from './tokenCodec.ts'
import { buildEnvelope, openEnvelope, type Part } from './messageCodec.ts'
import {
  PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding, type FundingInput,
} from './collectionBuilder.ts'
import type { WalletProvider, Utxo } from './walletProvider.ts'

const ZERO_REF = '00'.repeat(32)

export interface MessageTxResult {
  tx: Transaction
  txId: string
  messageVout: number
  notifyVout: number | null
  changeVout: number | null
  changeSats: number
}

export async function buildMessageTx(opts: {
  key: PrivateKey
  funding: FundingInput[]
  recipientPubKeyHex: string
  /** 32-byte hex context ref (collection id / thread root), or 64 zeros for a standalone DM. */
  ref?: string
  envelope: number[]
  notify?: boolean
  outputSats?: number
  feePerKb?: number
}): Promise<MessageTxResult> {
  const sats = opts.outputSats ?? PHARLAP_OUTPUT_SATS
  const notify = opts.notify ?? true
  const tx = new Transaction()

  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.key),
    })
  }

  const messageVout = tx.outputs.length
  tx.addOutput({
    lockingScript: buildMessageScript(opts.recipientPubKeyHex, { ref: opts.ref ?? ZERO_REF, envelope: opts.envelope }),
    satoshis: sats,
  })

  let notifyVout: number | null = null
  if (notify) {
    const recipientAddress = PublicKey.fromString(opts.recipientPubKeyHex).toAddress()
    notifyVout = tx.outputs.length
    tx.addOutput({ lockingScript: new P2PKH().lock(recipientAddress), satoshis: 1 })
  }

  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(opts.key.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return { tx, txId: tx.id('hex'), messageVout, notifyVout, changeVout: changeSats > 0 ? changeVout : null, changeSats }
}

async function toFundingInputs(provider: WalletProvider, utxos: Utxo[]): Promise<FundingInput[]> {
  return Promise.all(utxos.map(async u => ({ utxo: u, sourceTx: await provider.getSourceTransaction(u.txId) })))
}

/** Send a message on-chain to a recipient pubkey. Encrypted (authenticated ECIES) by default. */
export async function sendMessage(provider: WalletProvider, key: PrivateKey, params: {
  toPubKeyHex: string
  parts: Part[]
  encrypt?: boolean
  ref?: string
  feePerKb?: number
  /** Sender's self-asserted display alias, carried so the recipient can show @name. */
  senderAlias?: string
  /** Send time (UTC epoch ms); defaults to now. Carried so recipients can show + order by it. */
  sentAt?: number
}): Promise<{ txId: string; messageOutpoint: { txId: string; outputIndex: number } }> {
  const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB
  const envelope = await buildEnvelope({
    senderPriv: key, recipientPubKeyHex: params.toPubKeyHex, parts: params.parts, encrypt: params.encrypt,
    senderAlias: params.senderAlias, sentAt: params.sentAt ?? Date.now(),
  })
  const estFee = Math.ceil(((350 + envelope.length) * feePerKb) / 1000)
  const target = 2 * PHARLAP_OUTPUT_SATS + estFee + 500
  const selected = selectFunding(await getSafeUtxos(provider), target)
  const funding = await toFundingInputs(provider, selected)

  const r = await buildMessageTx({
    key, funding, recipientPubKeyHex: params.toPubKeyHex, ref: params.ref, envelope, feePerKb,
  })
  await provider.broadcast(r.tx.toHex())
  provider.registerPendingTx(r.txId, selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    r.changeVout != null ? { outputIndex: r.changeVout, satoshis: r.changeSats } : undefined)
  return { txId: r.txId, messageOutpoint: { txId: r.txId, outputIndex: r.messageVout } }
}

export interface IncomingMessage {
  txId: string
  outputIndex: number
  ref: string
  senderPubKeyHex: string
  encrypted: boolean
  parts: Part[]
  /** Sender's self-asserted alias (if they attached one). */
  senderAlias?: string
  /** Sender's self-asserted send time, UTC epoch ms (if attached) — display + tiebreak ordering. */
  sentAt?: number
  /** Block height of the message tx (0 = unconfirmed/unknown) — orders the inbox newest-first. */
  height?: number
}

/**
 * Find messages locked to us and open them. Candidate txs = address history ∪ getUtxos (mempool-aware,
 * so an unconfirmed message surfaces immediately via its 1-sat notification UTXO). Outputs whose
 * envelope can't be opened with our key are skipped.
 */
export async function scanIncomingMessages(provider: WalletProvider, recipientPriv: PrivateKey): Promise<IncomingMessage[]> {
  const myPub = recipientPriv.toPublicKey().toString().toLowerCase()
  const candidateTxIds = new Set<string>()
  const heightByTx = new Map<string, number>()
  try { for (const h of await provider.getAddressHistory()) { candidateTxIds.add(h.txId); heightByTx.set(h.txId, h.blockHeight || 0) } } catch { /* best-effort */ }
  try { for (const u of await provider.getUtxos()) candidateTxIds.add(u.txId) } catch { /* best-effort */ }

  const found: IncomingMessage[] = []
  const seen = new Set<string>()
  for (const txId of candidateTxIds) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    for (let i = 0; i < tx.outputs.length; i++) {
      const parsed = parseMessageScript(tx.outputs[i].lockingScript)
      if (parsed == null || parsed.recipientPubKeyHex.toLowerCase() !== myPub) continue
      const key = `${txId}:${i}`
      if (seen.has(key)) continue
      seen.add(key)
      const opened = await openEnvelope(parsed.fields.envelope, recipientPriv)
      if (opened == null) continue // not openable with our key
      found.push({
        txId, outputIndex: i, ref: parsed.fields.ref,
        senderPubKeyHex: opened.senderPubKeyHex, encrypted: opened.encrypted, parts: opened.parts,
        senderAlias: opened.senderAlias, sentAt: opened.sentAt, height: heightByTx.get(txId) ?? 0,
      })
    }
  }
  // Newest first: unconfirmed (height 0/unknown) on top, then highest block height, then sender send-time.
  // Finite sentinel for unconfirmed so ties compare to 0 (stable) rather than Infinity−Infinity = NaN.
  const rank = (m: IncomingMessage): number => (m.height != null && m.height > 0 ? m.height : Number.MAX_SAFE_INTEGER)
  return found.sort((a, b) => (rank(b) - rank(a)) || ((b.sentAt ?? 0) - (a.sentAt ?? 0)))
}
