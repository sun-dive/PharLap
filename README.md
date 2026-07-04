# PHAR LAP

**P**eer-to-peer · **H**ashing · **A**lgorithm · **R**eplication · **L**edger · **A**uthentication · **P**rotocol

A PushDrop-based BSV token wallet — a standalone browser app for minting, sharing, and transferring
tokenized content. Derived from the **MPT v05.24** prototype, rebuilt around PushDrop so token data lives
in a *spendable* (non-prunable) output rather than a prunable OP_RETURN.

> **Status:** experimental, but the core works on BSV mainnet. Collection mint (single + multi),
> embedded-file binding, transfer, discovery, lightweight verification, and a file viewer are validated.
> The permissionless **"unlimited mints" edition covenant** is built and **validated on mainnet** —
> mint, permissionless replicate (confirmed in a block), and owner-signed transfer all work, hand-rolled
> on `@bsv/sdk` with no external smart-contract toolchain. The covenant now rides on a configurable
> **refundable bond** with an owner-signed **burn** branch that reclaims it (mint → replicate → transfer →
> burn-reclaim validated on mainnet), and comes in a **v1 fixed-fee** and a **v2 percentage-pricing**
> variant. **Encrypted, authenticated on-chain messaging** (text / files / content keys) and optional
> **Tier-1 encrypted content** (gate an embedded file to token holders — an inconvenience, not DRM) are
> also working.
>
> **Recent updates:** **provable provenance** — a public embedded file is verified on view as a
> byte-exact, block-**timestamped exact replica** of its off-chain original; **smart compression** of
> embedded files + messages (gzip, keep-only-if-smaller, before encryption); **rich-media releases** —
> multi-track albums/EPs in one NFT, an in-wallet player (spinning-disc / bass-reactive speaker
> visualization, embedded cover art by role, time-synced LRC lyrics, on-chain scene-timeline music videos,
> IndexedDB replay cache); **reference / combination mints** (bundle existing mints into an EP by
> reference, no re-upload); shareable **collection sales pages** with an optional flippable **front + back
> cover** (a postable link that opens a storefront and a **one-click "Get a copy"** permissionless buy that
> **ghosts to "✓ You own a copy"** once you hold one); mutable **seller notes** that ride on-chain to
> buyers and propagate down the resale chain, with an optional **buyer bonus** (link/code); **recoverable
> gift links** (pre-funded claimable copies + reclaim of unclaimed ones); an **identity layer**
> (self-asserted aliases, deterministic identicons, on-chain profiles/avatars, address book); **encrypted
> DMs** with a compose overlay + **personalized bulk send** (mail-merge `%buyer%`/`%publisher%`/`%product%`),
> a publisher **buyer list + message**, and **Threads** (members-only lineage discussions — read your
> corridor, post, reply up, announce, un-spoofable badges); a **Sales dashboard** (de-duplicated per-sale
> view, dates, per-sale fees + gift detection, content-free scan); **encrypted config backup** (address
> book + prefs, encrypted-to-self, restored on WIF); **air-gapped / watch-only** operation (offline cold
> key-gen, file-based offline signing for transfer / burn / BSV payment, keyless watch-only mode); and
> **self-custody recovery** — restore your WIF on any browser or device and your purchases rebuild from chain.
>
> **New here? Read [`docs/OVERVIEW.md`](./docs/OVERVIEW.md)** — a plain-language functional tour. See
> [`docs/COVENANT_INTERNALS.md`](./docs/COVENANT_INTERNALS.md) for the deep covenant/protocol internals.

## How it works

- **Collections, not lone tokens.** A collection is created with two transactions: **TX1** commits the
  immutable template (name, rules, optional embedded file) and *is* the Collection ID; **TX2** mints the
  token editions, each referencing TX1.
- **Non-prunable data.** Token and file data live in PushDrop outputs (`<pubkey> OP_CHECKSIG <fields> OP_DROP`),
  so they stay in the UTXO set. An embedded file is bound to the collection identity by hash (tamper-evident).
- **Provenance / timestamped exact replica.** A public embedded file is committed by the SHA-256 of its
  *original* bytes, so anyone can prove the on-chain copy is a byte-exact, block-timestamped replica of an
  off-chain file (decompress → hash → match; the mint block is the timestamp). Encrypted files commit to the
  ciphertext instead (no plaintext oracle). The viewer shows a **✓ verified exact replica** result.
- **Compact by default.** Embedded files and messages are gzip-compressed when it shrinks them
  (keep-only-if-smaller, always before encryption), and the edition covenant is kept lean — lower fees and
  on-chain footprint, transparent in use.
- **SPV-only.** No indexers or trusted third parties — a token is a valid edition if it traces to a real
  genesis; proofs are fetched on demand (BEEF-ready). Transfers are constant-size (no on-chain proof chain).
