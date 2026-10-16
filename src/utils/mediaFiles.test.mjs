import assert from 'node:assert/strict'
import test from 'node:test'
import { ALL_MEDIA_EXTENSIONS, getDroppedMediaFiles, getMediaCategory, hasDesktopFiles } from './mediaFiles.mjs'

test('media categories cover the common editor formats', () => {
  assert.equal(getMediaCategory('clip.MP4'), 'video')
  assert.equal(getMediaCategory('take.m4v'), 'video')
  assert.equal(getMediaCategory('vo.m4a'), 'audio')
  assert.equal(getMediaCategory('score.flac'), 'audio')
  assert.equal(getMediaCategory('still.webp'), 'images')
  assert.equal(getMediaCategory('notes.docx'), null)
  assert.equal(getMediaCategory('no-extension'), null)
  assert.ok(ALL_MEDIA_EXTENSIONS.includes('.aac'))
})

test('desktop drops are told apart from in-app drags and split into media and skipped', () => {
  assert.equal(hasDesktopFiles({ types: ['Files'] }), true)
  assert.equal(hasDesktopFiles({ types: ['application/x-drama-studio-asset'] }), false)
  assert.equal(hasDesktopFiles(null), false)
  const result = getDroppedMediaFiles({ files: [{ name: 'a.mov' }, { name: 'b.txt' }, { name: 'c.wav' }] })
  assert.deepEqual(result.media.map(file => file.name), ['a.mov', 'c.wav'])
  assert.deepEqual(result.skipped, ['b.txt'])
})
