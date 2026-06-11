// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP — optimal OP_PUSH_TX primitive (transaction introspection in Bitcoin Script).
 *
 * BSV has no OP_CHECKDATASIG and no native "push the sighash" opcode, so to let a locking script
 * inspect the transaction that spends it we use the classic "optimal OP_PUSH_TX" trick:
 *
 *   1. The UNLOCK pushes the BIP143/FORKID sighash *preimage* of the spending input.
 *   2. The LOCK computes  e = HASH256(preimage)  and, using a fixed PUBLIC keypair (a, k),
 *      derives a valid ECDSA signature  s = k⁻¹·(e + r·a) mod n  (with r = (k·G).x mod n),
 *      assembles it as minimal DER, and verifies it with OP_CHECKSIG against Q = a·G.
 *
 * OP_CHECKSIG independently recomputes the sighash from the *actual* transaction, so the spend
 * only validates when HASH256(pushed preimage) == actual sighash — i.e. the spender is FORCED to
 * push the genuine preimage. Having proven it genuine, the covenant can OP_SPLIT the preimage to
 * read hashOutputs / value / nLocktime etc. and enforce arbitrary rules on the spending tx.
 *
 * Security note: (a, k) are PUBLIC, fixed constants — they protect nothing. Reusing k across spends
 * (which would be catastrophic for a secret key) is harmless here because there is no secret: the
 * covenant's security rests entirely on the preimage binding above, not on key secrecy.
 *
 * Chronicle (tx version > 1) makes this tractable: low-S is no longer enforced (so we never need to
 * normalise s) and big-integer arithmetic is available. Signature DER encoding, however, is STILL
 * enforced, so s must be MINIMAL DER. We get that for free: a positive script-number's minimal
 * little-endian form, byte-reversed, IS minimal big-endian DER content — so we OP_NUM2BIN s to a
 * fixed 33 bytes, reverse (fixed-length), then OP_SPLIT off the leading zero bytes at the runtime
 * index (33 − OP_SIZE(s)). No variable-length reversal required.
 *
 * Validated against the @bsv/sdk 2.x `Spend` interpreter with transactionVersion = 2.
 */
import { BigNumber, Curve, PrivateKey, TransactionSignature, OP as OPCODES, type ScriptChunk } from '@bsv/sdk'

const SIGHASH_ALL_FORKID = 0x41 // SIGHASH_ALL | SIGHASH_FORKID

/** Fixed, PUBLIC constants for the introspection key. Arbitrary valid scalars (see security note). */
const A_HEX = '11'.repeat(32)
const K_HEX = '22'.repeat(32)

export interface PushTxConstants {
  /** Compressed pubkey Q = a·G (33 bytes). */
  Qbytes: number[]
  /** Precomputed DER integer for the constant r: `0x02 <len> <rBE>`. */
  rDerInt: number[]
  /** Script-number (LE) encodings of the modular constants. */
  raLE: number[]
  nLE: number[]
  kInvLE: number[]
  /** Sighash type byte appended to the derived signature. */
  scope: number
}

function toScriptNumLE(bn: BigNumber): number[] {
  if (bn.isZero()) return []
  const le = bn.toArray('le') as number[]
  if ((le[le.length - 1] & 0x80) !== 0) le.push(0x00) // sign byte keeps it positive
  return le
}

function minimalBE(bn: BigNumber): number[] {
  const be = bn.toArray('be') as number[]
  if ((be[0] & 0x80) !== 0) be.unshift(0x00)
  return be
}

/** Compute the fixed introspection constants for a given sighash scope. Deterministic. */
export function pushTxConstants(scope: number = SIGHASH_ALL_FORKID): PushTxConstants {
  const curve = new Curve()
  const n = curve.n
  const aKey = PrivateKey.fromString(A_HEX, 16)
  const kKey = PrivateKey.fromString(K_HEX, 16)
  const a = new BigNumber(aKey.toArray())
  const k = new BigNumber(kKey.toArray())
  const r = kKey.toPublicKey().x!.umod(n)
  const rBE = minimalBE(r)
  return {
    Qbytes: aKey.toPublicKey().encode(true) as number[],
    rDerInt: [0x02, rBE.length, ...rBE],
    raLE: toScriptNumLE(r.mul(a).umod(n)),
    nLE: toScriptNumLE(n),
    kInvLE: toScriptNumLE(k.invm(n)),
    scope,
  }
}

const op = (code: number): ScriptChunk => ({ op: code })
function push(data: number[]): ScriptChunk {
  if (data.length < 76) return { op: data.length, data }
  if (data.length < 256) return { op: OPCODES.OP_PUSHDATA1, data }
  if (data.length < 65536) return { op: OPCODES.OP_PUSHDATA2, data }
  return { op: OPCODES.OP_PUSHDATA4, data }
}

