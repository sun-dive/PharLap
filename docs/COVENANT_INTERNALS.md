# PHAR LAP Covenant — Technical Internals

A maintainer's reference for the hand-rolled OP_PUSH_TX covenant that powers "unlimited mints" editions.
Written for a future session (Claude or human) that needs to **understand, modify, or repurpose** this
code. It documents the three modules that make up the covenant and — more importantly — the *reasoning*
and the *non-obvious constraints* that are easy to get wrong.

Files covered:
- **`src/pushtx.ts`** — the optimal OP_PUSH_TX primitive (transaction introspection in script).
- **`src/covenant.ts`** — the covenant script logic (output enforcement, the quine, the edition token).
- **`src/editionBuilder.ts`** — transaction construction, unlock templates, discovery, broadcast.

Prerequisites to read this: Bitcoin Script, the BIP143/FORKID sighash, and ECDSA basics.

> **Golden rule for any change here:** the `@bsv/sdk` `Spend` interpreter is your oracle. *Every* covenant
> path is validated offline against `Spend` with `transactionVersion: 2` **before** any broadcast (see the
> test files). If you change a script fragment, re-run the tests; if you can't explain a `Spend` failure,
> hand-trace the stack op-by-op — the inline comments track the stack (top element written last).

---

## 0. The one-paragraph summary

BSV scripts cannot natively see the transaction spending them, and BSV has no `OP_CHECKDATASIG`. So the
covenant uses **optimal OP_PUSH_TX**: the spender pushes the BIP143 sighash *preimage* of the spending
input; the locking script computes `e = HASH256(preimage)`, derives an ECDSA signature over `e` using a
**fixed public keypair `(a, k)`**, and verifies it with `OP_CHECKSIG` against `Q = a·G`. Because
`OP_CHECKSIG` independently recomputes the sighash from the *real* transaction, the spend only validates
when the pushed preimage is genuine. Having forced a genuine preimage, the covenant reads `hashOutputs`
from it and **reconstructs the outputs it requires** (re-creating its own script via the preimage's
`scriptCode` — a quine — and substituting the owner pubkey where needed), rejecting the spend unless the
transaction's outputs match. All hand-rolled on `@bsv/sdk`, no sCrypt.

---

## 1. Platform constraints — BSV Chronicle / transaction version 2 (read this first)

The covenant **only works in transaction version 2** (post-Chronicle relaxed script rules). What that buys
us, and — critically — what it does *not*:

| Rule | v2 (Chronicle) behavior | Consequence for the covenant |
|---|---|---|
| **Low-S** (signature malleability) | **Relaxed** (not enforced) | We never normalise `s`; the derived sig can be high-S. ✅ |
| **Big-integer arithmetic** | Available (no 4-byte cap) | `OP_MUL`/`OP_ADD`/`OP_MOD` on 256-bit numbers work. ✅ |
| **MINIMALDATA** (minimal pushes) | Relaxed | We push fields as explicit length-prefixed data without OP_1..16 folding. ✅ |
| **MINIMALIF** | Relaxed | `OP_IF` accepts the empty/`OP_0` selector as false. ✅ |
| **Clean stack** | Relaxed | Leftover stack items wouldn't fail, but we keep the stack clean anyway. |
| **Signature DER encoding** | **STILL ENFORCED** | ⚠️ The derived signature **must be minimal DER.** This is the single most important constraint — see §3.3. |

Discovered from the `@bsv/sdk` `Spend` source: `shouldEnforceDerSignatures()` returns `true` by default
(it is *not* gated on `isRelaxed`/version). Chronicle relaxes low-S and minimal *push* encoding, but **not**
signature DER. So an in-script signature with an excess `0x00` pad, or a non-minimal length, is rejected as
"The signature format is invalid."

**Mainnet reality (validated 2026-06-11):** version-2 txs are *mined* (a replicate confirmed at block
953007); the ~767-byte covenant output and ~1 KB OP_PUSH_TX unlock are within miner policy.

---

## 2. Module map & data flow