- **Unlimited-mints editions (covenant).** Optional miner-enforced tokens where *any buyer* can mint their
  own copy permissionlessly — the spend is rejected unless the holder's token is returned, the buyer's
  replica carries the same covenant forward, and fixed publisher + holder fees are paid. Built on a
  hand-rolled **OP_PUSH_TX** covenant (transaction introspection in script). A **v1 fixed-fee** and a
  **v2 percentage-pricing** variant both ship (each collection embeds its own covenant, so they coexist).
  See `docs/OVERVIEW.md`.
- **Refundable bond + burn.** Every edition rides on a **refundable bond** (satoshis locked in the token's
  own UTXO; amount set per collection, default 2100 sats, enforced by the covenant). The bond rides back to
  the holder on replicate and moves with the token on transfer; an owner-signed **burn** branch destroys a
  copy and **sweeps its bonded sats back** to the owner — the covenant's only exit, so UTXOs are reclaimable
  instead of dust-locked. A one-byte selector picks replicate / transfer / burn.
- **Recoverable gift links.** Pre-fund claimable copies of your edition as shareable links, derived
  deterministically so they're recoverable from the publisher's WIF + chain alone; **reclaim** sweeps the
  funds from unclaimed links back to your wallet (invalidating them).
- **Rich-media releases.** A mint's content can be a whole release packed into **one hash-bound object**:
  multi-track **albums/EPs** (a native `magic + header + concatenated bytes` container), played in a built-in
  **player** (spinning "disc," bass-reactive **speaker** mode, audio visualizer, playlist), with **embedded
  cover art by role** (front / back / media disc label, from FLAC `PICTURE` / MP3 `APIC` tags), **time-synced
  LRC lyrics** (karaoke overlay), and **on-chain scene-timeline music videos** (a cue sheet times reused
  scene images to playback). Verified content is cached locally (IndexedDB) for instant / offline replay.
- **Reference / combination mints.** A mint's content can be a **manifest of pointers** to content already
  on-chain, so you can **bundle existing mints into an EP/compilation without re-uploading** — each referenced
  work is resolved and hash-verified on play, and the bundle is priced independently. Covenant-safe (to the
  chain a manifest is just another content file).
- **Identity layer.** Everywhere a key appears: **self-asserted aliases** (`@you`, no global registry — the
  pubkey is the truth), deterministic **identicons** (un-spoofable at a glance), optional **on-chain profiles**
  (published alias + avatar), and an **address book** (your labels always win). Shared by DMs, storefront,
  Updates, and Threads.
- **Encrypted DMs, buyer tools & Threads.** Send **encrypted, authenticated** DMs (text / file / content key)
  via a **compose overlay**, or a **personalized bulk send** (one tx per recipient, mail-merge `%buyer%` /
  `%publisher%` / `%product%`). Publishers get a **buyer list + message** per collection. **Threads** are
  members-only **lineage discussions**: read your corridor (creator + upline + your sub-tree), post to your
  line, reply up, or (publisher) announce to everyone — with **un-spoofable creator / holder / seniority
  badges**. No new covenant — it reuses the message + notification machinery on lineage-derived addresses.
- **Sales dashboard.** A single content-free history scan reconstructs your whole sales picture: a
  **de-duplicated per-sale view** (one row per real sale, dates, which fees you earned, exact per-sale 🎁 gift
  detection) plus a stats header (count / earned in sats + BSV / this-month / unique buyers).
- **Encrypted config backup.** Your **address book** (+ alias + UI prefs) — the one piece of local state not
  rebuildable from key + chain — is posted **encrypted-to-yourself** on-chain and auto-restored + merged on
  WIF restore (newest label wins; no delete-sync yet).
- **Air-gapped / watch-only.** Generate keys offline, load a wallet **watch-only** by public key, and sign
  transfers / burns / plain BSV payments on an offline device — file-based (a JSON request out, a raw signed
  tx back), the key never crosses the gap. See `docs/AIR_GAPPED.md`.
- **Messaging.** Send encrypted, authenticated (ECIES) on-chain messages to any pubkey — a typed payload
  carrying text, a file (bonus content), and/or a content key. The same record shape as a token
  (`[P, version, RECORD_MESSAGE, ref, envelope]`); the delivery layer the encrypted-content feature builds on.
- **Encrypted content (Tier 1, optional).** An embedded file can be AES-GCM encrypted under a per-collection
  key; the ciphertext lives on-chain (hash-bound) and the key travels obfuscated in the TX1 template, so any
  holder — including a permissionless replica's buyer — decrypts it with no server. The wrap is a casual
  speed-bump, not security; the real protection is economic (price + the resale incentive). "An inconvenience,
  not DRM." See `docs/OVERVIEW.md`.
- **Shareable sales pages.** Every collection (and every holder) has a postable link — `…/#c=<TX1>&h=<holder>` —
  that opens a **storefront**: cover image, title, description, lock state, and price, served entirely client-side.
  A stranger can **"Get a copy"** in one click: the page resolves the holder's current edition (deterministically,
  by script hash — no indexer), funds-checks, runs the permissionless replicate, and reveals/decrypts the content.
