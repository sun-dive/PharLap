// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
/**
 * PHAR LAP plain BSV payments — an ordinary P2PKH spend to an address.
 *
 * Distinct from token/edition transfers: this moves *sats* (not a covenant UTXO) to any standard
 * BSV address, with change returning to the wallet. Layout:
 *
 *   Input 0+  : funding UTXOs   (P2PKH — owner's signature)
 *   Output 0  : recipient       (P2PKH → toAddress; the amount, or the whole balance if sendMax)
 *   Output 1  : change          (P2PKH → self; omitted when sendMax leaves nothing over)
 *
 * `buildPaymentTx` is pure/offline (explicit funding) so it can be unit-tested AND re-run by the
 * air-gapped signer to reproduce the exact tx the online wallet would have built. `sendPayment` is
 * the network wrapper (gather funding → build → broadcast).
 */
import { Transaction, P2PKH, SatoshisPerKilobyte } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import type { WalletProvider } from './walletProvider.ts'
import { DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding } from './collectionBuilder.ts'
import type { FundingInput } from './collectionBuilder.ts'

export interface PaymentTxResult {
  tx: Transaction
  txId: string
  /** Sats delivered to the recipient (after the fee, when sendMax). */
  sentSats: number
  changeVout: number | null
  changeSats: number
}

/** Throws if `addr` isn't a valid P2PKH address (cheap pre-flight before building). */
export function assertValidAddress(addr: string): void {
  try { new P2PKH().lock(addr) } catch { throw new Error('Invalid BSV address') }
}

export async function buildPaymentTx(opts: {
  key: PrivateKey
  toAddress: string
  /** Amount to send, in sats. Ignored when `sendMax` is set. */
  amountSats: number
  /** Sweep the entire funding (minus fee) to the recipient — no change output. */
  sendMax?: boolean
  funding: FundingInput[]
  feePerKb?: number
}): Promise<PaymentTxResult> {
  assertValidAddress(opts.toAddress)
  if (opts.funding.length === 0) throw new Error('No spendable funds')
  if (!opts.sendMax && (!Number.isFinite(opts.amountSats) || opts.amountSats < 1)) {
    throw new Error('Enter an amount of at least 1 sat')
  }
  const selfAddress = opts.key.toAddress()
  const tx = new Transaction()
  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx,
      sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.key),
    })
  }

  let changeVout: number | null = null
  if (opts.sendMax) {
    // The recipient IS the change sink: tx.fee() drops (total − fee) into it, sweeping the wallet.
    tx.addOutput({ lockingScript: new P2PKH().lock(opts.toAddress), change: true })
  } else {
    tx.addOutput({ lockingScript: new P2PKH().lock(opts.toAddress), satoshis: opts.amountSats })
    changeVout = tx.outputs.length
    tx.addOutput({ lockingScript: new P2PKH().lock(selfAddress), change: true })
  }

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const sentSats = opts.sendMax ? (tx.outputs[0]?.satoshis ?? 0) : opts.amountSats
  if (sentSats < 1) throw new Error('Funds too small to cover the network fee')
  const changeSats = changeVout != null ? (tx.outputs[changeVout]?.satoshis ?? 0) : 0
  return { tx, txId: tx.id('hex'), sentSats, changeVout: changeSats > 0 ? changeVout : null, changeSats }
}

/** Gather funding for a payment: everything (sendMax) or enough to cover amount + fee headroom. */
export async function gatherPaymentFunding(
  provider: WalletProvider,
  opts: { amountSats: number; sendMax?: boolean; feePerKb?: number },
): Promise<FundingInput[]> {
  const safe = await getSafeUtxos(provider)
  // ~200 B base + ~148 B/input; headroom is generous (change absorbs the slack).
  const feeHeadroom = Math.ceil((400 * (opts.feePerKb ?? DEFAULT_FEE_PER_KB)) / 1000) + 200
  const selected = opts.sendMax ? safe : selectFunding(safe, opts.amountSats + feeHeadroom)
  return Promise.all(selected.map(async u => ({ utxo: u, sourceTx: await provider.getSourceTransaction(u.txId) })))
}

export async function sendPayment(
  provider: WalletProvider,
  key: PrivateKey,
  opts: { toAddress: string; amountSats: number; sendMax?: boolean; feePerKb?: number },
): Promise<PaymentTxResult> {
  const funding = await gatherPaymentFunding(provider, opts)
  const result = await buildPaymentTx({ key, funding, ...opts })
  await provider.broadcast(result.tx.toHex())
  provider.registerPendingTx(
    result.txId,
    funding.map(f => ({ txId: f.utxo.txId, outputIndex: f.utxo.outputIndex })),
    result.changeVout != null ? { outputIndex: result.changeVout, satoshis: result.changeSats } : undefined,
  )
  return result
}
