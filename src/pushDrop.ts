// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP — lightweight raw-key PushDrop script template.
 *
 * A PushDrop output is a *spendable* P2PK output that also carries arbitrary data
 * fields, which are pushed and then dropped:
 *
 *     <pubkey> OP_CHECKSIG <field0> <field1> ... <fieldN-1> [OP_2DROP ...] [OP_DROP]
 *
 * Because the data lives in the locking script of a spendable output, it stays in
 * the UTXO set and is NOT prunable (unlike OP_RETURN). This is the core reason
 * PHAR LAP moves token metadata here. See PLAN.md / BRC-48.
 *
 * This is a *raw-key* re-implementation of the @bsv/sdk `PushDrop` template, which is
 * built around the BRC-100 `WalletInterface` (protocolID/keyID/counterparty). PHAR LAP
 * signs with a raw `PrivateKey`, matching the rest of the wallet, and keeps the
 * dependency surface to @bsv/sdk only.
 *
 * Layout note: we use the SDK's "lock-before" ordering (pubkey + OP_CHECKSIG first,
 * then the dropped fields). This matches `@bsv/sdk`'s `PushDrop.decode`, so the
 * encoding semantics are battle-tested. The minimal-push encoding and OP_DROP/OP_2DROP
 * bundling below are ported from that template.
 *
 * The fields themselves are opaque here — the token field layout (prefix, version,
 * name, rules, ...) is defined in `tokenCodec.ts` (Phase 2).
 */
import {
  LockingScript,
  UnlockingScript,
  OP,
  TransactionSignature,
  PublicKey,
  Utils,
  Hash,
} from '@bsv/sdk'
import type { PrivateKey, Transaction, Script } from '@bsv/sdk'

interface ScriptChunk {
  op: number
  data?: number[]
}

/**
 * Minimally-encoded push for a data field — required because BSV consensus (and the
 * SDK `Spend` interpreter) enforce MINIMALPUSH: a 1-byte value 1..16 must use OP_1..OP_16,
 * an empty push must use OP_0, etc. Ported verbatim from @bsv/sdk's PushDrop template.
 *
 * Caveat (round-trip): an empty field `[]` and a single zero byte `[0]` both encode to
 * OP_0 and both decode back to `[0]`. The token codec (Phase 2) must account for this
 * rather than relying on truly-empty fields.
 */
export function minimalPushChunk(data: number[]): ScriptChunk {
  if (data.length === 0) return { op: OP.OP_0 }
  if (data.length === 1 && data[0] === 0) return { op: OP.OP_0 }
  if (data.length === 1 && data[0] >= 1 && data[0] <= 16) return { op: 0x50 + data[0] } // OP_1..OP_16
  if (data.length === 1 && data[0] === 0x81) return { op: OP.OP_1NEGATE }
  if (data.length <= 75) return { op: data.length, data }
  if (data.length <= 255) return { op: OP.OP_PUSHDATA1, data }
  if (data.length <= 65535) return { op: OP.OP_PUSHDATA2, data }
  return { op: OP.OP_PUSHDATA4, data }
}

/** Append the correct run of OP_2DROP / OP_DROP to drop exactly `count` stack items. */
function appendDrops(chunks: ScriptChunk[], count: number): void {
  let notYetDropped = count
  while (notYetDropped > 1) {
    chunks.push({ op: OP.OP_2DROP })
    notYetDropped -= 2
  }
  if (notYetDropped === 1) chunks.push({ op: OP.OP_DROP })
}

/**
 * Build a PushDrop locking script: `<pubkey> OP_CHECKSIG <fields...> [drops]`.
 *
 * @param pubKeyHex Compressed (33-byte) or uncompressed (65-byte) public key, hex.
 * @param fields    The data fields to embed (opaque bytes; token layout lives in tokenCodec).
 */
export function lock(pubKeyHex: string, fields: number[][]): LockingScript {
  const pub = Utils.toArray(pubKeyHex, 'hex')
  if (pub.length !== 33 && pub.length !== 65) {
    throw new Error(`pushDrop.lock: public key must be 33 or 65 bytes, got ${pub.length}`)
  }
  const chunks: ScriptChunk[] = [
    { op: pub.length, data: pub },
    { op: OP.OP_CHECKSIG },
    ...fields.map(minimalPushChunk),
  ]
  appendDrops(chunks, fields.length)
  return new LockingScript(chunks)
}

export interface PushDropUnlockOptions {
  /** Output-signing scope. Default 'all'. */
  signOutputs?: 'all' | 'none' | 'single'
  /** Set the ANYONECANPAY flag so other inputs may be added after signing. Default false. */
  anyoneCanPay?: boolean
  /** Satoshis of the output being spent. Falls back to input.sourceTransaction. */
  sourceSatoshis?: number
  /** Locking script of the output being spent. Falls back to input.sourceTransaction. */
  lockingScript?: LockingScript
}