- **Buy BSV (on-ramp) + referrals.** A **💵 Buy BSV** button (in the wallet and on every storefront) sends a
  would-be buyer to **SimpleSwap** — swap any crypto for BSV, or buy with a card, no exchange account — so
  newcomers can fund a wallet without leaving the flow. Publishers can save their own **SimpleSwap referral
  code**, which rides on every sales page they share, earning the commission when a buyer funds up. Purely an
  external link — no covenant or protocol involvement. (Replaced Orange Gateway, which shut down.)
- **Seller notes & bonuses.** A seller can attach a public **note** (promo / redemption info) to a collection; it
  rides on-chain to the buyer at purchase and **propagates down the resale chain** as a sticky default (any owner
  can overwrite it). The note can carry an optional **bonus** — an external link or code the buyer claims from the
  sale confirmation. Lives outside the frozen covenant, so it stays freely editable; gating is the seller's site.
- **Self-custody recovery.** The local token store is just a cache — the **WIF + chain are the source of truth**.
  Restore your WIF on any browser or device and your holdings (with their notes/bonuses) rebuild from chain: a
  pubkey's live editions are found by address breadcrumbs + unspent-by-script-hash. No accounts, no server.
- **1-byte protocol prefix** `"P"` (`0x50`), format version `0x03`.

## Toolchain

- **Node ≥ 26** — runs the TypeScript sources directly (native type stripping); unit tests need no build step.
- **esbuild** — bundles `src/app.ts` → `bundle.js` for the browser wallet.
- **@bsv/sdk** — Bitcoin primitives (`PrivateKey`, `Transaction`, `Script`, `Hash`, `SymmetricKey`, `ECIES`).

## Commands

```bash
npm install      # install deps
npm test         # run unit tests (node --test)
npm run build    # bundle the browser wallet → bundle.js
npm run serve    # dev server on http://localhost:3000 (proxies /woc/* to WhatsOnChain)
```

Then open `http://localhost:3000`, fund the wallet's address, and mint a collection.

## Layout

```
src/
  pushDrop.ts          raw-key PushDrop script template (lock / unlock / decode)
  tokenCodec.ts        field codec for token / template / file / message / profile / config records
  tokenProtocol.ts     SPV core: Merkle-proof + proof-chain verification (zero network deps)
  collectionBuilder.ts collection genesis (TX1 template + TX2 mint) + funding helpers
  transfer.ts          transfers, ownership detection, incoming scan
  verify.ts            lightweight lineage verification
  pushtx.ts            hand-rolled optimal OP_PUSH_TX primitive (tx introspection in script)
  covenant.ts          unlimited-mints edition covenant — build / parse the locking script
                       (v1 fixed-fee + v2 percentage variants; replicate / transfer / burn branches)
  editionBuilder.ts    edition genesis / replicate / transfer / burn / gift links + discovery
  contentCrypto.ts     Tier-1 encrypted content (AES-GCM file + obfuscated per-collection key wrap)
  compress.ts          smart gzip for on-chain payloads (keep-only-if-smaller, before encryption)
  messageCodec.ts      message envelope: typed TLV payload (text/key/file) + authenticated ECIES
  messageBuilder.ts    send / scan on-chain messages (delivered like a transfer) + bulk mail-merge
  sellerNote.ts        seller notes + buyer bonuses: publish / resolve / echo (rides + propagates)
  broadcast.ts         publisher "Updates" — one public collection-keyed announcement holders pull
  discussion.ts        Threads: lineage-corridor discussions (post / read / reply-up / badges)
  profile.ts           self-published on-chain profile (display alias + avatar), resolve-by-scan
  configBackup.ts      encrypted-to-self address-book + prefs backup; restore + merge on WIF
  album.ts             PLEP album container — pack/unpack a multi-track release into one blob
  refManifest.ts       PREF reference manifest — content-by-pointer bundle (combination mints)
  sceneTimeline.ts     resolve a video cue sheet into a timed scene timeline for the player
  lyrics.ts            parse plain / synced-LRC lyrics for the karaoke overlay
  flacMeta.ts          extract embedded PICTURE (cover art) blocks from a FLAC
  id3.ts               extract embedded APIC (cover art) frames from an MP3 ID3v2 tag
  payment.ts           plain BSV P2PKH payment (pure builder + network wrapper)
  airgap.ts            air-gapped file-based signing (transfer / burn / payment); watch-only
  qrcodegen.ts         vendored Nayuki QR-code generator (MIT)
  qr.ts                QR render helpers + BSV (BIP21) payment URI
  thumbs.ts            NFT-card thumbnail cache (in-browser downscale, localStorage)
  walletProvider.ts    WhatsOnChain client (UTXOs, raw tx, broadcast, headers, script-hash unspent)
  pharlapStore.ts      local token store (localStorage cache)
  app.ts               browser wallet UI (incl. the player + IndexedDB content cache)
test/                  node --test suites
```

## License

Licensed under the **Open BSV License Version 6** — see [LICENSE](./LICENSE). © 2026 sun-dive;
© BSV Association. Derived from MPT v05.24. **Use only on the BSV Blockchains.**
