# Plan: "P" (Proof Token) — PushDrop token wallet derived from MPT v05.24

> Saved 2026-06-09 during a power outage (UPS). This is a copy of the approved-pending plan
> at `~/.claude/plans/polymorphic-gliding-sutton.md`. Status: plan finalized, NOT yet started.
> Next step on resume: get plan approval, then begin Phase 0 (bootstrap the new project folder).

## Context

New **standalone project** based on **MPT v05.24**
(`/home/sundive/Documents/GitHub/Merkle-Proof-Token-MPT/prototypes/MPT_v05_24/`), with three goals:

1. **Non-prunable on-chain data** — replace `P2PKH (1 sat) + separate OP_RETURN metadata` with a
   **PushDrop** model: token metadata lives in a *spendable* locking script that stays in the UTXO set
   (OP_RETURN can be pruned; PushDrop cannot).
2. **Miner-enforced script in the token** — consensus covenant (OP_PUSH_TX / sighash-preimage). Experimental, isolated, OFF by default.
3. **More efficient + robust** — fix bugs, harden parsing, add tests, keep transfers small.

### Confirmed decisions
- **Lightweight raw-key PushDrop template** (NOT the SDK `PushDrop` class, which needs the BRC-100 `WalletInterface`/`@bsv/wallet-toolbox`). Preserves raw-`PrivateKey` + SPV-only + zero-extra-deps.
- **Hybrid placement**: metadata in PushDrop output (non-prunable); bulky regenerable **proof chain stays in 0-sat OP_RETURN** on transfers.
- **Rebrand to "P"**: 1-byte prefix `0x50`, version `0x03` (saves 2 B/output vs 3-byte "MPT").
- **Clean break**: no interop with old MPT OP_RETURN tokens.

### Transfer-size analysis (the user's key question)
Spending a PushDrop UTXO does NOT repeat its data on-chain — the input only adds `<sig>` (~72 B, like
P2PKH). Data appears once, in the output that creates the UTXO. Current model already repeats metadata in
every transfer's OP_RETURN, so PushDrop just *moves* it into the permanent output (net ≈ +15–20 B). And
because the genesis PushDrop output is non-prunable, immutable fields (name/script/rules) are recoverable
from genesis, so **transfer outputs omit them** → carry only `prefix + version + mutable state + ownership`
→ transfers as small as or smaller than today. Covenant tokens are the exception (script must repeat).

## Module structure

- `src/tokenProtocol.ts` — keep ~verbatim (computeTokenId, verifyMerkleProof, verifyProofChain, verifyToken). Fix top comment: immutable = **3 fields name+script+rules** (not 4).
- `src/pushDrop.ts` (NEW) — raw-key ScriptTemplate. `lock(pubKeyHex, fields[][])` → `<fields> OP_DROP/OP_2DROP <pubkey> OP_CHECKSIG`. `unlock(key)` builds BIP143 preimage via `TransactionSignature.format()`, signs with raw `key.sign` (copy SDK PushDrop unlock.sign block, swap `wallet.createSignature`→`key.sign`). `static decode(script)`.
- `src/tokenCodec.ts` (NEW, replaces opReturnCodec.ts) — `P_PREFIX=[0x50]`, `P_VERSION=0x03`; `encodeTokenFields`/`decodeTokenFields`; single canonical `buildImmutableChunkBytes`/`extractImmutableChunkBytes` (fields[2..4]) **fixes Token ID bug**; move rules codec, proof-chain binary codec, file OP_RETURN; add `encodeProofChainOpReturn`/`decodeProofChainOpReturn` (+ max-size guard).
- `src/covenant.ts` (NEW, experimental OFF by default) — issuer co-sign (Pattern A from old_docs/consensus_level_scripts_research.md). Validate via SDK `Spend` in tests before broadcast. Reserve `consensusRuleType` byte; implement type 0 (none) + 1 (issuer co-sign) only.
- `src/walletProvider.ts` — persist `pendingUtxos` (fix loss-on-reload).
- `src/tokenStore.ts` — prefix `mpt:`→`p:`; keep currentOutputIndex/genesisOutputIndex (now 0-based); add lockPubKey/hasCovenant.
- `src/tokenBuilder.ts` — largest change (rewire genesis/transfer/quarantine/incoming/fee).
- `src/app.ts` — UI mostly unchanged; re-point imports.

## TX layouts (token UTXO = PushDrop output; token input always Input 0)
Genesis field vector: `[P_PREFIX, [P_VERSION], tokenName, tokenScript, tokenRules, tokenAttributes, stateData]`;
`immutableChunkBytes = name++script++rules`. Transfer vector reduced: `[P_PREFIX, [P_VERSION], stateData]` (+ tokenScript only if covenant).
- **Genesis NFT** (N = D>0?S×D:S): Out0..N-1 = PushDrop token (1 sat, full fields); [OutN] file OP_RETURN; Out last = P2PKH change. **genesisOutputIndex 0-based now.**
- **Genesis fungible**: Out0 = PushDrop (sats=units); Out1+ = P2PKH change.
- **NFT transfer**: In0 token PushDrop (`pushDrop.unlock`); Out0 PushDrop→recipient (1 sat, reduced); Out1 OP_RETURN proof cargo; Out2+ change.
- **Fungible transfer**: Out0 PushDrop→recipient (amount); Out1 OP_RETURN proof cargo; Out2 PushDrop self-change; Out3+ fee change. Token value only at indices 0 and 2.

## Migration map (tokenBuilder.ts)
- NFT genesis `:467-477`; fungible genesis `:566-575`; NFT transfer `:841-869` + token-input unlock `~:1870`; fungible transfer `:1887-1925` → PushDrop outputs + proof-cargo OP_RETURN, unlock `P2PKH().unlock`→`pushDrop.unlock`.
- Quarantine `getSafeUtxos :148-163` → predicate = "locking script parses as P PushDrop token" (now also protects fungible UTXOs).
- Incoming `:326-415, 1240-1320` → `pushDrop.decode`, compare `Hash.hash160(pubkey)` to our pubkeyhash; proof chain from cargo OP_RETURN.
- `deriveGenesisOutputIndex :261-320` → unchanged logic, 0-based, expose maxHops + explicit error.
- `estimateFee :1999-2016` → size outputs by actual `lockingScript.toBinary().length`.

## Robustness fixes (Phase 5)
1. Token ID bug (canonical 3-field immutable bytes + regression test). 2. maxHops configurable + error.
3. Persist pending UTXOs. 4. Gate console.debug behind DEBUG flag. 5. Proof-chain OP_RETURN max-size guard.
6. One hardened bounds-checked chunk reader (SDK `script.chunks` reliable for PushDrop). 7. Fee for large outputs.

## Phases (runnable after each)
0 Bootstrap (copy folder, prefix `p:`, confirm old app builds, add `node --test` scaffold) →
1 pushDrop.ts + tests (Spend validation) → 2 tokenCodec.ts (fixes Token ID bug) + tests →
3 Genesis on PushDrop (createGenesis/createFungibleGenesis + quarantine + unlock helper) →
4 Transfers on PushDrop (createTransfer/transferFungible/forwardFungibleUtxo + incoming + cargo) →
5 Robustness sweep → 6 Network validation (testnet then small mainnet; adjust TOKEN_SATS only if rejected) →
7 Experimental covenant (issuer co-sign, opt-in via params.covenant).

## Verification
- Unit (`npm test`, node --test): tokenCodec (Token ID regression w/ non-empty attrs), pushDrop (lock→decode 1/2/3/7 fields; malformed→null; **sighash correctness via SDK `Spend`**), tokenProtocol, fee (estimate ≥ signed size), covenant.
- Offline e2e (`test/e2e.ts`): build genesis+transfer, run inputs through `Spend`, recompute Token IDs, synthetic Merkle proofs.
- Live: `npm install && npm run build && npm run serve` → http://localhost:3000; mint→transfer→verify→transfer back (NFT + fungible). Testnet, then small mainnet.

