// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP lightweight token verification.
 *
 * Verifies that a token output is a legitimate member of its collection (PLAN.md Addendum
 * A/C/D — "genesis + immediate parent"):
 *   1. The token references a TX1 whose tx actually contains a TEMPLATE output (collection anchor).
 *   2. Its immediate parent (Input 0's source) is either:
 *        - a same-collection TOKEN output  → a transfer/edition descendant, OR
 *        - not a token                      → this is a genesis mint (a root of the collection).
 *   3. Optionally, the relevant tx is confirmed (Merkle proof verifies against a ChainTracker).
 *
 * Dependencies are injected so the logic is unit-testable offline and the proof/header source
 * is pluggable. Real wiring (Phase 6) passes a walletProvider-backed `getRawTransaction`, a
 * `getProof` that yields a MerklePath, and a `ChainTracker` (defaultChainTracker() = WoC-backed,
 * no extra infrastructure). The full lineage walk ("deep verify") is a later addition.
 *
 * Covenant matching (the token's locking-script covenant equals TX1's committed covenant) is
 * added with the covenant phase (Phase 7); this module covers the non-covenant base.
 */
import { Utils, type Transaction } from '@bsv/sdk'
import { parseTokenScript, parseTemplateScript } from './tokenCodec.ts'
import { parseEditionAny, buildHolderEditionScript, EDITION_PRICE_SCRIPT_OFFSET } from './covenant.ts'

/** Minimal ChainTracker shape (satisfied by @bsv/sdk's WhatsOnChain / defaultChainTracker()). */
export interface ChainTrackerLike {
  isValidRootForHeight(root: string, height: number): Promise<boolean>
  currentHeight(): Promise<number>
}

/** Minimal proof shape (satisfied by @bsv/sdk's MerklePath). */
export interface ProofLike {
  verify(txid: string, chainTracker: ChainTrackerLike): Promise<boolean>
}

export interface VerifyDeps {
  getRawTransaction(txId: string): Promise<Transaction>
  /** Optional: fetch a Merkle proof for a txid (null if not yet mined). */
  getProof?: (txId: string) => Promise<ProofLike | null>
  /** Optional: header source for proof verification. */
  chainTracker?: ChainTrackerLike
}

export interface VerifyResult {
  valid: boolean
  reason: string
  collectionId?: string
  isGenesis?: boolean
  /** True if accepted without a confirmation proof (unconfirmed, instant accept). */
  unconfirmed?: boolean
}

export async function verifyTokenLineage(
  tokenTx: Transaction,
  outputIndex: number,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const tokenOut = tokenTx.outputs[outputIndex]
  const token = tokenOut ? parseTokenScript(tokenOut.lockingScript) : null
  if (token == null) return { valid: false, reason: 'output is not a PHAR LAP token' }
  const collectionId = token.fields.tx1Ref

  // 1. Collection anchor: TX1 must exist and contain a TEMPLATE output.
  let tx1: Transaction
  try {
    tx1 = await deps.getRawTransaction(collectionId)
  } catch {
    return { valid: false, reason: `cannot fetch collection TX1 ${collectionId.slice(0, 12)}…`, collectionId }
  }
  // Pin the anchor to its txid: the provider is NOT trusted, so the returned TX1 must actually hash to the
  // collection id the token commits to. This is what makes the immutable template fields (tokenName, rules,
  // covenant, fileHash, licence) tamper-evident — altering any of them changes TX1's txid, which no token
  // references. (The MPT immutability guarantee, enforced by Bitcoin's own hash rather than a re-derived chunk.)
  if (tx1.id('hex') !== collectionId) {
    return { valid: false, reason: 'fetched TX1 does not hash to the collection id — tampered collection anchor', collectionId }
  }
  const hasTemplate = tx1.outputs.some(o => parseTemplateScript(o.lockingScript) != null)
  if (!hasTemplate) {
    return { valid: false, reason: 'TX1 has no TEMPLATE output — invalid collection anchor', collectionId }
  }

  // 2. Immediate parent (Input 0's source).
  const input0 = tokenTx.inputs[0]
  const parentTxId = input0?.sourceTXID ?? input0?.sourceTransaction?.id('hex')
  const parentVout = input0?.sourceOutputIndex
  if (parentTxId == null || parentVout == null) {
    return { valid: false, reason: 'token tx has no input 0', collectionId }
  }

  let isGenesis: boolean
  try {
    const parentTx = await deps.getRawTransaction(parentTxId)
    const parentOut = parentTx.outputs[parentVout]
    const parentToken = parentOut ? parseTokenScript(parentOut.lockingScript) : null
    // A same-collection token parent ⇒ descendant; otherwise this token is a genesis mint.
    isGenesis = !(parentToken != null && parentToken.fields.tx1Ref === collectionId)
  } catch {
    return { valid: false, reason: 'cannot fetch immediate parent tx', collectionId }
  }

  // 3. Optional confirmation: prove the relevant tx is mined.
  if (deps.getProof != null && deps.chainTracker != null) {
    const proofTxId = isGenesis ? tokenTx.id('hex') : parentTxId
    const proof = await deps.getProof(proofTxId)
    if (proof != null) {
      const ok = await proof.verify(proofTxId, deps.chainTracker)
      if (!ok) {
        return { valid: false, reason: 'Merkle proof did not verify against the chain', collectionId, isGenesis }
      }
      return {
        valid: true,
        reason: isGenesis ? 'valid genesis token (confirmed)' : 'valid descendant token (parent confirmed)',
        collectionId,
        isGenesis,
      }
    }
    // No proof yet → unconfirmed; lightweight instant-accept.
    return {
      valid: true,
      reason: isGenesis ? 'valid genesis token (unconfirmed)' : 'valid descendant token (unconfirmed)',
      collectionId,
      isGenesis,
      unconfirmed: true,
    }
  }

  // No proof source supplied → structural lineage check only.
  return {
    valid: true,
    reason: isGenesis ? 'valid genesis token (structure only)' : 'valid descendant token (structure only)',
    collectionId,
    isGenesis,
    unconfirmed: true,
  }
}

// ─── Edition covenant binding (O(1), no lineage walk) ───────────────

export interface EditionVerifyResult {
  valid: boolean
  reason: string
  collectionId?: string
  collectionName?: string
  /** This token's tx spends TX1 directly — i.e. it IS the publisher's original genesis mint. */
  isGenesis?: boolean
  isV2?: boolean
  /** Authoritative economics, proven equal to TX1's committed covenant (only set when valid). */
  publisherFeeSats?: number
  holderFeeSats?: number
  pBps?: number
  priceSats?: number
}

const bytesEqual = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Prove a token's locking script is byte-for-byte the covenant TX1 committed for its collection — i.e. it
 * enforces collection T's genuine, immutable rules (real publisher fee + split), not a look-alike with altered
 * economics. This is O(1): the covenant is consensus-enforced forward and TX1 commits the template, so a single
 * byte-match against TX1 IS the proof of "matches genesis" — no lineage walk (the MPT thesis: bind to genesis,
 * don't trace every hop).
 *
 * Every edition's script = the committed template with only two identity fields spliced in (tx1Ref @7, owner
 * @40), so we reconstruct the expected script from TX1's template and compare. The v2 holder-set price is
 * legitimately per-edition, so that one field is neutralized before comparing.
 */
export async function verifyEditionCovenant(
  tokenTx: Transaction,
  outputIndex: number,
  deps: VerifyDeps,
): Promise<EditionVerifyResult> {
  const lock = tokenTx.outputs[outputIndex]?.lockingScript
  const ed = lock != null ? parseEditionAny(lock) : null
  if (ed == null) return { valid: false, reason: 'output is not a PHAR LAP edition covenant' }
  const collectionId = ed.tx1RefHex

  // Fetch the collection anchor TX1 and read its committed covenant template C.
  let tx1: Transaction
  try { tx1 = await deps.getRawTransaction(collectionId) }
  catch { return { valid: false, reason: `cannot fetch collection TX1 ${collectionId.slice(0, 12)}…`, collectionId } }
  let covenantHex = '', tokenName = ''
  for (const o of tx1.outputs) {
    const t = parseTemplateScript(o.lockingScript)
    if (t != null) { covenantHex = t.fields.covenantScript; tokenName = t.fields.tokenName; break }
  }
  if (covenantHex === '') {
    return { valid: false, reason: 'TX1 has no covenant template — not a valid edition collection', collectionId }
  }

  // Reconstruct this token's expected script from C + its identity (tx1Ref + owner), then byte-match.
  let expected: number[]
  try {
    expected = buildHolderEditionScript(Utils.toArray(covenantHex, 'hex'), Utils.toArray(collectionId, 'hex'), Utils.toArray(ed.ownerPubKeyHex, 'hex'))
  } catch { return { valid: false, reason: 'collection template is malformed', collectionId, collectionName: tokenName } }
  const actual = lock!.toBinary()
  // v2: the reseller's price is legitimately per-edition — copy it across so it isn't a false mismatch.
  if (ed.isV2 && expected.length === actual.length) {
    for (let i = 0; i < 8; i++) expected[EDITION_PRICE_SCRIPT_OFFSET + i] = actual[EDITION_PRICE_SCRIPT_OFFSET + i]
  }
  if (!bytesEqual(expected, actual)) {
    return { valid: false, reason: 'covenant does NOT match this collection’s committed rules — possible counterfeit or altered fees', collectionId, collectionName: tokenName }
  }

  // Genuine. Genesis = this token's tx spends TX1 directly (the publisher's original mint).
  const in0 = tokenTx.inputs[0]
  const parentTxId = in0?.sourceTXID ?? in0?.sourceTransaction?.id('hex')
  const isGenesis = parentTxId === collectionId
  return {
    valid: true,
    reason: isGenesis ? 'genuine genesis edition (covenant matches the collection’s committed rules)'
      : 'genuine edition (covenant matches the collection’s committed rules)',
    collectionId, collectionName: tokenName, isGenesis, isV2: ed.isV2,
    publisherFeeSats: ed.isV2 ? undefined : ed.terms.publisherFeeSats,
    holderFeeSats: ed.isV2 ? undefined : ed.terms.holderFeeSats,
    pBps: ed.isV2 ? ed.terms.pBps : undefined,
    priceSats: ed.isV2 ? ed.priceSats : undefined,
  }
}
