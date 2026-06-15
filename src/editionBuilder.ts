// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP edition-token transaction builder (experimental covenant path).
 *
 * Editions are the "unlimited mints" covenant tokens (Addendum A), kept SEPARATE from the plain
 * collectionBuilder so the mainnet-validated plain-token path stays untouched. Three operations:
 *
 *   GENESIS   — mint edition covenant output(s) from a collection (tx1Ref), funded by the publisher.
 *   REPLICATE — anyone permissionlessly mints a copy: spends a holder edition UTXO via the replicate
 *               branch (+ funding) → token back to holder, replica to buyer, publisher fee, holder fee,
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
  Transaction, P2PKH, SatoshisPerKilobyte, Hash, Utils, LockingScript, UnlockingScript, TransactionSignature, PublicKey, PrivateKey,
} from '@bsv/sdk'
import {
  buildEditionLock, swapEditionOwner, editionOwnerPubKey, p2pkhScript, serializeOutput,
  editionReplicateUnlockChunks, editionTransferUnlockChunks, EDITION_SCOPE, parseEditionScript,
  buildHolderEditionScript, parseEditionScriptV2, parseEditionAny, buildEditionLockV2, u64le,
} from './covenant.ts'
import {
  PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding, buildTemplateTx, sha256Hex, type FundingInput,
} from './collectionBuilder.ts'
import { encodeTokenRules, buildNoteScript, RESTRICTION_REPLICABLE, RESTRICTION_ENCRYPTED, RESTRICTION_COMPRESSED } from './tokenCodec.ts'
import { compressIfSmaller } from './compress.ts'
import { readNoteFromTx, type SellerNote } from './sellerNote.ts'
import { newContentKey, newKeySalt, encryptContent, wrapContentKey } from './contentCrypto.ts'
import type { WalletProvider, Utxo } from './walletProvider.ts'

/** Common economic parameters of an edition collection (fixed forever at genesis). */
export interface EditionTerms {
  /** 20-byte hash160 of the immutable publisher fee address. */
  publisherPubKeyHash: number[]
  publisherFeeSats: number
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
      publisherPubKeyHash: opts.terms.publisherPubKeyHash, publisherFeeSats: opts.terms.publisherFeeSats,
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

/** Covenant v2 economic terms: a percentage split (pBps), no fixed fee amounts. */
export interface EditionV2Terms {
  /** 20-byte hash160 of the immutable publisher fee address. */
  publisherPubKeyHash: number[]
  /** Publisher fee in basis points (0–10000). */
  pBps: number
  tokenSats?: number
}

/** v2 genesis: mint edition outputs that enforce the percentage split, with an initial reseller price. */
export async function buildEditionGenesisV2Tx(opts: {
  key: PrivateKey
  funding: FundingInput[]
  tx1Ref: string
  terms: EditionV2Terms
  /** Initial reseller price (sats) baked into the genesis editions; resellers update it later (Layer 3). */
  initialPriceSats: number
  ownerPubKey?: number[]
  stateData?: number[]
  mintCount?: number
  feePerKb?: number
}): Promise<EditionGenesisResult> {
  const tokenSats = opts.terms.tokenSats ?? PHARLAP_OUTPUT_SATS
  const ownerPub = opts.ownerPubKey ?? pubKeyBytes(opts.key)
  const tx1Ref = Utils.toArray(opts.tx1Ref, 'hex')
  if (tx1Ref.length !== 32) throw new Error('buildEditionGenesisV2Tx: tx1Ref must be a 32-byte txid hex')
  const price = u64le(opts.initialPriceSats)
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
    const lock = buildEditionLockV2({
      tx1Ref, ownerPubKey: ownerPub, price, stateData: opts.stateData ?? [],
      publisherPubKeyHash: opts.terms.publisherPubKeyHash, pBps: opts.terms.pBps, tokenSats,
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
      if (sourceTXID == null) throw new Error('replicate unlock: input is missing sourceTXID/sourceTransaction')
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
      if (sourceTXID == null) throw new Error('transfer unlock: input is missing sourceTXID/sourceTransaction')
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
  /** Key that SIGNS the funding inputs (the payer). For a gift claim this is the voucher key. */
  buyerKey: PrivateKey
  /** Buyer funding inputs (P2PKH), signed with buyerKey. */
  funding: FundingInput[]
  /** Owner of the replica (decoupled from the payer). Default: the buyerKey's pubkey. A gift claim sets this
   *  to the recipient's wallet so the voucher funds the tx but the recipient owns the copy. */
  ownerPubKey?: number[]
  /** Where change goes. Default: the buyerKey's address. A gift claim sends it to the recipient. */
  changeAddress?: string
  /** Seller's note (promo + optional bonus) to echo onto the sale — hands-off propagation. */
  note?: SellerNote
  feePerKb?: number
}): Promise<ReplicateResult> {
  const tokenSats = opts.terms.tokenSats ?? PHARLAP_OUTPUT_SATS
  const lock = LockingScript.fromBinary(opts.edition.lockBytes)
  const holderPub = editionOwnerPubKey(opts.edition.lockBytes)
  const buyerPub = opts.ownerPubKey ?? pubKeyBytes(opts.buyerKey)
  const tx1RefHex = parseEditionScript(lock)?.tx1RefHex
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
  tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(opts.terms.publisherPubKeyHash)), satoshis: opts.terms.publisherFeeSats }) // [2] publisher fee
  tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(Hash.hash160(holderPub))), satoshis: opts.terms.holderFeeSats })       // [3] holder fee
  // [4] (optional) seller-note echo, locked to the buyer — a spender-supplied trailing output the covenant
  // appends verbatim (no covenant change). Carries the note + bonus to the buyer + to their future buyers.
  if (opts.note && tx1RefHex != null && (opts.note.text.length > 0 || (opts.note.bonusValue?.length ?? 0) > 0)) {
    tx.addOutput({
      lockingScript: buildNoteScript(Utils.toHex(buyerPub), {
        collectionRef: tx1RefHex, text: opts.note.text, bonusKind: opts.note.bonusKind, bonusValue: opts.note.bonusValue,
      }),
      satoshis: tokenSats,
    })
  }
  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(opts.changeAddress ?? opts.buyerKey.toAddress()), change: true }) // change → owner (or payer)

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return { tx, txId: tx.id('hex'), holderTokenVout: 0, replicaVout: 1, changeVout: changeSats > 0 ? changeVout : null }
}

