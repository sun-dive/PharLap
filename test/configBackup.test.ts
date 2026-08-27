// © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeConfig, type ConfigBlob } from '../src/configBackup.ts'

const blob = (over: Partial<ConfigBlob>): ConfigBlob =>
  ({ schema: 1, contacts: {}, contactsAt: {}, savedAt: 1000, ...over })

test('mergeConfig: newest-wins per contact, union, alias newest-wins', () => {
  const local = {
    alias: 'me', aliasAt: 50,
    contacts: { aa: 'A-local-new', bb: 'B-local', cc: 'C-local-only' },
    contactsAt: { aa: 300, bb: 100, cc: 100 },
  }
  const backup = blob({
    alias: 'me2', aliasAt: 500,
    contacts: { aa: 'A-backup-old', bb: 'B-backup-new', dd: 'D-backup-only' },
    contactsAt: { aa: 200, bb: 400, dd: 400 },
  })
  const m = mergeConfig(local, backup)
  assert.equal(m.contacts.aa, 'A-local-new')  // local newer (300 > 200) → kept
  assert.equal(m.contacts.bb, 'B-backup-new') // backup newer (400 > 100) → updated
  assert.equal(m.contacts.cc, 'C-local-only')  // only local → kept
  assert.equal(m.contacts.dd, 'D-backup-only') // only backup → added
  assert.equal(m.alias, 'me2')                 // backup alias newer (500 > 50)
  assert.ok(m.changed >= 2)                     // bb updated + dd added
})

test('mergeConfig: a backup contact missing from local is added even with no local timestamp', () => {
  const local = { contacts: {}, contactsAt: {} }
  const backup = blob({ contacts: { aa: 'A' }, contactsAt: { aa: 700 } })
  const m = mergeConfig(local, backup)
  assert.equal(m.contacts.aa, 'A')
  assert.equal(m.contactsAt.aa, 700)
  assert.equal(m.changed, 1)
})

test('mergeConfig: identical backup contributes nothing (idempotent)', () => {
  const local = { contacts: { aa: 'A' }, contactsAt: { aa: 700 } }
  const backup = blob({ contacts: { aa: 'A' }, contactsAt: { aa: 700 } })
  assert.equal(mergeConfig(local, backup).changed, 0)
})
