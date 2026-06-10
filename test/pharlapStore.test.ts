/**
 * Phase: App wiring — local token store tests (in-memory KV).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PharLapStore, type KVStore } from '../src/pharlapStore.ts'

function memKV(): KVStore {
  const m = new Map<string, string>()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

const TX1 = 'a'.repeat(64)

test('add / list / dedupe by outpoint', () => {
  const s = new PharLapStore(memKV())
  assert.equal(s.add({ txId: 'tx', outputIndex: 0, collectionId: TX1, stateData: 'beef' }), true)
  assert.equal(s.add({ txId: 'tx', outputIndex: 0, collectionId: TX1, stateData: 'beef' }), false) // dup
  assert.equal(s.add({ txId: 'tx', outputIndex: 1, collectionId: TX1, stateData: '00' }), true)
  assert.equal(s.list().length, 2)
  assert.equal(s.active().length, 2)
})

test('markSent moves a token out of active but keeps history', () => {
  const s = new PharLapStore(memKV())
  s.add({ txId: 'tx', outputIndex: 0, collectionId: TX1, stateData: 'beef' })
  s.markSent('tx', 0)
  assert.equal(s.active().length, 0)
  assert.equal(s.list().length, 1)
  assert.equal(s.list()[0].status, 'sent')
})

test('remove deletes a token', () => {
  const s = new PharLapStore(memKV())
  s.add({ txId: 'tx', outputIndex: 0, collectionId: TX1, stateData: 'beef' })
  s.remove('tx', 0)
  assert.equal(s.list().length, 0)
})

test('survives corrupt storage (returns empty)', () => {
  const kv = memKV()
  kv.setItem('p:tokens', '{not json')
  const s = new PharLapStore(kv)
  assert.deepEqual(s.list(), [])
})
