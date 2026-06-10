# PHAR LAP — deviations from MPT v05.24

PHAR LAP is derived from the **Merkle Proof Token (MPT) v05.24** prototype but makes deliberate
protocol-level changes. This document is the running record of every intentional deviation, so the
lineage stays clear. (See `PLAN.md` for the full design and rationale.)

## 1. On-chain data model: PushDrop, not P2PKH + OP_RETURN
MPT put ownership in a 1-sat **P2PKH** output and metadata in a separate **OP_RETURN** output. OP_RETURN
data is provably unspendable and may be pruned by miners. PHAR LAP puts token data in a **PushDrop**
output — a *spendable* locking script (`<pubkey> OP_CHECKSIG <fields> OP_DROP…`) — so the data stays in the
UTXO set and is **not prunable**. (BRC-48.)

## 2. Protocol prefix and version
- Prefix: **`"P"` (1 byte, `0x50`)** — was `"MPT"` (3 bytes). Saves 2 bytes per output.
- Format version: **`0x03`** — was `0x02`.

## 3. Two-transaction collection model (TX1 template anchor)
MPT minted a token in a single transaction with all immutable metadata encoded inline in the OP_RETURN.
PHAR LAP creates a collection with **two** transactions:
- **TX1 (Collection Template)** — a PushDrop output committing all immutable data: `tokenName`,
  `tokenRules`, covenant template, and optional embedded file. Kept unspent (non-prunable). **TX1's
  txid = the Collection ID.** The creator's pubkey is the lock key of this output.
- **TX2 / every token** — references TX1 by txid; carries only `[P, version, recordType, TX1-ref, stateData]`.

Immutable collection data is referenced by txid rather than re-encoded in every token. This also binds an
embedded file to identity for free (the file lives in TX1; altering it changes TX1's txid).

## 4. Identity model: Collection ID = TX1 txid (no per-token Token ID)
- MPT: per-token `Token ID = SHA-256(genesisTxId || outputIndex || (tokenName + tokenScript + tokenRules))`.
- PHAR LAP: **identity = Collection ID = the TX1 txid** carried as `TX1-ref`. All members of a collection
  share it (interchangeable editions); individual UTXOs are tracked by outpoint. No per-token Token ID and no
  carried `genesisTxId`.

Because the only identity input is a fixed 32-byte txid, PHAR LAP avoids MPT's encoding hazard where an empty
immutable field (e.g. an empty `tokenScript`) is minimal-push-encoded to `OP_0` and decodes back to `[0x00]`
rather than empty — which in MPT could make genesis-time and verify-time Token IDs diverge (the root of the
`extractImmutableChunkBytes` vs `buildImmutableChunkBytes` bug in MPT v05.24).

## 5. Field model: `tokenAttributes` removed; single mutable `stateData`
**Original MPT had one mutable data field; a second (`stateData`) was added during SVphone development.**
PHAR LAP consolidates them into a **single mutable field named `stateData`** (the better label), and removes
`tokenAttributes` entirely. `stateData` is **not** bound to identity (it may change on transfer). All immutable
collection metadata (name, rules, covenant, file) lives in TX1, not in token fields.

## 6. No on-chain proof chain — SPV proofs travel off-chain / on-demand
MPT embedded the proof chain (plus a copy of the metadata) in the **transfer** OP_RETURN, growing it on every
hop. PHAR LAP **carries no proof data on-chain at all**. Lineage is implicit (each transfer spends its parent as
Input 0); a verifier follows inputs and fetches ancestor txs + Merkle proofs **on-demand** from the network by
txid (standard SPV — not an indexer). Off-chain **BEEF** bundles (BRC-62/64) for offline verification are a
planned enhancement. Result: transfers are **minimal and constant-size forever**, regardless of lineage depth.

## 7. Storage namespace
localStorage key prefix changed from `mpt:` to `p:` (clean break — PHAR LAP does not read MPT tokens).

---

*Recorded during the PHAR LAP design sessions, 2026-06-10.*
