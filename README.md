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
> messaging** (text / files / content keys) is also working.
>
> **New here? Read [`docs/OVERVIEW.md`](./docs/OVERVIEW.md)** — a plain-language functional tour. See
> `PLAN.md` for the full design and `docs/DEVIATIONS_FROM_MPT.md` for how it differs from MPT.

## How it works

- **Collections, not lone tokens.** A collection is created with two transactions: **TX1** commits the
  immutable template (name, rules, optional embedded file) and *is* the Collection ID; **TX2** mints the
  token editions, each referencing TX1.
- **Non-prunable data.** Token and file data live in PushDrop outputs (`<pubkey> OP_CHECKSIG <fields> OP_DROP`),
  so they stay in the UTXO set. An embedded file is bound to the collection identity by hash (tamper-evident).
- **SPV-only.** No indexers or trusted third parties — a token is a valid edition if it traces to a real
  genesis; proofs are fetched on demand (BEEF-ready). Transfers are constant-size (no on-chain proof chain).
- **Unlimited-mints editions (covenant).** Optional miner-enforced tokens where *any buyer* can mint their
  own copy permissionlessly — the spend is rejected unless the holder's token is returned, the buyer's
  replica carries the same covenant forward, and fixed creator + holder fees are paid. Built on a
  hand-rolled **OP_PUSH_TX** covenant (transaction introspection in script). See `docs/OVERVIEW.md`.
- **Messaging.** Send encrypted, authenticated (ECIES) on-chain messages to any pubkey — a typed payload
  carrying text, a file (bonus content), and/or a content key. The same record shape as a token
  (`[P, version, RECORD_MESSAGE, ref, envelope]`); the delivery layer the encrypted-content feature builds on.
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
  messageCodec.ts      message envelope: typed TLV payload (text/key/file) + authenticated ECIES
  messageBuilder.ts    send / scan on-chain messages (delivered like a transfer)
  walletProvider.ts    WhatsOnChain client (UTXOs, raw tx, broadcast, headers)
  pharlapStore.ts      local token store (localStorage)
  app.ts               browser wallet UI
  fileCache.ts         IndexedDB cache for embedded files
test/                  node --test suites
```

## License

Licensed under the **Open BSV License Version 5** — see [LICENSE](./LICENSE). Derived from MPT v05.24.
© BSV Association. Use only on the BSV Blockchains.
