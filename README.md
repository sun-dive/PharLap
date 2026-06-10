# PHAR LAP

**P**eer-to-peer · **H**ashing · **A**lgorithm · **R**eplication · **L**edger · **A**uthentication · **P**rotocol

A PushDrop-based BSV token wallet — a standalone browser app for minting, sharing, and transferring
tokenized content. Derived from the **MPT v05.24** prototype, rebuilt around PushDrop so token data lives
in a *spendable* (non-prunable) output rather than a prunable OP_RETURN.

> **Status:** experimental. Collection mint (single + multi-edition), embedded-file binding, transfer,
> discovery, lightweight verification, and a file viewer are working and validated on BSV mainnet. The
> permissionless "unlimited mints" edition covenant is in design/development. See `PLAN.md` for the full
> design and `docs/DEVIATIONS_FROM_MPT.md` for how it differs from MPT.

## How it works

- **Collections, not lone tokens.** A collection is created with two transactions: **TX1** commits the
  immutable template (name, rules, optional embedded file) and *is* the Collection ID; **TX2** mints the
  token editions, each referencing TX1.
- **Non-prunable data.** Token and file data live in PushDrop outputs (`<pubkey> OP_CHECKSIG <fields> OP_DROP`),
  so they stay in the UTXO set. An embedded file is bound to the collection identity by hash (tamper-evident).
- **SPV-only.** No indexers or trusted third parties — a token is a valid edition if it traces to a real
  genesis; proofs are fetched on demand (BEEF-ready). Transfers are constant-size (no on-chain proof chain).
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
  walletProvider.ts    WhatsOnChain client (UTXOs, raw tx, broadcast, headers)
  pharlapStore.ts      local token store (localStorage)
  app.ts               browser wallet UI
  fileCache.ts         IndexedDB cache for embedded files
test/                  node --test suites
```

## License

Licensed under the **Open BSV License Version 5** — see [LICENSE](./LICENSE). Derived from MPT v05.24.
© BSV Association. Use only on the BSV Blockchains.
