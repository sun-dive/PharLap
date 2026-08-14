// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * CO-SIGNING — completing a transaction somebody else assembled.
 *
 * Phar Lap's air-gap signer refuses to sign anything it cannot re-derive: it takes a semantic request
 * ("transfer this edition to that pubkey") and REBUILDS the transaction with its own validated builder,
 * so an attacker who tampers with the request cannot make it sign something other than what it read.
 * That rule is right, and this module does not weaken it.
 *
 * But it only works while Phar Lap knows how to build the thing. A covenant it has never heard of —
 * the Bitcoin Battery, and every covenant after it — cannot be rebuilt here, because rebuilding would
 * mean carrying that covenant's script generator. There are two honest responses to that: refuse
 * forever, or find a different way to know what is being signed.
 *
 * ★ THE OBSERVATION THAT MAKES THIS SAFE: a transaction is not an opaque blob.
 *
 * Every satoshi it moves is derivable from its own bytes plus the source transaction of each input.
 * Given those, the fee, the amount leaving this wallet, the amount returning to it, and every output's
 * destination are FACTS to be computed — not claims to be believed. So the summary the signer confirms
 * is one this module derived, and a tampered transaction simply derives a different summary and shows
 * it. Nothing in the request is trusted, which was always the actual requirement; "rebuild it" was one
 * way of meeting it, not the only one.
 *
 * What this still refuses:
 *   - to sign an input that does not pay this wallet's address
 *   - to sign at all when any input's source transaction is missing (without it the fee is unknowable,
 *     and an unknowable fee is precisely how a co-signer gets robbed — see FEE WARNING below)
 *   - to sign when a source transaction does not hash to the txid the input names
 *
 * ⚠ THE FEE WARNING IS THE POINT OF THIS MODULE, not a nicety. A transaction's outputs are fixed by
 * whoever assembled it; the fee is simply whatever the inputs exceed them by. So an assembler who names
 * a large coin of yours and a small change output is not "asking for a fee" anywhere in the document —
 * the surplus is silently donated to the miner. Measured on a real battery top-up: the same transaction
 * with a coin twice the size turned a 347 sat fee into 100,347 sat, with nothing on its face to say so.
 * Deriving the fee and putting it in front of the signer is the only defence.
 */
import { Transaction, P2PKH, Utils } from '@bsv/sdk'
import type { PrivateKey } from '@bsv/sdk'

/** A source transaction for one of the inputs — needed for its value and its locking script. */
export interface CosignSource { txId: string; sourceTxHex: string }

export interface CosignInputView {
  index: number
  txId: string
  outputIndex: number
  /** Null when the source transaction was not supplied — which is a blocker, not a display detail. */
  satoshis: number | null
  /** Pays this wallet's address, so this is one we can and will sign. */
  mine: boolean
  /** Already carries an unlocking script — the covenant's input, or a co-signer who went before us. */
  complete: boolean
}

export interface CosignOutputView {
  index: number
  satoshis: number
  kind: 'yours' | 'address' | 'data' | 'script'
  address?: string
  /** OP_RETURN payload decoded as UTF-8. DISPLAY AS TEXT — never linkify; these are stranger's bytes. */
  text?: string
  scriptSize: number
}

export interface CosignAnalysis {
  /** Bytes as handed over, with this wallet's inputs still blank. */
  size: number
  /** Bytes once the blanks are filled — what the fee is actually paying for. */
  signedSize: number
  inputs: CosignInputView[]
  outputs: CosignOutputView[]
  totalIn: number
  totalOut: number
  fee: number
  /** sat/KB — the number to judge the fee by. Policy is 100; anything far above it wants explaining. */
  feePerKb: number
  /** What leaves this wallet across all inputs it owns. */
  youSpend: number
  /** What comes back to this wallet across all outputs paying it. */
  youReceive: number
  /** The real cost of signing: spend − receive. Includes the fee if this wallet is funding it. */
  youPay: number
  /** Input indices this wallet will sign. */
  toSign: number[]
  /** Sign-able, but the signer should read these first. */
  warnings: string[]
  /** Refusals. Non-empty means `cosignTransaction` will throw. */
  blockers: string[]
}

/** What filling in one blank costs in bytes: push(72-byte signature) + push(33-byte public key). */
const SIGNED_P2PKH_INPUT_BYTES = 107
/** Fee policy: 100 sat/KB is the official rate. Twice that is worth a word; ten times is alarming. */
const FEE_PER_KB_POLICY = 100
const FEE_PER_KB_NOTABLE = FEE_PER_KB_POLICY * 2
const FEE_PER_KB_ALARMING = FEE_PER_KB_POLICY * 10

