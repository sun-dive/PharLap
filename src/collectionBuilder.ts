// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP collection builder (genesis).
 *
 * A collection is created with two transactions (PLAN.md Addendum C):
 *   TX1 (template): a PushDrop TEMPLATE output (+ optional FILE output) committing all
 *        immutable collection data, locked to the publisher and kept unspent. TX1's txid is
 *        the Collection ID.
 *   TX2 (genesis):  PushDrop TOKEN outputs that reference TX1 by txid, locked to the owner.
 *
 * The low-level `buildTemplateTx` / `buildGenesisTx` are pure and offline (they take explicit
 * funding inputs), so the construction is unit-testable without the network. `createCollection`
 * is the network wrapper that selects funding, builds both txs (TX2 funded by TX1's change),
 * and broadcasts them.
 *
 * Reuses the WhatsOnChain client (walletProvider) and the field codec (tokenCodec) over the
 * raw-key PushDrop template (pushDrop). Verification (lineage, covenant match) is Phase 4.
 */
import { Transaction, P2PKH, SatoshisPerKilobyte, Hash, Utils } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import type { Utxo, WalletProvider } from './walletProvider.ts'
import {
  buildTemplateScript,
  buildFileScript,
  buildStorefrontScript,
  buildTokenScript,
  encodeTokenRules,
  classifyRecord,
} from './tokenCodec.ts'
import type { TemplateFields, FileFields, StorefrontFields } from './tokenCodec.ts'

/** Satoshi value of each PushDrop record output (token / template / file). */
export const PHARLAP_OUTPUT_SATS = 1
/** Default fee rate (satoshis per kilobyte) — current BSV standard is 100 sat/KB. */
export const DEFAULT_FEE_PER_KB = 100

export interface FundingInput {
  utxo: Utxo
  sourceTx: Transaction
}

// ─── Funding selection / quarantine ─────────────────────────────────

/**
 * Funding UTXOs safe to spend: never spend a PHAR LAP record output as fee funding.
 * All PHAR LAP outputs are PHARLAP_OUTPUT_SATS (1 sat), so the ≤1-sat quarantine protects
 * them (and any other ≤1-sat token/ordinal). A script-aware quarantine (classifyRecord) is a
 * Phase 5 hardening once UTXO scripts are available from the provider.
 */
export async function getSafeUtxos(provider: WalletProvider): Promise<Utxo[]> {
  const utxos = await provider.getUtxos()
  return utxos.filter(u => u.satoshis > PHARLAP_OUTPUT_SATS)
}

/** Greedy funding selection (largest first) covering `target` satoshis. */
export function selectFunding(utxos: Utxo[], target: number): Utxo[] {
  const sorted = [...utxos].sort((a, b) => b.satoshis - a.satoshis)
  const picked: Utxo[] = []
  let total = 0
  for (const u of sorted) {
    picked.push(u)
    total += u.satoshis
    if (total >= target) return picked
  }
  throw new Error(`Insufficient funds: have ${total} sats, need ~${target}`)
}

/** SHA-256(bytes) as hex — used for the optional template fileHash. */
export function sha256Hex(bytes: number[]): string {
  return Utils.toHex(Hash.sha256(bytes))
}

// ─── TX1: template (+ optional file) ────────────────────────────────

export interface TemplateTxResult {
  tx: Transaction
  tx1Id: string
  templateVout: number
  fileVout: number | null
  storefrontVout: number | null
  changeVout: number | null
  changeSats: number
}

export async function buildTemplateTx(opts: {
  key: PrivateKey
  funding: FundingInput[]
  template: TemplateFields
  file?: FileFields
  /** Optional immutable storefront record (description + optional cover image), TX1-resident. */
  storefront?: StorefrontFields
  outputSats?: number
  feePerKb?: number
}): Promise<TemplateTxResult> {
  const sats = opts.outputSats ?? PHARLAP_OUTPUT_SATS
  const publisherPub = opts.key.toPublicKey().toString()
  const address = opts.key.toAddress()
  const tx = new Transaction()

  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx,
      sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.key),
    })
  }

  tx.addOutput({ lockingScript: buildTemplateScript(publisherPub, opts.template), satoshis: sats })
  const templateVout = 0
  let fileVout: number | null = null
  if (opts.file) {
    fileVout = tx.outputs.length
    tx.addOutput({ lockingScript: buildFileScript(publisherPub, opts.file), satoshis: sats })
  }
  let storefrontVout: number | null = null
  if (opts.storefront) {
    storefrontVout = tx.outputs.length
    tx.addOutput({ lockingScript: buildStorefrontScript(publisherPub, opts.storefront), satoshis: sats })
  }

  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(address), change: true })

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return {
    tx,
    tx1Id: tx.id('hex'),
    templateVout,
    fileVout,
    storefrontVout,
    changeVout: changeSats > 0 ? changeVout : null,
    changeSats,
  }
}

// ─── TX2: genesis mint ──────────────────────────────────────────────

export interface GenesisTxResult {
  tx: Transaction
  tx2Id: string
  tokenVouts: number[]
  changeVout: number | null
  changeSats: number
}

