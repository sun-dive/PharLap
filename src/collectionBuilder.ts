// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
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
  RESTRICTION_ENCRYPTED,
  RESTRICTION_COMPRESSED,
  buildMockupScript,
} from './tokenCodec.ts'
import type { TemplateFields, FileFields, StorefrontFields } from './tokenCodec.ts'
import { compressIfSmaller } from './compress.ts'
import { newContentKey, newKeySalt, encryptContent, wrapContentKey } from './contentCrypto.ts'

/** Satoshi value of each PushDrop record output (token / template / file). */
export const PHARLAP_OUTPUT_SATS = 1
/** Default fee rate (satoshis per kilobyte) — current BSV standard is 100 sat/KB. */
// 101, not 100: the official minimum is 100 sats/KB, and the extra 1 sat/KB is a safety hair so a tx can never
// round or estimate its way *under* the floor. This is NOT ARC's inflated 500 — we hold at the true minimum
// (miners mine 100 sats/KB fine; see [[fee-rate-policy]]); the +1 is belt-and-braces only.
export const DEFAULT_FEE_PER_KB = 101

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
  mockupVout: number | null
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
  /** Optional packed mockup-cover manifest (mockup.ts packCover) — carried as its own TX1 output. */
  mockup?: number[]
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
  let mockupVout: number | null = null
  if (opts.mockup != null && opts.mockup.length > 0) {
    mockupVout = tx.outputs.length
    tx.addOutput({ lockingScript: buildMockupScript(publisherPub, opts.mockup), satoshis: sats })
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
    mockupVout,
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
  /** Tier-1 encrypt the embedded file (Addendum F). Requires `file`. The FILE output holds ciphertext; the
   *  wrapped content key rides in the template so only the publisher's key (and buyers it's shared with) can
   *  decrypt. This is the "encrypted product atom" — never mint a paid design in the clear. */
  encrypt?: boolean
  /** Immutable storefront blurb shown on the collection / sales page (the public "what you're buying" face,
   *  visible even when the content is encrypted). */
  description?: string
  /** Optional public (unencrypted) cover image — the storefront's face. For paid designs this should be the
   *  WATERMARKED PREVIEW, not the clean product (which lives encrypted in the FILE output). */
  cover?: { mimeType: string; fileName: string; bytes: number[] }
  /** Optional public BACK cover image (flippable on the sales page). Requires a front `cover`. */
  backCover?: { mimeType: string; fileName: string; bytes: number[] }
  /** Optional IMMUTABLE licence code (fixed at mint, travels with the coin) — e.g. "TS-COM-1", "CC-BY-4.0", "ARR". */
  license?: string
  /** Optional 64-hex txid pointing at the full licence text minted on-chain. */
  licenseRef?: string
  /** Optional packed mockup-cover manifest (mockup.ts packCover) — a TX1 output; the curator composites the
   *  public cover onto the referenced prop. */
  mockupManifest?: number[]
  /** How many token outputs to mint in TX2. Default: supply if > 0, else 1. */
  mintCount?: number
  /** Initial per-token stateData (hex). */
  initialStateData?: string
  outputSats?: number
  feePerKb?: number
  /** Optional spend gate: called with the EXACT total sats to be spent (built tx fee + outputs, minus change)
   *  AFTER both txs are built but BEFORE broadcast. Return false to abort (throws SPEND_CANCELLED). */
  confirmSpend?: (totalSats: number) => boolean | Promise<boolean>
}

/** Thrown by a builder when the caller's confirmSpend gate returns false — nothing was broadcast. */
export const SPEND_CANCELLED = 'SPEND_CANCELLED'

