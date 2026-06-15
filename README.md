# PHAR LAP

**P**eer-to-peer · **H**ashing · **A**lgorithm · **R**eplication · **L**edger · **A**uthentication · **P**rotocol

A PushDrop-based BSV token wallet — a standalone browser app for minting, sharing, and transferring
tokenized content. Derived from the **MPT v05.24** prototype, rebuilt around PushDrop so token data lives
in a *spendable* (non-prunable) output rather than a prunable OP_RETURN.

> **Status:** experimental, but the core works on BSV mainnet. Collection mint (single + multi),
> embedded-file binding, transfer, discovery, lightweight verification, and a file viewer are validated.
> The permissionless **"unlimited mints" edition covenant** is now built and **validated on mainnet** —
> mint, permissionless replicate (confirmed in a block), and owner-signed transfer all work, hand-rolled
> on `@bsv/sdk` with no external smart-contract toolchain. **Encrypted, authenticated on-chain
> messaging** (text / files / content keys) and optional **Tier-1 encrypted content** (gate an embedded
> file to token holders — an inconvenience, not DRM) are also working.
>
> **Recent updates:** **provable provenance** — a public embedded file is verified on view as a
> byte-exact, block-**timestamped exact replica** of its off-chain original; **smart compression** of
> embedded files + messages (gzip, keep-only-if-smaller, before encryption); shareable **collection sales
> pages** (a postable link that opens a storefront and a **one-click "Get a copy"** permissionless buy), a
> **cover image + description** per collection, mutable **seller notes** that ride on-chain to buyers and
> propagate down the resale chain, an optional **buyer bonus** (link/code) attached to the note, and
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
  hand-rolled **OP_PUSH_TX** covenant (transaction introspection in script). See `docs/OVERVIEW.md`.
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
  tokenCodec.ts        field codec for the token / template / file records
  tokenProtocol.ts     SPV core: Merkle-proof + proof-chain verification (zero network deps)
  collectionBuilder.ts collection genesis (TX1 template + TX2 mint)
  transfer.ts          transfers, ownership detection, incoming scan
  verify.ts            lightweight lineage verification
  pushtx.ts            hand-rolled optimal OP_PUSH_TX primitive (tx introspection in script)
  covenant.ts          unlimited-mints edition covenant (build + parse the locking script)
  editionBuilder.ts    edition genesis / replicate / transfer + discovery, over the covenant
  contentCrypto.ts     Tier-1 encrypted content (AES-GCM file + obfuscated per-collection key wrap)
  messageCodec.ts      message envelope: typed TLV payload (text/key/file) + authenticated ECIES
  messageBuilder.ts    send / scan on-chain messages (delivered like a transfer)
  sellerNote.ts        seller notes + buyer bonuses: publish / resolve / echo (rides + propagates)
  walletProvider.ts    WhatsOnChain client (UTXOs, raw tx, broadcast, headers, script-hash unspent)
  pharlapStore.ts      local token store (localStorage)
  app.ts               browser wallet UI
  fileCache.ts         IndexedDB cache for embedded files
test/                  node --test suites
```

## License

Licensed under the **Open BSV License Version 5** — see [LICENSE](./LICENSE). Derived from MPT v05.24.
© BSV Association. Use only on the BSV Blockchains.