/** Op fragment that reverses the top stack item, assuming it is exactly `len` bytes. */
export function reverseBytesOps(len: number): ScriptChunk[] {
  const ops: ScriptChunk[] = []
  for (let i = 0; i < len - 1; i++) ops.push(op(OPCODES.OP_1), op(OPCODES.OP_SPLIT))
  for (let i = 0; i < len - 1; i++) ops.push(op(OPCODES.OP_SWAP), op(OPCODES.OP_CAT))
  return ops
}

/**
 * Op fragment: consumes a preimage on top of the stack and leaves the derived ECDSA signature
 * (DER + sighash byte) on top. Does NOT run OP_CHECKSIG.
 */
export function deriveSigOps(c: PushTxConstants): ScriptChunk[] {
  return [
    // e = HASH256(preimage) as a positive script number (reverse BE→LE, append sign byte, minimise)
    op(OPCODES.OP_HASH256), ...reverseBytesOps(32), push([0x00]), op(OPCODES.OP_CAT), op(OPCODES.OP_BIN2NUM),
    // s = k⁻¹·((e + r·a) mod n) mod n
    push(c.raLE), op(OPCODES.OP_ADD), push(c.nLE), op(OPCODES.OP_MOD),
    push(c.kInvLE), op(OPCODES.OP_MUL), push(c.nLE), op(OPCODES.OP_MOD),
    // s (LE number) → minimal-DER integer: NUM2BIN(33) → reverse → strip leading zeros at 33−size
    op(OPCODES.OP_SIZE), push([33]), op(OPCODES.OP_SWAP), op(OPCODES.OP_SUB), op(OPCODES.OP_TOALTSTACK),
    push([33]), op(OPCODES.OP_NUM2BIN), ...reverseBytesOps(33),
    op(OPCODES.OP_FROMALTSTACK), op(OPCODES.OP_SPLIT), op(OPCODES.OP_NIP),
    op(OPCODES.OP_SIZE), op(OPCODES.OP_SWAP), op(OPCODES.OP_CAT), // <len> ++ sBE
    push([0x02]), op(OPCODES.OP_SWAP), op(OPCODES.OP_CAT),        // 0x02 ++ <len> ++ sBE
    // assemble full sig: 0x30 <bodylen> rDerInt sDerInt <scope>
    push(c.rDerInt), op(OPCODES.OP_SWAP), op(OPCODES.OP_CAT),
    op(OPCODES.OP_SIZE), op(OPCODES.OP_SWAP), op(OPCODES.OP_CAT),
    push([0x30]), op(OPCODES.OP_SWAP), op(OPCODES.OP_CAT),
    push([c.scope]), op(OPCODES.OP_CAT),
  ]
}

/**
 * Standalone primitive: consumes a preimage and leaves a boolean (OP_CHECKSIG result).
 * Useful for tests; covenants normally use `pushTxVerifyOps` to keep the preimage for inspection.
 */
export function pushTxCheckOps(c: PushTxConstants = pushTxConstants()): ScriptChunk[] {
  return [...deriveSigOps(c), push(c.Qbytes), op(OPCODES.OP_CHECKSIG)]
}

/**
 * Covenant primitive: asserts the preimage is genuine and LEAVES IT on the stack for further
 * inspection. Expects the preimage on top; on success the stack top is the (verified) preimage.
 */
export function pushTxVerifyOps(c: PushTxConstants = pushTxConstants()): ScriptChunk[] {
  return [
    op(OPCODES.OP_DUP),
    ...deriveSigOps(c),
    push(c.Qbytes), op(OPCODES.OP_CHECKSIG), op(OPCODES.OP_VERIFY),
  ]
}

export interface PreimageParams {
  sourceTXID: string
  sourceOutputIndex: number
  sourceSatoshis: number
  transactionVersion: number
  inputIndex: number
  /** The locking script being spent (the covenant script). */
  subscript: { toBinary: () => number[] } | unknown
  outputs: unknown[]
  inputSequence: number
  lockTime: number
  otherInputs?: unknown[]
  scope?: number
}

/** Build the sighash preimage the unlocking script must push. Thin wrapper over the SDK. */
export function pushTxPreimage(p: PreimageParams): number[] {
  return TransactionSignature.format({
    sourceTXID: p.sourceTXID,
    sourceOutputIndex: p.sourceOutputIndex,
    sourceSatoshis: p.sourceSatoshis,
    transactionVersion: p.transactionVersion,
    otherInputs: (p.otherInputs ?? []) as never,
    inputIndex: p.inputIndex,
    outputs: p.outputs as never,
    inputSequence: p.inputSequence,
    subscript: p.subscript as never,
    lockTime: p.lockTime,
    scope: p.scope ?? SIGHASH_ALL_FORKID,
  })
}

/** Helper to push arbitrary data with the correct (minimal) push opcode. */
export const pushData = push
export { SIGHASH_ALL_FORKID }