```
pushtx.ts        covenant.ts                         editionBuilder.ts
─────────        ──────────                          ────────────────
deriveSigOps ──▶ covenantPrefixOps ──▶ editionLockOps ──▶ buildEditionLock ──▶ buildReplicate/Transfer/GenesisTx
pushTxVerifyOps    │  replicateTailOps   (OP_IF branch)      (computes offset)      replicate/transferUnlockTemplate
pushTxConstants    │  transferTailOps                         parseEditionScript    create/replicate/transferEdition
pushTxPreimage     └─ extract*Ops, p2pkhScript, serializeOutput                     scanIncomingEditions
```

`pushtx.ts` is generic (any covenant could reuse it). `covenant.ts` builds the edition script from it.
`editionBuilder.ts` constructs/broadcasts the actual transactions and handles wallet-side discovery.

---

## 3. `src/pushtx.ts` — the OP_PUSH_TX primitive

### 3.1 Fixed public constants — `pushTxConstants(scope)`

```
a = 0x1111…11   k = 0x2222…22         (32-byte scalars, PUBLIC, arbitrary-but-fixed)
Q = a·G (compressed, 33 bytes)        r = (k·G).x mod n
ra = (r·a) mod n   kInv = k⁻¹ mod n   n = secp256k1 order
rDerInt = 0x02 ‖ len ‖ minimalBE(r)   (the constant DER integer for r)
scope = sighash type byte appended to the derived sig (default 0x41 = ALL|FORKID)
```

**Security note (important, do not "fix" it):** `(a, k)` are *public* and *reused on every spend*. That is
fine — there is **no secret** here. Reusing a nonce `k` would be catastrophic for a real signing key
(it leaks the key), but `a` is already public, so leaking it protects nothing. The covenant's security
rests entirely on the **preimage binding** (§3.2), never on key secrecy. You may regenerate `(a, k)` to any
valid scalars; everything else (`Q, r, ra, kInv, rDerInt`) derives from them.

### 3.2 Why pushing the preimage forces the real transaction

`OP_CHECKSIG(sig, Q)` recomputes the input's sighash from the **actual transaction** and verifies `sig`
against it. The script derives `sig` as a function of `e = HASH256(pushedPreimage)`. The derived `sig` is a
valid ECDSA signature of `e` under `Q` *by construction*. So `OP_CHECKSIG` passes **iff** `e == realSighash`,
i.e. `HASH256(pushedPreimage) == HASH256(realPreimage)`, i.e. (collision resistance) `pushedPreimage ==
realPreimage`. The spender cannot lie about the transaction.

### 3.3 In-script signature derivation — `deriveSigOps(c)` (the hard part)

Consumes a preimage on top of the stack, leaves the derived DER signature (with sighash byte). Three stages:

**Stage A — `e` as a positive script number:**
```
OP_HASH256            preimage → 32-byte big-endian hash
reverseBytesOps(32)   → little-endian (script numbers are LE)
push 0x00, OP_CAT     append a high zero byte so the value is unsigned/positive (a 32-byte LE value
                      whose top bit is set would read as NEGATIVE)
OP_BIN2NUM            minimise → clean positive number e
```

**Stage B — `s = k⁻¹·((e + ra) mod n) mod n`:** `push ra, OP_ADD, push n, OP_MOD, push kInv, OP_MUL, push n,
OP_MOD`. (`ra`, `n`, `kInv` are pushed as minimal LE script numbers, positive — see `toScriptNumLE`.)

**Stage C — encode `s` as MINIMAL DER without a variable-length reversal (the key trick):**

The naive approach (reverse a variable-length `s`) is painful. Instead exploit this fact: *a positive
script-number's minimal little-endian serialization, byte-reversed, is already a minimal big-endian DER
integer body.* (Script-number encoding already adds a `0x00` sign byte exactly when DER would need one.)
So:
```
OP_SIZE, push 33, OP_SWAP, OP_SUB, OP_TOALTSTACK   stash (33 − len(s))   // leading-zero count after padding
push 33, OP_NUM2BIN                                pad s to a FIXED 33-byte LE
reverseBytesOps(33)                                → 33-byte big-endian (value in low bytes, zeros on top)
OP_FROMALTSTACK, OP_SPLIT, OP_NIP                  drop exactly (33 − len(s)) leading zero bytes
                                                   → minimal big-endian s
OP_SIZE, OP_SWAP, OP_CAT                           prepend the length byte:  <len> ‖ sBE
push 0x02, OP_SWAP, OP_CAT                          → 0x02 ‖ <len> ‖ sBE   (a DER INTEGER)
```
Then frame the full signature: `push rDerInt, OP_SWAP, OP_CAT` (r is constant), `OP_SIZE, OP_SWAP, OP_CAT`
(bodylen), `push 0x30, OP_SWAP, OP_CAT` (SEQUENCE), `push scope, OP_CAT` (sighash byte).