/**
 * Build an unlocking-script template for spending a PushDrop output. The spend is
 * P2PK-style: the unlocking script is simply `<sig>` (the pubkey is in the lock).
 *
 * Mirrors @bsv/sdk's P2PKH/PushDrop signing (FORKID sighash preimage via
 * `TransactionSignature.format`, signed over `sha256(preimage)` — `PrivateKey.sign`
 * applies SHA-256 again, giving the correct Bitcoin double-SHA256 digest).
 */
export function unlock(privateKey: PrivateKey, options: PushDropUnlockOptions = {}) {
  const { signOutputs = 'all', anyoneCanPay = false } = options
  return {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      let scope = TransactionSignature.SIGHASH_FORKID
      if (signOutputs === 'all') scope |= TransactionSignature.SIGHASH_ALL
      else if (signOutputs === 'none') scope |= TransactionSignature.SIGHASH_NONE
      else if (signOutputs === 'single') scope |= TransactionSignature.SIGHASH_SINGLE
      if (anyoneCanPay) scope |= TransactionSignature.SIGHASH_ANYONECANPAY

      const input = tx.inputs[inputIndex]
      const otherInputs = tx.inputs.filter((_, i) => i !== inputIndex)
      const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
      if (sourceTXID == null || sourceTXID === '') {
        throw new Error('pushDrop.unlock: input.sourceTXID or input.sourceTransaction is required')
      }
      const sourceSatoshis =
        options.sourceSatoshis ??
        input.sourceTransaction?.outputs[input.sourceOutputIndex]?.satoshis
      if (sourceSatoshis == null) {
        throw new Error('pushDrop.unlock: sourceSatoshis or input.sourceTransaction is required')
      }
      const lockingScript =
        options.lockingScript ??
        input.sourceTransaction?.outputs[input.sourceOutputIndex]?.lockingScript
      if (lockingScript == null) {
        throw new Error('pushDrop.unlock: lockingScript or input.sourceTransaction is required')
      }

      const preimage = TransactionSignature.format({
        sourceTXID,
        sourceOutputIndex: input.sourceOutputIndex,
        sourceSatoshis,
        transactionVersion: tx.version,
        otherInputs,
        inputIndex,
        outputs: tx.outputs,
        inputSequence: input.sequence ?? 0xffffffff,
        subscript: lockingScript as Script,
        lockTime: tx.lockTime,
        scope,
      })

      const rawSignature = privateKey.sign(Hash.sha256(preimage))
      const sig = new TransactionSignature(rawSignature.r, rawSignature.s, scope)
      const sigForScript = sig.toChecksigFormat()
      return new UnlockingScript([{ op: sigForScript.length, data: sigForScript }])
    },
    estimateLength: async (): Promise<number> => 73, // ~72-byte sig + 1 push byte
  }
}

export interface DecodedPushDrop {
  /** The data fields, in order. */
  fields: number[][]
  /** The locking public key, hex (compressed or uncompressed). */
  pubKeyHex: string
}

/**
 * Decode a PushDrop locking script back into `{ fields, pubKeyHex }`, or `null` if the
 * script is not a well-formed PushDrop output. Mirrors @bsv/sdk's `PushDrop.decode`
 * field normalization (OP_0 → [0], OP_1..16 → [n], OP_1NEGATE → [0x81]) and is robust to
 * malformed input.
 *
 * Expected layout: `<pubkey> OP_CHECKSIG <field...> [OP_2DROP ...] [OP_DROP]`.
 */
export function decode(script: LockingScript): DecodedPushDrop | null {
  const chunks = script.chunks
  if (chunks == null || chunks.length < 2) return null

  // chunks[0] = pubkey push, chunks[1] = OP_CHECKSIG
  const pubData = chunks[0].data
  if (pubData == null || (pubData.length !== 33 && pubData.length !== 65)) return null
  if (chunks[1].op !== OP.OP_CHECKSIG) return null
  let pubKeyHex: string
  try {
    pubKeyHex = PublicKey.fromString(Utils.toHex(pubData)).toString()
  } catch {
    return null
  }

  const fields: number[][] = []
  for (let i = 2; i < chunks.length; i++) {
    const op = chunks[i].op
    // A drop opcode marks the end of the fields section.
    if (op === OP.OP_DROP || op === OP.OP_2DROP) break
    let data = chunks[i].data ?? []
    if (data.length === 0) {
      if (op >= 0x51 && op <= 0x60) data = [op - 0x50] // OP_1..OP_16
      else if (op === OP.OP_0) data = [0]
      else if (op === OP.OP_1NEGATE) data = [0x81]
      else return null // unexpected non-data opcode inside the fields section
    }
    fields.push(data)
  }
  return { fields, pubKeyHex }
}
