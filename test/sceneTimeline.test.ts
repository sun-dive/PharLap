import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCue } from '../src/sceneTimeline.ts'

const files = ['cosmic-1.webp', 'cosmic-2.webp', 'art/cover.webp', 'song.flac']

test('resolves timed scene filenames against packed files, sorted by time', () => {
  const cue = '[00:10.00]cosmic-2.webp\n[00:00.00]cosmic-1.webp'
  assert.deepEqual(resolveCue(cue, files), [
    { t: 0, name: 'cosmic-1.webp' },
    { t: 10, name: 'cosmic-2.webp' },
  ])
})

test('matches by basename when the packed file has a path', () => {
  assert.deepEqual(resolveCue('[00:05.00]cover.webp', files), [{ t: 5, name: 'art/cover.webp' }])
})

test('drops cue lines whose file is not packed; null if none resolve', () => {
  assert.deepEqual(resolveCue('[00:01.00]cosmic-1.webp\n[00:02.00]missing.webp', files),
    [{ t: 1, name: 'cosmic-1.webp' }])
  assert.equal(resolveCue('[00:01.00]nope.webp', files), null)
})

test('returns null for an untimed (plain) cue sheet — a video cue must carry timestamps', () => {
  assert.equal(resolveCue('cosmic-1.webp\ncosmic-2.webp', files), null)
  assert.equal(resolveCue('', files), null)
})