/**
 * Covenant v2 replicate (Addendum G): the buyer pays the COMPUTED percentage split of the reseller's price.
 * Reads the price + pBps + publisher hash straight from the edition's own v2 lock, so the out[2]/out[3] amounts
 * this builds are exactly what the covenant recomputes and enforces. out[0]/out[1]/note/change are unchanged.
 */
export async function buildReplicateV2Tx(opts: {
  edition: EditionUtxo
  /** Key that SIGNS the funding inputs (the payer). For a gift claim this is the voucher key. */
  buyerKey: PrivateKey
  funding: FundingInput[]
  /** Owner of the replica (decoupled from the payer). Default: the buyerKey's pubkey. */
  ownerPubKey?: number[]
  /** Where change goes. Default: the buyerKey's address. */
  changeAddress?: string
  note?: SellerNote
  tokenSats?: number
  feePerKb?: number
}): Promise<ReplicateResult & { publisherCut: number; resellerCut: number }> {
  const tokenSats = opts.tokenSats ?? PHARLAP_OUTPUT_SATS
  const lock = LockingScript.fromBinary(opts.edition.lockBytes)
  const parsed = parseEditionScriptV2(lock)
  if (parsed == null) throw new Error('buildReplicateV2Tx: not a v2 edition covenant')
  const holderPub = editionOwnerPubKey(opts.edition.lockBytes)
  const buyerPub = opts.ownerPubKey ?? pubKeyBytes(opts.buyerKey)
  const publisherCut = Math.floor((parsed.priceSats * parsed.terms.pBps) / 10000)
  const resellerCut = parsed.priceSats - publisherCut
  const tx = new Transaction()
  tx.version = 2

  tx.addInput({
    sourceTransaction: opts.edition.sourceTx, sourceOutputIndex: opts.edition.outputIndex, sequence: 0xffffffff,
    unlockingScriptTemplate: replicateUnlockTemplate({ buyerPubKey: buyerPub, lockingScript: lock, sourceSatoshis: opts.edition.satoshis }),
  })
  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.buyerKey),
    })
  }

  tx.addOutput({ lockingScript: lock, satoshis: tokenSats })                                                  // [0] token → holder (verbatim)
  tx.addOutput({ lockingScript: LockingScript.fromBinary(swapEditionOwner(opts.edition.lockBytes, buyerPub)), satoshis: tokenSats }) // [1] replica → buyer
  tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(parsed.terms.publisherPubKeyHash)), satoshis: publisherCut })       // [2] publisher cut = ⌊P·c%⌋
  tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(Hash.hash160(holderPub))), satoshis: resellerCut })             // [3] reseller cut = P − publisherCut
  if (opts.note && (opts.note.text.length > 0 || (opts.note.bonusValue?.length ?? 0) > 0)) {
    tx.addOutput({
      lockingScript: buildNoteScript(Utils.toHex(buyerPub), {
        collectionRef: parsed.tx1RefHex, text: opts.note.text, bonusKind: opts.note.bonusKind, bonusValue: opts.note.bonusValue,
      }),
      satoshis: tokenSats,
    })
  }
  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(opts.changeAddress ?? opts.buyerKey.toAddress()), change: true }) // change → owner (or payer)

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return {
    tx, txId: tx.id('hex'), holderTokenVout: 0, replicaVout: 1,
    changeVout: changeSats > 0 ? changeVout : null, publisherCut, resellerCut,
  }
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
  /** Seller-note (promo + optional bonus) to carry to the new owner — hands-off propagation. */
  note?: SellerNote
  tokenSats?: number
  feePerKb?: number
}): Promise<TransferResult> {
  const tokenSats = opts.tokenSats ?? PHARLAP_OUTPUT_SATS
  const lock = LockingScript.fromBinary(opts.edition.lockBytes)
  const tx1RefHex = parseEditionScript(lock)?.tx1RefHex
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
  // [1] 1-sat P2PKH notification to the new owner's address — the discovery breadcrumb (the edition
  // covenant output itself is not WoC-address-indexed). Part of the covenant's free "change" region.
  const notifyAddress = PublicKey.fromString(Utils.toHex(opts.newOwnerPubKey)).toAddress()
  tx.addOutput({ lockingScript: new P2PKH().lock(notifyAddress), satoshis: 1 })
  // (optional) seller-note echo, locked to the new owner — carries the note + bonus across the transfer.
  if (opts.note && tx1RefHex != null && (opts.note.text.length > 0 || (opts.note.bonusValue?.length ?? 0) > 0)) {
    tx.addOutput({
      lockingScript: buildNoteScript(Utils.toHex(opts.newOwnerPubKey), {
        collectionRef: tx1RefHex, text: opts.note.text, bonusKind: opts.note.bonusKind, bonusValue: opts.note.bonusValue,
      }),
      satoshis: tokenSats,
    })
  }
  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(opts.ownerKey.toAddress()), change: true })

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return { tx, txId: tx.id('hex'), tokenVout: 0, changeVout: changeSats > 0 ? changeVout : null }
}

