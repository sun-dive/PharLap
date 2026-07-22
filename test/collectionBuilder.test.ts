/**
 * Phase 3 — collection genesis builder tests (offline).
 *
 *  - buildTemplateTx produces a TX1 with a TEMPLATE output (+ optional FILE output) locked to
 *    the publisher, parseable back to the same fields.
 *  - buildGenesisTx produces TX2 token outputs referencing TX1's txid, locked to the owner.
 *  - the TX1 -> TX2 funding chain is spendable (Spend-validated).
 *  - getSafeUtxos quarantines ≤1-sat outputs; selectFunding covers the target / throws.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Transaction, P2PKH, Spend, SatoshisPerKilobyte } from '@bsv/sdk'
import {
  buildTemplateTx,
  buildGenesisTx,
  createCollection,
  getSafeUtxos,
  selectFunding,
  sha256Hex,
  PHARLAP_OUTPUT_SATS,
  type FundingInput,
} from '../src/collectionBuilder.ts'
import {
  parseTemplateScript,
  parseTokenScript,
  parseFileScript,
  parseStorefrontScript,
  decodeTokenRules,
  encodeTokenRules,
  RESTRICTION_REPLICABLE,
} from '../src/tokenCodec.ts'
import { unwrapContentKey, decryptContent } from '../src/contentCrypto.ts'

const KEY = PrivateKey.fromRandom()
const PUB = KEY.toPublicKey().toString()

function makeFunding(sats: number): FundingInput {
  const sourceTx = new Transaction()
  sourceTx.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: sats })
  return { utxo: { txId: sourceTx.id('hex'), outputIndex: 0, satoshis: sats, script: '' }, sourceTx }
}

const TEMPLATE = {
  tokenName: 'PHAR LAP Editions',
  tokenRules: encodeTokenRules(0, 0, RESTRICTION_REPLICABLE, 1),
  covenantScript: '',
}

test('buildTemplateTx: TX1 has a parseable TEMPLATE output locked to the publisher', async () => {
  const t1 = await buildTemplateTx({ key: KEY, funding: [makeFunding(100_000)], template: TEMPLATE })
  const parsed = parseTemplateScript(t1.tx.outputs[t1.templateVout].lockingScript)
  assert.ok(parsed, 'template output did not parse')
  assert.equal(parsed.publisherPubKeyHex, PUB)
  assert.equal(parsed.fields.tokenName, 'PHAR LAP Editions')
  assert.equal(decodeTokenRules(parsed.fields.tokenRules).isUnlimited, true)
  assert.equal(t1.tx.outputs[t1.templateVout].satoshis, PHARLAP_OUTPUT_SATS)
  assert.equal(t1.fileVout, null)
  assert.ok(t1.changeVout != null && t1.changeSats > 0, 'expected a change output')
  assert.equal(t1.tx1Id.length, 64)
})

test('buildTemplateTx: with a file, TX1 has a FILE output and the template carries its hash', async () => {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]
  const t1 = await buildTemplateTx({
    key: KEY,
    funding: [makeFunding(100_000)],
    template: { ...TEMPLATE, fileHash: sha256Hex(bytes) },
    file: { mimeType: 'image/png', fileName: 'art.png', fileBytes: bytes },
  })
  assert.equal(t1.fileVout, 1)
  const file = parseFileScript(t1.tx.outputs[1].lockingScript)
  assert.ok(file)
  assert.deepEqual(file.fields.fileBytes, bytes)
  const tmpl = parseTemplateScript(t1.tx.outputs[0].lockingScript)
  assert.equal(tmpl?.fields.fileHash, sha256Hex(bytes))
})

test('buildGenesisTx: TX2 mints token outputs referencing TX1 and locked to the owner', async () => {
  const tx1Id = 'a'.repeat(64)
  const t2 = await buildGenesisTx({
    key: KEY,
    funding: [makeFunding(100_000)],
    tx1Id,
    mintCount: 3,
    stateData: 'beef',
  })
  assert.deepEqual(t2.tokenVouts, [0, 1, 2])
  for (const v of t2.tokenVouts) {
    const tok = parseTokenScript(t2.tx.outputs[v].lockingScript)
    assert.ok(tok, `token output ${v} did not parse`)
    assert.equal(tok.ownerPubKeyHex, PUB)
    assert.equal(tok.fields.tx1Ref, tx1Id) // every token references the collection
    assert.equal(tok.fields.stateData, 'beef')
  }
})

test('two-tx chain: TX2 spends TX1 change and the spend is valid (Spend interpreter)', async () => {
  const t1 = await buildTemplateTx({ key: KEY, funding: [makeFunding(200_000)], template: TEMPLATE })
  assert.ok(t1.changeVout != null)

  const t2 = await buildGenesisTx({
    key: KEY,
    funding: [{
      utxo: { txId: t1.tx1Id, outputIndex: t1.changeVout, satoshis: t1.changeSats, script: '' },
      sourceTx: t1.tx,
    }],
    tx1Id: t1.tx1Id,
    mintCount: 2,
  })

  // Every token references TX1.
  for (const v of t2.tokenVouts) {
    assert.equal(parseTokenScript(t2.tx.outputs[v].lockingScript)?.fields.tx1Ref, t1.tx1Id)
  }

  // The TX2 input spending TX1's change must satisfy TX1's change locking script.
  const unlockingScript = t2.tx.inputs[0].unlockingScript
  assert.ok(unlockingScript)
  const interpreter = new Spend({
    sourceTXID: t1.tx1Id,
    sourceOutputIndex: t1.changeVout,
    lockingScript: t1.tx.outputs[t1.changeVout].lockingScript,
    sourceSatoshis: t1.changeSats,
    transactionVersion: t2.tx.version,
    otherInputs: [],
    unlockingScript,
    inputSequence: t2.tx.inputs[0].sequence ?? 0xffffffff,
    inputIndex: 0,
    outputs: t2.tx.outputs,
    lockTime: t2.tx.lockTime,
  })
  assert.equal(interpreter.validate(), true)
})

test('getSafeUtxos quarantines ≤1-sat outputs', async () => {
  const mockProvider = {
    getUtxos: async () => [
      { txId: 'a', outputIndex: 0, satoshis: 1, script: '' },     // a PHAR LAP / token output
      { txId: 'b', outputIndex: 1, satoshis: 5000, script: '' },  // spendable funding
    ],
  } as any
  const safe = await getSafeUtxos(mockProvider)
  assert.equal(safe.length, 1)
  assert.equal(safe[0].satoshis, 5000)
})

test('selectFunding covers the target and throws when insufficient', () => {
  const utxos = [
    { txId: 'a', outputIndex: 0, satoshis: 1000, script: '' },
    { txId: 'b', outputIndex: 0, satoshis: 9000, script: '' },
    { txId: 'c', outputIndex: 0, satoshis: 500, script: '' },
  ]
  const picked = selectFunding(utxos, 9500)
  assert.equal(picked.reduce((s, u) => s + u.satoshis, 0) >= 9500, true)
  assert.equal(picked[0].satoshis, 9000) // largest first
  assert.throws(() => selectFunding(utxos, 100_000), /Insufficient funds/)
})

test('createCollection WITH a file mints and TX1 carries a FILE output (regression: file.fileBytes)', async () => {
  const key = PrivateKey.fromRandom()
  // Realistic funding parsed from hex (inputs lack sourceTransaction), like a WoC fetch.
  const prev = new Transaction()
  prev.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 50_000 })
  const fb = new Transaction()
  fb.addInput({ sourceTransaction: prev, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(key) })
  fb.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 20_000 })
  fb.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), change: true })
  await fb.fee(new SatoshisPerKilobyte(100))
  await fb.sign()
  const fundingTx = Transaction.fromHex(fb.toHex())
  const fundingId = fundingTx.id('hex')

  const broadcasts: string[] = []
  const provider: any = {
    getUtxos: async () => [{ txId: fundingId, outputIndex: 0, satoshis: 20_000, script: '' }],
    getSourceTransaction: async (id: string) => {
      if (id === fundingId) return fundingTx
      throw new Error(`unexpected getSourceTransaction(${id})`)
    },
    broadcast: async (hex: string) => { broadcasts.push(hex); return 'id' },
    registerPendingTx: () => {},
  }

  const file = { mimeType: 'image/png', fileName: 'art.png', bytes: [0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4] }
  const r = await createCollection(provider, key, { tokenName: 'WithFile', supply: 1, mintCount: 1, file })
  assert.equal(r.tokenOutpoints.length, 1)
  // TX1 is the first broadcast; it must contain a FILE output.
  const tx1 = Transaction.fromHex(broadcasts[0])
  assert.equal(tx1.outputs.some(o => parseFileScript(o.lockingScript) != null), true)
})

test('createCollection mints ALL editions (multi-edition: 21) and broadcasts TX1 then TX2', async () => {
  const key = PrivateKey.fromRandom()
  const prev = new Transaction()
  prev.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 100_000 })
  const fb = new Transaction()
  fb.addInput({ sourceTransaction: prev, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(key) })
  fb.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 50_000 })
  fb.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), change: true })
  await fb.fee(new SatoshisPerKilobyte(100))
  await fb.sign()
  const fundingTx = Transaction.fromHex(fb.toHex())
  const fundingId = fundingTx.id('hex')

  const broadcasts: string[] = []
  const provider: any = {
    getUtxos: async () => [{ txId: fundingId, outputIndex: 0, satoshis: 50_000, script: '' }],
    getSourceTransaction: async (id: string) => {
      if (id === fundingId) return fundingTx
      throw new Error(`unexpected getSourceTransaction(${id})`)
    },
    broadcast: async (hex: string) => { broadcasts.push(hex); return 'id' },
    registerPendingTx: () => {},
  }

  const r = await createCollection(provider, key, { tokenName: 'Editions21', supply: 21, mintCount: 21 })
  assert.equal(r.tokenOutpoints.length, 21)
  assert.equal(broadcasts.length, 2) // TX1 then TX2, in order
  const tx2 = Transaction.fromHex(broadcasts[1])
  const tokenOuts = tx2.outputs.filter(o => parseTokenScript(o.lockingScript) != null)
  assert.equal(tokenOuts.length, 21) // all 21 editions present in the genesis tx
})

test('createCollection: encrypted capped-supply collection carries an encrypted FILE + storefront cover, supply preserved, NOT replicable', async () => {
  const key = PrivateKey.fromRandom()
  const prev = new Transaction()
  prev.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 100_000 })
  const fb = new Transaction()
  fb.addInput({ sourceTransaction: prev, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(key) })
  fb.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 60_000 })
  fb.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), change: true })
  await fb.fee(new SatoshisPerKilobyte(100))
  await fb.sign()
  const fundingTx = Transaction.fromHex(fb.toHex())
  const fundingId = fundingTx.id('hex')

  const broadcasts: string[] = []
  const provider: any = {
    getUtxos: async () => [{ txId: fundingId, outputIndex: 0, satoshis: 60_000, script: '' }],
    getSourceTransaction: async (id: string) => { if (id === fundingId) return fundingTx; throw new Error(`unexpected getSourceTransaction(${id})`) },
    broadcast: async (hex: string) => { broadcasts.push(hex); return 'id' },
    registerPendingTx: () => {},
  }

  const plaintext = [5, 9, 2, 250, 7, 199, 42, 13] // tiny + incompressible → the smart-compressor keeps it as-is
  const cover = { mimeType: 'image/webp', fileName: 'preview.webp', bytes: [1, 2, 3, 4, 5, 6] }
  const r = await createCollection(provider, key, {
    tokenName: 'Limited Ten', supply: 10, mintCount: 10, encrypt: true,
    file: { mimeType: 'application/pdf', fileName: 'design.pdf', bytes: plaintext },
    description: 'Only ten will ever exist.', cover,
  })
  assert.equal(r.tokenOutpoints.length, 10)

  const tx1 = Transaction.fromHex(broadcasts[0])
  // Template: supply preserved, capped (NOT unlimited/replicable), encrypted flag set, wrapped key present.
  const tmpl = tx1.outputs.map(o => parseTemplateScript(o.lockingScript)).find(Boolean)!
  const rules = decodeTokenRules(tmpl.fields.tokenRules)
  assert.equal(rules.supply, 10)
  assert.equal(rules.isUnlimited, false)
  assert.equal(rules.isReplicable, false) // a capped/limited mint is NOT the replication covenant
  assert.equal(rules.isEncrypted, true)
  assert.ok(tmpl.fields.wrappedKey != null && tmpl.fields.keySalt != null, 'template must carry the wrapped content key')

  // Storefront output present with description + cover (the public "what you're buying" face).
  const sf = tx1.outputs.map(o => parseStorefrontScript(o.lockingScript)).find(Boolean)!
  assert.ok(sf, 'expected a storefront output')
  assert.equal(sf.fields.description, 'Only ten will ever exist.')
  assert.deepEqual(sf.fields.coverBytes, cover.bytes)

  // FILE output holds CIPHERTEXT (not the clean product); it decrypts back with the wrapped key.
  const file = tx1.outputs.map(o => parseFileScript(o.lockingScript)).find(Boolean)!
  assert.notDeepEqual(file.fields.fileBytes, plaintext)
  const K = unwrapContentKey(tmpl.fields.wrappedKey!, tmpl.fields.keySalt!)
  assert.ok(K != null)
  assert.deepEqual(decryptContent(file.fields.fileBytes, K!), plaintext)
})