Why `NUM2BIN(s, 33)` is safe: `s < n < 2²⁵⁶`, so `s` fits in 33 bytes (32 magnitude + sign) with room to
spare; the fixed 33 lets us use a fixed-length `reverseBytesOps(33)` and recover minimality by stripping a
*runtime-counted* number of leading zeros via `OP_SPLIT`. No variable-length reversal anywhere.

### 3.4 `reverseBytesOps(len)`

Reverses the top stack item, assuming it is exactly `len` bytes:
`(len−1)×[OP_1 OP_SPLIT]` (peel into single bytes) then `(len−1)×[OP_SWAP OP_CAT]` (re-concatenate in
reverse). Fixed-length only — there is deliberately no variable-length reversal in this codebase.

### 3.5 Entry points

- `pushTxCheckOps(c)` = `deriveSigOps + push Q + OP_CHECKSIG` → leaves a **boolean** (used in primitive tests).
- `pushTxVerifyOps(c)` = `OP_DUP + deriveSigOps + push Q + OP_CHECKSIG + OP_VERIFY` → **leaves the verified
  preimage on the stack** for the covenant to dissect. This is what real covenants use.
- `pushTxPreimage(params)` wraps `TransactionSignature.format` — builds the preimage the unlock must push.
  Its `scope` **must equal** the covenant constants' scope, or `OP_CHECKSIG` computes a different sighash and
  fails.

`deriveSigOps` uses the alt stack internally (Stage C) but is **balanced** (every `OP_TOALTSTACK` has a
matching `OP_FROMALTSTACK`), so the covenant may freely use the alt stack afterwards.

---

## 4. `src/covenant.ts` — the covenant script

### 4.1 The BIP143/FORKID preimage layout (memorise these offsets)

```
 4   version
32   hashPrevouts        (zeroed when ANYONECANPAY — but still 32 bytes)
32   hashSequence        (zeroed when ANYONECANPAY — but still 32 bytes)
36   outpoint            (txid 32 ‖ index 4)
var  scriptCode          (varint(len) ‖ the locking script being spent)
 8   value (satoshis)
 4   nSequence
32   hashOutputs         (= HASH256 over each output: value(8 LE) ‖ varint(scriptLen) ‖ script)
 4   nLocktime
 4   sighashType
```

Two fields are extracted at **fixed offsets** (independent of script length *and* of ANYONECANPAY, since the
zeroed hashes still occupy their 32-byte slots):

- **`hashOutputs`** = preimage bytes `[len−40, len−8)` → `extractHashOutputsOps()`:
  `OP_SIZE, push 40, OP_SUB, OP_SPLIT, OP_NIP, push 32, OP_SPLIT, OP_DROP`.
- **`scriptCode` field** (`varint ‖ script`) = preimage bytes `[104, len−52)` → `extractScriptCodeFieldOps()`:
  `push 104, OP_SPLIT, OP_NIP, OP_SIZE, push 52, OP_SUB, OP_SPLIT, OP_DROP`. The leading `104 = 4+32+32+36`.
  Returned *with* its varint so it slots straight after an 8-byte value to rebuild "an output paying this
  script."

### 4.2 Output-serialization helpers

`u64le(n)` (8-byte LE value), `varInt(n)` (CompactSize), `numLE(n)` (minimal LE script number, for OP_SPLIT
indices), `serializeOutput(sats, script)` = `u64le ‖ varInt(len) ‖ script`, `p2pkhScript(hash20)` =
`76 a9 14 <hash20> 88 ac`.