// ─── Network wrappers (funding selection + broadcast) ───────────────

async function toFundingInputs(provider: WalletProvider, utxos: Utxo[]): Promise<FundingInput[]> {
  return Promise.all(utxos.map(async u => ({ utxo: u, sourceTx: await provider.getSourceTransaction(u.txId) })))
}

export interface CreateEditionResult {
  collectionId: string
  tx1Id: string
  tx2Id: string
  editions: Array<{ txId: string; outputIndex: number; lockHex: string }>
}

/**
 * Create an edition collection on-chain: TX1 template (commits name, replicable rules, and the covenant
 * template with a zeroed tx1Ref/owner for later verification) + TX2 that mints the edition covenant
 * outputs referencing TX1. Mirrors collectionBuilder.createCollection's funding/broadcast pattern.
 */
export async function createEdition(provider: WalletProvider, key: PrivateKey, params: {
  tokenName: string
  terms: EditionTerms
  mintCount?: number
  ownerPubKey?: number[]
  stateData?: number[]
  /** Optional file embedded (hash-bound) in TX1, viewable by token holders. */
  file?: { mimeType: string; fileName: string; bytes: number[] }
  /** Tier-1 encrypt the embedded file (Addendum F). Requires `file`. */
  encrypt?: boolean
  /** Immutable storefront blurb shown on the collection / sales page (PLAN.md Step 2, D3). */
  description?: string
  /** Optional public (unencrypted) cover image — the storefront's face, shown even when content is encrypted. */
  cover?: { mimeType: string; fileName: string; bytes: number[] }
  feePerKb?: number
}): Promise<CreateEditionResult> {
  const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB
  const mintCount = params.mintCount ?? 1
  const ownerPub = params.ownerPubKey ?? pubKeyBytes(key)
  const tokenSats = params.terms.tokenSats ?? PHARLAP_OUTPUT_SATS
  const stateData = params.stateData ?? []

  // Covenant template committed in TX1: structurally identical to an edition but with identity zeroed.
  const templateLock = buildEditionLock({
    tx1Ref: new Array(32).fill(0), ownerPubKey: new Array(33).fill(0), stateData,
    publisherPubKeyHash: params.terms.publisherPubKeyHash, publisherFeeSats: params.terms.publisherFeeSats,
    holderFeeSats: params.terms.holderFeeSats, tokenSats,
  })

  // Smart-compress (keep only if smaller), then optionally Tier-1 encrypt. Order matters: compress BEFORE
  // encrypt (ciphertext is incompressible). The FILE output stores the final bytes; fileHash binds them.
  const encrypt = params.encrypt === true && params.file != null
  let storedBytes = params.file?.bytes
  let compressed = false
  let wrappedKey: number[] | undefined
  let keySalt: number[] | undefined
  if (params.file != null) {
    const z = await compressIfSmaller(params.file.bytes)
    storedBytes = z.bytes
    compressed = z.compressed
    if (encrypt) {
      const K = newContentKey()
      keySalt = newKeySalt()
      storedBytes = encryptContent(storedBytes, K)
      wrappedKey = wrapContentKey(K, keySalt)
    }
  }
  const restrictions = RESTRICTION_REPLICABLE | (encrypt ? RESTRICTION_ENCRYPTED : 0) | (compressed ? RESTRICTION_COMPRESSED : 0)
  const template = {
    tokenName: params.tokenName,
    tokenRules: encodeTokenRules(0, 0, restrictions, 1), // supply 0 = unlimited / replicable
    covenantScript: Utils.toHex(templateLock.toBinary()),
    fileHash: storedBytes != null ? sha256Hex(storedBytes) : undefined, // binds the stored (cipher)text
    wrappedKey,
    keySalt,
  }
  const file = params.file != null
    ? { mimeType: params.file.mimeType, fileName: params.file.fileName, fileBytes: storedBytes! }
    : undefined

  // Immutable storefront record (description + optional public cover image), carried as a TX1 output.
  const hasStorefront = (params.description != null && params.description.length > 0) || params.cover != null
  const storefront = hasStorefront
    ? {
        description: params.description ?? '',
        coverMimeType: params.cover?.mimeType,
        coverFileName: params.cover?.fileName,
        coverBytes: params.cover?.bytes,
      }
    : undefined

  // Fund both txs. TX1 carries any embedded file + cover, so its fee scales with their size; keep a healthy margin.
  const editionBytes = 800
  const tx1Bytes = 500 + templateLock.toBinary().length
    + (file ? file.fileBytes.length : 0)
    + (params.cover ? params.cover.bytes.length : 0)
  const tx2Bytes = 300 + mintCount * editionBytes
  const estFee = Math.ceil(((tx1Bytes + tx2Bytes) * feePerKb) / 1000)
  const target = (1 + mintCount) * tokenSats + estFee + Math.max(1000, Math.ceil(estFee * 0.2))
  const selected = selectFunding(await getSafeUtxos(provider), target)
  const funding = await toFundingInputs(provider, selected)

  // Build both offline, broadcast only if both succeed (no orphaned template).
  const t1 = await buildTemplateTx({ key, funding, template, file, storefront, outputSats: tokenSats, feePerKb })
  if (t1.changeVout == null) throw new Error('Insufficient funding: template tx left no change to fund the edition mint.')
  const t2Funding: FundingInput[] = [{
    utxo: { txId: t1.tx1Id, outputIndex: t1.changeVout, satoshis: t1.changeSats, script: '' },
    sourceTx: t1.tx,
  }]
  const t2 = await buildEditionGenesisTx({
    key, funding: t2Funding, tx1Ref: t1.tx1Id, terms: params.terms, ownerPubKey: ownerPub, stateData, mintCount, feePerKb,
  })

  await provider.broadcast(t1.tx.toHex())
  provider.registerPendingTx(t1.tx1Id, selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    { outputIndex: t1.changeVout, satoshis: t1.changeSats })
  await provider.broadcast(t2.tx.toHex())
  provider.registerPendingTx(t2.txId, [{ txId: t1.tx1Id, outputIndex: t1.changeVout }],
    t2.changeVout != null ? { outputIndex: t2.changeVout, satoshis: t2.changeSats } : undefined)

  const editions = t2.editionVouts.map(v => ({
    txId: t2.txId, outputIndex: v, lockHex: Utils.toHex(t2.tx.outputs[v].lockingScript.toBinary()),
  }))
  return { collectionId: t1.tx1Id, tx1Id: t1.tx1Id, tx2Id: t2.txId, editions }
}