## Reference files
- `MPT_v05_24/src/{tokenBuilder,opReturnCodec,tokenProtocol,tokenStore,walletProvider,app}.ts`
- `MPT_v05_24/node_modules/@bsv/sdk/.../script/templates/PushDrop` (template reference)
- `Merkle-Proof-Token-MPT/old_docs/consensus_level_scripts_research.md` (covenant patterns)
- `sun-dive-BRCs/scripts/0048.md` (BRC-48 PushDrop spec)
- @bsv/sdk version: v1.10.3

---

## Addendum A — "Unlimited Mints" (on-demand edition minting covenant)

Added in design discussion 2026-06-10. An advanced, experimental covenant pattern (built after the base
PushDrop phases; slot as a Phase 7+ pattern alongside issuer co-sign).

**Concept:** uncapped supply (like e-commerce units) vs. the typical limited-supply collectible NFT. The
default token still transfers A→B fee-free. *Additionally*, ANY buyer can permissionlessly mint their own
copy ("edition") **without any interaction from the current holder's wallet**.

**Mechanic** (covenant + `SIGHASH_ANYONECANPAY | ALL | FORKID`):
- Buyer builds a tx: `In0` = a holder's token UTXO spent via the covenant "replicate" branch (NO holder
  signature — authorized by structure, not key); `In1+` = buyer funding.
- Outputs, order fixed by the covenant and validated via OP_PUSH_TX output-reconstruction against the
  preimage `hashOutputs`:
  - `[0]` token **returned** to current holder (same fields/owner, re-locked under same covenant)
  - `[1]` **replica** to buyer (cloned fields, owner = buyer pubkey, same covenant)
  - `[2]` publisher fee → publisher address (immutable field)
  - `[3]` holder fee → current holder address
  - `[4+]` buyer change
- `ANYONECANPAY` zeroes `hashPrevouts`, so arbitrary buyers can attach funding without breaking the covenant.
  A plain pre-signed offer can't express this (SINGLE commits to one output; ALL can't pre-commit to the
  buyer's unknown replica/change) — so it is fundamentally an OP_PUSH_TX covenant.

**Confirmed parameters:**
1. Replicas are interchangeable **editions of one collection** (shared identity).
2. Every holder is a paid cloning source (load distributes across all holders; one clone per spine-UTXO per
   spend — serialized per UTXO but parallel across holders).
3. Fees **fixed forever** (immutable, bound to Token ID).
4. Direct transfers stay **fee-free**; royalties accrue only on replication.

**Identity model:**
- **Collection ID = hash(genesisTxId ‖ immutable fields)**, shared by all editions. Verification proves
  "valid edition of collection C," not "the unique token."
- `tokenRules.supply` (uint16): use **`supply = 0` as the "unlimited" sentinel**.
- Honest limitation: each edition is individually verifiable, but the **global total minted is NOT
  trustlessly knowable** without an indexer.

**Verification model (KEY decision — confirmed):**
- Backward lineage of any *single* edition is **LINEAR to genesis** (each edition has exactly one
  token-parent). No per-token DAG; the proof chain stays linear. Branching is forward/global only.
