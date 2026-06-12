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
| **Mint edition collection** | Create an unlimited-mints collection with fixed creator/holder fees (+ optional file, which can be **encrypted** for holders). |
| **Replicate** | Permissionlessly mint your own copy of an edition (pays the fees). |
| **Sales page / Share** | Open a collection's public storefront and copy a postable link to it. |
| **Get a copy** | Buy an edition in one click from a sales link (resolve → fund → replicate → reveal). |
| **Seller note / bonus** | Attach a public promo note (+ optional link/code bonus) buyers receive at purchase. |
| **Send / Transfer** | Move a token to another wallet (owner-signed, free). |
| **Message** | Send an **encrypted, authenticated** on-chain message — text, a file, and/or a content key — to any pubkey. |
| **Check incoming / recover** | Discover tokens / editions / messages sent to you, and rebuild your holdings from chain. |
| **Restore from WIF** | Recover your wallet **and** purchases on any browser/device from your private key. |
| **Verify** | Confirm a token/edition is structurally valid and which collection it belongs to. |
| **View** | Open the embedded file — **decrypting it** if the collection is encrypted — and check its hash against the collection commitment. |
| **Test v2 broadcast** | Sanity-check that the network accepts version-2 (Chronicle) transactions. |

Receiving wallets find tokens through a small **1-sat P2PKH notification** to the recipient's address
(the token output itself is a non-standard script and isn't address-indexed); the wallet then reads the
token out of that transaction.

---

## Messaging

Send an **encrypted, authenticated** message to any pubkey — a single typed payload that can carry text,
a file (bonus content), and/or a content key all at once. Encryption is real per-recipient ECIES (only
the recipient decrypts, and they can verify *who* sent it); delivery is on-chain like a token transfer
and discovered through the same 1-sat notification breadcrumb. It is the same record shape as a token,
and it is the delivery layer the encrypted-content feature builds on.

## Encrypted content (Tier 1)

A collection's embedded file can be encrypted so only token holders can view it:

- The file is AES-encrypted under a fresh **per-collection key**; the **ciphertext** is what's stored
  on-chain (hash-bound to the collection identity).
- The key travels **obfuscated** in the TX1 template, so **any holder** — including a buyer who
  *permissionlessly replicates* an edition — can decrypt it with **no server and no live party**.
- Clicking **View** unwraps the key, decrypts the ciphertext, and displays the file.

Important: this is **"an inconvenience, not DRM."** The wrap is open-source obfuscation — a casual
block-explorer reader can't lift the file, but a determined coder can. The real protection is
**economic**: the content is priced below the bother-cost of extracting it, and because every holder
earns the built-in replication royalties, leaking undercuts a market they themselves profit from.
Stronger tiers — a live per-recipient key sender, or a server that watermarks each buyer's copy — are
designed but not built.

## Shareable sales pages

Every collection — and every individual holder — has a **postable link** that opens a public storefront,
served entirely from the same client-side page (no backend):

```
…/#c=<Collection-ID>&h=<holder-pubkey>
```

The storefront shows a **cover image**, title, description, the lock state (e.g. "🔒 holders only"), and
the price (creator + holder fee). A stranger can press **"Get a copy"** and own one in a single click:

1. the page **resolves the holder's current edition** deterministically (by script hash — no indexer);
2. it **funds-checks** the visitor's wallet (auto-created on first use; shows an address to top up if needed);
3. it runs the **permissionless replicate** (with a retry if another buyer was first);
4. it **reveals / decrypts** the content.

Because the holder named in the link earns the holder-fee, everyone has a reason to share *their own*
link — and a sale never spends the holder's only copy (it comes straight back to them), so links stay live.

## Seller notes & bonuses

A seller can attach a short **note** to a collection — a thank-you, redemption instructions, a promo. It
is published on-chain, shown on the storefront, and **rides onto the buyer's purchase**, so it lands in
their wallet. It then **propagates down the resale chain** as a *sticky default*: each onward sale carries
the seller's own note if they've set one, otherwise the note that came with the copy — until someone
overwrites it. It lives **outside** the frozen covenant, so it stays freely editable (no re-validation).

The note can also carry a **bonus** the buyer claims from the sale confirmation:

- a **link** (the seller's site delivers the reward, gating by proof-of-purchase), or
- a **code** (a coupon / redeem code).

The bonus value is **public on the chain** (it's part of the note), so gating is the *seller's* job — fine
for links and shareable coupons; don't put a one-time secret there. On-chain (encrypted) and *time-locked*
bonuses are designed for later.

## Recovering on a new device

The wallet is **self-custodial**: the local list of tokens is just a **cache**, and the **WIF private key
plus the chain are the source of truth**. Paste your WIF into **Restore from WIF** on any browser or
device and your holdings rebuild from chain — including each one's captured note and bonus. (A seller's
published notes resolve from chain on demand too.) Editions you've already sold or transferred are left
out; only your current, live holdings come back. No accounts, no server, nothing to lose but the key
itself — so back it up.

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
- ✅ **Encrypted, authenticated messaging** (text / file / content key)
- ✅ **Tier-1 encrypted content** (holder-only embedded files, decrypt-on-view)
- ✅ **Shareable sales pages + one-click "Get a copy"** (storefront, cover/description, deterministic
  tip resolution, fund-and-replicate, reveal)
- ✅ **Seller notes & bonuses** (on-chain, ride to the buyer, propagate down the resale chain)
- ✅ **Self-custody recovery** — restore the WIF on any device and rebuild holdings (with notes/bonuses)
  from chain

Still experimental — treat it as a working prototype, and use small amounts. Stronger encrypted-content
tiers (live per-recipient key delivery; a server with per-buyer watermarking), on-chain / time-locked
bonuses, and edition deep-verify (full lineage proof) are designed but not yet built.
