import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLyrics } from '../src/lyrics.ts'

test('plain lyrics → unsynced, non-empty lines only', () => {
  const r = parseLyrics('first line\n\n  second line  \n')
  assert.equal(r?.synced, false)
  assert.deepEqual(r?.lines, [{ t: -1, text: 'first line' }, { t: -1, text: 'second line' }])
})

test('LRC timestamps → synced, sorted, text stripped of tags', () => {
  const r = parseLyrics('[00:04.50]second\n[00:01.00]first')
  assert.equal(r?.synced, true)
  assert.deepEqual(r?.lines, [{ t: 1, text: 'first' }, { t: 4.5, text: 'second' }])
})

test('a line may repeat at multiple timestamps (chorus)', () => {
  const r = parseLyrics('[00:10.00][01:00.00]chorus')
  assert.equal(r?.synced, true)
  assert.deepEqual(r?.lines, [{ t: 10, text: 'chorus' }, { t: 60, text: 'chorus' }])
})

test('LRC metadata tags ([ti:]/[ar:]/[offset:]) are not treated as timestamps', () => {
  const r = parseLyrics('[ti:My Song]\n[ar:Me]\n[00:02.00]real line')
  assert.equal(r?.synced, true)
  assert.deepEqual(r?.lines, [{ t: 2, text: 'real line' }])
})

test('empty / whitespace input → null', () => {
  assert.equal(parseLyrics(''), null)
  assert.equal(parseLyrics('   \n  '), null)
  assert.equal(parseLyrics(null), null)
})
