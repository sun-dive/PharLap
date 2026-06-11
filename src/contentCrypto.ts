// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP — Tier 1 encrypted content (PLAN.md Addendum F).
 *
 * Envelope encryption with a per-collection content key K:
 *   - K = Random(32); the file is AES-GCM encrypted with K → ciphertext (stored on-chain; fileHash binds it).
 *   - K is delivered to holders as `wrappedK` — an OBFUSCATED, not securely-encrypted, blob.
 *   - Each collection also gets a random `keySalt`; the wrap key = SHA256(walletConstant ‖ keySalt). So both
 *     K and the wrapper are unique per collection (the keySalt is stored in the TX1 template, public).
 *
 * IMPORTANT — this is Tier 1: "an inconvenience, not DRM". The wrap is a deterministic obfuscation: every
 * holder derives the same wrap key from the public keySalt + a constant baked into this (open-source) wallet.
 * So ANY holder can unwrap K with no live party — which is exactly what makes permissionless replication work
 * without a server — but it also means anyone who reads this source + the public keySalt can unwrap it too.
 * The per-collection keySalt makes wrappers distinct but adds NO security over a constant (the unwrap method
 * is public either way). The real defence is economic (content priced below the bother-cost of extraction) +
 * the resale incentive (Addendum A). Its only cryptographic job is to stop casual copy-paste of a raw key out
 * of a block explorer.
 *
 * For real per-recipient protection you need a live sender (Tier 2) or a watermarking server (Tier 3).
 */
import { SymmetricKey, Random, Hash, Utils } from '@bsv/sdk'

/** Constant baked into the wallet — PUBLIC (this is open source). Obfuscation only, not a secret. */
const OBFUSCATION_SALT = Utils.toArray('PHARLAP/tier1/content-key/v1', 'utf8')

/** Generate a fresh 32-byte content key K. */
export function newContentKey(): number[] {
  return Random(32)
}

/** Generate a fresh per-collection 16-byte key salt (stored public in the template). */
export function newKeySalt(): number[] {
  return Random(16)
}

/** AES-GCM encrypt file bytes with K → ciphertext (IV embedded by SymmetricKey). */
export function encryptContent(fileBytes: number[], K: number[]): number[] {
  return new SymmetricKey(K).encrypt(fileBytes) as number[]
}

/** AES-GCM decrypt ciphertext with K → file bytes. Throws on a wrong/garbled key. */
export function decryptContent(ciphertext: number[], K: number[]): number[] {
  return new SymmetricKey(K).decrypt(ciphertext) as number[]
}

/**
 * Per-collection obfuscation key = SHA-256(SALT ‖ keySalt). Every holder derives the same key from the
 * public keySalt — see the file header: this is NOT a secret.
 */
function obfuscationKey(keySalt: number[]): number[] {
  return Hash.sha256([...OBFUSCATION_SALT, ...keySalt])
}

/** Obfuscate K for a collection → `wrappedK` (stored in the TX1 template alongside its keySalt). */
export function wrapContentKey(K: number[], keySalt: number[]): number[] {
  return new SymmetricKey(obfuscationKey(keySalt)).encrypt(K) as number[]
}

/** Recover K from `wrappedK` using the collection's keySalt, or null if it doesn't unwrap. */
export function unwrapContentKey(wrappedK: number[], keySalt: number[]): number[] | null {
  try {
    return new SymmetricKey(obfuscationKey(keySalt)).decrypt(wrappedK) as number[]
  } catch {
    return null
  }
}

/** SHA-256 of the (encrypted) bytes, hex — binds the ciphertext to the collection identity (template fileHash). */
export function contentHash(ciphertext: number[]): string {
  return Utils.toHex(Hash.sha256(ciphertext))
}