- The real challenge is path **LENGTH** (a hot token's "spine" can be thousands of hops), not branching.
- Covenant inductive guarantee: a *confirmed* covenant-C-locked UTXO can only have been created by spending a
  covenant-C parent → recursively to genesis. A counterfeit look-alike can't trace to the real `genesisTxId`.
- **DEFAULT = lightweight "genesis + immediate parent"**: (1) Merkle path proving `genesisTxId` is in its
  block + collection ID binds to it; (2) confirm the immediate parent is a confirmed covenant-C UTXO. **O(1)
  per token regardless of spine length.** Reuses/generalizes the existing `verifyBeforeImport()` ancestor-proof
  instant-accept path.
- **OPTIONAL "Deep Verify" button** = full lineage walk (Merkle proof for every ancestor to genesis) for
  high-value / paranoid checks.

**Plan impact:**
- New covenant pattern in `src/covenant.ts`: `editionMintCovenant` lock + replicate-branch unlock
  (OP_PUSH_TX output reconstruction), alongside the issuer co-sign pattern.
- `computeTokenId` / identity: add collection-ID derivation; store schema gains edition/collection fields +
  parent outpoint.
- Verification layer: generalize `verifyBeforeImport` to a covenant-C ancestor check; add the optional
  deep-walk.
- These tokens are **heavier** (the covenant script must travel in every output — no immutable-field
  omission saving from the transfer-size analysis).
- **Fee outputs are P2PKH and double as discovery breadcrumbs.** The replication tx pays the publisher fee and
  the holder fee as **P2PKH** outputs (to `hash160(pubkey)`, address-indexed) — NOT P2P-K. The covenant reads the
  holder's pubkey from its own `scriptCode` and `OP_HASH160`es it to build the holder-fee P2PKH; the publisher
  address comes from TX1's committed publisher pubkey. Because these are address-indexed payments, the **seller**
  discovers their returned token (and the **publisher** discovers royalties) via the normal `scanIncoming` flow —
  the holder fee tx appears in the seller's address history, then `findOwnedTokenOutputs` finds the returned
  token. So the permissionless-replication flow needs **no extra notification output** (the buyer built the tx
  and already knows the replica's outpoint). Edge case: this relies on a non-zero holder fee (always true in this
  design — "every holder is a paid cloning source"); if a collection ever set `holderFee = 0`, add a 1-sat
  notification to the holder to preserve discoverability.

---

## Addendum B — Chronicle release considerations (BSV opcode re-enablement) [2026-06-10]

BSV's **Chronicle** update (mainnet activated 7 Apr 2026 @ height 943,816; testnet already active) restored
original opcodes and relaxed several rules. Verdict for PHAR LAP: **convenience for the covenant phase, not a
new capability, and NOT needed for the base build** — everything we need was already possible post-Genesis.

Relevant items, ranked:
- **HIGH (Phase 7):** malleability rules relaxed for **tx version > 1** (push-only-unlocking, clean-stack,
  MINIMALIF, NULLFAIL, low-S all dropped) → makes OP_PUSH_TX covenants simpler/smaller. Author covenants for
  **tx version 2**. Caveat: clean-stack removal can MASK covenant bugs → author defensively regardless.
- **MEDIUM (Phase 7):** `OP_SUBSTR` (0xb3) / `OP_LEFT` (0xb4) / `OP_RIGHT` (0xb5) — cleaner byte-slicing when
  parsing the FORKID preimage / reconstructing outputs (vs. chaining `OP_SPLIT`).
- **LOW:** `OP_LSHIFTNUM` (0xb6) / `OP_RSHIFTNUM` (0xb7), `OP_2MUL`/`OP_2DIV` (arithmetic); `OP_VER` (push tx
  version, lightweight guard).
- **None for us:** `MAX_SCRIPT_NUM_LENGTH` 750KB→32MB (we do no in-script big-number crypto); OTDA via
  `CHRONICLE` sighash flag 0x20 — but it CONFIRMS BIP143/FORKID is BSV's default digest (OTDA is opt-in only).

**SDK catch:** the vendored **`@bsv/sdk` v1.10.3 is pre-Chronicle** — opcodes 0xb3–0xb7 are still
`OP_NOP4`–`OP_NOP8`, and `Spend` hard-codes `requirePushOnlyUnlockingScripts`/`requireCleanStack`/
`requireMinimalPush = true` with no version-gating. So local `Spend` validation does NOT reflect Chronicle.
Latest SDK is **2.1.4** (major-version jump from 1.10.3 → likely breaking `PushDrop`/`TransactionSignature` API
changes).

**Decision:** Phases 0–6 stay on v1.10.3 (unaffected). For Phase 7, author the edition-mint covenant with
post-Genesis opcodes + push-only unlocking first so local `Spend` tests stay valid; THEN evaluate bumping to
`@bsv/sdk` 2.x for `OP_SUBSTR/LEFT/RIGHT` + relaxed-rule validation, paired with **testnet broadcast** as the
real proof (Chronicle is live there). Defer the SDK-bump decision to Phase 7.

---

## Addendum C — Two-transaction collection model (TX1 template anchor) [design 2026-06-10]

**Supersedes** the inline-field token model in the main plan and Addendum A's field vector. Confirmed with the
user: applies UNIFORMLY to every collection.

**Decision:** a collection is created with TWO transactions:
- **TX1 (Collection Template):** a PushDrop output committing ALL immutable collection data — `tokenName`,
  `tokenRules`, covenant template (`covenantScript`), and (optionally) an embedded file. Created once per
  collection and kept UNSPENT (in the UTXO set ⇒ non-prunable). **TX1's txid = the Collection ID.**
- **TX2 (Genesis) + every token/edition:** a minimal, constant-size PushDrop token output carrying only
  `[ P, version, recordType=TOKEN, TX1-ref(32B), stateData ]` + ownership, plus covenant logic in the locking
  script for covenant collections.

**Identity = Collection ID = TX1 txid** (carried as `TX1-ref`). All members of a collection share it
(interchangeable editions, fungible-like); individual UTXOs are tracked by outpoint (txid:index) + stateData.
**No per-token Token ID, no carried `genesisTxId`** (confirmed with user — it adds bytes + a genesis/transfer
field asymmetry without improving security; a forger can carry the real value, only descent-walking catches
forgeries). Publisher's pubkey = the **lock key of the TX1 template output** (recoverable via `pushDrop.decode`),
so it needs no separate field.

**Why this model:**
- Solves immutable **file binding** (file lives in TX1; `TX1-ref` is the identity ⇒ altering the file changes
  TX1's txid ⇒ changes the collection identity) with NO tokenAttributes field.
- **Eliminates the empty-field / OP_0→[0] Token ID trap**: the only identity input is a fixed 32-byte txid,
  never empty, never re-derived from variable-length encoded fields. No canonicalization patch needed.
- TX1 txid = natural **Collection ID**, shared by all editions — ideal for unlimited mints.

**No on-chain proof cargo.** MPT embedded a growing proof chain in the transfer OP_RETURN; PHAR LAP drops it
entirely (it would make every transfer progressively more expensive). Lineage is implicit on-chain (each
transfer spends its parent as Input 0); the verifier reconstructs it by following inputs and fetches ancestor
txs + Merkle proofs **on-demand** from the network by txid (standard SPV, not an indexer). Off-chain **BEEF**
bundles (BRC-62/64; `@bsv/sdk` `BEEF_V1/V2`/`MerklePath`) for offline verification are a later enhancement.
⇒ transfers are **minimal and constant-size forever**.

**Verification (lightweight default, per Addendum A):** read token's `TX1-ref` → fetch TX1 (non-prunable) →
read name/rules/covenant/file + publisher pubkey → check the token's covenant matches TX1's commitment → confirm
the **immediate parent** (Input 0's source) is a confirmed, covenant-matching PHAR LAP token of the same
collection. (A fresh forgery fails this because its Input 0 is a plain funding UTXO, not a covenant-C token.)
Optional **deep verify** walks the descent and recognizes the publisher-authorized genesis via the publisher pubkey
committed in TX1.

**Covenant note:** the executable covenant still travels in each token's locking script (miners can't read TX1).
TX1 holds the canonical covenant commitment; integrity = miner-enforced self-propagation + a wallet check that
the token's covenant matches TX1. (Genuine "does it simplify the covenant" answer: simplifies the data/params it
carries, not the enforcement logic.)

**Cost:** one extra TX per COLLECTION (not per token — editions just reference the existing TX1). Verifiers
fetch TX1 once (cached per collection).

**Field layouts** (PushDrop data fields, in order; the PushDrop lock key carries ownership/authorship):
- Token (lock=owner):     `[ P(0x50), version(0x03), recordType(0x02=TOKEN), TX1-ref(32B), stateData ]`
- Template (lock=publisher): `[ P, version, recordType(0x01=TEMPLATE), tokenName, tokenRules(8B), covenantScript, fileHash?(32B) ]`
- File (lock=publisher):     `[ P, version, recordType(0x03=FILE), mimeType, fileName, fileBytes ]`  (separate TX1 output, optional)

`stateData` is mutable and NOT in the identity (empty normalizes to a 1-byte sentinel `"00"`). `tokenAttributes`
is removed entirely. Phase 2 builds the field codec for these (no proof-chain/OP_RETURN-cargo codec needed);
covenant enforcement and file-output construction land in later phases. NOTE: `PharLap/PLAN.md` (this file) is
now the source-of-truth plan.

---

## Addendum D — Data layer (hybrid) + detection model [design 2026-06-10]

**Goal context (user):** PHAR LAP (like MPT/SVphone) ships as **standalone HTML/JS apps** usable in a plain
browser, shareable as links on Web2 sites, zero-install, simplest-possible UX for mint/share/buy/sell. This
rules out **Level 2** (BRC-100 `WalletClient` → external wallet dependency).

**Decision — hybrid data layer:**
- Keep `walletProvider` (WoC) for the provider-bound pieces: **address-UTXO listing (funding), raw-tx fetch,
  broadcast**. (Address-UTXO listing is inherently provider-bound in the raw-key model; the SDK's SPV layer
  doesn't do address scanning.)
- Use **@bsv/sdk `MerklePath` (BRC-74 BUMP) + a `ChainTracker`** (`defaultChainTracker()` / `WhatsOnChain`) for
  **verification** — standard, swappable provider, less bespoke code, and BEEF-ready. Verify functions take a
  `ChainTracker` so the source is pluggable (WoC now, ARC/overlay/local-headers later). Trust is unchanged:
  proofs are verified against headers; the provider is not trusted.

**Detection model — 1-sat P2PKH notification output (scan) + local tracking:** PushDrop token outputs
(`<pubkey> OP_CHECKSIG <data> OP_DROP`) are non-standard and **NOT indexed by WoC under the owner's P2PKH
address**, so MPT's raw "scan for the token output" doesn't find them. PHAR LAP preserves scan-based discovery
with one indirection:
- A transfer adds a small **P2PKH notification output (1 sat)** to the recipient's address (which IS
  address-indexed) next to the PushDrop token. The recipient scans their address history → finds the notifying
  tx → parses it for the token locked to their pubkey (`findOwnedTokenOutputs`) → verifies → records. (1 sat,
  not 0: a 0-sat spendable output is non-standard/dust-rejected; OP_RETURN is 0-sat but not address-indexed.)
- The wallet also keeps a **local store of its own token outpoints** (mints it makes / tokens it receives).
- Notification is **default-on for sends, optional** (omit for the buyer-built covenant flow, for privacy, or
  when sharing the tx out-of-band via link/BEEF). Sending requires the recipient's **public key** (P2P-K-style
  lock), not just an address; the notify address is derived from the pubkey.
- Funding (P2PKH change) IS WoC-address-indexed, so fee funding via `getSafeUtxos` is unaffected.

This is a deliberate deviation from MPT's `checkIncomingTokens` address scan (recorded in
docs/DEVIATIONS_FROM_MPT.md). **Level 2 (full BRC-100 wallet)** remains the eventual path for Metanet-app
integration, where the wallet supplies outputs + BEEF proofs and WoC disappears.

---

## Addendum E — Publisher↔holder messaging + transfer tracking (later feature; hooks reserved) [design 2026-06-10]

Use case: a publisher mints tokenized content, sells editions (permissionless replication), and later wants to
reach holders (announcements, airdrops, loyalty, direct messages). Two complementary models:

- **Broadcast (pull / private):** the publisher publishes a message ONCE, anchored to the collection's publisher
  pubkey (the TX1 lock key). Any **current** holder polls the publisher's address for `RECORD_MESSAGE` records
  referencing their collection. Reaches current owners regardless of free transfers, flat cost, and the publisher
  need not know who the holders are.
- **Targeted / per-holder (push):** the publisher sends a (1-sat P2PKH + payload) to specific holders. Requires
  knowing each holder's **pubkey** — which the publisher learns from (a) royalty payments revealing original
  buyers' replica outputs, and (b) **transfer notifications** for current holders (below). Enables encrypted DMs.

