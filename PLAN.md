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
  - `[2]` creator fee → creator address (immutable field)
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