### 4.3 How output enforcement works (L1, the foundation)

`hashOutputs` is a single hash of *all* outputs, so you cannot enforce a "prefix" directly. Instead the
covenant **reconstructs the required outputs in script**, concatenates **spender-supplied trailing outputs**
(their change, pushed in the unlock), hashes the whole thing, and asserts it equals `hashOutputs`:
`HASH256(reconstructed ‖ spenderOutputs) == hashOutputs`. The spender can choose their change freely (they
supply it) but cannot alter the reconstructed prefix. `outputPrefixCovenantOps` is the minimal L1 form.

### 4.4 The quine — re-creating the script (L2/L3)

The covenant rebuilds **its own** locking script for the new outputs by reading the `scriptCode` field from
the preimage (free — no second copy embedded). For an unchanged owner it reuses the field verbatim (L2,
`selfReplicateCovenantOps`). For a new owner it **swaps the 33-byte owner pubkey** (L3,
`swapPubkeyOut0CovenantOps`): split the field at the pubkey offset, drop the old 33 bytes, splice in the new
ones from the unlock. **Swapping 33 bytes for 33 bytes preserves the script length, so the varint stays
valid and the field is mutated in place** (only ~13 extra script bytes vs the verbatim quine).

### 4.5 The edition token script — `editionLockOps` / `buildEditionLock`

```
<P=0x50> <ver=0x03> <RECORD_EDITION=0x05> <tx1Ref:32> <ownerPubKey:33> <stateData>   (6 data fields)
OP_2DROP OP_2DROP OP_2DROP                                                            (drop all 6)
covenantPrefixOps(F)              ── verify preimage; hashOutputs→alt; scriptCode→[pre, ownerPub, suffix]
push 3, OP_ROLL                   ── bring the branch selector to the top
OP_IF   transferTailOps  OP_ELSE  replicateTailOps  OP_ENDIF
```

Key constants and layout facts:
- **`EDITION_OWNER_SCRIPT_OFFSET = 40`** — the owner pubkey's byte offset *within the script*:
  `P(2) + ver(2) + record(2) + tx1Ref(33) + pushOpcode(1) = 40`. (Each 1-byte field is a 2-byte push;
  tx1Ref is a 33-byte push.) The owner pubkey sits **before** the variable-length `stateData` precisely so
  this offset is **constant** for every edition of a collection.
- **`fieldPubkeyOffset F`** (used inside the script to split `scriptCode`) = `varIntSize(scriptLen) + 40`
  — the offset within the `scriptCode` *field* (which is prefixed by its varint). `buildEditionLock`
  computes it with a **two-pass** trick: build once with a placeholder `F=1` (same 2-byte push width as the
  real `F≈43`) to measure the script length, derive `varIntSize` (3 for a ~767-byte script), rebuild with
  `F = varIntSize + 40`. The script is ~767 bytes so the varint is always the 3-byte form.
- **`EDITION_SCOPE = 0xc1`** = `ANYONECANPAY | ALL | FORKID`. Used for the covenant's OP_PUSH_TX in *both*
  branches, so buyers can add funding inputs without invalidating the holder's outpoint commitment. (The
  introspection only reads `hashOutputs`, which is committed regardless of ANYONECANPAY.)
- **`RECORD_EDITION = 0x05`** (0x01–0x04 are TEMPLATE/TOKEN/FILE/MESSAGE from `tokenCodec`).

### 4.6 The shared prefix + branch dispatch

`covenantPrefixOps(F)` runs **once** before the branch (saving ~200 bytes vs each branch carrying its own
OP_PUSH_TX): `pushTxVerifyOps` → `OP_DUP` → `extractHashOutputsOps` → `OP_TOALTSTACK` (hashOutputs parked on
the alt stack) → `extractScriptCodeFieldOps` → split at `F` then at `33` → leaves `[…, pre, ownerPub,
suffix]`.

**Selector convention:** `OP_0` (empty/false) → `OP_ELSE` = **replicate**; `OP_1` (true) → `OP_IF` =
**transfer**. After the prefix, the selector sits at **depth 3** in *both* unlock layouts (the prefix pushes
exactly 3 items above where the preimage was), so `push 3, OP_ROLL` brings it to the top for `OP_IF`.