**Encryption:** because tokens lock to **pubkeys**, the publisher learns each holder's pubkey and can **ECIES-encrypt**
a message to it (only the holder's privkey decrypts). `@bsv/sdk` has ECIES. Messages may be public or encrypted.

**Transfer tracking (publisher-notify) — per-collection, opt-in, private by default.** Ordinary transfers are
fee-free and invisible to the publisher, so the royalty list reflects original buyers, not current owners. To let
the publisher track **current** holders, a transfer can add a **1-sat P2PKH notification to the publisher's address**
(publisher pubkey = TX1 lock key); the publisher scans their address → sees every transfer → reads the new owner's
pubkey. This makes the collection **publisher-tracked** (publisher sees the ownership graph) — a deliberate privacy
trade, so it is the **publisher's explicit choice at mint** via the `RESTRICTION_TRACK_TRANSFERS` rules bit
(visible to buyers before they buy). Private by default.

**Holder opt-out is a hard requirement (consent-first).** The buyer/current holder must always be able to
opt out, which constrains the design:
- **Opt out of being tracked:** the publisher-notify is a **default-on, holder-OMITTABLE** output — the holder's
  wallet can simply not add it on transfer. Therefore transfer-tracking is a **wallet convention, NOT
  covenant-enforced** (a covenant mandate would remove the opt-out). If a publisher ever wants *enforced* tracking,
  that must be **disclosed before purchase** (informed consent — the buyer sees it and can decline to buy); it is
  never silent.
- **Opt out of receiving/seeing messages:** always available at the receiver — the holder's wallet filters/ignores
  publisher messages regardless of what the publisher sends.
- **Boundary:** the *initial purchase* unavoidably reveals an original buyer to the publisher (buying = paying the
  royalty-fee output). Opt-out covers ongoing transfer-tracking + message display, not the purchase-time royalty.
The messaging-phase UI must surface these choices to the buyer/holder explicitly.

**Hooks reserved now (no full feature yet):**
- `tokenCodec`: `RECORD_MESSAGE = 0x04`; `RESTRICTION_TRACK_TRANSFERS = 0x0004` (+ `decodeTokenRules().isTracked`).
- `transfer.buildTransferTx`/`createTransfer`: optional `notifyPublisher` + `publisherPubKeyHex` → adds the 1-sat
  publisher notification (`publisherNotifyVout`). Off by default.
- ECIES for encrypted messages: deferred to the messaging phase (SDK provides it).

Deferred: the announcement/pull channel, the message record format (plaintext + ECIES), and covenant-enforced
tracking. Reserving the bits/record-type now keeps both models open without committing to either.

### Addendum E — IMPLEMENTATION STATUS (Messaging v1, 2026-06-11) + future work

**v1 BUILT & validated (offline + mainnet, by the user):** targeted, encrypted/public, authenticated on-chain
DMs carrying text + file. Record = exact P-token twin `[P, ver, RECORD_MESSAGE(0x04), ref(32), envelope]` (the
reserved script field was dropped as redundant). `src/messageCodec.ts` (envelope = version‖flags‖senderPubKey‖
body; body = TLV parts text/key/file-inline/file-ref, plaintext or authenticated real-key ECIES electrum,
noKey=true with senderPubKey in header), `src/messageBuilder.ts` (buildMessageTx → message PushDrop + 1-sat
notification + change; sendMessage; scanIncomingMessages = history ∪ getUtxos mempool-aware), tokenCodec
MessageFields + build/parseMessageScript. Minimal "Messages" UI (compose + Check messages → inbox).

**FUTURE DEVELOPMENT WORK (recorded 2026-06-11):**
- **UI overhaul (significant, time-consuming):** make the messaging UX feel like a real email / DM client —
  conversation threads (group by counterparty / `ref`), persistent local inbox+sent store (don't re-scan/re-
  decrypt every time), contacts/known-senders, compose-reply, unread state, spam filtering (only show
  senders/collections you know), attachment gallery, notifications. The current UI is a minimal functional
  stub (send + flat inbox list, transient).
- **v1.1 protocol:** ride-along messages (attach a message/key to a transfer/replicate tx — same-tx key
  delivery for a sale); broadcast/pull announcement channel (anchored to TX1 publisher pubkey, plaintext or
  group-encrypted); ephemeral/anonymous ECIES mode (unauthenticated, hides senderPubKey); `FILE_REF` + the
  hosting layer for large bonus files.

---

## Addendum F — Encrypted content (envelope encryption + permissionless editions w/ key-delivery) [design 2026-06-10]

Goal: gate *viewing* of an embedded file (e.g. an eBook PDF) to token holders — "an inconvenience that makes
direct-from-chain access hard," **NOT foolproof DRM**. Confirmed direction with the user.

**Scheme — envelope encryption:**
- Generate a random content key **K** (`Random(32)`). Encrypt the file with `SymmetricKey(K)` (AES-GCM) →
  **ciphertext**. Store the *ciphertext* in the FILE output; bind `fileHash = SHA256(ciphertext)` (the encrypted
  file is identity-bound + tamper-evident). A holder needs only K to view.
- K is wrapped to a holder via **ECIES** (ephemeral — does NOT require the *sender's* private key); the holder
  unwraps with their own private key. Mark the collection **encrypted** (a `tokenRules` bit / template flag) so
  the viewer knows to decrypt.

**Chosen delivery model: permissionless editions + off-chain, K-only key-delivery** (per the key-exposure
analysis — smallest blast radius; a server is needed anyway for shareable sales links, so the availability
dependency is non-blocking):
- Buyers **self-mint** editions permissionlessly (covenant, Addendum A); they don't have K at mint time.
- The publisher runs a **delivery service that is keyless except for K**: it watches the chain (read-only) for paid
  editions (via the publisher-fee / notification, Addendum E), verifies on-chain that the requester holds a paid
  edition, then delivers `wrappedK = ECIES(K, buyerPubKey)` **off-chain** (HTTP, or a message per Addendum E).
  Because ECIES delivery is ephemeral and the buyer can *verify* K works (it must AES-decrypt the on-chain
  ciphertext to a file matching `fileHash`), the service needs **no publisher signing key** — the publisher's
  identity/spending key stays **offline/cold**.
- The buyer's wallet verifies K, stores `wrappedK` locally (keyed by collection), and the **View** flow unwraps
  K → AES-decrypts the on-chain ciphertext → displays.
- For **wallet-mediated transfers** (seller → buyer), the seller re-wraps K into the recipient's token
  **`stateData`** on-chain, so the key travels with the token. So `wrappedK` lives in `stateData` (on-chain, for
  transfers / publisher-held editions) and/or the buyer's local store (off-chain delivery for permissionless
  purchases); View checks both.

**Key exposure:**
- *Shared, irreducible:* the delivery service holds K; a breach leaks K → the immutable on-chain ciphertext is
  decryptable forever. Acceptable under the "inconvenience, not DRM" bar.
- *Minimized:* the service holds **only K** (no publisher signing key). Use **per-collection K** so one breach
  doesn't expose other collections; a dedicated hot key for any signing; manual delivery for low volume.

**Honest limits:** any holder can extract K + plaintext; no revocation of past holders; once K leaks the
ciphertext is forever decryptable; viewing new permissionless purchases depends on the publisher's delivery service
(an *availability*, not *trust*, dependency — it's the publisher's own service).

**Building blocks (all confirmed in @bsv/sdk):** `SymmetricKey` (AES-GCM) for the file; `ECIES` (ephemeral) +
`PrivateKey.deriveSharedSecret` for key-wrapping; `Random` for K. `stateData` carries `wrappedK` on the on-chain path.

**Status:** design reserved; depends on the covenant (Addendum A, editions) + key-delivery (Addendum E messaging
or a simple HTTP service). Server required — acknowledged and non-blocking (needed anyway for shareable links).

### Addendum F — REFINED: the three delivery tiers, watermarking, and the honest security model [2026-06-11]

The "chosen model" above is essentially Tier 2/3 below. After mapping the full spectrum with the user, the
**root constraint** is the anchor for everything: **BSV Script cannot decrypt**, so you can never enforce "holds
the token ⟹ the chain hands over K" on-chain. Gating K *always* requires a live party (a server or a person's
wallet). Remove the live party and K must be sitting somewhere readable. Corollary (the chicken-and-egg of
passive flows): in a *fully passive permissionless replicate* the key **cannot be per-recipient encrypted** —
buyer B replicating from holder A can't read a key ECIES-locked to A, so the wrap must be unwrappable by *every*
holder via a shared method the wallet carries… and the wallet is open-source, so that method is **public**.
Therefore "wrapped" in a passive design = **shared obfuscation**, never real per-recipient crypto.