/** Replicate (permissionlessly mint a copy of) an on-chain edition. The caller is the buyer. */
export async function replicateEdition(provider: WalletProvider, buyerKey: PrivateKey, params: {
  editionTxId: string
  editionOutputIndex: number
  editionLockHex: string
  terms: EditionTerms
  /** Seller's note (promo + optional bonus) to echo onto the buyer's copy (hands-off propagation). */
  note?: SellerNote
  feePerKb?: number
}): Promise<{ txId: string; replicaOutpoint: { txId: string; outputIndex: number }; lockHex: string }> {
  const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB
  const tokenSats = params.terms.tokenSats ?? PHARLAP_OUTPUT_SATS
  const lockBytes = Utils.toArray(params.editionLockHex, 'hex')
  const sourceTx = await provider.getSourceTransaction(params.editionTxId)
  const edition: EditionUtxo = {
    txId: params.editionTxId, outputIndex: params.editionOutputIndex,
    satoshis: sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? tokenSats, lockBytes, sourceTx,
  }
  // Buyer funds: token + replica sats, both fees, the optional note output, miner fee, margin.
  const noteSats = params.note ? tokenSats : 0
  const estFee = Math.ceil((1500 * feePerKb) / 1000)
  const target = 2 * tokenSats + noteSats + params.terms.publisherFeeSats + params.terms.holderFeeSats + estFee + 1000
  const selected = selectFunding(await getSafeUtxos(provider), target)
  const funding = await toFundingInputs(provider, selected)

  const rep = await buildReplicateTx({ edition, terms: params.terms, buyerKey, funding, note: params.note, feePerKb })
  await provider.broadcast(rep.tx.toHex())
  provider.registerPendingTx(rep.txId,
    [{ txId: params.editionTxId, outputIndex: params.editionOutputIndex },
      ...selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex }))],
    rep.changeVout != null ? { outputIndex: rep.changeVout, satoshis: rep.tx.outputs[rep.changeVout].satoshis ?? 0 } : undefined)
  return {
    txId: rep.txId, replicaOutpoint: { txId: rep.txId, outputIndex: rep.replicaVout },
    lockHex: Utils.toHex(rep.tx.outputs[rep.replicaVout].lockingScript.toBinary()),
  }
}

// ─── Covenant v2 network wrappers (Addendum G) ──────────────────────

/** Mint a v2 (percentage-pricing) edition collection on-chain: TX1 template + TX2 v2 genesis.
 *  Same feature set as createEdition (file / encryption / storefront cover+description). */
