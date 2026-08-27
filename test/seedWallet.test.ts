// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Mnemonic, HD } from '@bsv/sdk'

// Mirrors app.ts keyFromMnemonic — locks the FIXED derivation path (changing it breaks every restore).
const PATH = "m/44'/236'/0'/0/0"
const wifFrom = (phrase: string, pass = ''): string =>
  HD.fromSeed(Mnemonic.fromString(phrase.trim().replace(/\s+/g, ' ')).toSeed(pass)).derive(PATH).privKey.toWif()

// Canonical BIP-39 test vector (valid checksum).
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

test('seed→WIF is deterministic, mainnet, and separated by path + passphrase', () => {
  assert.equal(Mnemonic.isValid(PHRASE), true)
  const w = wifFrom(PHRASE)
  assert.equal(w, wifFrom(PHRASE))                                   // deterministic (same phrase → same key)
  assert.equal(w, wifFrom('  abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon   about ')) // whitespace-tolerant
  assert.notEqual(w, wifFrom(PHRASE, 'extra'))                       // optional passphrase changes the key
  const otherPath = HD.fromSeed(Mnemonic.fromString(PHRASE).toSeed()).derive("m/44'/236'/0'/0/1").privKey.toWif()
  assert.notEqual(w, otherPath)                                      // a different path → different key
  assert.match(w, /^[KL5]/)                                          // mainnet WIF
})

test('a fresh 12-word phrase is valid and derives a usable key', () => {
  const m = Mnemonic.fromRandom(128).toString()
  assert.equal(m.split(' ').length, 12)
  assert.equal(Mnemonic.isValid(m), true)
  assert.doesNotThrow(() => wifFrom(m))
})

test('an invalid phrase is rejected', () => {
  assert.equal(Mnemonic.isValid('not a real seed phrase at all nope nope'), false)
})