**Tier 1 — passive, no server, shared-K + obfuscated wrap (lightest; K exposed-in-principle).** One per-collection
`K`; AES-GCM ciphertext stored on-chain (its own tx). `wrappedK` = `K` *encoded/obfuscated* (never raw bytes; a
shared unwrap method) delivered to each owner via the **1-sat RECORD_MESSAGE key-part** (Addendum E) — kept in a
**separate tx from the content ciphertext**. Propagates through permissionless replicate by copying the wrapped
blob forward (no live party). Defeats casual block-explorer copy-paste, but a coder reads the open-source unwrap
and extracts `K` in minutes → the *real* security is **economic, not cryptographic**: (a) content priced below
the bother-cost of extracting, and (b) the **resale incentive** (Addendum A royalties make legit replication
profitable, so leaking sabotages a market the holder benefits from). Tx-separation + non-raw encoding = casual
friction only. The user's chosen v1 shape, and it needs no new infra (messaging is built).

**Tier 2 — live sender, no *dedicated* server, real per-recipient ECIES (private, needs availability).** The
publisher's or a holder's online wallet delivers `wrappedK = ECIES(K, buyerPub)` per buyer (RECORD_MESSAGE key-part,
or `stateData` on a wallet-mediated transfer). `K` is *not* exposed on-chain (ciphertext to one recipient). Cost:
someone must be online to respond; not instant/permissionless. A strict upgrade over Tier 1, reachable today.

