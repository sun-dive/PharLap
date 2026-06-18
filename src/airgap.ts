// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP air-gapped signing (Phase 1a — file-based).
 *
 * The online/watch machine never has the private key; it gathers the on-chain inputs for an action (the
 * edition UTXO + its source tx, any funding UTXOs + source txs) and packages a **signing request**. The
 * offline machine imports it and re-runs the SAME validated builder (`buildEditionTransferTx` /
 * `buildEditionBurnTx`) with its key — these builders are pure given their inputs (no network) and build the
 * tx deterministically, so the cold-built signed tx is the canonical one. The online side just broadcasts it.
 *
 * Crossing the gap: a JSON request (online → offline) and a raw signed tx (offline → online) — files only,
 * never the key. Source txs travel inside the request so the offline signer has every input's value + script.
 */
import { Transaction, Utils } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import { buildEditionTransferTx, buildEditionBurnTx, type EditionUtxo } from './editionBuilder.ts'
import { editionOwnerPubKey } from './covenant.ts'
import type { FundingInput } from './collectionBuilder.ts'
import type { SellerNote } from './sellerNote.ts'

export const AIRGAP_VERSION = 1
export type AirgapAction = 'transfer' | 'burn'

interface AirgapInput { txId: string; outputIndex: number; satoshis: number; sourceTxHex: string }

/** What crosses the gap online → offline. Carries everything the offline builder needs — but no key. */
export interface AirgapRequest {
  v: number
  action: AirgapAction
  /** The edition being spent: outpoint, bond value, its lock, and its source tx (for the sighash). */
  edition: AirgapInput & { lockHex: string }
  /** transfer: the recipient's 33-byte pubkey (hex). */
  newOwnerPubKeyHex?: string
  /** transfer: optional seller note to carry to the new owner. */
  note?: SellerNote
  /** transfer: P2PKH funding inputs for the miner fee (owner-signed offline). */
  funding?: AirgapInput[]
  feePerKb?: number
  /** Human-readable summary for the offline signer to confirm before signing (not trusted — re-derived). */
  summary?: string
}

/** Build the request on the WATCH side. The caller gathers `edition` (with its sourceTx) + `funding` via the
 *  provider; this just serializes them — no key involved. */
export function buildAirgapRequest(
  action: AirgapAction,
  edition: EditionUtxo,
  opts: { newOwnerPubKeyHex?: string; note?: SellerNote; funding?: FundingInput[]; feePerKb?: number; summary?: string } = {},
): AirgapRequest {
  return {
    v: AIRGAP_VERSION,
    action,
    edition: {
      txId: edition.txId, outputIndex: edition.outputIndex, satoshis: edition.satoshis,
      lockHex: Utils.toHex(edition.lockBytes), sourceTxHex: edition.sourceTx.toHex(),
    },
    newOwnerPubKeyHex: opts.newOwnerPubKeyHex,
    note: opts.note,
    funding: opts.funding?.map(f => ({
      txId: f.utxo.txId, outputIndex: f.utxo.outputIndex, satoshis: f.utxo.satoshis, sourceTxHex: f.sourceTx.toHex(),
    })),
    feePerKb: opts.feePerKb,
    summary: opts.summary,
  }
}

/**
 * OFFLINE side: sign a request with the key, returning the signed raw tx. Re-runs the canonical builder, so the
 * signed tx is identical to what the online wallet would have produced. Refuses to sign an edition this key
 * doesn't own (the cold signer's sanity check).
 */
export async function signAirgapRequest(req: AirgapRequest, key: PrivateKey): Promise<{ txId: string; rawTx: string }> {
  if (req.v !== AIRGAP_VERSION) throw new Error(`unsupported air-gap request version ${req.v}`)
  const edition: EditionUtxo = {
    txId: req.edition.txId, outputIndex: req.edition.outputIndex, satoshis: req.edition.satoshis,
    lockBytes: Utils.toArray(req.edition.lockHex, 'hex'), sourceTx: Transaction.fromHex(req.edition.sourceTxHex),
  }
  const owner = Utils.toHex(editionOwnerPubKey(edition.lockBytes)).toLowerCase()
  if (owner !== key.toPublicKey().toString().toLowerCase()) {
    throw new Error('this wallet does not own that edition — cannot sign')
  }
  if (req.action === 'burn') {
    const r = await buildEditionBurnTx({ edition, ownerKey: key, feePerKb: req.feePerKb })
    return { txId: r.txId, rawTx: r.tx.toHex() }
  }
  if (req.action === 'transfer') {
    if (req.newOwnerPubKeyHex == null || req.newOwnerPubKeyHex.length === 0) throw new Error('transfer request is missing the recipient pubkey')
    const funding: FundingInput[] = (req.funding ?? []).map(f => ({
      utxo: { txId: f.txId, outputIndex: f.outputIndex, satoshis: f.satoshis, script: '' },
      sourceTx: Transaction.fromHex(f.sourceTxHex),
    }))
    const r = await buildEditionTransferTx({
      edition, ownerKey: key, newOwnerPubKey: Utils.toArray(req.newOwnerPubKeyHex, 'hex'), funding, note: req.note, feePerKb: req.feePerKb,
    })
    return { txId: r.txId, rawTx: r.tx.toHex() }
  }
  throw new Error(`unknown air-gap action: ${String(req.action)}`)
}

// ── File (de)serialization ──────────────────────────────────────────
export function encodeAirgapRequest(req: AirgapRequest): string { return JSON.stringify(req, null, 2) }

export function decodeAirgapRequest(json: string): AirgapRequest {
  const req = JSON.parse(json) as AirgapRequest
  if (req == null || typeof req !== 'object') throw new Error('not an air-gap request')
  if (req.v !== AIRGAP_VERSION) throw new Error(`unsupported air-gap request version ${req.v}`)
  if (req.action !== 'transfer' && req.action !== 'burn') throw new Error('unknown air-gap action')
  if (req.edition?.sourceTxHex == null || req.edition.lockHex == null) throw new Error('malformed air-gap request (missing edition data)')
  return req
}