Unlock layouts (bottom → top):
- **Replicate:** `[ change, buyerPub, OP_0, preimage ]`
- **Transfer:**  `[ change, newOwnerPub, ownerSig, OP_1, preimage ]`

### 4.7 `replicateTailOps` — Addendum A enforcement

Entry stack: `[ change, buyerPub, pre, ownerPub, suffix ]`, alt = `[ hashOutputs ]`. Reconstructs five
outputs and compares:
```
out0 = value ‖ pre ‖ ownerPub ‖ suffix        token returned to holder (verbatim)
out1 = value ‖ pre ‖ buyerPub ‖ suffix        replica to buyer (owner swapped)
out2 = serializeOutput(publisherFee, P2PKH(publisherHash))   publisher fee  (a CONSTANT in the script: OUT2)
out3 = u64le(holderFee) ‖ 0x19 76 a9 14 ‖ HASH160(ownerPub) ‖ 88 ac   holder fee (built in-script)
expected = out0 ‖ out1 ‖ out2 ‖ out3 ‖ change ;  assert HASH256(expected) == hashOutputs
```
Implementation notes that bite if you edit it:
- Uses **`OP_PICK`** to copy `pre`/`ownerPub`/`suffix`/`buyerPub` non-destructively while assembling. Every
  `push N, OP_PICK`/`OP_ROLL` index is a hand-traced **stack depth** — if you add/remove a stack item
  anywhere above, **every subsequent index changes.** Re-trace the whole tail.
- The growing `expected` blob is stashed via `OP_TOALTSTACK` and the 4 leftover pieces dropped
  (`OP_2DROP OP_2DROP`) to leave a clean single-boolean stack.
- `OUT2` and `C3pre` are constants computed from `terms` at build time — and are what `parseEditionScript`
  later reads back (§4.9). Keep them serialized exactly as P2PKH (`…19 76 a9 14…`).

### 4.8 `transferTailOps` — owner-signed move

Entry stack: `[ change, newOwnerPub, ownerSig, pre, ownerPub, suffix ]`, alt = `[ hashOutputs ]`.
1. **Authenticate the owner:** copy `ownerPub` and `ownerSig` via `OP_PICK`, `OP_SWAP`,
   `OP_CHECKSIGVERIFY`. (This is a *second, real* signature — the OP_PUSH_TX one uses the fake key `Q`; it
   only proves the tx is genuine, not who authorised it.)
2. **Enforce out0** = `value ‖ pre ‖ newOwnerPub ‖ suffix` (the covenant re-created for the new owner), then
   `‖ change`. Assert `HASH256 == hashOutputs`.
The transfer leftover is **5** pieces (`OP_2DROP OP_2DROP OP_DROP`), not 4 — a common off-by-one if you copy
from the replicate tail.

### 4.9 `parseEditionScript(lockingScript)` — read an edition back

Returns `{ tx1RefHex, ownerPubKeyHex, stateDataHex, terms }` or `null`. Reads the 6 data fields from
`chunks[0..5]`, checks `OP_2DROP×3` at `chunks[6..8]`, and recovers the economic **terms straight from the
covenant body** (so a recipient needs no out-of-band metadata): it scans for the `OUT2` constant (a 34-byte
push) and `C3pre` (a 12-byte push), both identifiable by the P2PKH signature `0x19 0x76 0xa9 0x14` at byte
offset 8 → `publisherFee`/`publisherPubKeyHash` from OUT2, `holderFee` from C3pre.

---

## 5. `src/editionBuilder.ts` — transactions, unlocks, discovery

### 5.1 The ordering problem and the unlock templates

`hashOutputs` commits to **all** outputs, including the spender's change — but the covenant's preimage is
needed to spend the input, and the change isn't known until `tx.fee()` runs. The solution: covenant inputs
spend via **unlocking-script templates** (`replicateUnlockTemplate`, `transferUnlockTemplate`) whose
`sign(tx, i)` builds the preimage/owner-sig from the **finalised** transaction at sign time — i.e. *after*
`tx.fee()` has set the change output. So the flow is always: add inputs/outputs → `tx.fee()` → `tx.sign()`.
`estimateLength()` returns a generous over-estimate (~1100/1200 bytes) so `tx.fee()` sizes correctly.