export async function buildGenesisTx(opts: {
  key: PrivateKey
  funding: FundingInput[]
  tx1Id: string
  mintCount: number
  stateData?: string
  outputSats?: number
  feePerKb?: number
}): Promise<GenesisTxResult> {
  if (opts.mintCount < 1) throw new Error('mintCount must be >= 1')
  const sats = opts.outputSats ?? PHARLAP_OUTPUT_SATS
  const ownerPub = opts.key.toPublicKey().toString()
  const address = opts.key.toAddress()
  const stateData = opts.stateData ?? ''
  const tx = new Transaction()

  for (const f of opts.funding) {
    tx.addInput({
      sourceTransaction: f.sourceTx,
      sourceOutputIndex: f.utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(opts.key),
    })
  }

  const tokenVouts: number[] = []
  for (let i = 0; i < opts.mintCount; i++) {
    tokenVouts.push(tx.outputs.length)
    tx.addOutput({
      lockingScript: buildTokenScript(ownerPub, { tx1Ref: opts.tx1Id, stateData }),
      satoshis: sats,
    })
  }

  const changeVout = tx.outputs.length
  tx.addOutput({ lockingScript: new P2PKH().lock(address), change: true })

  await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB))
  await tx.sign()

  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0
  return {
    tx,
    tx2Id: tx.id('hex'),
    tokenVouts,
    changeVout: changeSats > 0 ? changeVout : null,
    changeSats,
  }
}

// ─── createCollection: build both + broadcast ───────────────────────

export interface CollectionParams {
  tokenName: string
  /** Declared supply for tokenRules (0 = unlimited / replicable). */
  supply?: number
  divisibility?: number
  restrictions?: number
  rulesVersion?: number
  /** Covenant script bytes (hex). Empty = no covenant. */
  covenantScript?: string
  file?: { mimeType: string; fileName: string; bytes: number[] }
  /** How many token outputs to mint in TX2. Default: supply if > 0, else 1. */
  mintCount?: number
  /** Initial per-token stateData (hex). */
  initialStateData?: string
  outputSats?: number
  feePerKb?: number
}

export interface CollectionResult {
  collectionId: string // = tx1Id
  tx1Id: string
  tx2Id: string
  tokenOutpoints: Array<{ txId: string; outputIndex: number }>
}

export async function createCollection(
  provider: WalletProvider,
  key: PrivateKey,
  params: CollectionParams,
): Promise<CollectionResult> {
  const sats = params.outputSats ?? PHARLAP_OUTPUT_SATS
  const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB
  const supply = params.supply ?? 1
  const mintCount = params.mintCount ?? (supply > 0 ? supply : 1)

  const template: TemplateFields = {
    tokenName: params.tokenName,
    tokenRules: encodeTokenRules(supply, params.divisibility ?? 0, params.restrictions ?? 0, params.rulesVersion ?? 1),
    covenantScript: params.covenantScript ?? '',
    fileHash: params.file ? sha256Hex(params.file.bytes) : undefined,
  }
  const file: FileFields | undefined = params.file
    ? { mimeType: params.file.mimeType, fileName: params.file.fileName, fileBytes: params.file.bytes }
    : undefined

  // Select funding to cover BOTH txs' outputs + fees (tx.fee() computes exact fees afterwards;
  // selection just needs to pick enough UTXOs, and TX1 must leave enough change to fund TX2).
  // TX1 carries any embedded file, so its fee scales with file size — keep a healthy margin so a
  // large file never eats all the funding and starves the genesis mint.
  const numOutputs = 1 + (file ? 1 : 0) + mintCount
  const tx1Bytes = 400 + (file ? file.fileBytes.length : 0)
  const tx2Bytes = 300 + mintCount * 80
  const estFee = Math.ceil(((tx1Bytes + tx2Bytes) * feePerKb) / 1000)
  // Margin: 10% of the estimate (absorbs file-encoding overhead on big files) or 1000 sat, whichever larger.
  const target = numOutputs * sats + estFee + Math.max(1000, Math.ceil(estFee * 0.1))
  const selected = selectFunding(await getSafeUtxos(provider), target)
  const funding: FundingInput[] = await Promise.all(
    selected.map(async u => ({ utxo: u, sourceTx: await provider.getSourceTransaction(u.txId) })),
  )

  // Build BOTH transactions offline first. Only broadcast once both succeed, so a failure (e.g.
  // insufficient change for the genesis mint) never leaves an orphaned template tx on-chain.
  const t1 = await buildTemplateTx({ key, funding, template, file, outputSats: sats, feePerKb })
  if (t1.changeVout == null) {
    throw new Error('Insufficient funding: the template tx left no change to fund the genesis mint. Add more funds.')
  }
  const t2Funding: FundingInput[] = [
    {
      utxo: { txId: t1.tx1Id, outputIndex: t1.changeVout, satoshis: t1.changeSats, script: '' },
      sourceTx: t1.tx,
    },
  ]
  const t2 = await buildGenesisTx({
    key,
    funding: t2Funding,
    tx1Id: t1.tx1Id,
    mintCount,
    stateData: params.initialStateData ?? '',
    outputSats: sats,
    feePerKb,
  })

  // Both built — broadcast TX1 then TX2.
  await provider.broadcast(t1.tx.toHex())
  provider.registerPendingTx(
    t1.tx1Id,
    selected.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
    { outputIndex: t1.changeVout, satoshis: t1.changeSats },
  )
  await provider.broadcast(t2.tx.toHex())
  provider.registerPendingTx(
    t2.tx2Id,
    [{ txId: t1.tx1Id, outputIndex: t1.changeVout }],
    t2.changeVout != null ? { outputIndex: t2.changeVout, satoshis: t2.changeSats } : undefined,
  )

  return {
    collectionId: t1.tx1Id,
    tx1Id: t1.tx1Id,
    tx2Id: t2.tx2Id,
    tokenOutpoints: t2.tokenVouts.map(v => ({ txId: t2.tx2Id, outputIndex: v })),
  }
}

// Re-export for convenience at call sites.
export { classifyRecord }