/** Decode an OP_FALSE OP_RETURN <data> payload as text, or null if this is not a data output. */
function dataPayload(scriptHex: string): string | null {
  // OP_FALSE OP_RETURN is `006a`; a bare OP_RETURN output is `6a`. Accept both, then take the first push.
  const s = scriptHex.toLowerCase()
  const body = s.startsWith('006a') ? s.slice(4) : s.startsWith('6a') ? s.slice(2) : null
  if (body == null) return null
  try {
    const bytes = Utils.toArray(body, 'hex')
    let i = 0, len = 0
    const op = bytes[i++]
    if (op == null) return ''
    if (op <= 75) len = op
    else if (op === 0x4c) len = bytes[i++] ?? 0
    else if (op === 0x4d) { len = (bytes[i++] ?? 0) | ((bytes[i++] ?? 0) << 8) }
    else if (op === 0x4e) { len = (bytes[i++] ?? 0) | ((bytes[i++] ?? 0) << 8) | ((bytes[i++] ?? 0) << 16) | ((bytes[i++] ?? 0) << 24) }
    else return ''
    return Utils.toUTF8(bytes.slice(i, i + len))
  } catch { return '' }
}

/**
 * Work out what signing this transaction would actually do to this wallet. Pure — no network, no key,
 * so it runs on the offline box and is safe to call before the signer has committed to anything.
 */
export function analyseCosign(rawTx: string, sources: CosignSource[], address: string): CosignAnalysis {
  const tx = Transaction.fromHex(rawTx)
  const mineLock = new P2PKH().lock(address).toHex()

  // Index the sources by txid, and VERIFY each one hashes to the id it is filed under. A source
  // transaction is how we learn an input's value; a forged one would let an assembler understate what
  // it is spending, and the fee we derive from it would be a lie we told ourselves.
  const byId = new Map<string, Transaction>()
  const blockers: string[] = []
  const warnings: string[] = []
  for (const s of sources) {
    let parsed: Transaction
    try { parsed = Transaction.fromHex(s.sourceTxHex) }
    catch { blockers.push(`a supplied source transaction for ${s.txId.slice(0, 12)}… is not valid hex`); continue }
    if (parsed.id('hex') !== s.txId) {
      blockers.push(`a source transaction does not hash to the txid it claims (${s.txId.slice(0, 12)}…) — refusing`)
      continue
    }
    byId.set(s.txId, parsed)
  }

  const inputs: CosignInputView[] = tx.inputs.map((inp, index) => {
    const txId = inp.sourceTXID ?? inp.sourceTransaction?.id('hex') ?? ''
    const outputIndex = inp.sourceOutputIndex
    const src = byId.get(txId) ?? inp.sourceTransaction ?? null
    const out = src?.outputs[outputIndex] ?? null
    const complete = (inp.unlockingScript?.toBinary().length ?? 0) > 0
    return {
      index, txId, outputIndex,
      satoshis: out?.satoshis ?? null,
      mine: out != null && out.lockingScript.toHex() === mineLock,
      complete,
    }
  })

  const outputs: CosignOutputView[] = tx.outputs.map((o, index) => {
    const hex = o.lockingScript.toHex()
    const text = dataPayload(hex)
    let kind: CosignOutputView['kind'] = 'script'
    let addr: string | undefined
    if (text != null) kind = 'data'
    else if (hex === mineLock) { kind = 'yours'; addr = address }
    else {
      // A standard P2PKH we can name: OP_DUP OP_HASH160 <20> … OP_EQUALVERIFY OP_CHECKSIG
      const m = /^76a914([0-9a-f]{40})88ac$/.exec(hex.toLowerCase())
      if (m != null) {
        kind = 'address'
        try { addr = Utils.toBase58Check(Utils.toArray(m[1], 'hex')) } catch { addr = undefined }
      }
    }
    return { index, satoshis: o.satoshis ?? 0, kind, address: addr, text: text ?? undefined, scriptSize: o.lockingScript.toBinary().length }
  })

  const missing = inputs.filter(i => i.satoshis == null)
  if (missing.length > 0) {
    blockers.push(
      `${missing.length} input${missing.length === 1 ? '' : 's'} ha${missing.length === 1 ? 's' : 've'} no source ` +
      'transaction, so the fee cannot be worked out. Refusing to sign a transaction whose cost is unknown.')
  }

  const totalIn = inputs.reduce((a, i) => a + (i.satoshis ?? 0), 0)
  const totalOut = outputs.reduce((a, o) => a + o.satoshis, 0)
  const fee = totalIn - totalOut
  const size = rawTx.length / 2
  const toSign = inputs.filter(i => i.mine && !i.complete).map(i => i.index)

  /* Judge the fee against the size this transaction will BE, not the size it is now. Every blank we
     fill in grows it by about 107 bytes (a 72-byte signature and a 33-byte public key, each pushed).
     Rating the fee against the unsigned bytes overstates it — a perfectly ordinary 20 sat fee on a
     small transaction reads as 235 sat/KB before signing and 100 after — and a warning that cries wolf
     on every co-sign is worse than no warning, because it trains the signer to click through it. */
  const signedSize = size + SIGNED_P2PKH_INPUT_BYTES * toSign.length
  const feePerKb = signedSize > 0 ? Math.round((fee * 1000) / signedSize) : 0
  const youSpend = inputs.filter(i => i.mine).reduce((a, i) => a + (i.satoshis ?? 0), 0)
  const youReceive = outputs.filter(o => o.kind === 'yours').reduce((a, o) => a + o.satoshis, 0)

  if (toSign.length === 0) {
    blockers.push(missing.length > 0
      ? 'no input could be matched to this wallet (some sources are missing, so this may be why)'
      : 'no input in this transaction pays this wallet — there is nothing here for it to sign')
  }
  for (const i of inputs) {
    if (i.mine && i.complete) warnings.push(`input #${i.index + 1} already carries a signature and will be left alone`)
    if (!i.mine && !i.complete) {
      warnings.push(`input #${i.index + 1} is neither yours nor already signed — somebody else must sign it before this can be broadcast`)
    }
  }
  if (blockers.length === 0) {
    if (fee < 0) blockers.push('the outputs are worth more than the inputs — this transaction can never be valid')
    else if (feePerKb >= FEE_PER_KB_ALARMING) {
      warnings.push(`⚠ THE FEE IS ${fee.toLocaleString()} SAT — ${feePerKb.toLocaleString()} sat/KB, over ${Math.round(feePerKb / FEE_PER_KB_POLICY)}× the standard rate. ` +
        'Outputs are fixed by whoever built this, so any surplus goes to the miner, not back to you. Check the change amount before signing.')
    } else if (feePerKb >= FEE_PER_KB_NOTABLE) {
      warnings.push(`the fee is ${fee.toLocaleString()} sat (${feePerKb.toLocaleString()} sat/KB) against a standard rate of ${FEE_PER_KB_POLICY}`)
    }
  }

  return {
    size, signedSize, inputs, outputs, totalIn, totalOut, fee, feePerKb,
    youSpend, youReceive, youPay: youSpend - youReceive,
    toSign, warnings, blockers,
  }
}