The templates serialize the spender's "change region" (`tx.outputs.slice(enforcedCount)`) as the
`buyerChange`/`change` bytes the covenant expects — automatically consistent with what `hashOutputs` commits.

### 5.2 The two signature scopes (don't conflate them)

- The covenant's **OP_PUSH_TX** uses `EDITION_SCOPE = 0xc1` (ANYONECANPAY|ALL|FORKID) in both branches.
- The transfer branch's **owner-auth** signature uses `ALL|FORKID = 0x41` (no ANYONECANPAY): the owner
  builds the whole transaction, so it commits to all inputs/outputs. `transferUnlockTemplate` therefore
  passes the **real other-inputs** to `TransactionSignature.format` for the owner sig (ANYONECANPAY would
  ignore them, but ALL needs them). Signing mirrors `pushDrop.unlock`:
  `key.sign(Hash.sha256(preimage))` → `new TransactionSignature(r, s, scope).toChecksigFormat()`.

### 5.3 Transaction shapes (all version 2)

- **`buildEditionGenesisTx`** — funding (P2PKH) → edition covenant output(s) + change.
- **`buildReplicateTx`** — `[in0 = holder edition via replicateUnlockTemplate] [in1+ = buyer funding]` →
  `[0] token→holder (verbatim) [1] replica→buyer (swapEditionOwner) [2] publisher fee [3] holder fee
  [4+] change]`. `enforcedOutputCount = 4`.
- **`buildEditionTransferTx`** — `[in0 = edition via transferUnlockTemplate] [in1+ = funding]` →
  `[0] token→newOwner (swapEditionOwner) [1] 1-sat P2PKH notification to newOwner's address [2] change]`.
  `enforcedOutputCount = 1`; the notification rides in the covenant's free change region (so enforcement is
  unaffected) and is the **discovery breadcrumb**.

`swapEditionOwner(lockBytes, newPub)` / `editionOwnerPubKey(lockBytes)` are the JS mirrors of the in-script
pubkey surgery, operating at `EDITION_OWNER_SCRIPT_OFFSET = 40`.

### 5.4 Network wrappers & discovery

- `createEdition` (TX1 template committing name + replicable rules + the covenant template with a *zeroed*
  tx1Ref/owner, plus optional hash-bound file; then TX2 mints editions), `replicateEdition`,
  `transferEdition`, `broadcastV2Probe` (a trivial v2 P2PKH self-send to confirm the network relays v2).
- `scanIncomingEditions(provider, pubKeyHex)` — candidate txs = **union of `getAddressHistory()` AND
  `getUtxos()`** (the latter is mempool-aware, so an *unconfirmed* transfer surfaces immediately via the
  1-sat notification UTXO). For each candidate tx, parse outputs with `parseEditionScript` and keep those
  whose `ownerPubKeyHex` matches. ⚠️ Using only `getAddressHistory()` (confirmed-only) was a real bug — an
  unconfirmed transfer was invisible to the recipient.

---

## 6. How to modify safely — a checklist

- **Changing the field layout** (e.g. adding a field, resizing one): recompute `EDITION_OWNER_SCRIPT_OFFSET`
  and the `buildEditionLock` two-pass; keep the owner pubkey **before** the variable-length `stateData` so
  its offset stays constant. Update `parseEditionScript`'s chunk indices and the `OP_2DROP` count.
- **Adding/removing an enforced output** (e.g. a second fee): update *three* places in lockstep —
  `replicateTailOps`/`transferTailOps` output construction, **every** `OP_PICK`/`OP_ROLL` depth after the
  change (hand-trace!), and the builder's `enforcedOutputCount`. Then Spend-validate.
- **Changing fees / the publisher address**: they live as constants (`OUT2`, `C3pre`) in the tail **and** are
  parsed by `parseEditionScript` via the `19 76 a9 14` signature — keep them P2PKH-serialized and parseable.
