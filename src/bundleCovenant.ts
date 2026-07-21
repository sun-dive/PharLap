// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP — Bundle covenant (NEW, standalone; does NOT modify the edition covenant).
 *
 * A bundle coin is a single covenant UTXO that resells a BUNDLE of on-chain assets and, on EVERY resale,
 * pays each referenced component's ORIGINAL creator — a fixed payout bound to that component's immutable
 * genesis address. One coin pays many, so there is no multi-coin "output 0" conflict.
 *
 * It reuses the shipped covenant primitives (OP_PUSH_TX introspection + the quine self-replication in
 * `./covenant`) and simply generalizes the edition's single publisher-fee output to an N-payee,
 * genesis-bound list. The resale forces:
 *
 *   out0      = the bundle coin re-locked to the SAME covenant, with the NEW holder pubkey  (bond value)
 *   out1..N   = P2PKH(creatorAddr_i) paying feeSats_i                                       (genesis-bound)
 *   out(N+1)+ = the spender's change                                                        (free)
 *
 * and checks `HASH256(out0 ‖ fee_1 ‖ … ‖ fee_N ‖ change) == hashOutputs`. The current holder must sign.
 *
 * NOT yet wired into the app. The mint flow (bake genesis-verified payees), the wallet verify pass
 * (confirm each payout address == its component's genesis publisher), the resale/marketplace plumbing,
 * and two deferred knobs (publisher-set bond; referencing a component's CURRENT price) come later.
 * Full design + rationale: ~/Documents/bundle-covenant-design.md.
 */
import { OP, LockingScript, type ScriptChunk } from '@bsv/sdk'
import { pushData, pushTxConstants, type PushTxConstants } from './pushtx.ts'
import { covenantPrefixOps, serializeOutput, p2pkhScript, u64le, EDITION_SCOPE } from './covenant.ts'

const op = (code: number): ScriptChunk => ({ op: code })

/** Record byte marking a bundle covenant (distinct from the edition RECORD). */
export const RECORD_BUNDLE = 0x0b
/** Byte offset of the 33-byte holder pubkey within the bundle script.
 *  P(2)+ver(2)+record(2)+manifestRef(33)+ownerPushOpcode(1) = 40 (same field layout as the edition). */
export const BUNDLE_OWNER_OFFSET = 40

/** One genesis-bound creator payout: pay `feeSats` to `pubKeyHash` — the component's immutable publisher address. */
export interface BundlePayee { pubKeyHash: number[]; feeSats: number }

export interface BundleParams {
  /** 32-byte reference to the bundle's manifest (e.g. the .bmf content hash). Committed, part of the quine. */
  manifestRef: number[]
  /** 33-byte current holder (owner) pubkey — the quine's mutable slot. */
  ownerPubKey: number[]
  /** Genesis-bound creator payouts, forced on every resale. */
  payees: BundlePayee[]
  /** Satoshis carried on the bundle coin (the publisher-set bond). Default 1. */
  tokenSats?: number
  /** Offset of the owner pubkey within the scriptCode FIELD (varIntSize + BUNDLE_OWNER_OFFSET). */
  fieldPubkeyOffset: number
  c?: PushTxConstants
}

/**
 * Resale tail. Stack on entry (after `covenantPrefixOps`):
 *   [ change, newOwnerPub, ownerSig, pre, ownerPub, suffix ], alt = [ hashOutputs ].
 * Authenticates the current holder, rebuilds out0 (self-replica with the new holder), forces the N fixed
 * creator-fee outputs, appends the spender's change, and asserts `HASH256(expected) == hashOutputs`.
 * (Generalizes `transferTailOps` from one publisher fee to N genesis-bound creator fees.)
 */
export function bundleTailOps(payees: BundlePayee[], tokenSats = 1): ScriptChunk[] {
  const VALUE1 = u64le(tokenSats)
  const feeCats: ScriptChunk[] = []
  for (const pe of payees) feeCats.push(pushData(serializeOutput(pe.feeSats, p2pkhScript(pe.pubKeyHash))), op(OP.OP_CAT))
  return [
    // authenticate the current holder: <ownerSig> <ownerPub> OP_CHECKSIGVERIFY
    pushData([1]), op(OP.OP_PICK),                 // copy ownerPub (extracted from scriptCode)
    pushData([4]), op(OP.OP_PICK),                 // copy ownerSig (from the unlock)
    op(OP.OP_SWAP), op(OP.OP_CHECKSIGVERIFY),
    // out0 = VALUE1 ‖ pre ‖ newOwnerPub ‖ suffix   (bundle re-locked to the new holder)
    pushData(VALUE1),
    pushData([3]), op(OP.OP_PICK), op(OP.OP_CAT),  // ‖ pre
    pushData([5]), op(OP.OP_PICK), op(OP.OP_CAT),  // ‖ newOwnerPub
    pushData([1]), op(OP.OP_PICK), op(OP.OP_CAT),  // ‖ suffix → out0
    ...feeCats,                                    // ‖ FEE_1 ‖ … ‖ FEE_N (constant, genesis-bound)
    pushData([6]), op(OP.OP_ROLL), op(OP.OP_CAT),  // ‖ change → expected
    op(OP.OP_TOALTSTACK), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP),
    op(OP.OP_FROMALTSTACK), op(OP.OP_HASH256),
    op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  ]
}

/** The full bundle locking-script op list: committed state fields (dropped at runtime), the covenant prefix, the tail. */
export function bundleLockOps(p: BundleParams): ScriptChunk[] {
  const c = p.c ?? pushTxConstants(EDITION_SCOPE)
  return [
    pushData([0x50]), pushData([0x03]), pushData([RECORD_BUNDLE]), pushData(p.manifestRef), pushData(p.ownerPubKey),
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP), // 5 state fields — present in the script bytes (quine), no-op at runtime
    ...covenantPrefixOps(p.fieldPubkeyOffset, c),
    ...bundleTailOps(p.payees, p.tokenSats),
  ]
}

/** Build the bundle locking script, computing the holder-pubkey offset from the fixed field layout
 *  (two-pass, like `buildEditionLock`: the offset push is a stable width, so the scriptCode varint is stable). */
export function buildBundleLock(p: Omit<BundleParams, 'fieldPubkeyOffset'>): LockingScript {
  const probeLen = new LockingScript(bundleLockOps({ ...p, fieldPubkeyOffset: 1 })).toBinary().length
  const varIntSize = probeLen < 253 ? 1 : probeLen < 65536 ? 3 : 5
  return new LockingScript(bundleLockOps({ ...p, fieldPubkeyOffset: varIntSize + BUNDLE_OWNER_OFFSET }))
}

/** Unlock a bundle resale. Stack it leaves (bottom→top): change, newOwnerPub, ownerSig, preimage. */
export function bundleTransferUnlockChunks(p: { newOwnerPubKey: number[]; ownerSig: number[]; change: number[]; preimage: number[] }): ScriptChunk[] {
  return [pushData(p.change), pushData(p.newOwnerPubKey), pushData(p.ownerSig), pushData(p.preimage)]
}

/** Swap the 33-byte holder pubkey in a copy of a bundle script (the quine's mutable slot) — used to build out0. */
export function swapBundleOwner(lockBytes: number[], newOwnerPub: number[]): number[] {
  const out = [...lockBytes]
  for (let i = 0; i < 33; i++) out[BUNDLE_OWNER_OFFSET + i] = newOwnerPub[i]
  return out
}
