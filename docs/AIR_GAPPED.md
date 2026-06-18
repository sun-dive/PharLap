# PHAR LAP — Air-Gapped (Cold) Wallet

A guide to generating and holding a PHAR LAP wallet on a permanently-offline machine, so the secret
(your 12-word seed phrase) is never exposed to an internet-connected device. Pattern adapted from the
classic cold-storage split (offline signer / online watcher / clean transfer medium).

> **Status:** This documents **Phase 0 — air-gapped key generation + cold storage**, which works **today** with
> no code changes (PHAR LAP is a self-contained client-side app that runs offline). The full air-gapped
> *transaction loop* (a keyless online "watch-only" mode + export-unsigned / sign-offline / import-signed) is a
> planned build — see **Roadmap** at the end. Until then, *using* the wallet still requires importing the key
> into an online instance, so Phase 0 alone = **cold generation + storage**, not cold operation.

## Threat model

**Protects against** (the key never touches a networked machine): remote malware / keyloggers / exploits,
supply-chain tampering of software in transit, and network-level surveillance of your secret.

**Does NOT protect against**: physical seizure of the offline machine or your paper backups, a compromised /
improperly-handled USB stick, or user error in handling the seed phrase. Cold storage moves the risk from the
network to your physical opsec — guard the paper and the offline box accordingly.

## Why PHAR LAP suits this

- **Client-side keys.** Key generation and signing already run entirely in the browser — no server — so an
  offline instance is fully functional for creating a wallet.
- **Single self-contained app.** `index.html` + `bundle.js` run straight from disk with no network. Opening
  them on an air-gapped machine *is* a cold wallet.
- **BIP-39 seed phrase.** Wallets are created from a standard 12-word phrase (BIP-32 path `m/44'/236'/0'/0/0`),
  so the cold backup is just words on paper — portable and human-recordable.
- **Verifiable build (supply-chain check).** PHAR LAP publishes timestamped on-chain snapshots of the built app
  (`index.html` + `bundle.js`) as SMART NFTs. Before trusting the files you carry to the offline machine, you
  can **hash them and compare against the on-chain, block-timestamped snapshot** — a stronger integrity check
  than "downloaded from a website."

## Phase 0 — step by step (cold key generation)

**On the offline machine** (no Wi-Fi/Ethernet — ideally a fresh OS or a live-USB boot, camera/mic covered):
1. Bring the PHAR LAP app files (`index.html`, `bundle.js`, `brand/`) over on a **clean, dedicated USB**.
   Optionally verify them first (see *Verify the build*).
2. Open `index.html` in a local browser. Confirm it's truly offline — **Refresh balance will fail**; that's
   expected and reassuring (the box has no network).
3. Click **New wallet**. The 12-word **seed phrase** appears — **write it down on paper, in order, multiple
   copies**, store them in separate secure locations. (Optionally also record the WIF from the Wallet tab as an
   equivalent backup.) **Never photograph it, never type it into an online device.**
4. From the Wallet tab, record the **Address** and **Public key** — these are **safe to take online**. Copy them
   to the clean USB (or transcribe them by hand). They are *not* secrets.
5. Power down the offline machine. The seed phrase never leaves it.

**On any online machine:** use the **address** to receive funds and watch activity in a block explorer
(e.g. WhatsOnChain). You can hand out the address / public key freely.

## Verify the build (recommended)

To defend against tampered app files, compare what you carry to a known-good, on-chain snapshot:
1. On a trusted machine, hash the files you'll air-gap (e.g. `sha256sum index.html bundle.js`).
2. Compare against the SHA-256 of the matching **on-chain timestamped snapshot** (the published proof zip /
   its contents). A match proves the files are the exact build fixed on-chain at that block time.

## Handling rules (the discipline that makes it real)

- The offline machine **never** connects to a network. Ever.
- Move **only non-secret data** (address, public key — and, in Phase 1, *signed* transactions) across the gap.
  **The seed phrase / WIF never crosses the gap in any digital form.**
- Use a **fresh, dedicated USB** for transfers; treat unknown USB media as hostile.
- Keep paper backups offline, redundant, and physically secured.

## Roadmap — full air-gapped operation (planned, not yet built)

To *transact* without ever exposing the key, PHAR LAP needs the sign-from-network split:
- **Phase 1:** a keyless **watch-only mode** (load by address/pubkey) that scans holdings and **builds unsigned
  transactions**, exporting them with their input context (a BEEF-style bundle: tx + input source-txs, since
  BSV's BIP-143 sighash needs each input's value + script); an **offline signer** that imports the bundle,
  signs with the seed-derived key, and exports the **signed** tx; and broadcast on the online side. File/USB
  transfer first. Targets ordinary spends + edition **transfers**.
- **Phase 2:** extend offline signing to the **covenant** operations (replicate / mint / burn — the OP_PUSH_TX
  preimage signed offline), and add **multi-frame QR** transfer as an alternative to USB.

Until Phase 1 ships, treat Phase 0 as cold *generation and storage*: the moment you need to spend, importing
the key into an online instance ends the air gap.