- **Changing the sighash scope**: update `EDITION_SCOPE` and `pushTxConstants(scope)` consistently; the
  preimage offsets in §4.1 are scope-independent, so they don't change.
- **Regenerating `(a, k)`**: allowed (they're public); everything else derives from them.
- **Never** trust a script change until it passes `Spend` with `transactionVersion: 2`. The `Spend` error
  prints the program counter and stack depth at failure — invaluable for locating an off-by-one.

---

## 7. Testing & validation methodology

- `test/pushtx.test.ts` — reversal, genuine vs **tampered** preimage (the binding), `pushTxVerifyOps` leaves
  the preimage.
- `test/covenant.test.ts` — L1 output prefix, L2 quine, L3 pubkey swap, L4 full replicate (short-pay /
  redirect / covenant-drop all rejected).
- `test/edition.test.ts` — the real edition lock: offset check, `parseEditionScript` round-trip, replicate,
  transfer, forged-sig and covenant-drop rejections.
- `test/editionBuilder.test.ts` — builds genesis→replicate→transfer txs and **Spend-validates each covenant
  input** with the *real* other-inputs (so the owner's ALL-sig hashes correctly). This is the safety net
  before any broadcast.

Development tip that worked well: prototype a new in-script fragment as a **staged spike** — a throwaway
script that runs each stage (reverse → hash→num → s-derive → DER assembly → full OP_CHECKSIG) as a separate
`Spend` validation, so a failure pinpoints one stage. (The original `pushtx` was built this way.)

---

## 8. Known limitations & gotchas

- **Verification is structure-only.** `parseEditionScript` confirms an output *is* a well-formed edition and
  recovers its collection id/terms, but there is **no lineage walk** yet (proving it descends from the real
  TX1 genesis + that TX1 committed a matching covenant template). That's the natural next verify feature.
- **Total mint count is not trustlessly knowable** (no indexer) — by design.
- **Replicate doesn't add a holder notification**, but the **holder-fee P2PKH output** lands in the holder's
  address history, so the holder still discovers their returned token via `scanIncomingEditions`.
- **Overlay-based publishing doesn't propagate deletions** (see `publish.sh`); delete public files on the
  `publish` branch by hand.
- Script size ≈ **767 bytes** (both branches); replicate unlock ≈ **1 KB** (mostly the preimage, which
  carries the full `scriptCode`). Within mainnet policy as of validation, but watch this if the script grows.
- `OP_PICK`/`OP_ROLL` indices are the most fragile thing in the codebase — they encode exact stack depths.
  Treat the stack-state comments as load-bearing documentation and keep them correct.

---

## 9. Quick reference

| Thing | Value / location |
|---|---|
| OP_PUSH_TX constants | `pushTxConstants()` in `pushtx.ts` (`a=0x11…`, `k=0x22…`) |
| Introspection scope | `EDITION_SCOPE = 0xc1` (ANYONECANPAY\|ALL\|FORKID) |
| Owner-auth scope (transfer) | `0x41` (ALL\|FORKID) |
| Owner pubkey offset (script) | `EDITION_OWNER_SCRIPT_OFFSET = 40` |
| Field-split offset (in scriptCode) | `F = varIntSize(scriptLen) + 40` (≈ 43; two-pass in `buildEditionLock`) |
| `hashOutputs` in preimage | bytes `[len−40, len−8)` |
| `scriptCode` field in preimage | bytes `[104, len−52)` (incl. its varint) |
| Record type | `RECORD_EDITION = 0x05` |
| Replicate selector / outputs | `OP_0`; out `[0]`token `[1]`replica `[2]`publisherFee `[3]`holderFee `[4+]`change |
| Transfer selector / outputs | `OP_1`; out `[0]`token→newOwner `[1]`notification `[2+]`change |
| Must-stay-minimal | the in-script **signature DER** (Chronicle does NOT relax it) |
| Validation oracle | `@bsv/sdk` `Spend` with `transactionVersion: 2` |

---

*Authored 2026-06-11, immediately after the covenant was validated on BSV mainnet, to preserve the
implementation reasoning for future modification/repurposing.*
