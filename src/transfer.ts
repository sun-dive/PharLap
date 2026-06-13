// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP transfers + ownership detection.
 *
 * A transfer spends a token PushDrop (Input 0, via pushDrop.unlock) and recreates an
 * equivalent token PushDrop locked to the recipient — constant-size, no proof cargo
 * (lineage is implicit: the parent is Input 0; see PLAN.md Addendum C/D).
 *
 *   Input 0   : token UTXO            (pushDrop.unlock — owner's signature)
 *   Input 1+  : funding UTXOs         (P2PKH)
 *   Output 0  : recipient token       (PushDrop, same tx1Ref, locked to recipient pubkey)
 *   Output 1  : notification (opt.)   (P2PKH, 1 sat, to recipient's address — discovery breadcrumb)
 *   Output 2+ : change                (P2PKH)
 *
 * The notification output makes the transfer discoverable by the recipient's address scan
 * (PushDrop outputs themselves are not WoC-address-indexed; 1 sat is the minimum standard,
 * address-indexed value — see PLAN.md Addendum D). It is default-on but optional.
 *
 * `buildTransferTx` is pure/offline (explicit funding) for unit testing; `createTransfer`
 * is the network wrapper.
 */
import { Transaction, P2PKH, SatoshisPerKilobyte, PublicKey } from '@bsv/sdk'
import type { PrivateKey, LockingScript } from '@bsv/sdk'
import { unlock as pushDropUnlock } from './pushDrop.ts'
import { buildTokenScript, parseTokenScript } from './tokenCodec.ts'
import type { TokenFields } from './tokenCodec.ts'
import type { WalletProvider } from './walletProvider.ts'
import {
  PHARLAP_OUTPUT_SATS,
  DEFAULT_FEE_PER_KB,
  getSafeUtxos,
  selectFunding,
} from './collectionBuilder.ts'
import type { FundingInput } from './collectionBuilder.ts'

export interface TransferTxResult {
  tx: Transaction
  txId: string
  recipientVout: number
  notifyVout: number | null
  /** Index of the optional 1-sat publisher-notification output (collection-tracking), or null. */
  publisherNotifyVout: number | null
  changeVout: number | null
  changeSats: number
  tokenFields: TokenFields
}

export async function buildTransferTx(opts: {
  key: PrivateKey
  tokenOutputIndex: number
  tokenSourceTx: Transaction
  recipientPubKeyHex: string
  funding: FundingInput[]
  /** Optional updated mutable state; defaults to carrying the existing stateData forward. */
  newStateData?: string
  /** Add a 1-sat P2PKH notification output to the recipient's address. Default true. */
  notify?: boolean
  /**
   * Add a 1-sat P2PKH notification to the publisher's address so the publisher can track the
   * current holder (RESTRICTION_TRACK_TRANSFERS / Addendum E). Requires publisherPubKeyHex.
   * Off by default — private unless the collection opts into tracking.
   */
  notifyPublisher?: boolean
  /** Publisher's public key (the TX1 template lock key); required when notifyPublisher is set. */
  publisherPubKeyHex?: string
  outputSats?: number
  feePerKb?: number
}): Promise<TransferTxResult> {
  const sats = opts.outputSats ?? PHARLAP_OUTPUT_SATS
  const notify = opts.notify ?? true
  const address = opts.key.toAddress()

  const tokenOut = opts.tokenSourceTx.outputs[opts.tokenOutputIndex]
  const parsed = tokenOut ? parseTokenScript(tokenOut.lockingScript as LockingScript) : null
  if (!parsed) throw new Error('buildTransferTx: source output is not a PHAR LAP token')
  const tokenFields: TokenFields = {
    tx1Ref: parsed.fields.tx1Ref,
    stateData: opts.newStateData ?? parsed.fields.stateData,
  }

  const tx = new Transaction()
  // Input 0: the token UTXO, spent via the PushDrop owner key.
  tx.addInput({
    sourceTransaction: opts.tokenSourceTx,
    sourceOutputIndex: opts.tokenOutputIndex,
    unlockingScriptTemplate: pushDropUnlock(opts.key),
  })
  // Funding inputs.
  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx,
      sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.key),
    })
  }

  // Output 0: recipient token (PushDrop locked to recipient pubkey).
  tx.addOutput({ lockingScript: buildTokenScript(opts.recipientPubKeyHex, tokenFields), satoshis: sats })
  const recipientVout = 0

  // Output 1 (optional): 1-sat P2PKH notification to the recipient's address (discovery breadcrumb).
  let notifyVout: number | null = null
  if (notify) {
    const recipientAddress = PublicKey.fromString(opts.recipientPubKeyHex).toAddress()
    notifyVout = tx.outputs.length
    tx.addOutput({ lockingScript: new P2PKH().lock(recipientAddress), satoshis: 1 })
  }

  // Optional: 1-sat P2PKH notification to the publisher (collection transfer-tracking).
  let publisherNotifyVout: number | null = null
  if (opts.notifyPublisher) {
    if (opts.publisherPubKeyHex == null) {
      throw new Error('buildTransferTx: notifyPublisher requires publisherPubKeyHex')
    }
    const publisherAddress = PublicKey.fromString(opts.publisherPubKeyHex).toAddress()
    publisherNotifyVout = tx.outputs.length
    tx.addOutput({ lockingScript: new P2PKH().lock(publisherAddress), satoshis: 1 })
  }

  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(address), change: true })

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return {
    tx,
    txId: tx.id('hex'),
    recipientVout,
    notifyVout,
    publisherNotifyVout,
    changeVout: changeSats > 0 ? changeVout : null,
    changeSats,
    tokenFields,
  }
}