export async function createEditionV2(provider: WalletProvider, key: PrivateKey, params: {
  tokenName: string
  terms: EditionV2Terms
  initialPriceSats: number
  mintCount?: number
  ownerPubKey?: number[]
  stateData?: number[]
  file?: { mimeType: string; fileName: string; bytes: number[] }
  encrypt?: boolean
  description?: string
  cover?: { mimeType: string; fileName: string; bytes: number[] }
  feePerKb?: number
}): Promise<CreateEditionResult & { tx2: Transaction }> {
  const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB
  const mintCount = params.mintCount ?? 1
  const ownerPub = params.ownerPubKey ?? pubKeyBytes(key)
  const tokenSats = params.terms.tokenSats ?? PHARLAP_OUTPUT_SATS
  const stateData = params.stateData ?? []
  const price = u64le(params.initialPriceSats)

  // v2 covenant template (identity zeroed) committed in TX1 — lets a holder's edition be reconstructed later.
  const templateLock = buildEditionLockV2({
    tx1Ref: new Array(32).fill(0), ownerPubKey: new Array(33).fill(0), price, stateData,
    publisherPubKeyHash: params.terms.publisherPubKeyHash, pBps: params.terms.pBps, tokenSats,
  })

  // Smart-compress (keep only if smaller), then optionally Tier-1 encrypt — compress BEFORE encrypt.
  const encrypt = params.encrypt === true && params.file != null
  let storedBytes = params.file?.bytes
  let compressed = false
  let wrappedKey: number[] | undefined
  let keySalt: number[] | undefined
  if (params.file != null) {
    const z = await compressIfSmaller(params.file.bytes)
    storedBytes = z.bytes
    compressed = z.compressed
    if (encrypt) {
      const K = newContentKey()
      keySalt = newKeySalt()
      storedBytes = encryptContent(storedBytes, K)
      wrappedKey = wrapContentKey(K, keySalt)
    }
  }
  const template = {
    tokenName: params.tokenName,
    tokenRules: encodeTokenRules(0, 0, RESTRICTION_REPLICABLE | (encrypt ? RESTRICTION_ENCRYPTED : 0) | (compressed ? RESTRICTION_COMPRESSED : 0), 1),
    covenantScript: Utils.toHex(templateLock.toBinary()),
    fileHash: storedBytes != null ? sha256Hex(storedBytes) : undefined,
    wrappedKey,
    keySalt,
  }
  const file = params.file != null
    ? { mimeType: params.file.mimeType, fileName: params.file.fileName, fileBytes: storedBytes! }
    : undefined
  const hasStorefront = (params.description != null && params.description.length > 0) || params.cover != null
  const storefront = hasStorefront
    ? { description: params.description ?? '', coverMimeType: params.cover?.mimeType, coverFileName: params.cover?.fileName, coverBytes: params.cover?.bytes }
    : undefined

  const tx1Bytes = 500 + templateLock.toBinary().length + (file ? file.fileBytes.length : 0) + (params.cover ? params.cover.bytes.length : 0)
  const tx2Bytes = 300 + mintCount * 900
  const estFee = Math.ceil(((tx1Bytes + tx2Bytes) * feePerKb) / 1000)
  const target = (1 + mintCount) * tokenSats + estFee + Math.max(1000, Math.ceil(estFee * 0.2))
  const selected = selectFunding(await getSafeUtxos(provider), target)
  const funding = await toFundingInputs(provider, selected)

  const t1 = await buildTemplateTx({ key, funding, template, file, storefront, outputSats: tokenSats, feePerKb })
  if (t1.changeVout == null) throw new Error('Insufficient funding: template tx left no change to fund the v2 mint.')
  const t2Funding: FundingInput[] = [{
    utxo: { txId: t1.tx1Id, outputIndex: t1.changeVout, satoshis: t1.changeSats, script: '' }, sourceTx: t1.tx,
  }]
  const t2 = await buildEditionGenesisV2Tx({
    key, funding: t2Funding, tx1Ref: t1.tx1Id, terms: params.terms, initialPriceSats: params.initialPriceSats,
    ownerPubKey: ownerPub, stateData, mintCount, feePerKb,
  })

  await provider.broadcast(t1.tx.toHex())
  provider.registerPendingTx(t1.tx1Id, selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    { outputIndex: t1.changeVout, satoshis: t1.changeSats })
  await provider.broadcast(t2.tx.toHex())
  provider.registerPendingTx(t2.txId, [{ txId: t1.tx1Id, outputIndex: t1.changeVout }],
    t2.changeVout != null ? { outputIndex: t2.changeVout, satoshis: t2.changeSats } : undefined)

  const editions = t2.editionVouts.map(v => ({
    txId: t2.txId, outputIndex: v, lockHex: Utils.toHex(t2.tx.outputs[v].lockingScript.toBinary()),
  }))
  return { collectionId: t1.tx1Id, tx1Id: t1.tx1Id, tx2Id: t2.txId, editions, tx2: t2.tx }
}

/** Permissionlessly replicate a v2 edition (computed percentage split). The caller is the buyer. */
export async function replicateEditionV2(provider: WalletProvider, buyerKey: PrivateKey, params: {
  editionTxId: string
  editionOutputIndex: number
  editionLockHex: string
  /** Pass the edition's source tx to skip the WoC fetch (e.g. replicating an own just-minted, unconfirmed edition). */
  editionSourceTx?: Transaction
  /** Seller's note (promo + optional bonus) to echo onto the buyer's copy (hands-off propagation, like v1). */
  note?: SellerNote
  feePerKb?: number
}): Promise<{ txId: string; replicaOutpoint: { txId: string; outputIndex: number }; lockHex: string; publisherCut: number; resellerCut: number }> {
  const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB
  const lockBytes = Utils.toArray(params.editionLockHex, 'hex')
  const parsed = parseEditionScriptV2(LockingScript.fromBinary(lockBytes))
  if (parsed == null) throw new Error('replicateEditionV2: not a v2 edition covenant')
  const sourceTx = params.editionSourceTx ?? await provider.getSourceTransaction(params.editionTxId)
  const tokenSats = sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? PHARLAP_OUTPUT_SATS
  const edition: EditionUtxo = {
    txId: params.editionTxId, outputIndex: params.editionOutputIndex, satoshis: tokenSats, lockBytes, sourceTx,
  }
  // Buyer funds: token + replica sats + the price (publisher + reseller cuts) + the optional note output + miner fee + margin.
  const noteSats = params.note ? tokenSats : 0
  const estFee = Math.ceil((1600 * feePerKb) / 1000)
  const target = 2 * tokenSats + noteSats + parsed.priceSats + estFee + 1000
  const selected = selectFunding(await getSafeUtxos(provider), target)
  const funding = await toFundingInputs(provider, selected)

  const rep = await buildReplicateV2Tx({ edition, buyerKey, funding, note: params.note, feePerKb })
  await provider.broadcast(rep.tx.toHex())
  provider.registerPendingTx(rep.txId,
    [{ txId: params.editionTxId, outputIndex: params.editionOutputIndex },
      ...selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex }))],
    rep.changeVout != null ? { outputIndex: rep.changeVout, satoshis: rep.tx.outputs[rep.changeVout].satoshis ?? 0 } : undefined)
  return {
    txId: rep.txId, replicaOutpoint: { txId: rep.txId, outputIndex: rep.replicaVout },
    lockHex: Utils.toHex(rep.tx.outputs[rep.replicaVout].lockingScript.toBinary()),
    publisherCut: rep.publisherCut, resellerCut: rep.resellerCut,
  }
}