/** Net sats leaving the wallet for a flow = the selected funding minus the final change output. */
export function spentSats(selected: Array<{ satoshis: number }>, finalChangeSats: number): number {
  return selected.reduce((s, u) => s + u.satoshis, 0) - finalChangeSats
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

  // Smart-compress (keep only if smaller), then optionally Tier-1 encrypt. Order matters: compress BEFORE
  // encrypt (ciphertext is incompressible). The FILE output stores the final bytes; fileHash binds them.
  // Unlike the covenant edition path this does NOT set RESTRICTION_REPLICABLE — a capped/limited mint has a
  // fixed supply, not unlimited replication.
  const encrypt = params.encrypt === true && params.file != null
  let storedBytes = params.file?.bytes
  let compressed = false
  let wrappedKey: number[] | undefined
  let keySalt: number[] | undefined
  if (params.file != null) {
    const z = await compressIfSmaller(params.file.bytes, params.file.mimeType, params.file.fileName)
    storedBytes = z.bytes
    compressed = z.compressed
    if (encrypt) {
      const K = newContentKey()
      keySalt = newKeySalt()
      storedBytes = encryptContent(storedBytes, K)
      wrappedKey = wrapContentKey(K, keySalt)
    }
  }
  const restrictions = (params.restrictions ?? 0) | (encrypt ? RESTRICTION_ENCRYPTED : 0) | (compressed ? RESTRICTION_COMPRESSED : 0)

  const template: TemplateFields = {
    tokenName: params.tokenName,
    tokenRules: encodeTokenRules(supply, params.divisibility ?? 0, restrictions, params.rulesVersion ?? 1),
    covenantScript: params.covenantScript ?? '',
    // PUBLIC content binds the plaintext hash (provenance); ENCRYPTED content binds the ciphertext hash (privacy —
    // a public plaintext hash would be a confirmation oracle). Mirrors the edition path.
    fileHash: params.file == null ? undefined : encrypt ? sha256Hex(storedBytes!) : sha256Hex(params.file.bytes),
    wrappedKey,
    keySalt,
    license: params.license,
    licenseRef: params.licenseRef,
  }
  const file: FileFields | undefined = params.file
    ? { mimeType: params.file.mimeType, fileName: params.file.fileName, fileBytes: storedBytes! }
    : undefined

  // Immutable storefront record (description + optional public cover/back-cover), carried as a TX1 output — the
  // public "what you're buying" face, shown even when the content is encrypted. For paid designs the cover is the
  // WATERMARKED PREVIEW (the clean product stays encrypted in the FILE output).
  const hasStorefront = (params.description != null && params.description.length > 0) || params.cover != null
  const storefront: StorefrontFields | undefined = hasStorefront
    ? {
        description: params.description ?? '',
        coverMimeType: params.cover?.mimeType,
        coverFileName: params.cover?.fileName,
        coverBytes: params.cover?.bytes,
        // A back cover only makes sense alongside a front cover (the codec keys "has back" off the bytes).
        backCoverMimeType: params.cover != null ? params.backCover?.mimeType : undefined,
        backCoverFileName: params.cover != null ? params.backCover?.fileName : undefined,
        backCoverBytes: params.cover != null ? params.backCover?.bytes : undefined,
      }
    : undefined

  // Select funding to cover BOTH txs' outputs + fees (tx.fee() computes exact fees afterwards;
  // selection just needs to pick enough UTXOs, and TX1 must leave enough change to fund TX2).
  // TX1 carries any embedded file, so its fee scales with file size — keep a healthy margin so a
  // large file never eats all the funding and starves the genesis mint.
  const numOutputs = 1 + (file ? 1 : 0) + (storefront ? 1 : 0) + (params.mockupManifest?.length ? 1 : 0) + mintCount
  const tx1Bytes = 400 + (file ? file.fileBytes.length : 0)
    + (params.cover ? params.cover.bytes.length : 0)
    + (params.backCover ? params.backCover.bytes.length : 0)
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
  const t1 = await buildTemplateTx({ key, funding, template, file, storefront, mockup: params.mockupManifest, outputSats: sats, feePerKb })
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

  // Spend gate (exact total now known): give the caller a chance to confirm before any sats move.
  if (params.confirmSpend != null && !(await params.confirmSpend(spentSats(selected, t2.changeSats)))) {
    throw new Error(SPEND_CANCELLED)
  }

  // Both built — broadcast TX1, wait until it's actually visible in a relay mempool, THEN TX2 (which spends TX1's
  // change). The awaitSeen gate stops TX2 racing ahead of its unconfirmed parent → "Missing inputs"; it throws
  // (aborting) if TX1 never surfaces, so there's no orphaned TX2. See walletProvider.awaitInMempool.
  await provider.broadcast(t1.tx.toHex(), { awaitSeen: true })
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
