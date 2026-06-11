# PHAR LAP — Functional Overview

A plain-language tour of what PHAR LAP is and what it does. For the deep protocol design see
`PLAN.md`; for how it differs from its MPT predecessor see `docs/DEVIATIONS_FROM_MPT.md`.

---

## What it is

PHAR LAP is a **standalone browser wallet for tokenized content on BSV**. You mint a piece of content
as a token, optionally embed a file with it, and share, sell, or transfer it — with no server, no
install, and no account. Everything is a single HTML page talking to the public blockchain.

It is built around two ideas that make it different from a typical token wallet:

1. **The data lives in a spendable output (PushDrop), not an OP_RETURN.** OP_RETURN data can be pruned
   by miners; a PushDrop output stays in the live UTXO set, so the token — and any embedded file — is
   permanent.
2. **"Unlimited mints" editions.** A creator can publish content that *any buyer can clone for
   themselves*, permissionlessly, paying a fixed fee — enforced by the miners, with no action from the
   creator or current holder. This is the headline feature, and it is powered by a hand-rolled
   **covenant** (a script that constrains how it may be spent).

---

## Two kinds of token

| | **Collection token** | **Edition (unlimited mints)** |
|---|---|---|
| Supply | Fixed at mint (1 or N) | Uncapped — anyone can mint a copy |
| Transfer | Owner-signed, fee-free | Owner-signed, fee-free |
| Cloning | — | Any holder is a paid cloning source |
| Enforced by | Wallet convention + SPV | **Miners** (covenant script) |
| Use case | A numbered collectible / proof token | An e-book, article, song — sold by the copy |

Both share the same identity model (below) and can carry an embedded, hash-bound file.

---

## How identity works

A collection is created with **two transactions**:

- **TX1 (template)** commits the immutable collection data — name, rules, the covenant template, and an
  optional embedded file (bound by SHA-256 hash). **TX1's transaction id _is_ the Collection ID.**
- **TX2 (genesis)** mints the token(s) — each one carries the Collection ID as a 32-byte reference.

So every token points back to its collection by txid. Changing the embedded file would change TX1's
txid, which would break every token's reference — that is what makes the file *bound to identity*.
There is no central registry: a token is a genuine member of a collection if it traces back to the real
TX1 (verified by standard SPV / Merkle proofs, fetched on demand).

---

## The "unlimited mints" model

A creator mints an edition and announces it. The edition token sits in a holder's wallet. Then:

```
A buyer clicks "Replicate" on an edition they found:

  INPUTS                            OUTPUTS  (fixed by the covenant — miners enforce them)
  ┌─ holder's edition  (1 sat) ──┐  ┌─ [0] token returned to the holder      (same edition)
  └─ buyer's funding ────────────┘  ├─ [1] a new replica for the buyer       (same collection)
                                    ├─ [2] creator fee   → creator's address
                                    ├─ [3] holder fee    → holder's address
                                    └─ [4] change        → buyer

  • No holder signature is required — the holder's wallet does nothing.
  • The transaction is INVALID unless outputs [0]–[3] are exactly correct:
    the holder's token comes back, the buyer's copy carries the same covenant,
    and both fees are paid in full. Miners reject any cheat.
```

The result:

- **Every holder is automatically a paid distribution point.** A buyer clones from whoever they found,
  and that copy can itself be cloned — the covenant rides forward into every replica.
- **Fees are fixed forever** at mint time and split between the original creator and the current holder.
- **Ordinary transfers stay free** — royalties are only charged on replication.

The honest limit: because there is no indexer, the *total number of copies ever minted* is not
trustlessly knowable. But any individual copy is verifiable as a genuine edition of its collection.

---

## How the covenant is enforced (in one breath)

BSV scripts can't normally "see" the transaction spending them. PHAR LAP uses the classic **OP_PUSH_TX**
technique: the spender is forced to hand the script a faithful copy of the spending transaction, which
the script verifies cryptographically (by re-deriving a signature over it and checking it with
`OP_CHECKSIG`). Once the transaction is proven genuine, the script reads its outputs and rejects the
spend unless they match the rules above. The covenant even re-creates *its own script* in the new
outputs, so the rules propagate to every replica. All of this is hand-rolled on `@bsv/sdk` — no
external smart-contract toolchain — and runs under BSV's post-Chronicle (version-2) script rules.

---

## What you can do in the wallet

| Action | What it does |
|---|---|
| **Mint collection** | Create a fixed-supply collection (+ optional file). |
| **Mint edition collection** | Create an unlimited-mints collection with fixed creator/holder fees (+ optional file). |
| **Replicate** | Permissionlessly mint your own copy of an edition (pays the fees). |
| **Send / Transfer** | Move a token to another wallet (owner-signed, free). |
| **Check incoming** | Discover tokens/editions sent to you (via a 1-sat notification breadcrumb). |
| **Verify** | Confirm a token/edition is structurally valid and which collection it belongs to. |
| **View** | Open the embedded file, checking its hash against the collection commitment. |
| **Test v2 broadcast** | Sanity-check that the network accepts version-2 (Chronicle) transactions. |

Receiving wallets find tokens through a small **1-sat P2PKH notification** to the recipient's address
(the token output itself is a non-standard script and isn't address-indexed); the wallet then reads the
token out of that transaction.

---

## Running it

```bash
npm install
npm test          # unit tests (no build needed — Node ≥ 26 runs the TypeScript directly)
npm run build     # bundle the browser wallet
npm run serve     # http://localhost:3000  (proxies blockchain calls to WhatsOnChain)
```

Open the page, fund the wallet address shown, and mint. The wallet key is a WIF stored in the browser's
localStorage — back it up.

---

## Status

Validated on **BSV mainnet**:

- ✅ Collection mint (single + multi), embedded-file binding, transfer, discovery, verification, viewer
- ✅ **Edition covenant**: mint, **permissionless replicate** (confirmed in a block), owner-signed
  transfer, file embed/view, discovery

Still experimental — treat it as a working prototype, and use small amounts. Encrypted-content delivery
(holder-only files) and creator↔holder messaging are designed but not yet built.
