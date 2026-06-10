# PHAR LAP

**P**eer-to-peer **H**ashing **A**lgorithm **R**eplication **L**edger **A**uthentication **P**rotocol

A PushDrop-based BSV token wallet, derived from the **MPT v05.24** prototype. PHAR LAP keeps token
metadata inside a *spendable* PushDrop locking script (so it stays in the UTXO set and cannot be pruned,
unlike OP_RETURN), and adds experimental miner-enforced covenant scripts — including the **"unlimited
mints"** edition-replication mechanic.

> Status: early development. The base PushDrop migration is being built in phases on top of the copied
> v05.24 wallet. See `PLAN.md` for the full design.

## Design at a glance

- **Non-prunable data** — token metadata lives in a PushDrop output (`<fields> OP_DROP <pubkey> OP_CHECKSIG`),
  not a prunable OP_RETURN. The bulky proof chain stays in a (regenerable) OP_RETURN on transfers.
- **SPV-only verification** — a token is valid if its Token ID derives from genesis and a Merkle path
  anchors it to a block header. No indexers, no trusted third parties.
- **1-byte protocol prefix** `"P"` (`0x50`), format version `0x03`.
- **Experimental covenants** (off by default) — issuer co-sign, and "unlimited mints" edition replication
  where any buyer can permissionlessly mint a copy that pays a fixed creator fee + holder fee.

## Toolchain

- **Node ≥ 26** — runs the TypeScript sources directly (native type stripping); unit tests need no build step.
- **esbuild** — bundles `src/app.ts` → `bundle.js` for the browser wallet.
- **@bsv/sdk** v1.10.3 — Bitcoin primitives (raw `PrivateKey`, `Transaction`, `Script`, `Hash`, `PushDrop`).

## Commands

```bash
npm install      # install deps (esbuild + @bsv/sdk)
npm test         # run unit tests (node --test)
npm run build    # bundle the browser wallet → bundle.js
npm run serve    # dev server on http://localhost:3000 (proxies /woc/* to WhatsOnChain)
```

## Layout

```
src/
  tokenProtocol.ts   SPV core: Token ID, Merkle proof, proof-chain verification (zero network deps)
  opReturnCodec.ts   (to be split into pushDrop.ts + tokenCodec.ts)
  walletProvider.ts  WhatsOnChain API client
  tokenStore.ts      localStorage persistence (key prefix "p:")
  tokenBuilder.ts    mint / transfer / verify orchestration
  app.ts             browser wallet UI
  fileCache.ts       IndexedDB cache for embedded files
test/                node --test suites
```

Derived from MPT v05.24 under the Open BSV License.
