// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP edition-token transaction builder (experimental covenant path).
 *
 * Editions are the "unlimited mints" covenant tokens (Addendum A), kept SEPARATE from the plain
 * collectionBuilder so the mainnet-validated plain-token path stays untouched. Three operations:
 *
 *   GENESIS   — mint edition covenant output(s) from a collection (tx1Ref), funded by the creator.
 *   REPLICATE — anyone permissionlessly mints a copy: spends a holder edition UTXO via the replicate
 *               branch (+ funding) → token back to holder, replica to buyer, creator fee, holder fee,
 *               change. No holder signature.
 *   TRANSFER  — the owner moves the token, re-creating the covenant for a new owner (owner-signed).
 *
 * The covenant inputs are spent with unlocking-script TEMPLATES: the sighash preimage / owner sig is
 * built from the finalised transaction at sign time (after `tx.fee()` sets the change output), so
 * `hashOutputs` always matches. Spend/replicate/transfer txs are version 2 (Chronicle relaxed rules).
 *
 * Low-level builders are pure/offline (explicit funding) so every input can be Spend-validated without
 * the network, exactly like collectionBuilder. Network wrappers select funding + broadcast.
 */
import {
  Transaction, P2PKH, SatoshisPerKilobyte, Hash, Utils, LockingScript, UnlockingScript, TransactionSignature,
} from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import {
  buildEditionLock, swapEditionOwner, editionOwnerPubKey, p2pkhScript, serializeOutput,
  editionReplicateUnlockChunks, editionTransferUnlockChunks, EDITION_SCOPE,
} from './covenant.ts'
import { PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, type FundingInput } from './collectionBuilder.ts'

/** Common economic parameters of an edition collection (fixed forever at genesis). */
export interface EditionTerms {
  /** 20-byte hash160 of the immutable creator fee address. */
  creatorPubKeyHash: number[]
  creatorFeeSats: number
  holderFeeSats: number
  tokenSats?: number
}

function pubKeyBytes(key: PrivateKey): number[] {
  return key.toPublicKey().encode(true) as number[]
}

// ─── GENESIS ────────────────────────────────────────────────────────

export interface EditionGenesisResult {
  tx: Transaction
  txId: string
  editionVouts: number[]
  changeVout: number | null
  changeSats: number
}

export async function buildEditionGenesisTx(opts: {
  key: PrivateKey
  funding: FundingInput[]
  /** Collection id (TX1 txid), hex. Carried as tx1Ref in every edition. */
  tx1Ref: string
  terms: EditionTerms
  /** Owner of the minted editions. Default: the funding key's pubkey. */
  ownerPubKey?: number[]
  stateData?: number[]
  mintCount?: number
  feePerKb?: number
}): Promise<EditionGenesisResult> {
  const tokenSats = opts.terms.tokenSats ?? PHARLAP_OUTPUT_SATS
  const ownerPub = opts.ownerPubKey ?? pubKeyBytes(opts.key)
  const tx1Ref = Utils.toArray(opts.tx1Ref, 'hex')
  if (tx1Ref.length !== 32) throw new Error('buildEditionGenesisTx: tx1Ref must be a 32-byte txid hex')
  const tx = new Transaction()
  tx.version = 2

  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.key),
    })
  }

  const editionVouts: number[] = []
  for (let i = 0; i < (opts.mintCount ?? 1); i++) {
    const lock = buildEditionLock({
      tx1Ref, ownerPubKey: ownerPub, stateData: opts.stateData ?? [],
      creatorPubKeyHash: opts.terms.creatorPubKeyHash, creatorFeeSats: opts.terms.creatorFeeSats,
      holderFeeSats: opts.terms.holderFeeSats, tokenSats,
    })
    editionVouts.push(tx.outputs.length)
    tx.addOutput({ lockingScript: lock, satoshis: tokenSats })
  }

  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(opts.key.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return { tx, txId: tx.id('hex'), editionVouts, changeVout: changeSats > 0 ? changeVout : null, changeSats }
}

// ─── Covenant unlock templates (preimage built from the finalised tx) ───

const REPLICATE_UNLOCK_LEN = 1100 // generous over-estimate (preimage ≈ 930B incl. scriptCode + buyer data)
const TRANSFER_UNLOCK_LEN = 1200

/** Other-inputs in the shape TransactionSignature.format expects (ANYONECANPAY ignores them). */
function otherInputsOf(tx: Transaction, inputIndex: number) {
  return tx.inputs.filter((_, i) => i !== inputIndex)
}

export function replicateUnlockTemplate(opts: {
  buyerPubKey: number[]
  lockingScript: LockingScript
  sourceSatoshis: number
  enforcedOutputCount?: number
}) {
  return {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      const input = tx.inputs[inputIndex]
      const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
      const preimage = TransactionSignature.format({
        sourceTXID, sourceOutputIndex: input.sourceOutputIndex, sourceSatoshis: opts.sourceSatoshis,
        transactionVersion: tx.version, otherInputs: otherInputsOf(tx, inputIndex), inputIndex,
        outputs: tx.outputs, inputSequence: input.sequence ?? 0xffffffff,
        subscript: opts.lockingScript, lockTime: tx.lockTime, scope: EDITION_SCOPE,
      })
      const enforced = opts.enforcedOutputCount ?? 4
      const buyerChange = tx.outputs.slice(enforced)
        .flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary()))
      return new UnlockingScript(editionReplicateUnlockChunks({ buyerPubKey: opts.buyerPubKey, buyerChange, preimage }))
    },
    estimateLength: async (): Promise<number> => REPLICATE_UNLOCK_LEN,
  }
}