/**
 * Sign this wallet's inputs and leave every other byte of the transaction alone.
 *
 * ★ Why signing one input cannot disturb another: a sighash preimage commits to the outpoints, the
 * values, the outputs and the scriptCode of the input BEING signed — never to another input's
 * unlocking script. So a covenant input authorised by OP_PUSH_TX, or a partner's signature added
 * yesterday, both stay valid while this one is filled in. That fact is what makes co-signing possible
 * at all; without it the only way to complete a transaction would be to rebuild it.
 */
export async function cosignTransaction(
  rawTx: string, sources: CosignSource[], key: PrivateKey,
): Promise<{ txId: string; rawTx: string; analysis: CosignAnalysis }> {
  const address = key.toAddress()
  const analysis = analyseCosign(rawTx, sources, address)
  if (analysis.blockers.length > 0) throw new Error(analysis.blockers[0])

  const tx = Transaction.fromHex(rawTx)
  const byId = new Map(sources.map(s => [s.txId, Transaction.fromHex(s.sourceTxHex)]))
  // Every input needs its source attached for the sighash (value + script), including the ones we are
  // NOT signing — their values are part of the preimage of the ones we are.
  for (const inp of tx.inputs) {
    const src = byId.get(inp.sourceTXID ?? '')
    if (src != null) inp.sourceTransaction = src
  }

  const unlock = new P2PKH().unlock(key)
  for (const i of analysis.toSign) {
    // Signed one at a time, deliberately. `tx.sign()` would walk every input with a template attached
    // and is the wrong tool here: this transaction is part ours and part somebody else's.
    tx.inputs[i].unlockingScript = await unlock.sign(tx, i)
  }

  /* ⚠ WITHOUT THIS LINE THE SIGNATURE IS DISCARDED, SILENTLY.
     `Transaction.fromHex` stores the bytes it parsed in `rawBytesCache`, and `getSerializedBytes()`
     returns that cache if it is populated — so `toHex()` on a parsed transaction reproduces the
     ORIGINAL bytes no matter what has been assigned to its inputs since. The SDK invalidates the cache
     itself inside addInput/addOutput/sign, but assigning `inputs[i].unlockingScript` directly reaches
     past all of them.
     The failure mode is the dangerous kind: signing appears to succeed, a txid comes back, and the
     transaction handed on is the unsigned one. Caught here only because a test validated the result
     through the interpreter rather than trusting that the assignment had taken. */
  tx.invalidateSerializationCaches()
  return { txId: tx.id('hex'), rawTx: tx.toHex(), analysis }
}
