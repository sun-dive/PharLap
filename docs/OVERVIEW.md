# PHAR LAP — Functional Overview

A plain-language tour of what PHAR LAP is and what it does. For the deep covenant/protocol internals see
[`docs/COVENANT_INTERNALS.md`](./COVENANT_INTERNALS.md).

---

## What it is

PHAR LAP is a **standalone browser wallet for tokenized content on BSV**. You mint a piece of content
as a token, optionally embed a file with it, and share, sell, or transfer it — with no server, no
install, and no account. Everything is a single HTML page talking to the public blockchain.

It is built around three ideas that make it different from a typical token wallet:

1. **The data lives in a spendable output (PushDrop), not an OP_RETURN.** OP_RETURN data can be pruned
   by miners; a PushDrop output stays in the live UTXO set, so the token — and any embedded file — is
   permanent.
2. **"Unlimited mints" editions.** A publisher can release content that *any buyer can clone for
   themselves*, permissionlessly, paying a fixed fee — enforced by the miners, with no action from the
   publisher or current holder. This is the headline feature, and it is powered by a hand-rolled
   **covenant** (a script that constrains how it may be spent).
3. **Provable, timestamped content.** A public embedded file is committed by the SHA-256 of its
   *original* bytes, so anyone can later prove the on-chain copy is a byte-exact, block-timestamped
   replica of an off-chain file — a built-in notary. (This is the "proof token" in PHAR LAP's origins.)
4. **A release, not just a file.** A mint can be a multi-track **album/EP**, play in a built-in **music
   player**, carry **embedded cover art and time-synced lyrics**, and even drive a **scene-timeline music
   video** — a whole rich release packed into one hash-bound, optionally-encrypted object (see *Rich media*).

---

## Two kinds of token

| | **Collection token** | **Edition (unlimited mints)** |
|---|---|---|
| Supply | Fixed at mint (1 or N) | Uncapped — anyone can mint a copy |
| Transfer | Owner-signed, fee-free | Owner-signed, fee-free |
| Cloning | — | Any holder is a paid cloning source |
| Bond / burn | — | Rides on a refundable bond; owner can burn to reclaim it |
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

## Provenance: a timestamped exact replica

One core use of PHAR LAP is as a **notary** — proving that an on-chain object is a byte-exact,
time-stamped copy of an off-chain file.

When a **public** file is embedded, the collection commits to the **SHA-256 of the original file** (its
plaintext bytes, before any compression). To verify later, anyone:

1. fetches the on-chain object and reverses the storage encoding (decompresses it) to recover the bytes,
2. hashes those bytes and checks the result against the on-chain commitment, and
3. reads the **mint transaction's block time** for the timestamp.

A match proves the file existed, and was fixed on-chain, no later than that block — and is byte-for-byte
the file in front of you. The viewer does this automatically and shows **"✓ Verified exact replica —
SHA-256 of the content matches the on-chain commitment (timestamped on mint)."**

The proof survives compression: gzip *compression* isn't byte-reproducible across tools, but gzip
*decompression* is exactly defined — so the commitment is to the recovered content, never to the
particular compressed bytes that happened to be stored.

**Encrypted** content commits to the **ciphertext** instead. That stops the public commitment from
acting as a "guess-the-file" oracle, while holders still verify integrity the moment they decrypt.

---

## The "unlimited mints" model

A publisher mints an edition and announces it. The edition token sits in a holder's wallet. Then:

```
A buyer clicks "Replicate" on an edition they found:

  INPUTS                            OUTPUTS  (fixed by the covenant — miners enforce them)
  ┌─ holder's edition (bond) ────┐  ┌─ [0] token returned to the holder   (same edition, bond intact)
  └─ buyer's funding ────────────┘  ├─ [1] a new replica for the buyer    (same collection, fresh bond)
                                    ├─ [2] publisher fee   → publisher's address
                                    ├─ [3] holder fee    → holder's address
                                    └─ [4] change        → buyer

  • No holder signature is required — the holder's wallet does nothing.
  • The transaction is INVALID unless outputs [0]–[3] are exactly correct:
    the holder's token comes back (carrying its bond unchanged), the buyer's copy
    carries the same covenant and an equal fresh bond, and both fees are paid in
    full. Miners reject any cheat.
```

The result:

- **Every holder is automatically a paid distribution point.** A buyer clones from whoever they found,
  and that copy can itself be cloned — the covenant rides forward into every replica.
- **Fees are fixed forever** at mint time and split between the original publisher and the current holder.
- **Ordinary transfers stay free** — royalties are only charged on replication.

The honest limit: because there is no indexer, the *total number of copies ever minted* is not
trustlessly knowable. But any individual copy is verifiable as a genuine edition of its collection.

---

## The bond, and burning to reclaim it

Every edition rides on a **refundable bond** — the satoshis locked in the token's own UTXO. The publisher
sets the amount per collection at mint time (default **2100 sats**, a nod to the 21-million cap); it is
baked into the covenant and **enforced forever** for that collection. The bond is *not* a fee — nobody
keeps it. It is recoverable deposit:

- On **replication**, the holder's bond rides straight back to them on output [0], and the buyer posts an
  **equal fresh bond** for their own new copy — both consensus-enforced, so a collection's bond is uniform
  across every edition and can't be shaved.
- On **transfer**, the bond moves with the token to the new owner.

**Burning** is how you get it back. An owner can destroy a copy they hold and **sweep its bonded sats back
into their wallet** (minus a small network fee). This solves what would otherwise be a permanent dust-lock:
the covenant has no other exit, so without burn every edition's sats would be trapped forever.

```
The owner clicks "Burn" on a copy they hold:

  INPUTS                            OUTPUTS  (the owner signs — they choose where it goes)
  └─ owner's edition (bond) ─────┐  └─ [0] the reclaimed bond → owner's wallet
                                 │
  • Owner-signed: only the current owner can produce a valid signature against the
    pubkey embedded in the script, so only they can burn their copy.
  • The token is DESTROYED — no covenant output is re-created. Irreversible.
```

Why it matters: the bond gives every edition an **intrinsic price floor** (a copy is never worth less than
its recoverable bond), discourages frivolous minting (each copy ties up real capital), and lets the UTXO be
reclaimed instead of leaving permanent dust at scale. Because the amount is configurable, a publisher can
set a tiny bond for free-content drops or a larger one for premium / gift editions.

A wallet caveat that follows from self-custody: you can only burn (or transfer/replicate) a copy once its
creating transaction has **confirmed and propagated** — until then the network can't see the UTXO to spend
it. And because PushDrop tokens aren't address-indexed, a copy spent on another device can briefly linger in
your local list; acting on it simply detects that it's already gone and quietly removes it.

---

## How the covenant is enforced (in one breath)

BSV scripts can't normally "see" the transaction spending them. PHAR LAP uses the classic **OP_PUSH_TX**
technique: the spender is forced to hand the script a faithful copy of the spending transaction, which
the script verifies cryptographically (by re-deriving a signature over it and checking it with
`OP_CHECKSIG`). Once the transaction is proven genuine, the script reads its outputs and rejects the
spend unless they match the rules above. The covenant even re-creates *its own script* in the new
outputs, so the rules propagate to every replica. All of this is hand-rolled on `@bsv/sdk` — no
external smart-contract toolchain — and runs under BSV's post-Chronicle (version-2) script rules.

A single byte on the spender's stack selects **one of three branches** the covenant offers:

| Selector | Branch | What it enforces |
|---|---|---|
| `0` | **Replicate** | The 5-output layout above — token back to holder, fresh-bonded replica to buyer, both fees paid. No owner signature. |
| `1` | **Transfer** | Owner-signed move: re-creates the covenant for the new owner (bond intact), no fees. |
| `2` | **Burn** | Owner-signed destroy: enforces *no* outputs — the owner's signature already commits to where the reclaimed bond goes. |

Replicate and transfer reconstruct their required outputs inside the script and check them against the
transaction's committed `hashOutputs`; burn skips that entirely, because an ordinary owner signature over
the whole transaction is all the authority a destroy-and-reclaim needs. The shared transaction-verification
prefix runs once before the branch split, so the three branches add only a few bytes over a single one.
Older collections minted before the bond/burn work carry the earlier two-branch (replicate/transfer) script
and keep working unchanged — each collection embeds its own covenant, so the two coexist.

---

## What you can do in the wallet

| Action | What it does |
|---|---|
| **Mint collection** | Create a fixed-supply collection (+ optional file). |
| **Mint edition collection** | Create an unlimited-mints collection with fixed publisher/holder fees (+ optional file, which can be **encrypted** for holders). |
| **Multi-file release** | Pack several files — album/EP tracks, or a music video's scenes + cue sheet — into one NFT; it plays inline in the built-in player. |
| **Combine into an EP** | Bundle existing mints by *reference* (no re-upload) into a new release with its own price. |
| **Replicate** | Permissionlessly mint your own copy of an edition (pays the fees + posts a fresh bond). |
| **Burn** | Destroy a copy you hold and reclaim its bonded sats to your wallet (owner-signed, irreversible). |
| **Gift links** | Pre-fund claimable copies of your edition as shareable links; recoverable from your key alone. |
| **Reclaim gifts** | Sweep the funds from your **unclaimed** gift links back to your wallet (invalidates those links). |
| **Sales** | A dashboard of your sales — stats (count, earnings, this-month), buyers, and earnings per collection, as **creator** and **reseller**. |
| **Sales page / Share** | Open a collection's public storefront and copy a postable link to it. |
| **Get a copy** | Buy an edition in one click from a sales link (resolve → fund → replicate → reveal). |
| **Seller note / bonus** | Attach a public promo note (+ optional link/code bonus) buyers receive at purchase. |
| **Send / Transfer** | Move a token to another wallet (owner-signed, free). |
| **DM** | Send an **encrypted, authenticated** on-chain message — text, a file, and/or a content key — to any pubkey. |
| **Buyers** | (Publisher) list everyone who bought a copy of your collection, and message them — one, several, or all. |
| **Message publisher** | From an NFT card, DM the collection's publisher (their key is recovered from chain). |
| **Threads** | Open a collection's **members-only lineage discussion** — read your corridor, post to your line, reply up, or (publisher) announce to everyone. |
| **Alias / Profile** | Name your key (`@you`) and publish an on-chain avatar; others resolve your name + face by pubkey. |
| **Back up config** | Post an **encrypted** copy of your address book + alias + prefs to your own address; restores on any device. |
| **Check incoming / recover** | Discover tokens / editions / messages sent to you, and rebuild your holdings from chain. |
| **Restore from WIF** | Recover your wallet **and** purchases on any browser/device from your private key. |
| **Air-gapped / watch-only** | Generate keys offline, load a wallet **watch-only** by public key, and sign transfers / burns / BSV payments on an offline device (file-based; see `AIR_GAPPED.md`). |
| **Verify** | Confirm a token/edition is structurally valid and which collection it belongs to. |
| **View** | Open the embedded file — decompressing and **decrypting** it as needed — and verify it against the collection commitment (public files show a **✓ verified exact replica** proof). |

Receiving wallets find tokens through a small **1-sat P2PKH notification** to the recipient's address
(the token output itself is a non-standard script and isn't address-indexed); the wallet then reads the
token out of that transaction.

---

## Identity: aliases, avatars & profiles

A public key is the real identity, but raw keys are unreadable — so PHAR LAP layers a friendly identity on
top, everywhere a key appears:

- **Self-asserted aliases.** Name your own key `@you`; the alias rides in the message/post envelope, bound
  to your pubkey. There's **no global uniqueness** (no registry), so an alias is a *display label*, not a
  username — two keys can both claim `@john`; the **pubkey is the truth** (hover any name to see + copy it).
  A name you haven't saved shows with an **⚠ unverified** cue until you save it to contacts.
- **Identicons.** Every key gets a deterministic icon derived from the pubkey — free, universal, and
  **un-spoofable**: a faked `@name` renders a *different* pattern, so impersonation is visible at a glance.
- **On-chain profiles.** Optionally publish an alias + a small avatar **once** (a record on your own
  address); others resolve your name and face by pubkey and cache it. The identicon is the instant
  placeholder, and a key-derived ring is the security anchor.
- **Address book.** Save, rename, and confirm contacts; your labels always win over self-asserted names.

This one identity layer is shared by DMs, the storefront, the Updates feed, and Threads.

## DMs (encrypted messaging)

Send an **encrypted, authenticated** message to any pubkey — a single typed payload that can carry text,
a file (bonus content), and/or a content key all at once. Encryption is real per-recipient ECIES (only
the recipient decrypts, and they can verify *who* sent it); delivery is on-chain like a token transfer
and discovered through the same 1-sat notification breadcrumb. It is the same record shape as a token,
and it is the delivery layer the encrypted-content feature builds on.

Two conveniences for outreach (built for publishers, useful to anyone):

- **Compose overlay.** Messaging from a card or a buyer row opens a compose pop-up *over* the current page,
  so you never lose your place.
- **Send to many, personalized.** Pick several recipients (e.g. selected buyers) and send one message as a
  **mail-merge** — one encrypted transaction each, with wildcards substituted per recipient: `%buyer%`,
  `%publisher%`, `%product%`. (It's genuinely N transactions, so the cost scales with the list; for a true
  "everyone who holds it" announcement, a publisher **Broadcast** or a **Threads** post to "everyone" is cheaper.)

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

## Rich media — a release, not just a file

A mint's embedded content can be far more than a single document. The wallet packs a whole release into
**one hash-bound object** — to the chain it's still "a file," so identity, the covenant, and the provenance
proof are unchanged — and plays it back in a built-in experience:

- **Multi-track albums / EPs.** Select several files at mint and they're packed into one container
  (a lightweight `magic + header + concatenated bytes` blob, no external zip). One NFT, one provenance hash,
  the whole release inside; the viewer unpacks it into a track list.
- **An in-wallet player.** Audio opens in a built-in player — a spinning "disc," a circular **audio
  visualizer**, reactive background, and a playlist. For anyone the rotation makes dizzy, a **speaker mode**
  stops the spin and instead **pushes the disc in and out with the bass**; the choice is remembered.
- **Embedded cover art, by role.** Art carried in the audio's own tags (FLAC `PICTURE` / MP3 `APIC`, e.g.
  added in a tag editor) is shown by its picture type: **Front + Back** in a flip-through cover view, and a
  **Media** image — animated or still — as the spinning disc label. A track with no art falls back to the
  release cover.
- **Time-synced lyrics.** Lyrics embedded as **LRC** (timestamped lines) drive a **karaoke overlay** — the
  current line highlights and auto-scrolls in time with the song; plain (un-timed) lyrics simply scroll.
- **On-chain music videos.** A tiny **cue sheet** (`[mm:ss.cc]scene.webp` lines, packed alongside the audio)
  times scene images to playback, so a release plays a **seekable, audio-synced music video** — entirely
  on-chain, and a *fraction* of a baked video's size: each scene is stored once and reused by reference, and
  a held still costs almost nothing to linger on. Lyrics can overlay the video for a karaoke clip.

All of it works with **public or holder-only encrypted** content alike, and a verified copy is **cached
locally** (IndexedDB) so the next open is instant and works offline.

## Reference & combination mints

A mint's content doesn't have to be re-embedded bytes — it can be a **manifest of pointers** to content
already on-chain. That lets you **bundle existing mints into an EP or compilation without re-uploading** a
single byte: the new release references each work by its genesis + content hash, and the player **resolves
and hash-verifies** each one and plays them as a single release. Because the bundle is just pointers it's
tiny, and it's priced **independently** — an album can cost less than the sum of its singles, while the
singles stay separate products. It's covenant-safe: to the chain a reference manifest is just another
content file. (Publisher *re-mints* — re-pricing or re-packaging your own catalogue by reference, without
re-uploading — build on the same primitive; full version-supersession is a designed follow-up.)

## Shareable sales pages

Every collection — and every individual holder — has a **postable link** that opens a public storefront,
served entirely from the same client-side page (no backend):

```
…/#c=<Collection-ID>&h=<holder-pubkey>
```

The storefront shows a **cover image** (a front cover, with an optional **back cover** a viewer can flip to —
separate from the audio's own embedded art), title, description, the lock state (e.g. "🔒 holders only"), and
the price (publisher + holder fee). A stranger can press **"Get a copy"** and own one in a single click:

1. the page **resolves the holder's current edition** deterministically (by script hash — no indexer);
2. it **funds-checks** the visitor's wallet (auto-created on first use; shows an address to top up if needed);
3. it runs the **permissionless replicate** (with a retry if another buyer was first);
4. it **reveals / decrypts** the content.

Because the holder named in the link earns the holder-fee, everyone has a reason to share *their own*
link — and a sale never spends the holder's only copy (it comes straight back to them), so links stay live.

If the visitor already **holds a copy** of the collection, the buy button **ghosts to "✓ You own a copy"**
to head off an accidental second purchase — with a deliberate **"Buy another copy"** escape hatch for anyone
who genuinely wants another (e.g. to gift or resell).

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

## Sales: buyers, earnings & stats

Because every replication pays the **publisher fee** to the publisher's address *and* the **holder fee** to
the seller (the cloning source), **a single scan of your own transaction history reconstructs your whole
sales picture** — and the buyer's public key is the owner of the replica each sale minted. From that one
scan, the **📊 Sales** tab shows a **de-duplicated, per-sale view**: **one row per real sale**, no
double-counting even when you earned *both* fees on the same replication (as publisher *and* as the cloning
source). Each sale row shows:

- **The date** of the sale.
- **Which fees you earned** on it — **both**, **publisher-only**, or **holder-only** — so a sale where you
  wore two hats is counted once, with both fees credited.
- **The buyer**, with the same alias / identicon identity layer as everywhere else.
- A **🎁 gift** tag when — and *only* when — that specific sale's funding came from one of **your own gift
  vouchers**. Detection is **per-sale and exact**: it traces the sale's actual funding input back to a
  voucher you issued, so ordinary buys, sweeps, and reclaims are never mis-tagged as gifts.

On top sits a lean **statistics** header — sales of your mints, total **earned** (in sats + BSV), your
resales, unique buyers and your top collection — each with a **this-month** figure (bucketed cheaply by
block height, so no extra lookups). Every buyer list has **DM / Message-all** (the personalized mail-merge),
and the per-collection **👥 Buyers** button still gives a single collection's list in place.

The scan is **content-free**: it reads only the small **replicate outputs** via **capped fetches** and never
pulls a mint's large embedded content, so it stays fast and safe even on collections with big (multi-MB)
files. It's also **mempool-aware**, so a brand-new sale shows up before it even confirms. Honest limits:
figures are **at point of purchase** — onward *transfers* are owner-signed, free, and notify only the new
owner, so they're invisible to you (it's "who bought," not a current-owner roster); periods are
**approximate** (block height); and the scan is capped to recent transactions. (There's also no separate
"you made a sale" ping — the fee landing in your wallet *is* the notification, which is why a 1-sat minimum
fee matters.)

## Encrypted config backup

The one piece of local state that *isn't* rebuildable from your key + chain is your **address book** — your
private labels for other people's keys. **Back up config** posts an **encrypted-to-yourself** copy of your
address book (plus your alias and UI prefs) to your own address; only your key can read it. On a new device,
**Restore from WIF** pulls it back automatically and merges it (newest label wins per contact). So
"everything recoverable from the key alone" now includes your contacts. (Honest limit: no delete-sync yet —
a contact you delete on one device can reappear from an older backup elsewhere.)

## Threads — members-only lineage discussions

Every collection has a built-in **discussion forum scoped to its lineage tree**. Think of the replication
tree as an upline/downline network: when you buy a copy, you sit at a **node** below whoever you bought
from, back to the creator at the root. Threads lets you talk along that vertical line.

**What you see (your "corridor"):** posts from the **creator** and everyone **up your lineage** to the
mint, your **own** posts, and — passively — posts from anyone **down your lineage** (your sub-tree). You do
**not** see siblings/cousins on other branches. The creator, at the root, sees the whole tree.

**What you can post:**

- **Your line** — your downstream sees it.
- **Reply to an upline** — reaches that holder (and their sub-tree).
- **Everyone** *(publisher only)* — an announcement every holder sees.

**Un-spoofable badges.** Because membership is derived from the real lineage (not self-claimed), each
author carries a verifiable badge: **👑 creator** (their key controls the collection's covenant — a faker
gets *no* crown), **🌱 original holder** (owns a genesis copy), or **✓ holder** (a verified holder in your
upline). Names still use the alias/identicon layer, so impersonation is visible.

**How it works (no new covenant):** a post is a public, self-locked message keyed to your node, discovered
via a tiny breadcrumb at the node's *derived* feed address — so exactly the people on your line can find it,
and nobody else. Reading walks your lineage **upward only** (cheap — one parent per hop); downward
visibility is achieved by pushing a breadcrumb *up* to each ancestor when you post, never by traversing the
(branching, expensive) sub-tree. It's the same message + notification machinery the rest of the wallet uses,
pointed at lineage-derived addresses.

The honest edges: reading is public-authenticated (anyone can read; holders get the verified badges), and
downstream authors who aren't on your direct path aren't yet given a holder badge (only the creator is
verified everywhere). Replies/threading and deeper downstream verification are designed follow-ups.

## Compact by default

Everything PHAR LAP writes on-chain is kept as small as it safely can be:

- **Embedded files and messages are gzip-compressed** whenever that actually shrinks them — a
  keep-only-if-smaller check, so already-compressed media (JPEG, MP4, PDF…) and very short text are left
  untouched. For documents and text this can roughly **halve the mint cost**. Compression always happens
  *before* encryption (ciphertext doesn't compress) and is transparently reversed on view.
- **The edition covenant is lean.** Every byte of an edition's lock is repeated into each replica, so
  the on-chain format carries only what the rules strictly need. At the scale of a popular collection,
  trimmed bytes compound across every copy ever minted.

It's invisible in use — files and messages go in and come back out unchanged — but it lowers fees and
on-chain footprint.

## Recovering on a new device

The wallet is **self-custodial**: the local list of tokens is just a **cache**, and the **private key
plus the chain are the source of truth**. New wallets are created from a **BIP-39 12-word seed phrase**
(BIP-32 path `m/44'/236'/0'/0/0`); back up the phrase (or the equivalent **WIF**) and restore from either. Paste your WIF into **Restore from WIF** on any browser or
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
- ✅ **Bonded-burn covenant**: configurable refundable bond per collection (default 2100 sats) + an
  owner-signed **burn** branch that reclaims it; bond preserved through replicate/transfer
  (mainnet-validated mint → replicate → transfer → burn-reclaim)
- ✅ **Recoverable gift links**: pre-funded claimable copies with deterministic keys, recoverable from
  the publisher's WIF + chain alone, with **reclaim** of unclaimed links
- ✅ **Provenance** — public embedded files committed by plaintext hash, verified as a **timestamped
  exact replica** on view
- ✅ **Smart compression** of embedded files + messages (gzip, keep-only-if-smaller, compress-before-encrypt)
- ✅ **Encrypted, authenticated messaging** (text / file / content key) + **personalized bulk send**
  (multi-recipient mail-merge with `%buyer%`/`%publisher%`/`%product%` wildcards)
- ✅ **Identity layer** — self-asserted aliases, deterministic identicons, on-chain profiles (alias + avatar),
  address book
- ✅ **Publisher tools** — publisher avatar/alias on cards + sort-by-publisher, **buyer list + DM** (incl.
  unconfirmed sales)
- ✅ **Sales dashboard + stats** — one history scan → creator & reseller buyer lists, earnings per
  collection, and a stats header (count / earned in sats+BSV / this-month / unique buyers)
- ✅ **Encrypted config backup** — address book + alias + prefs, encrypted-to-self on-chain, auto-restored
  + merged on WIF restore
- ✅ **Threads** — members-only lineage discussions: read your corridor (upline + creator), post to your
  line / reply up / announce-to-everyone, **downstream visibility** via push-up breadcrumbs, and
  **un-spoofable creator / holder / seniority badges**
- ✅ **Tier-1 encrypted content** (holder-only embedded files, decrypt-on-view)
- ✅ **Shareable sales pages + one-click "Get a copy"** (storefront, cover/description, deterministic
  tip resolution, fund-and-replicate, reveal)
- ✅ **Seller notes & bonuses** (on-chain, ride to the buyer, propagate down the resale chain)
- ✅ **Self-custody recovery** — restore the WIF on any device and rebuild holdings (with notes/bonuses)
  from chain
- ✅ **Rich-media releases** — multi-track albums/EPs in one NFT; a built-in player (spinning-disc /
  bass-reactive **speaker** visualization + audio visualizer + track list); **embedded cover art** by role
  (front / back / **media** disc label, animated or still); **time-synced LRC lyrics** (karaoke overlay);
  and **on-chain scene-timeline music videos** (seekable; scenes stored once, reused by reference)
- ✅ **Reference / combination mints** — bundle existing mints by reference into an EP/compilation (no
  re-upload), independently priced; each referenced work resolved + hash-verified on play
- ✅ **Front + back storefront covers** — a flippable sales-page cover, separate from embedded art
- ✅ **Encrypted music-video release** — a full multi-file, holder-only release (lossless audio + scene
  video + synced lyrics) minted and decrypt-verified **end-to-end on mainnet**
- ✅ **Air-gapped & watch-only** — offline cold key-gen, file-based offline signing for transfers / burns /
  BSV payments, and a keyless watch-only mode
- ✅ **Instant / offline replay** — verified content cached locally (IndexedDB)

Still experimental — treat it as a working prototype, and use small amounts. Stronger encrypted-content
tiers (live per-recipient key delivery; a server with per-buyer watermarking), on-chain / time-locked
bonuses, edition deep-verify (full lineage proof), Threads replies/threading + deeper downstream-holder
verification, a sales **spent/net P&L** + trend chart, config-backup **delete-sync** (tombstones), reference-mint
**version supersession**, an eBook **"library" view** for non-audio bundles, **lazy/prefetch resolution**
for very large reference releases, and a **native-WebCrypto** speed-up for encrypting large content are
designed but not yet built.
