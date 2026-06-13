// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
// Validates the storefront READ path the sales page (app.ts loadCollection) relies on: from a
// collection's TX1 outputs, recover name + description + cover + edition fees + lock state.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, LockingScript, Utils } from '@bsv/sdk'
import {
  buildTemplateScript, buildStorefrontScript, encodeTokenRules,
  parseTemplateScript, parseStorefrontScript, parseFileScript, decodeTokenRules,
  RESTRICTION_REPLICABLE, RESTRICTION_ENCRYPTED,
} from '../src/tokenCodec.ts'
import { buildEditionLock, parseEditionScript } from '../src/covenant.ts'

const publisher = PrivateKey.fromRandom()
const publisherPub = publisher.toPublicKey().toString()
const publisherPubKeyHash = publisher.toPublicKey().toHash() as number[]
const coverBytes = Array.from({ length: 300 }, (_, i) => (i * 5 + 1) & 0xff)

// Mirror of app.ts loadCollection's extraction loop over tx1.outputs.
function extract(outputs: LockingScript[]) {
  let template, publisherPubKeyHex: string | null = null, storefront, hasContentFile = false
  for (const o of outputs) {
    const t = parseTemplateScript(o); if (t) { template = t.fields; publisherPubKeyHex = t.publisherPubKeyHex }
    const s = parseStorefrontScript(o); if (s) storefront = s.fields
    if (parseFileScript(o)) hasContentFile = true
  }
  if (!template) throw new Error('no template')
  const rules = decodeTokenRules(template.tokenRules)
  let fees: { publisher: number; holder: number } | null = null
  if (template.covenantScript) {
    const ed = parseEditionScript(LockingScript.fromHex(template.covenantScript))
    if (ed) fees = { publisher: ed.terms.publisherFeeSats, holder: ed.terms.holderFeeSats }
  }
  return {
    name: template.tokenName, description: storefront?.description ?? '',
    cover: storefront?.coverBytes ?? null, encrypted: rules.isEncrypted,
    replicable: rules.isReplicable, hasContentFile, publisherPubKeyHex, fees,
  }
}

test('sales page reads name, description, cover, fees, and lock state from TX1 outputs', () => {
  const templateLock = buildEditionLock({
    tx1Ref: new Array(32).fill(0), ownerPubKey: new Array(33).fill(0), stateData: [],
    publisherPubKeyHash, publisherFeeSats: 5000, holderFeeSats: 1000, tokenSats: 1,
  })
  const template = {
    tokenName: 'Secret eBook (unlimited editions)',
    tokenRules: encodeTokenRules(0, 0, RESTRICTION_REPLICABLE | RESTRICTION_ENCRYPTED, 1),
    covenantScript: Utils.toHex(templateLock.toBinary()),
    fileHash: 'ab'.repeat(32),
  }
  const outputs = [
    buildTemplateScript(publisherPub, template),
    buildStorefrontScript(publisherPub, {
      description: 'A tokenized eBook. Holders unlock the full PDF.',
      coverMimeType: 'image/png', coverFileName: 'cover.png', coverBytes,
    }),
  ]

  const info = extract(outputs)
  assert.equal(info.name, 'Secret eBook (unlimited editions)')
  assert.equal(info.description, 'A tokenized eBook. Holders unlock the full PDF.')
  assert.deepEqual(info.cover, coverBytes)
  assert.equal(info.encrypted, true)
  assert.equal(info.replicable, true)
  assert.deepEqual(info.fees, { publisher: 5000, holder: 1000 })
  assert.equal(info.publisherPubKeyHex, publisherPub)
})

test('sales page handles a collection with no storefront output (description empty, no cover)', () => {
  const template = {
    tokenName: 'Plain collection',
    tokenRules: encodeTokenRules(1, 0, 0, 1),
    covenantScript: '',
    fileHash: 'cd'.repeat(32),
  }
  const info = extract([buildTemplateScript(publisherPub, template)])
  assert.equal(info.name, 'Plain collection')
  assert.equal(info.description, '')
  assert.equal(info.cover, null)
  assert.equal(info.replicable, false)
  assert.equal(info.fees, null)
})