// ─── Free-gift vouchers (publisher pre-funds claims; recipients claim for ~a miner fee) ──────────

/**
 * Publisher: mint `count` funded "voucher" keys in ONE transaction, each holding `fundEachSats`. Returns
 * the funding txid + the voucher WIFs (the app turns each into a `&g=` claim link). Because the recipient
 * claims by replicating the publisher's own edition, the price + fees they "pay" flow straight back to the
 * publisher (they are the holder) — so the publisher's real cost ≈ the miner fee × count.
 */
export async function createGiftVouchers(provider: WalletProvider, publisherKey: PrivateKey, params: {
  count: number
  fundEachSats: number
  feePerKb?: number
}): Promise<{ fundingTxId: string; voucherWifs: string[] }> {
  const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB
  const count = Math.max(1, Math.floor(params.count))
  const keys = Array.from({ length: count }, () => PrivateKey.fromRandom())
  const estFee = Math.ceil(((250 + count * 35) * feePerKb) / 1000)
  const target = count * params.fundEachSats + estFee + 500
  const selected = selectFunding(await getSafeUtxos(provider), target)
  if (selected.length === 0) throw new Error('Insufficient funds to create the gift vouchers.')
  const funding = await toFundingInputs(provider, selected)

  const tx = new Transaction()
  for (const f of funding) {
    tx.addInput({ sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex, unlockingScriptTemplate: new P2PKH().unlock(publisherKey) })
  }
  for (const k of keys) {
    tx.addOutput({ lockingScript: new P2PKH().lock(k.toAddress()), satoshis: params.fundEachSats })
  }
  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(publisherKey.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(feePerKb))
  await tx.sign()
  await provider.broadcast(tx.toHex())
  const txId = tx.id('hex')
  provider.registerPendingTx(txId, selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    (tx.outputs[changeVout]?.satoshis ?? 0) > 0 ? { outputIndex: changeVout, satoshis: tx.outputs[changeVout].satoshis ?? 0 } : undefined)
  return { fundingTxId: txId, voucherWifs: keys.map(k => k.toWif()) }
}

/**
 * Recipient: claim a gift edition with a funded voucher key. The voucher signs the funding (pays the fee +
 * price), but the replica is owned by `ownerKey` (the recipient's own wallet) and change tops them up.
 * Works for a brand-new OR existing wallet. Throws if the voucher has already been spent (single-use).
 */
export async function claimGiftEdition(provider: WalletProvider, ownerKey: PrivateKey, params: {
  giftWif: string
  editionTxId: string
  editionOutputIndex: number
  editionLockHex: string
  editionSourceTx?: Transaction
  note?: SellerNote
  feePerKb?: number
}): Promise<{ txId: string; replicaOutpoint: { txId: string; outputIndex: number }; lockHex: string; isV2: boolean }> {
  const giftKey = PrivateKey.fromWif(params.giftWif)
  const giftScript = p2pkhScript(Hash.hash160(giftKey.toPublicKey().encode(true) as number[]))
  const giftUtxos = await provider.getUnspentByScriptHash(wocScriptHash(giftScript))
  if (giftUtxos.length === 0) throw new Error('This free copy has already been claimed.')
  const funding = await toFundingInputs(provider, giftUtxos)

  const lockBytes = Utils.toArray(params.editionLockHex, 'hex')
  const parsed = parseEditionAny(LockingScript.fromBinary(lockBytes))
  if (parsed == null) throw new Error('claimGiftEdition: not an edition covenant')
  const sourceTx = params.editionSourceTx ?? await provider.getSourceTransaction(params.editionTxId)
  const tokenSats = sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? PHARLAP_OUTPUT_SATS
  const edition: EditionUtxo = { txId: params.editionTxId, outputIndex: params.editionOutputIndex, satoshis: tokenSats, lockBytes, sourceTx }
  const ownerPub = ownerKey.toPublicKey().encode(true) as number[]
  const changeAddress = ownerKey.toAddress()

  let rep: ReplicateResult
  if (parsed.isV2) {
    rep = await buildReplicateV2Tx({ edition, buyerKey: giftKey, funding, ownerPubKey: ownerPub, changeAddress, note: params.note, feePerKb: params.feePerKb })
  } else {
    const terms: EditionTerms = {
      publisherPubKeyHash: parsed.terms.publisherPubKeyHash, publisherFeeSats: parsed.terms.publisherFeeSats,
      holderFeeSats: parsed.terms.holderFeeSats, tokenSats,
    }
    rep = await buildReplicateTx({ edition, terms, buyerKey: giftKey, funding, ownerPubKey: ownerPub, changeAddress, note: params.note, feePerKb: params.feePerKb })
  }
  await provider.broadcast(rep.tx.toHex())
  provider.registerPendingTx(rep.txId,
    [{ txId: params.editionTxId, outputIndex: params.editionOutputIndex }, ...giftUtxos.map(u => ({ txId: u.txId, outputIndex: u.outputIndex }))],
    rep.changeVout != null ? { outputIndex: rep.changeVout, satoshis: rep.tx.outputs[rep.changeVout].satoshis ?? 0 } : undefined)
  return {
    txId: rep.txId, replicaOutpoint: { txId: rep.txId, outputIndex: rep.replicaVout },
    lockHex: Utils.toHex(rep.tx.outputs[rep.replicaVout].lockingScript.toBinary()), isV2: parsed.isV2,
  }
}