export function transferUnlockTemplate(opts: {
  ownerKey: PrivateKey
  newOwnerPubKey: number[]
  lockingScript: LockingScript
  sourceSatoshis: number
  enforcedOutputCount?: number
}) {
  return {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      const input = tx.inputs[inputIndex]
      const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
      const fmt = (scope: number) => TransactionSignature.format({
        sourceTXID, sourceOutputIndex: input.sourceOutputIndex, sourceSatoshis: opts.sourceSatoshis,
        transactionVersion: tx.version, otherInputs: otherInputsOf(tx, inputIndex), inputIndex,
        outputs: tx.outputs, inputSequence: input.sequence ?? 0xffffffff,
        subscript: opts.lockingScript, lockTime: tx.lockTime, scope,
      })
      const introspection = fmt(EDITION_SCOPE)
      const ownerScope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
      const raw = opts.ownerKey.sign(Hash.sha256(fmt(ownerScope)))
      const ownerSig = new TransactionSignature(raw.r, raw.s, ownerScope).toChecksigFormat()
      const enforced = opts.enforcedOutputCount ?? 1
      const change = tx.outputs.slice(enforced)
        .flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary()))
      return new UnlockingScript(editionTransferUnlockChunks({
        newOwnerPubKey: opts.newOwnerPubKey, ownerSig, change, preimage: introspection,
      }))
    },
    estimateLength: async (): Promise<number> => TRANSFER_UNLOCK_LEN,
  }
}

// ─── REPLICATE ──────────────────────────────────────────────────────

/** A spendable edition UTXO (the output being replicated/transferred). */
export interface EditionUtxo {
  txId: string
  outputIndex: number
  satoshis: number
  /** The edition locking script bytes (the covenant being spent). */
  lockBytes: number[]
  sourceTx: Transaction
}

export interface ReplicateResult {
  tx: Transaction
  txId: string
  /** outpoint of the token returned to the holder (verbatim). */
  holderTokenVout: number
  /** outpoint of the buyer's new replica. */
  replicaVout: number
  changeVout: number | null
}

export async function buildReplicateTx(opts: {
  edition: EditionUtxo
  terms: EditionTerms
  buyerKey: PrivateKey
  /** Buyer funding inputs (P2PKH), signed with buyerKey. */
  funding: FundingInput[]
  feePerKb?: number
}): Promise<ReplicateResult> {
  const tokenSats = opts.terms.tokenSats ?? PHARLAP_OUTPUT_SATS
  const lock = LockingScript.fromBinary(opts.edition.lockBytes)
  const holderPub = editionOwnerPubKey(opts.edition.lockBytes)
  const buyerPub = pubKeyBytes(opts.buyerKey)
  const tx = new Transaction()
  tx.version = 2

  // input 0: the holder's edition UTXO, spent via the permissionless replicate branch
  tx.addInput({
    sourceTransaction: opts.edition.sourceTx, sourceOutputIndex: opts.edition.outputIndex, sequence: 0xffffffff,
    unlockingScriptTemplate: replicateUnlockTemplate({ buyerPubKey: buyerPub, lockingScript: lock, sourceSatoshis: opts.edition.satoshis }),
  })
  // buyer funding inputs
  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.buyerKey),
    })
  }

  // Enforced outputs (order fixed by the covenant), then buyer change.
  tx.addOutput({ lockingScript: lock, satoshis: tokenSats })                                                  // [0] token → holder (verbatim)
  tx.addOutput({ lockingScript: LockingScript.fromBinary(swapEditionOwner(opts.edition.lockBytes, buyerPub)), satoshis: tokenSats }) // [1] replica → buyer
  tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(opts.terms.creatorPubKeyHash)), satoshis: opts.terms.creatorFeeSats }) // [2] creator fee
  tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(Hash.hash160(holderPub))), satoshis: opts.terms.holderFeeSats })       // [3] holder fee
  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(opts.buyerKey.toAddress()), change: true })                  // [4] buyer change

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return { tx, txId: tx.id('hex'), holderTokenVout: 0, replicaVout: 1, changeVout: changeSats > 0 ? changeVout : null }
}

// ─── TRANSFER ───────────────────────────────────────────────────────

export interface TransferResult {
  tx: Transaction
  txId: string
  tokenVout: number
  changeVout: number | null
}

export async function buildEditionTransferTx(opts: {
  edition: EditionUtxo
  /** Current owner's key (must match the owner pubkey in the edition script). */
  ownerKey: PrivateKey
  newOwnerPubKey: number[]
  /** Owner funding inputs (P2PKH) for the miner fee, signed with ownerKey. */
  funding: FundingInput[]
  tokenSats?: number
  feePerKb?: number
}): Promise<TransferResult> {
  const tokenSats = opts.tokenSats ?? PHARLAP_OUTPUT_SATS
  const lock = LockingScript.fromBinary(opts.edition.lockBytes)
  const tx = new Transaction()
  tx.version = 2

  tx.addInput({
    sourceTransaction: opts.edition.sourceTx, sourceOutputIndex: opts.edition.outputIndex, sequence: 0xffffffff,
    unlockingScriptTemplate: transferUnlockTemplate({
      ownerKey: opts.ownerKey, newOwnerPubKey: opts.newOwnerPubKey, lockingScript: lock, sourceSatoshis: opts.edition.satoshis,
    }),
  })
  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.ownerKey),
    })
  }

  tx.addOutput({ lockingScript: LockingScript.fromBinary(swapEditionOwner(opts.edition.lockBytes, opts.newOwnerPubKey)), satoshis: tokenSats }) // [0] token → new owner
  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(opts.ownerKey.toAddress()), change: true })

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return { tx, txId: tx.id('hex'), tokenVout: 0, changeVout: changeSats > 0 ? changeVout : null }
}
