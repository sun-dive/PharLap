// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP — miner-enforced covenant scripts, built on the OP_PUSH_TX primitive (`./pushtx`).
 *
 * The covenant verifies the spending transaction's sighash preimage in-script (so it is provably
 * genuine), then reads `hashOutputs` from the preimage and forces the spending tx to contain a
 * specific set of outputs — by reconstructing those outputs and asserting
 * `HASH256(reconstructed) == hashOutputs`. The spender may append arbitrary trailing outputs
 * (their own change), which they supply in the unlocking script; they cannot alter the enforced
 * prefix.
 *
 * Layers (built incrementally, each validated against the @bsv/sdk 2.x `Spend` interpreter):
 *   L1 — enforce a fixed-bytes output prefix + spender-supplied trailing outputs.  ← this file
 *   L2 — reconstruct the "token returned to holder" output from the script's own bytes (quine).
 *   L3 — reconstruct the buyer's replica output (same covenant, buyer's pubkey substituted).
 *   L4 — creator-fee + holder-fee P2PKH outputs (Addendum A edition-mint layout).
 *   L5 — transfer/replicate branching + wiring into tokenCodec/collectionBuilder.
 */
import { OP, type ScriptChunk } from '@bsv/sdk'
import { pushTxVerifyOps, pushData, type PushTxConstants, pushTxConstants } from './pushtx.ts'

const op = (code: number): ScriptChunk => ({ op: code })

/** Little-endian 8-byte satoshi amount. */
export function u64le(n: number): number[] {
  const out: number[] = []
  let v = n
  for (let i = 0; i < 8; i++) { out.push(v & 0xff); v = Math.floor(v / 256) }
  return out
}

/** Bitcoin var-int (CompactSize). */
export function varInt(n: number): number[] {
  if (n < 0xfd) return [n]
  if (n <= 0xffff) return [0xfd, n & 0xff, (n >> 8) & 0xff]
  if (n <= 0xffffffff) return [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
  throw new Error('varInt: value too large')
}

/** Serialize a tx output exactly as it appears inside hashOutputs: value(8 LE) ‖ varint(len) ‖ script. */
export function serializeOutput(satoshis: number, scriptBytes: number[]): number[] {
  return [...u64le(satoshis), ...varInt(scriptBytes.length), ...scriptBytes]
}

/**
 * Op fragment: consumes the verified preimage on top of the stack and leaves `hashOutputs` (32 bytes).
 * hashOutputs sits at preimage bytes [len-40, len-8): the trailing 52 bytes are
 * value(8) ‖ nSequence(4) ‖ hashOutputs(32) ‖ nLocktime(4) ‖ sighashType(4).
 */
export function extractHashOutputsOps(): ScriptChunk[] {
  return [
    op(OP.OP_SIZE), pushData([40]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP), // tail 40 bytes
    pushData([32]), op(OP.OP_SPLIT), op(OP.OP_DROP),                               // first 32 = hashOutputs
  ]
}

/**
 * L1 covenant body. Stack on entry (top last): [ spenderOutputs, preimage ].
 *   - `spenderOutputs` = serialized trailing outputs the spender is free to choose (their change).
 *   - `preimage`       = the sighash preimage of this input.
 * Leaves a boolean: true iff the spending tx's outputs are exactly
 *   `enforcedPrefixBytes ‖ spenderOutputs`.
 */
export function outputPrefixCovenantOps(enforcedPrefixBytes: number[], c: PushTxConstants = pushTxConstants()): ScriptChunk[] {
  return [
    ...pushTxVerifyOps(c),        // [ spenderOutputs, preimage ]  (preimage verified genuine)
    ...extractHashOutputsOps(),   // [ spenderOutputs, hashOutputs ]
    op(OP.OP_SWAP),               // [ hashOutputs, spenderOutputs ]
    pushData(enforcedPrefixBytes),// [ hashOutputs, spenderOutputs, prefix ]
    op(OP.OP_SWAP), op(OP.OP_CAT),// [ hashOutputs, prefix ‖ spenderOutputs ]
    op(OP.OP_HASH256),            // [ hashOutputs, HASH256(expected) ]
    op(OP.OP_EQUAL),              // [ bool ]
  ]
}
