/**
 * Phase 3 — collection genesis builder tests (offline).
 *
 *  - buildTemplateTx produces a TX1 with a TEMPLATE output (+ optional FILE output) locked to
 *    the creator, parseable back to the same fields.
 *  - buildGenesisTx produces TX2 token outputs referencing TX1's txid, locked to the owner.
 *  - the TX1 -> TX2 funding chain is spendable (Spend-validated).
 *  - getSafeUtxos quarantines ≤1-sat outputs; selectFunding covers the target / throws.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Transaction, P2PKH, Spend } from '@bsv/sdk'
import {
  buildTemplateTx,
  buildGenesisTx,
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
  decodeTokenRules,
  encodeTokenRules,
  RESTRICTION_REPLICABLE,
} from '../src/tokenCodec.ts'

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

test('buildTemplateTx: TX1 has a parseable TEMPLATE output locked to the creator', async () => {
  const t1 = await buildTemplateTx({ key: KEY, funding: [makeFunding(100_000)], template: TEMPLATE })
  const parsed = parseTemplateScript(t1.tx.outputs[t1.templateVout].lockingScript)
  assert.ok(parsed, 'template output did not parse')
  assert.equal(parsed.creatorPubKeyHex, PUB)
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
