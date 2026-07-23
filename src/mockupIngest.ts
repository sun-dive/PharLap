// Mockup-bundle ingest — read a Pole Position mockup `.bmc` bundle and turn its recipe into a packed cover
// manifest for minting. The bundle is a store-only ZIP: base.webp + design.webp (+ optional mask/shade/disp)
// + a readable mockup.json recipe. See PolePosition docs/MOCKUP-SPEC.md and public/mockup-author.js.
//
// The pure pieces live here (read + map, unit-testable). The network orchestration — mint the prop atom once,
// then mint the product with this manifest — is driven by the app (it needs the wallet/provider).
import { Utils } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'
import { readStoreZip } from './bmc.ts'
import { packCover, type MockupCover, type WarpStage } from './mockup.ts'
import { createCollection } from './collectionBuilder.ts'
import { createEdition, type EditionTerms } from './editionBuilder.ts'
import type { WalletProvider } from './walletProvider.ts'

/** The recipe emitted by Pole Position's mockup export (mockup.json). */
export interface MockupRecipe {
  v?: number
  prop?: { name?: string; roles?: Record<string, string>; warp?: WarpStage[] }
  design?: string
  /** Placement in the authoring stage (= base aspect), normalized: centre cx,cy + size w,h + rot° + skew. */
  place?: { cx: number; cy: number; w: number; h: number; rot: number; skewX: number; skewY: number }
  fabric?: number
}

export interface MockupBundle {
  base: number[]
  design: number[]
  maps: { mask?: number[]; shade?: number[]; disp?: number[] }
  recipe: MockupRecipe
}

/** Parse a mockup `.bmc` bundle into its images + recipe, or null if it isn't one. */
export function readMockupBundle(zipBytes: number[]): MockupBundle | null {
  const files = readStoreZip(zipBytes)
  if (files == null || files['mockup.json'] == null) return null
  let recipe: MockupRecipe
  try { recipe = JSON.parse(Utils.toUTF8(files['mockup.json'])) } catch { return null }
  const roles = recipe.prop?.roles ?? {}
  const base = files[roles.base ?? 'base.webp']
  const design = files[recipe.design ?? 'design.webp']
  if (base == null || design == null) return null
  const maps: MockupBundle['maps'] = {}
  for (const role of ['mask', 'shade', 'disp'] as const) {
    const file = roles[role]
    if (file != null && files[file] != null) maps[role] = files[file]
  }
  return { base, design, maps, recipe }
}

/**
 * Map a bundle's recipe → a packed mockup-cover manifest for the product's TX1 output.
 * The design is EMBEDDED (it's the product's own storefront cover), so no design ref. Placement carries over
 * directly: the recipe's normalized centre/size/rot/skew becomes the manifest's x,y,scale,rot,skew. The renderer
 * derives the box height from the design's aspect at render time, so only the width (scale) is stored.
 */
export function bundleToManifest(recipe: MockupRecipe, propTxid: string): number[] {
  const p = recipe.place
  const cover: MockupCover = {
    version: 1,
    prop: { tx: propTxid, index: null },
    design: null, // embedded — the storefront cover
    place: p == null ? null : { x: p.cx, y: p.cy, scale: p.w, rot: p.rot, skewX: p.skewX, skewY: p.skewY, fabric: recipe.fabric ?? 0.8 },
    warp: recipe.prop?.warp ?? null,
  }
  return packCover(cover)
}

/** An image payload for a mint (mimeType + bytes; fileName is filled in). */
export interface ImagePayload { mimeType: string; bytes: number[] }

/**
 * Orchestrate a mockup product mint (network). Two mints:
 *   1. PROP — the base image as a public reusable collection → its txid (skipped if `propTxid` is supplied to
 *      reuse an existing prop; that's the whole point — mint a prop once, reference it forever).
 *   2. PRODUCT — the CLEAN design encrypted in the FILE (what the buyer gets), the PREVIEW design as the public
 *      storefront cover, the licence + tier, and the packed mockup manifest pointing at the prop.
 * v1 mints the product on the plain capped-supply path (Limited/Exclusive); base-only props (procedural warp,
 * e.g. a mug) — map-bearing props (a `.bmc` of base+maps) are a later addition.
 */
export async function mintMockupProduct(provider: WalletProvider, key: PrivateKey, opts: {
  base: number[]
  cleanDesign: ImagePayload
  previewDesign: ImagePayload
  recipe: MockupRecipe
  /** Reuse an existing prop by txid; omit to mint the prop from `base`. */
  propTxid?: string
  propName?: string
  productName: string
  description?: string
  encrypt?: boolean
  license?: string
  /** Capped supply / tier: 1 = exclusive, N = limited. */
  supply?: number
  /** Covenant tier: when set, the PRODUCT mints as a covenant edition (trustless permissionless resale +
   *  publisher/holder fees), instead of a plain capped token. The prop stays a plain referenced asset. */
  covenant?: { terms: EditionTerms }
  feePerKb?: number
  confirmSpend?: (totalSats: number) => boolean | Promise<boolean>
}): Promise<{
  propTxid: string
  productTxid: string
  /** Covenant tier: the minted editions (with lockHex) — store via storeEdition for the onboard flow. */
  editions?: Array<{ txId: string; outputIndex: number; lockHex: string }>
  /** Plain tier: the minted token outpoints — store via the plain token index. */
  tokenOutpoints?: Array<{ txId: string; outputIndex: number }>
}> {
  let propTxid = opts.propTxid
  if (propTxid == null) {
    const prop = await createCollection(provider, key, {
      tokenName: opts.propName ?? opts.recipe.prop?.name ?? 'prop',
      supply: 1, mintCount: 1,
      file: { mimeType: 'image/webp', fileName: 'base.webp', bytes: opts.base },
    })
    propTxid = prop.collectionId
  }
  const manifest = bundleToManifest(opts.recipe, propTxid)
  const supply = opts.supply ?? 1
  const file = { mimeType: opts.cleanDesign.mimeType, fileName: 'design', bytes: opts.cleanDesign.bytes }
  const cover = { mimeType: opts.previewDesign.mimeType, fileName: 'preview', bytes: opts.previewDesign.bytes }

  // Covenant tier: the product is a covenant edition (permissionless resale enforced on-chain, publisher/holder
  // fees), carrying the mockup manifest + preview cover in TX1 exactly like a plain product — so the existing
  // Big Red curator lists AND composites it with no changes. Else a plain capped token (Limited/Exclusive).
  if (opts.covenant) {
    const product = await createEdition(provider, key, {
      tokenName: opts.productName,
      terms: opts.covenant.terms,
      mintCount: supply,
      file, cover,
      encrypt: opts.encrypt,
      description: opts.description,
      license: opts.license,
      mockupManifest: manifest,
      feePerKb: opts.feePerKb,
      confirmSpend: opts.confirmSpend,
    })
    return { propTxid, productTxid: product.collectionId, editions: product.editions }
  }

  const product = await createCollection(provider, key, {
    tokenName: opts.productName,
    supply, mintCount: supply,
    file,
    encrypt: opts.encrypt,
    description: opts.description,
    cover,
    license: opts.license,
    mockupManifest: manifest,
    feePerKb: opts.feePerKb,
    confirmSpend: opts.confirmSpend,
  })
  return { propTxid, productTxid: product.collectionId, tokenOutpoints: product.tokenOutpoints }
}
