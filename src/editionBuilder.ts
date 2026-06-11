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
  Transaction, P2PKH, SatoshisPerKilobyte, Hash, Utils, LockingScript, UnlockingScript, TransactionSignature, PublicKey,
} from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import {
  buildEditionLock, swapEditionOwner, editionOwnerPubKey, p2pkhScript, serializeOutput,
  editionReplicateUnlockChunks, editionTransferUnlockChunks, EDITION_SCOPE, parseEditionScript,
} from './covenant.ts'
import {
  PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, getSafeUtxos, selectFunding, buildTemplateTx, sha256Hex, type FundingInput,
} from './collectionBuilder.ts'
import { encodeTokenRules, RESTRICTION_REPLICABLE, RESTRICTION_ENCRYPTED } from './tokenCodec.ts'
import { newContentKey, newKeySalt, encryptContent, wrapContentKey } from './contentCrypto.ts'
import type { WalletProvider, Utxo } from './walletProvider.ts'

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
  // [1] 1-sat P2PKH notification to the new owner's address — the discovery breadcrumb (the edition
  // covenant output itself is not WoC-address-indexed). Part of the covenant's free "change" region.
  const notifyAddress = PublicKey.fromString(Utils.toHex(opts.newOwnerPubKey)).toAddress()
  tx.addOutput({ lockingScript: new P2PKH().lock(notifyAddress), satoshis: 1 })
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
    creatorPubKeyHash: params.terms.creatorPubKeyHash, creatorFeeSats: params.terms.creatorFeeSats,
    holderFeeSats: params.terms.holderFeeSats, tokenSats,
  })

  // Tier-1 encrypt the file: store ciphertext, carry the wrapped content key + keySalt in the template.
  const encrypt = params.encrypt === true && params.file != null
  let storedBytes = params.file?.bytes
  let wrappedKey: number[] | undefined
  let keySalt: number[] | undefined
  if (encrypt && params.file != null) {
    const K = newContentKey()
    keySalt = newKeySalt()
    storedBytes = encryptContent(params.file.bytes, K)
    wrappedKey = wrapContentKey(K, keySalt)
  }
  const restrictions = RESTRICTION_REPLICABLE | (encrypt ? RESTRICTION_ENCRYPTED : 0)
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

  // Fund both txs. TX1 carries any embedded file, so its fee scales with file size; keep a healthy margin.
  const editionBytes = 800
  const tx1Bytes = 500 + templateLock.toBinary().length + (file ? file.fileBytes.length : 0)
  const tx2Bytes = 300 + mintCount * editionBytes
  const estFee = Math.ceil(((tx1Bytes + tx2Bytes) * feePerKb) / 1000)
  const target = (1 + mintCount) * tokenSats + estFee + Math.max(1000, Math.ceil(estFee * 0.2))
  const selected = selectFunding(await getSafeUtxos(provider), target)
  const funding = await toFundingInputs(provider, selected)

  // Build both offline, broadcast only if both succeed (no orphaned template).
  const t1 = await buildTemplateTx({ key, funding, template, file, outputSats: tokenSats, feePerKb })
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
  // Buyer funds: token + replica sats, both fees, miner fee, margin.
  const estFee = Math.ceil((1500 * feePerKb) / 1000)
  const target = 2 * tokenSats + params.terms.creatorFeeSats + params.terms.holderFeeSats + estFee + 1000
  const selected = selectFunding(await getSafeUtxos(provider), target)
  const funding = await toFundingInputs(provider, selected)

  const rep = await buildReplicateTx({ edition, terms: params.terms, buyerKey, funding, feePerKb })
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

/** Transfer (owner-signed) an on-chain edition to a new owner, re-creating the covenant. */
export async function transferEdition(provider: WalletProvider, ownerKey: PrivateKey, params: {
  editionTxId: string
  editionOutputIndex: number
  editionLockHex: string
  newOwnerPubKey: number[]
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
  const estFee = Math.ceil((1500 * feePerKb) / 1000)
  const selected = selectFunding(await getSafeUtxos(provider), tokenSats + estFee + 1000)
  const funding = await toFundingInputs(provider, selected)

  const xfer = await buildEditionTransferTx({
    edition, ownerKey, newOwnerPubKey: params.newOwnerPubKey, funding, tokenSats, feePerKb,
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

export interface IncomingEdition {
  txId: string
  outputIndex: number
  lockHex: string
  tx1RefHex: string
  terms: EditionTerms
}

/**
 * Find edition covenant outputs locked to `pubKeyHex` by scanning the wallet address history (the
 * transfer notification breadcrumbs land there) and parsing each tx's outputs. Terms are recovered
 * from the covenant script itself, so received editions are fully replicable/transferable.
 */
export async function scanIncomingEditions(provider: WalletProvider, pubKeyHex: string): Promise<IncomingEdition[]> {
  const mine = pubKeyHex.toLowerCase()
  const found: IncomingEdition[] = []
  const seenOutpoint = new Set<string>()
  // Candidate txs: confirmed address history PLUS the txids of current address UTXOs. The latter is
  // mempool-aware (getUtxos includes unconfirmed), so the 1-sat transfer notification surfaces the
  // carrying tx immediately, before it confirms — matching the plain-token scanIncoming.
  const candidateTxIds = new Set<string>()
  try { for (const { txId } of await provider.getAddressHistory()) candidateTxIds.add(txId) } catch { /* best-effort */ }
  try { for (const u of await provider.getUtxos()) candidateTxIds.add(u.txId) } catch { /* best-effort */ }
  for (const txId of candidateTxIds) {
    let tx: Transaction
    try { tx = await provider.getSourceTransaction(txId) } catch { continue }
    tx.outputs.forEach((o, i) => {
      const ed = parseEditionScript(o.lockingScript)
      if (ed == null || ed.ownerPubKeyHex.toLowerCase() !== mine) return
      const key = `${txId}:${i}`
      if (seenOutpoint.has(key)) return
      seenOutpoint.add(key)
      found.push({
        txId, outputIndex: i, lockHex: Utils.toHex(o.lockingScript.toBinary()), tx1RefHex: ed.tx1RefHex,
        terms: { ...ed.terms, tokenSats: o.satoshis ?? PHARLAP_OUTPUT_SATS },
      })
    })
  }
  return found
}