export async function createTransfer(
  provider: WalletProvider,
  key: PrivateKey,
  opts: {
    tokenTxId: string
    tokenOutputIndex: number
    recipientPubKeyHex: string
    newStateData?: string
    notify?: boolean
    notifyPublisher?: boolean
    publisherPubKeyHex?: string
    outputSats?: number
    feePerKb?: number
  },
): Promise<TransferTxResult> {
  const tokenSourceTx = await provider.getSourceTransaction(opts.tokenTxId)
  // Small fee headroom: a transfer is ~500 bytes; the 1-sat token input also contributes.
  const feeHeadroom = Math.ceil((500 * (opts.feePerKb ?? DEFAULT_FEE_PER_KB)) / 1000) + 200
  const selected = selectFunding(await getSafeUtxos(provider), feeHeadroom)
  const funding: FundingInput[] = await Promise.all(
    selected.map(async u => ({ utxo: u, sourceTx: await provider.getSourceTransaction(u.txId) })),
  )

  const result = await buildTransferTx({
    key,
    tokenOutputIndex: opts.tokenOutputIndex,
    tokenSourceTx,
    recipientPubKeyHex: opts.recipientPubKeyHex,
    funding,
    newStateData: opts.newStateData,
    notify: opts.notify,
    notifyPublisher: opts.notifyPublisher,
    publisherPubKeyHex: opts.publisherPubKeyHex,
    outputSats: opts.outputSats,
    feePerKb: opts.feePerKb,
  })

  await provider.broadcast(result.tx.toHex())
  provider.registerPendingTx(
    result.txId,
    [
      { txId: opts.tokenTxId, outputIndex: opts.tokenOutputIndex },
      ...selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    ],
    result.changeVout != null ? { outputIndex: result.changeVout, satoshis: result.changeSats } : undefined,
  )
  return result
}

// ─── Ownership detection ────────────────────────────────────────────

/**
 * Find the token outputs of a transaction that are locked to `ownerPubKeyHex`. The token stores
 * the owner's full public key in its PushDrop lock, so this is an exact match. Used both to read
 * one's own tokens and to extract the token(s) from a notifying tx during an incoming scan.
 */
export function findOwnedTokenOutputs(
  tx: Transaction,
  ownerPubKeyHex: string,
): Array<{ outputIndex: number; fields: TokenFields }> {
  const found: Array<{ outputIndex: number; fields: TokenFields }> = []
  tx.outputs.forEach((o, i) => {
    const parsed = parseTokenScript(o.lockingScript as LockingScript)
    if (parsed != null && parsed.ownerPubKeyHex === ownerPubKeyHex) {
      found.push({ outputIndex: i, fields: parsed.fields })
    }
  })
  return found
}

export interface IncomingToken {
  txId: string
  outputIndex: number
  fields: TokenFields
}

/**
 * Scan the wallet's address history for incoming tokens. The notification outputs make the
 * carrying transactions show up under the owner's address; we then parse each tx for token
 * outputs locked to our pubkey. Verification (lightweight lineage) is the caller's
 * responsibility (see verify.ts) before trusting/recording a result.
 */
export async function scanIncoming(
  provider: WalletProvider,
  myPubKeyHex: string,
): Promise<IncomingToken[]> {
  // Candidate txs: confirmed address history PLUS the txids of current UTXOs at our address.
  // The latter is mempool-aware (getUtxos includes unconfirmed), so the 1-sat notification
  // output of an incoming transfer surfaces the carrying tx immediately, before it confirms.
  const candidateTxIds = new Set<string>()
  try {
    for (const { txId } of await provider.getAddressHistory()) candidateTxIds.add(txId)
  } catch { /* history is best-effort */ }
  try {
    for (const u of await provider.getUtxos()) candidateTxIds.add(u.txId)
  } catch { /* utxos best-effort */ }

  const found: IncomingToken[] = []
  for (const txId of candidateTxIds) {
    let tx: Transaction
    try {
      tx = await provider.getSourceTransaction(txId)
    } catch {
      continue
    }
    for (const { outputIndex, fields } of findOwnedTokenOutputs(tx, myPubKeyHex)) {
      found.push({ txId, outputIndex, fields })
    }
  }
  return found
}