/** Transfer (owner-signed) an on-chain edition to a new owner, re-creating the covenant. */
export async function transferEdition(provider: WalletProvider, ownerKey: PrivateKey, params: {
  editionTxId: string
  editionOutputIndex: number
  editionLockHex: string
  newOwnerPubKey: number[]
  /** Seller-note (promo + optional bonus) to carry to the new owner (hands-off propagation). */
  note?: SellerNote
  tokenSats?: number
  feePerKb?: number
}): Promise<{ txId: string; tokenOutpoint: { txId: string; outputIndex: number }; lockHex: string }> {
  const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB
  const tokenSats = params.tokenSats ?? PHARLAP_OUTPUT_SATS
  const lockBytes = Utils.toArray(params.editionLockHex, 'hex')
  const sourceTx = await provider.getSourceTransaction(params.editionTxId)
  const edition: EditionUtxo = {
    txId: params.editionTxId, outputIndex: params.editionOutputIndex,
    satoshis: sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? tokenSats, lockBytes, sourceTx,
  }
  const noteSats = params.note ? tokenSats : 0
  const estFee = Math.ceil((1500 * feePerKb) / 1000)
  const selected = selectFunding(await getSafeUtxos(provider), tokenSats + noteSats + estFee + 1000)
  const funding = await toFundingInputs(provider, selected)

  const xfer = await buildEditionTransferTx({
    edition, ownerKey, newOwnerPubKey: params.newOwnerPubKey, funding, note: params.note, tokenSats, feePerKb,
  })
  await provider.broadcast(xfer.tx.toHex())
  provider.registerPendingTx(xfer.txId,
    [{ txId: params.editionTxId, outputIndex: params.editionOutputIndex },
      ...selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex }))],
    xfer.changeVout != null ? { outputIndex: xfer.changeVout, satoshis: xfer.tx.outputs[xfer.changeVout].satoshis ?? 0 } : undefined)
  return {
    txId: xfer.txId, tokenOutpoint: { txId: xfer.txId, outputIndex: xfer.tokenVout },
    lockHex: Utils.toHex(xfer.tx.outputs[xfer.tokenVout].lockingScript.toBinary()),
  }
}

/**
 * Cheapest possible de-risk: broadcast a trivial VERSION-2 P2PKH self-send. If the network relays/mines
 * it, version-2 (Chronicle) transactions are accepted — a prerequisite for any covenant spend. Returns txid.
 */
export async function broadcastV2Probe(provider: WalletProvider, key: PrivateKey, feePerKb?: number): Promise<string> {
  const selected = selectFunding(await getSafeUtxos(provider), 1000)
  const funding = await toFundingInputs(provider, selected)
  const tx = new Transaction()
  tx.version = 2
  for (const f of funding) {
    tx.addInput({ sourceTransaction: f.sourceTx, sourceOutputIndex: f.utxo.outputIndex, unlockingScriptTemplate: new P2PKH().unlock(key) })
  }
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()
  await provider.broadcast(tx.toHex())
  provider.registerPendingTx(tx.id('hex'), selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    tx.outputs[0]?.satoshis != null ? { outputIndex: 0, satoshis: tx.outputs[0].satoshis } : undefined)
  return tx.id('hex')
}

/** WoC script hash for an output: SHA-256(scriptBytes) byte-reversed (Electrum/WoC convention). */
export function wocScriptHash(scriptBytes: number[]): string {
  return Utils.toHex(Hash.sha256(scriptBytes).reverse())
}

export interface ResolvedEdition {
  txId: string
  outputIndex: number
  /** The exact edition locking script (hex) — feeds straight into replicateEdition / replicateEditionV2. */
  lockHex: string
  terms: EditionTerms
  tokenSats: number
  /** True if a v2 (percentage-pricing) edition — caller dispatches to replicateEditionV2. */
  isV2: boolean
  /** v2 only: the reseller's price (sats); 0 for v1. */
  priceSats: number
}

/**
 * Resolve a holder's CURRENT spendable edition of a collection, given the collection's covenant template
 * (from TX1) and the holder's pubkey — the "sales link" tip resolution (PLAN.md Step 2, D2).
 *
 * The holder's edition script is deterministic (buildHolderEditionScript: template + tx1Ref + owner), so
 * we derive it and ask WoC for its unspent UTXO(s) by script hash — no address-history walk. Returns the
 * tip to replicate from, or null if the holder currently holds no edition of this collection.
 */
