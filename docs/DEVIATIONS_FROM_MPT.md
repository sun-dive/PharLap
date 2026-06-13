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
  txid = the Collection ID.** The publisher's pubkey is the lock key of this output.
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

## 8. Incoming detection: a 1-sat P2PKH notification output + local tracking
PHAR LAP tokens are PushDrop outputs (`<pubkey> OP_CHECKSIG <data> OP_DROP`) — non-standard scripts that WoC does
**not** index under a P2PKH address — so MPT's raw "scan my address for the token output" does not find them
directly. PHAR LAP keeps discovery via one indirection: a transfer adds a small **P2PKH "notification" output**
(1 sat) to the recipient's address (which IS address-indexed) alongside the PushDrop token. The recipient scans
their address history, finds the notifying tx, parses that tx for the PushDrop token locked to their pubkey
(`findOwnedTokenOutputs`), verifies it, and records it. The notification is the discoverable breadcrumb; the token
rides in the spendable PushDrop.

The notification is **1 sat** (not 0): a 0-sat *spendable* output is non-standard/dust-rejected on BSV, and the
only 0-sat construct allowed (OP_RETURN) is not address-indexed, so it can't act as the breadcrumb. 1 sat is the
minimum that is both standard and discoverable; the recipient owns it and can later sweep these notifications.

Notification is **default-on for sends, optional** (omit for the buyer-built covenant flow or for privacy;
out-of-band link/BEEF also works). Note: sending requires the recipient's **public key** (the lock is P2P-K-style),
not just an address; the notification address is derived from that pubkey. Funding UTXOs (P2PKH change) are
address-indexed as usual. (See PLAN.md Addendum D.)

## 9. Verification via SDK MerklePath + ChainTracker (no new infrastructure)
MPT used a bespoke TSC proof parser (`walletProvider.getMerkleProof`) + custom Merkle code in `tokenProtocol`.
PHAR LAP verifies with **@bsv/sdk `MerklePath` (BRC-74 BUMP) + a pluggable `ChainTracker`**; raw-tx/UTXO/broadcast
still go through `walletProvider` (WoC). The **default `ChainTracker` is WhatsOnChain-backed** — the same WoC we
already call (it fetches a block header by height to check the merkle root, which our old code already did), so
this adds **no extra service/node/overlay**. Verify functions take a `ChainTracker` so the proof/header source is
*optionally* swappable later (WoC → ARC → overlay → local headers) without touching verification logic. Trust
model is unchanged from MPT (WoC as header source; proofs are verified, the provider is not trusted).

## 10. Miner-enforced "unlimited mints" editions (covenant) — new in PHAR LAP
MPT had no covenant: token rules were wallet-enforced only (SPV self-verification). PHAR LAP adds an
**optional, miner-enforced covenant** token type — the "unlimited mints" edition (Addendum A) — that has no
analogue in MPT. The edition locking script is a custom covenant (not the standard `<pubkey> OP_CHECKSIG …`
PushDrop), structured as `<P, ver, RECORD_EDITION(0x05), tx1Ref(32), ownerPubKey(33), stateData> OP_2DROP×3`
followed by a shared OP_PUSH_TX prefix and an `OP_IF transfer OP_ELSE replicate OP_ENDIF` branch.

Key points / deviations:
- **Transaction introspection by hand-rolled optimal OP_PUSH_TX** (`src/pushtx.ts`): BSV has no
  OP_CHECKDATASIG, so the spender pushes the sighash preimage and the script re-derives an ECDSA signature
  over it with fixed *public* constants and verifies it via `OP_CHECKSIG`, forcing a genuine preimage. The
  covenant then reads `hashOutputs` and reconstructs the required outputs. Requires BSV **Chronicle** (tx
  version 2) for relaxed low-S + big-int arithmetic; signature DER is still minimal-encoded (handled in-script
  via `OP_NUM2BIN` + fixed reverse + a runtime `OP_SPLIT`). No sCrypt / external toolchain — only `@bsv/sdk`.
- **Self-replication (quine):** outputs re-create the covenant's *own* script (read from the preimage's
  scriptCode, so no second copy is embedded), with the owner pubkey swapped where needed (replica → buyer,
  transfer → new owner). Full both-branch edition script ≈ **767 bytes**.
- **Economic enforcement at consensus:** replicate forces `[0]` token→holder, `[1]` replica→buyer, `[2]`
  publisher fee, `[3]` holder fee, `[4+]` buyer change. Transfer is owner-signed (`OP_CHECKSIGVERIFY`) and also
  re-creates the covenant for the new owner. Introspection scope is `ANYONECANPAY|ALL|FORKID` so buyers can
  add funding inputs.
- **New modules:** `src/pushtx.ts`, `src/covenant.ts`, `src/editionBuilder.ts` (kept separate from the
  mainnet-validated plain `collectionBuilder` path). Editions carry economic terms *in the script itself*, so
  a recipient recovers them with `parseEditionScript` — no out-of-band metadata.
- **Validated on BSV mainnet** (2026-06-11): a permissionless replicate was mined into a block.

---

*Recorded during the PHAR LAP design sessions, 2026-06-10; §10 covenant added 2026-06-11.*
