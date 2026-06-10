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
import type { Transaction } from '@bsv/sdk'
import { parseTokenScript, parseTemplateScript } from './tokenCodec.ts'

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