**Tier 3 — server, per-buyer WATERMARK + encryption, content OFF-chain (the polished product).** Content leaves
the chain; the chain becomes the **trustless purchase receipt** (the edition mint / replicate + publisher-fee). A
**"keyless-except-content"** server watches the chain read-only, verifies the buyer paid, **watermarks the
plaintext per-buyer**, encrypts (to the buyer's pubkey), and serves for immediate download. Publisher *signing* key
stays cold; the server now holds the **master content** (the asset to protect). **Critical distinction:** per-buyer
*encryption* ≠ per-buyer *watermark*. Encryption protects transit/at-rest + binds to identity, but the *decrypted*
plaintext is byte-identical → untraceable once shared. A *watermark* makes each buyer's plaintext unique → a
leaked plaintext fingerprints the leaker. **Rule: watermark the plaintext, then encrypt.** Watermark = the
deterrent; encryption = transport. (Visible "Licensed to X" stamp = simple + survives re-encode; forensic/steg =
stronger, more work. Fast for docs/images, heavy for video.)

**The honest ceiling (all tiers — trusted-client / analog-hole):** on general-purpose hardware, *any legitimate
recipient* can extract `K` and the plaintext (a modified or instrumented wallet reads `K` the instant it
decrypts). So the tiers do **not** differ in "is it copyable" (it always is, by whoever legitimately receives K).
They differ in **who can get K casually** (Tier 1: anyone reading the chain, no purchase; Tier 2/3: only paying
buyers) and **whether leaks are traceable** (Tier 3 watermark). The only ways to *not* hand the user K are
server-side-render-only (still screen-capturable) or hardware DRM (TEE/Widevine — out of scope, still beatable).
Realistic goal stays: **tie access to a purchase, kill casual chain-scraping, make leaks traceable and
economically irrational** — "an inconvenience, not DRM."

**Cross-tier moat (the genuinely novel bit):** trustless on-chain purchase proof + (Tier 3) traceable watermark +
the **resale incentive** = leaking is *cheap to avoid* (just buy), *traceable to me*, and *self-sabotaging* (kills
my own royalty stream). That flips DRM from punish-only to reward-the-honest-path — most schemes lack the carrot.

**Phasing:** Tier 1 buildable now (no new infra; AES-GCM the file + a key-part message + a shared encode). Tier 2
reachable now (publisher-active messaging). Tier 3 = the eventual product (needs the server that shareable links /
large files need anyway). Pair any tier with **per-buyer watermarking** for traceability. Primitives: `SymmetricKey`
(AES-GCM), `ECIES`, `Random`; RECORD_MESSAGE key-part (Addendum E) for Tier 1/2 delivery; off-chain HTTP for Tier 3.

---

## Addendum G — Covenant v2: ranged percentage pricing + reseller-set price [design 2026-06-13]

**Why now.** Still experimental, so this is the moment to finalize the covenant to its intended FINAL shape.
A covenant is immutable per collection; once testers/publishers mint on v1 the wallet must parse both forever.
Locking the design before the public deploy avoids a v1/v2 split. The public test therefore runs on the
FINALISED covenant (Step 3 deploy waits for it). Non-covenant work already shipped (sales pages, recovery,
notes, bonuses) is unaffected.

**Motivation — BSV/fiat volatility.** A fee/price fixed in sats at mint drifts badly if BSV moves (a 5,000-sat
royalty becomes expensive if BSV 50×'s; a fixed ebook price is unrealistic long-term). Fix: the price becomes a
**percentage of a reseller-chosen price within a publisher-set band** — each reseller acts as a local
price-discovery agent tracking real value within bounds, no oracle. Decision (2026-06-13): **percentage-only**
fee model (no fixed-sat mode). Permissionless replicate stays the core (buyer one-clicks; reseller PRE-SETS the
price; no holder action at buy time).

### Money flow (final)

```
Reseller sets price P  — within the publisher's [min,max], range-checked, owner-signed (mutable field)
A buyer one-clicks "Get a copy" and pays:
  • P, split by the COVENANT (miner-enforced):
        publisher  = ⌊P × c%⌋        → publisher address (baked at mint)
        reseller = P − publisher      → holder address (hash160 of the owner pubkey, in-script)
  • + host fee (page-added, CONVENTION, on top):
        host     = ⌊P × h%⌋        → the domain that served the link
  • + token sat + network fee
```

- `c%` (publisher), `h%` (host), and `[min,max]` are **baked at mint, immutable** (like today's fixed fees).
- **Rounding:** integer math; the reseller absorbs truncation dust (publisher gets exactly `⌊P×c%⌋`, reseller the
  remainder). Express `c%` as **basis points** (`pBps`, 0–10000): `publisherCut = P × pBps / 10000`.
- **Range matters:** `min` stops a reseller zeroing `P` to dodge the publisher's cut (and sets the royalty floor
  `c%·min`); `max` caps it. Aligned incentives: the reseller maximises their own `(1−c%)·P` against demand; the
  publisher rides at `c%` of whatever the market bears.

### Publisher fee = covenant-enforced; host fee = convention (the asymmetry)

- **Publisher fee** is enforceable: the publisher address is fixed at mint, so the covenant computes `P×c%` and
  REJECTS any sale that doesn't pay it. Miner-guaranteed.
- **Host fee** is NOT enforceable in the covenant: the host is *whichever domain served that link* — unknown at
  mint, unverifiable in-script (a buyer would set the host address to themselves and pocket it). So it stays a
  **page-added trailing output** (same sticky-default trade as the seller-note), now a percentage. It sits **on
  top** of the split, not inside it — otherwise a buyer bypassing the hosted page would shrink the *reseller's*
  take (penalising the reseller for something they don't control). On-top means publisher+reseller are unaffected
  by host-fee bypass; only the host loses if bypassed. Configured per-deployment (a `<meta>`/build constant for
  the host address + `h%`); disclosed in the buy confirmation (price + platform fee + network).

### Covenant changes (v2)

Current edition: `[P, ver, RECORD_EDITION, tx1Ref(32), ownerPubKey(33), stateData]` `OP_2DROP×3` + shared
prefix + `selector OP_IF transfer OP_ELSE replicate OP_ENDIF`. v2:

1. **New fixed-length PRICE field** in the script, placed AFTER ownerPubKey so the owner offset (40) and tx1Ref
   offset (7) stay stable: `… ownerPubKey(33) ‖ price(8, LE)`. Fixed length → constant offsets → extractable in
   script like the owner pubkey (and the varint/scriptlen stay constant, so the quine/swap machinery is unchanged
   in shape). Bump the edition **version byte** (0x03→0x04) as a covenant-rules marker (pre-launch = no v1
   back-compat, but the byte future-proofs the parser).
2. **Third branch: UPDATE (owner-signed).** Selector grows from 2 to 3 (numeric selector or nested IF:
   0=replicate, 1=transfer, 2=update). Update re-creates the covenant with a NEW price, **range-checked**
   `min ≤ P ≤ max` (`OP_WITHIN`, min/max baked), owner sig verified (reuse the transfer branch's
   `OP_CHECKSIGVERIFY`). Everything else (tx1Ref, owner, covenant body) copied verbatim. (The seller-NOTE does
   NOT need this — it already lives outside the covenant on the notification output and is editable by
   re-publishing; the mutable field is for PRICE only.)
3. **Replicate branch: computed fee outputs** (replace the baked constants).
   - Extract `P` from the price field; `OP_BIN2NUM` → number.
   - `publisherCut = P × pBps / 10000` (`OP_MUL`,`OP_DIV`; `pBps` baked). `resellerCut = P − publisherCut` (`OP_SUB`).
   - Encode each as an 8-byte LE output value with **`OP_NUM2BIN(cut, 8)`** (positive, `< 2^63` ⇒ correct
     unsigned LE), then `‖ varint(25) ‖ P2PKH(addr)` — `out[2]` to the baked publisher hash, `out[3]` to
     `hash160(ownerPub)`. Post-Chronicle big-int math means no overflow for sane `P`; **cap `max` well under
     `2^63`** and keep the price field 8 bytes. Optionally re-check `min ≤ P ≤ max` here too (defence in depth;
     primary enforcement is at update so a reseller can't store an out-of-range price).
4. **Replica (`out[1]`) clones the price field verbatim** → the buyer inherits the reseller's price and can later
   UPDATE it (range-checked). Genesis mint sets an initial in-range price.
5. **Unlock templates:** replicate = no sig (`OP_0` selector + preimage); transfer = owner sig + new owner;
   update = owner sig + new price. Scopes unchanged (replicate `ANYONECANPAY|ALL|FORKID = 0xc1`; owner-signed
   branches use `ALL|FORKID` for the sig + introspection).

### The honest caveat (volatility)

Percentage fees auto-track the reseller-adjusted `P`, but the `[min,max]` **band is fixed in sats at mint**, so
it absorbs MODERATE volatility (reseller slides within the band) — an extreme long-term move drifts the band
itself. Mitigations: set a **wide band** (near-total reseller latitude, soft publisher floor/ceiling); or, much
later, a **fiat-pegged price via an oracle** (robust but reintroduces a trusted feed — out of scope).

### Build / validation plan (foundational — spec-first, validate before wiring)

1. Implement v2 covenant ops in `covenant.ts` incrementally, each **`Spend`-validated offline** (as L1–L5 were):
   price-field extract → `NUM2BIN` fee outputs → percentage math → UPDATE branch + 3-way selector + range check.
2. **Prototype the riskiest pieces on MAINNET first** — the `OP_MUL/OP_DIV/OP_NUM2BIN` fee computation and the
   owner-signed UPDATE branch — confirming a real mint → set-price(update) → permissionless-replicate cycle is
   relayed/mined (mirror the original replicate validation at block 953007). Only then layer the rest.
3. Wire `editionBuilder` (genesis takes `pBps`/`min`/`max`/initial price; new `updatePrice`; replicate reads the
   price; funding/disclosure) + the wallet UI (publisher sets `c%`,`min`,`max` at mint; holder sets price within
   band; buy shows the computed split + host surcharge) + the host-fee percentage trailing output.
4. **Then** deploy the public test (Step 3) on the finalised covenant.

### Open knobs to confirm at build time

- `pBps` precision (basis points = 0.01% granularity — enough?); default `c%`, `h%`, and `[min,max]` suggestions.
- Whether to re-check range at replicate (defence-in-depth) vs update-only.
- Price field 8 bytes (cap `max` ≪ 2^63) — confirm sane upper bound.
- Host-fee config surface (per-deployment `<meta>` vs build constant) + how the page learns its own host address.

### Future extension (non-covenant) — multi-level referral fees [idea 2026-06-13]

Same family as the host fee — **page-added, percentage, on-top, convention** (bypassable like web/MLM
referrals, NOT miner-enforced) — a sellable future feature, no covenant change.

- **Elegant fit:** PharLap's resale chain IS a referral chain (publisher → A → B → C). We already propagate data
  sale-to-sale (the seller-note echo) and track provenance, so a propagating **referrer stack** (the last N
  sellers'/referrers' payout addresses) can ride the same outputs. Each buy pays the stack on a **decaying
  schedule** (e.g. L1 2%, L2 1%, L3 0.5%), then pushes the current seller and trims to N.
- **Knobs:** levels `N` + the percentage schedule (**cap the total** — every level adds to the buyer's
  surcharge and stacks with the host fee); **resale-chain referrers** (owners) vs **affiliate-link referrers**
  (promoters who needn't own); schedule set by the **publisher at mint** (TX1 metadata, non-covenant) so honest
  deployments honour it.
- **Reality:** convention only — a buyer/modified page can omit payouts or stuff the stack with their own
  addresses (the same circumvention the web already lives with). That's the accepted price of zero covenant
  change. Keep percentages small and the depth shallow so the buyer's total stays sane.

---

## Next phase — Public web version (3-step plan) [planned 2026-06-12]

Goal: a publicly-hosted, multi-user-safe web build people can open and test end-to-end (mint / replicate /
transfer / message / encrypted content), much like the SVphone public test — but without SVphone's API
rate-limit failure. PHAR LAP is fully client-side (browser + WhatsOnChain), so no backend is required.

### Step 1 — Serverless WoC + attribution (UNBLOCKS multi-user testing; do first)
The SVphone failure: the dev server proxied every `/woc/*` call, so WoC saw ALL users' calls coming from ONE IP
(the server) and rate-limited the aggregate. Subdomains don't fix this (they resolve to the same server IP). The
fix is to have **each browser call `api.whatsonchain.com` DIRECTLY**, so calls originate from each user's OWN IP
and WoC's free per-IP limit applies per-user, not in aggregate.
- Make `walletProvider` base URL configurable: production = direct `https://api.whatsonchain.com/v1/bsv/main`;
  keep the `serve.mjs` proxy only as a local-dev convenience (e.g. choose by `location.hostname === 'localhost'`).
- Verify WoC is **CORS-enabled** for every endpoint used (read endpoints yes; confirm broadcast `POST /tx/raw`).
- Reduce per-user call volume: the provider already caches raw txs (`txCache`); debounce/avoid polling; reuse
  fetched TX1s (the `nameCache` pattern). A shared WoC **API key** raises the limit but RE-SHARES one bucket, so
  it's a complement, not a substitute for per-user-IP.
- Add a **"Powered by WhatsOnChain"** footer linking to https://whatsonchain.com — VERIFY exact wording/placement
  against WoC's current free-tier terms before shipping (compliance, not approximation).
- Acceptance: two testers on different networks/IPs run the full flow with no rate-limit blocks; attribution visible.

### Step 2 — Shareable collection links + public view page (the headline feature)
The "shareable sales link" from the product vision; builds on the existing permissionless replicate.
- **Hash routing** (works on static hosting, no server routing): `…/#c=<TX1-txid>` → read `location.hash` on load.
- **Collection view page:** fetch TX1, render name + rules/terms (publisher/holder fees, edition flag, encrypted
  flag), and a file preview (decrypt if a holder + encrypted, else a "🔒 holders only" placeholder).
- **"Get a copy"** action = the permissionless replicate flow (auto-create a wallet if none). Friction to design:
  a stranger needs funds — testnet faucet, or a "fund this address to buy" prompt on mainnet.
- **Share** button: copy the `#c=…` link for a collection you hold/created, to paste anywhere.
- Acceptance: a link opens the right collection from a fresh browser; "Get a copy" replicates (with funds); the
  share button yields a working link.

### Step 3 — Deploy to static hosting + test harness (hand out a URL)
**GATED on Covenant v2 (Addendum G):** finalise + mainnet-validate the v2 covenant FIRST, so the public test
mints on the intended covenant and we avoid a v1/v2 split. Deploy mechanics (Namecheap cPanel Git + `.cpanel.yml`,
mainnet, root domain, built bundle on origin/main via publish.sh) are wired and ready to go once v2 lands.
- **WIF recovery FIRST (DONE) — prerequisite for multi-device hosting.** The local token store is now treated as
  a rebuildable CACHE; the WIF + chain are the source of truth, so purchases recover on any browser/device.
  `scanIncomingEditions` rewritten to two passes: (1) discover the collections a pubkey holds/held via address
  breadcrumbs, (2) for each distinct (deterministic) edition script, query WoC unspent-by-script-hash → only
  CURRENT live holdings (excludes editions already sold/transferred), reading each one's echoed note/bonus.
  `PharLapStore.clear()`; `switchWallet()` clears the cache and (on WIF restore) auto-recovers from chain; New
  wallet clears too. Holdings, captured notes, and bonuses all rebuild from chain (the on-chain echo work powers
  this); published seller-notes already resolve from chain on demand. Caveat: relies on the breadcrumb assumption
  (acquisitions touch the address — true in practice); a thorough scan is a bounded burst of WoC calls (fine
  per-IP). UI: Restore note + "Check incoming / recover" button. Suite 100/100.
  - Display order: sorted by the acquiring tx's block height (unconfirmed = newest), so a bulk recovery reads
    sensibly instead of in scan order.
  - **TODO (deferred, cosmetic): recovery-browser ordering.** In a recovery browser there is no local action
    timeline, so order falls back to on-chain acquisition height — meaning an edition you bought AFTER minting
    another collection ranks above that earlier mint (honest acquisition-recency, but it can surprise: "my
    newest mint isn't at the top"). Options when revisited: (a) order by each collection's TX1/genesis recency
    so your latest mint floats up regardless of later buys (one extra TX1 fetch per collection); (b) group
    "minted by me" vs "acquired", each newest-first; (c) a manual sort toggle (newest-acquired / by name /
    minted-first). Not blocking — purely display.
- Static deploy: **GitHub Pages** from the public repo (or Netlify/Vercel). Configure base paths for hash routing
  under a subpath (e.g. `/PharLap/`). Build = `index.html` + `bundle.js`; no backend.
- **Network choice for testers (decide here):** small-value MAINNET (Chronicle/v2 confirmed working there) needs
  testers to fund a wallet; TESTNET is friendlier (free faucet coins) **only if Chronicle/v2 is active on testnet
  — VERIFY, since the covenant needs v2**. Likely start mainnet with clear "fund this address" guidance + a tiny
  amount, or stand up a testnet build if v2 is available.
- Onboarding: clear first-run guidance (wallet auto-created → fund address → try mint/replicate/transfer/message).
- Acceptance: multiple testers from different IPs complete the full lifecycle with no rate-limit blocks, and
  shared `#c=…` links work from the hosted URL.

Order is deliberate: Step 1 is the blocker (without it, multi-user testing fails as SVphone did); Step 2 is the
feature that makes sharing worthwhile; Step 3 ships it. Future (post-phase): Tier 2/3 encrypted content + the
key-delivery / watermarking server (the first component that actually needs a backend).

### Step 2 — finalized design (decided 2026-06-12, 4 decisions locked)

Design sketched and decided one question at a time. The four locked decisions:

**D1 — Funding model: mainnet, testers self-fund.**
Initial testers already hold BSV, so no testnet/faucet (also sidesteps "is Chronicle/v2 live on testnet?").
"Get a copy" shows a **fund-this-address** prompt = the wallet's **receiving address** (NOT the pubkey — a
standard BSV wallet sends to an address; the pubkey is only for receiving tokens/messages) + a **copy** button
+ a **QR** of the address (covers PC-testing / phone-funding) + the suggested amount. A **"Buy BSV"** link to
**Orange Gateway** (buy as little as ~$10 BSV) is reserved for real-world use, not the test phase. QR needs a
tiny pure-JS encoder bundled (no external image calls).

**D2 — Resolution: any-holder address-history trace now; tiny read-cache resolver service in production.**
Every current holder gets their OWN share page, not just the publisher. Share link carries collection + holder:
`…/#c=<TX1-txid>&h=<holderPubKey>`. The page resolves **that holder's current edition tip** by tracing the
holder's address history forward (holder-fee P2PKH breadcrumb + the `out[0]`-returns-to-holder quine make the
edition discoverable at its latest outpoint). The buyer's replicate then sources from *that* holder, so the
holder who shared the link earns the holder-fee — the incentive to share your own link. Durable: replicate
returns the token to the holder verbatim, so a holder's edition SURVIVES being a sale source (moves to a new
outpoint); the trace walks only that holder's short forward chain, not the hot-token spine. Production resolver
= a read-cache only (try cached outpoint → if spent-and-not-returned, re-trace → cache new tip); never an
authority, no custody, pure optimization over the same trustless trace. Tests: live trace each load, no cache.

**D3 — Storefront metadata (immutable publisher record + a mutable seller-note on the notification output).**

A field-semantics correction drove the final structure: `tokenRules` is meant to be immutable and `stateData`
mutable — but under the edition COVENANT *both* are immutable, because the covenant reconstructs each spend's
outputs from the token's own script bytes and copies them verbatim (only the 33-byte owner pubkey is swapped).
That immutability is a property of covenant editions only; for plain (non-covenant) PushDrop tokens `stateData`
is genuinely mutable (an owner-signed transfer re-creates the output freely). So immutable storefront data must
NOT live in `stateData` (misuses the mutable field + bloats every ~1KB covenant output); and mutable per-token
state must live OUTSIDE the covenant script (a companion/notification output that isn't part of the cloned
scriptCode). Resulting split — *covenant token carries what must be immutable; a sibling output carries what
must be mutable*:

- *Immutable "what you're buying"* (publisher, set at mint): a dedicated **`RECORD_STOREFRONT` (0x06) output in
  TX1** = `[P, ver, 0x06, description, coverMimeType, coverFileName, coverBytes]`. Self-contained and immutable
  by virtue of living in TX1 (the Collection ID tx, never re-created, locked to the publisher); every edition binds
  to it via `tx1Ref`. Title stays `template.tokenName`. Works even for encrypted collections (cover + blurb
  public, content locked) — the public face of the "🔒 holders only" gate. Cover BYTES live here (too big for a
  script field); editions stay small (no per-edition duplication — one `tx1Ref` fetch the page does anyway).
  **DONE (A.1):** `tokenCodec` storefront codec + `buildTemplateTx` cover output + `createEdition`
  `description`/`cover` params + mint UI fields; 5 tests, full suite 86/86, bundle builds.
- *Mutable "seller-note"* (holder/reseller promo: review, bonuses, **bonus-redemption instructions the buyer
  must see in-wallet**): rides as data on the **purchase notification output**, NOT in the covenant token — so a
  reseller can change it freely (publish a newer one) with zero covenant cost, and the buyer receives the current
  one *with their purchase*, visible in-wallet, on-chain. Overwrite-by-default (i): latest published note wins at
  purchase time; an un-updated note keeps carrying the last seller's promo downstream. No covenant change, no
  fixed-length field, no re-validation.
  **DONE (step 5):** `RECORD_NOTE` (0x07) codec + `sellerNote.ts` (`publishSellerNote` / `resolveSellerNote`
  via the seller's address history) + `getAddressHistory(address?)`. The sales page resolves & shows the link
  seller's current note; the holder gets an editor on their own page (publish = overwrite-latest). The buyer
  CAPTURES the note at purchase (stored on the edition + shown on the wallet card + post-purchase), and a
  reseller's own page pre-fills the editor with the note they received so they can pass it on in one click.
  4 codec tests; suite 95/95.
  **DONE (on-chain echo + hands-off propagation):** the note now rides as a NOTE output (locked to the
  buyer/new owner) on the replicate AND transfer txs — a trailing output the covenant appends verbatim, so
  `covenant.ts` is untouched and the spend still `Spend`-validates (tests assert both the echo and validity).
  Propagation is a sticky default: a holder's sale carries their own PUBLISHED note if set, else the note that
  rode in on the edition they hold (`readNoteFromTx` of its source tx), so S→B→C→… flows hands-off until a
  reseller overwrites it; received editions capture the note (scanIncomingEditions) for wallet display. Not
  consensus-enforced (the note is deliberately outside the frozen covenant), so a modified client could drop
  it — the price of keeping it freely overwritable. Mempool-aware resolution (getRecentTxIdsForAddress). +3
  edition-echo tests; suite 98/98.

**Bonus delivery (extends the seller-note).** A seller can attach a BONUS to their note that a buyer can
claim straight from the sales confirmation + wallet. Built as structured fields on the NOTE record so it
rides + propagates + overwrites exactly like the promo text (sticky default).
  - **BUILDING NOW — external link/code bonus (instant):** `bonusKind` (link | code) + `bonusValue` on the
    note. Wallet shows a "🎁 Claim bonus" CTA post-purchase (and on the held edition card); a `link` opens
    the seller's URL (their site verifies proof-of-purchase via the txid), a `code` is revealed/copyable.
    Storefront shows a "🎁 includes a bonus" teaser. Public (the value is on-chain in the note) — the seller's
    site does the gating; cheap, no crypto.
  - **FUTURE — on-chain content bonus:** the bonus IS an on-chain (Tier-1-encrypted) file/payload claimed via
    the existing content viewer, instead of an off-chain link — no seller server needed.
  - **FUTURE — timelocked bonus:** a second bonus that unlocks after a block height / date. Two models:
    (A) client-gated reveal (cheap, soft — value sits in the tx, wallet just hides it until the time;
    trivially bypassed); (B) encrypt-now / seller-reveals-key-at-time (real — ciphertext rides with the
    purchase, key withheld until the seller publishes it at unlock; reuses Tier-1 crypto, and the seller's
    timed key-publish is a natural fit for scheduling/automation). (C) fully trustless on-chain timelock =
    heavy, out of scope. Lean: (B) when implemented.

**D4 — First-cut scope: (b) full flow.**
Landing page **+** in-page **"Get a copy"** (auto-create wallet if none → resolve holder's edition tip →
funds check + fund-address prompt → permissionless replicate w/ retry-on-double-spend → reveal/decrypt). The
one-click "anyone can click and own" buy IS the thing being tested (the SVphone-style demo); resolve+replicate
already exist in `editionBuilder.ts`. A read-only landing page alone would just be a viewer.

**Landing-page layout (per-holder link):** `[cover image]` · title · publisher · price (publisher+holder fees) ·
type/lock state · **that holder's seller-note** (if any) · `[Get a copy]` `[Share]` `[Open in wallet]` · WoC badge.

**Build order within Step 2:** (1) hash-route reader (`#c=`,`#h=`) + a collection-view mode in the SPA;
(2) TX1 storefront fetch/render (title/desc/cover/lock); (3) holder-tip resolver over address history (reads the
seller-note from the resolved token); (4) "Get a copy" wired to existing replicate + fund-address prompt (address
+ copy + QR); (5) Share button (emit `#c=…&h=…` for a collection you hold); (6) reveal/decrypt on success.
Covenant/codec work: add the immutable title+description + cover-image-hash to the TX1 template, and the capped
mutable seller-note field at the tail of the edition state (settable on transfer, carried verbatim on replicate).
Mint UI gains the storefront fields (title/description/cover image); a "seller-note" editor sets it via transfer.

---

## ⭐ PRE-LAUNCH TASK LIST — settle before PUBLIC live testing [started 2026-06-15]

The on-chain token format effectively locks once real users adopt it. Per-tx fees on BSV are a rounding error,
but at scale (hundreds of millions of editions) byte-level footprint + a clean format matter collectively — so
these are worth doing now, while the user is the only tester.

- [x] **V1 covenant trim — drop `price` + `stateData` from v1 editions** ✅ DONE 2026-06-15 (offline-validated;
      v1 lock 775 → **763 B**, −12 B/edition). Both were dead weight in v1: `price` (8 B) is read only by v2's
      percentage split — inert in v1; `stateData` is covenant-PINNED (the `suffix` after the owner pubkey is
      reproduced VERBATIM on every transfer/replicate, so it's immutable, and editions always mint it empty) → it
      carried no information in an edition. Trimmed the data fields 7 → 5 (`P, ver, RECORD_EDITION, tx1Ref,
      ownerPubKey`) + drop seq `OP_2DROP×3+OP_DROP` → `OP_2DROP×2+OP_DROP`. v1/v2 layouts now diverge cleanly:
      `editionFieldChunks` = 5 (v1), `editionFieldChunksV2` = 7 (v2 keeps price+stateData for future ranged
      pricing). Owner offset stays 40 (trimmed fields sat after it), so all offset/reconstruction logic is
      unchanged. 126/126 tests green incl. the Spend-interpreter mint→replicate/transfer enforcement.
      ⚠ STILL NEEDS: a fresh mainnet self-test (mint trimmed v1 edition + replicate) before publishing Step 3.
- [x] **Hide v2 (percentage) from the mint UI** ✅ DONE 2026-06-15 (published to origin/main, Steps 1&2). Ranged pricing — the only
      thing that needs v2 — is postponed; a fixed "publisher %" is a UX convenience v1 can do (compute a fixed
      fee from a %, store/enforce fixed, DISPLAY as %). Keep all v2 code + tests intact but unreachable from the
      UI until ranged pricing is built. Enables the V1 trim above (v1 becomes the only minted format).
- [x] **Remove dead legacy MPT modules** ✅ DONE (prior commit). (~2,999 LOC, zero functional risk — not bundled, not tested):
      `tokenBuilder.ts` (2153), `opReturnCodec.ts` (483), `tokenStore.ts` (248), `fileCache.ts` (115). They form
      a closed dead loop (only `tokenBuilder` imports `opReturnCodec`/`tokenStore`; nothing imports `tokenBuilder`
      or `fileCache`). KEEP `tokenProtocol.ts` — `walletProvider.ts` (live) imports its SPV/Merkle types. Confirms
      ON-CHAIN data is all binary (no JSON; the only `JSON.*` is off-chain: localStorage caches + WoC HTTP + logs).
- [x] **Smart compression — GENERAL, applied wherever bytes go on-chain** ✅ DONE 2026-06-15 (published, Steps 1&2). (one mechanism, gated by
      keep-only-if-smaller). gzip via the browser-native `CompressionStream`/`DecompressionStream` (zero deps),
      ALWAYS compress-before-encrypt (ciphertext is incompressible). Two attach points:
      • **Embedded edition files** — set a new `RESTRICTION_COMPRESSED` bit in `tokenRules` (room beside
        ENCRYPTED/REPLICABLE); decompress after decrypt at view. Text/markup → 50–90% (halves mint fee);
        already-compressed media (jpg/png/mp4/pdf/zip) fail the "smaller?" test → stay raw → no-op.
      • **Message envelopes (DMs + broadcasts + message file-attachments)** — add `FLAG_COMPRESSED` (0x02)
        beside `FLAG_ENCRYPTED` in the envelope flags byte; compress the TLV body if smaller. NOTE: typical
        short messages won't compress (gzip's ~18 B overhead > gain at <~150 B, and notes/broadcasts are capped
        280/480 B) — the keep-if-smaller guard auto-skips them, so it's safe but only really helps long messages
        + file attachments. App-layer, covenant untouched, adds on-chain format flags → do pre-launch.
- (add further pre-launch items here as they surface: onboarding, deploy/host decision, WoC-terms check, etc.)