export async function resolveHolderEdition(provider: WalletProvider, params: {
  tx1RefHex: string
  holderPubKeyHex: string
  /** The collection's covenant template bytes (hex) — TX1 template.covenantScript. */
  templateCovenantHex: string
}): Promise<ResolvedEdition | null> {
  const tx1Ref = Utils.toArray(params.tx1RefHex, 'hex')
  const ownerPub = Utils.toArray(params.holderPubKeyHex, 'hex')
  const templateBytes = Utils.toArray(params.templateCovenantHex, 'hex')
  const lockBytes = buildHolderEditionScript(templateBytes, tx1Ref, ownerPub)
  const lockScript = LockingScript.fromHex(Utils.toHex(lockBytes))
  const ed = parseEditionAny(lockScript)
  if (ed == null) throw new Error('resolveHolderEdition: reconstructed script is not a valid edition')

  const unspent = await provider.getUnspentByScriptHash(wocScriptHash(lockBytes))
  if (unspent.length === 0) return null
  // Any unspent edition of this holder is an interchangeable sale source; prefer a confirmed one.
  const pick = unspent.find(u => u.satoshis > 0) ?? unspent[0]
  return {
    txId: pick.txId, outputIndex: pick.outputIndex, lockHex: Utils.toHex(lockBytes),
    terms: { publisherPubKeyHash: ed.terms.publisherPubKeyHash, publisherFeeSats: ed.terms.publisherFeeSats, holderFeeSats: ed.terms.holderFeeSats, tokenSats: pick.satoshis },
    tokenSats: pick.satoshis, isV2: ed.isV2, priceSats: ed.priceSats,
  }
}

export interface IncomingEdition {
  txId: string
  outputIndex: number
  lockHex: string
  tx1RefHex: string
  terms: EditionTerms
  /** True if a v2 (percentage-pricing) edition. */
  isV2: boolean
  /** v2 only: the reseller's price (sats). */
  priceSats: number
  /** Seller-note (promo + optional bonus) that rode in on the carrying tx (on-chain echo), if any. */
  sellerNote?: SellerNote
  /** Block height of the acquiring tx (0/undefined = unconfirmed) — for ordering recovered holdings. */
  height?: number
}

/**
 * Find the edition covenant outputs CURRENTLY held by `pubKeyHex` (unspent). Two passes:
 *   1) Discover which collections this pubkey has held, by scanning the wallet's address history (the
 *      change / notification breadcrumbs land there) for edition outputs locked to it.
 *   2) For each distinct edition script (one per collection+owner, deterministic), ask WoC for its current
 *      UNSPENT outputs by script hash — so editions already sold/transferred away are excluded.
 * This makes the result a true snapshot of live holdings, which is what both "check incoming" and
 * recover-from-WIF need (the local store is a rebuildable cache; the chain is the source of truth).
 * Terms come from the covenant script itself, and any seller-note that rode in is read from each tx.
 */
export async function scanIncomingEditions(provider: WalletProvider, pubKeyHex: string): Promise<IncomingEdition[]> {
  const mine = pubKeyHex.toLowerCase()

  // Pass 1 — discover distinct edition scripts (lockHex) this pubkey holds/held, from address breadcrumbs.
  const candidateTxIds = new Set<string>()
  try { for (const { txId } of await provider.getAddressHistory()) candidateTxIds.add(txId) } catch { /* best-effort */ }
  try { for (const u of await provider.getUtxos()) candidateTxIds.add(u.txId) } catch { /* best-effort */ }
  const scripts = new Map<string, string>() // lockHex -> tx1RefHex
  for (const txId of candidateTxIds) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    for (const o of tx.outputs) {
      const ed = parseEditionAny(o.lockingScript)
      if (ed == null || ed.ownerPubKeyHex.toLowerCase() !== mine) continue
      scripts.set(Utils.toHex(o.lockingScript.toBinary()), ed.tx1RefHex)
    }
  }

  // Pass 2 — for each distinct script, the current UNSPENT outputs are the live holdings (mempool-aware).
  const found: IncomingEdition[] = []
  const seen = new Set<string>()
  for (const [lockHex, tx1RefHex] of scripts) {
    const lockBytes = Utils.toArray(lockHex, 'hex')
    let unspent: Utxo[]
    try { unspent = await provider.getUnspentByScriptHash(wocScriptHash(lockBytes)) } catch { continue }
    const ed = parseEditionAny(LockingScript.fromHex(lockHex))
    if (ed == null) continue
    for (const u of unspent) {
      const key = `${u.txId}:${u.outputIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      let note: SellerNote | null = null
      try { note = readNoteFromTx(await provider.getSourceTransaction(u.txId), tx1RefHex) } catch { /* best-effort */ }
      found.push({
        txId: u.txId, outputIndex: u.outputIndex, lockHex, tx1RefHex,
        terms: { publisherPubKeyHash: ed.terms.publisherPubKeyHash, publisherFeeSats: ed.terms.publisherFeeSats, holderFeeSats: ed.terms.holderFeeSats, tokenSats: u.satoshis ?? PHARLAP_OUTPUT_SATS },
        isV2: ed.isV2, priceSats: ed.priceSats,
        ...(note ? { sellerNote: note } : {}),
        ...(u.height ? { height: u.height } : {}),
      })
    }
  }
  return found
}
