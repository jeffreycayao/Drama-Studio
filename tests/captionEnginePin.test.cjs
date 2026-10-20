'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ENGINE_BINARY_DOWNLOADS, createCaptionWhisperService } = require('../electron/captionWhisper.js')

function service(t, writeArchive) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-studio-caption-pin-'))
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }))
  const downloads = []
  const captions = createCaptionWhisperService({
    app: { getPath: () => userData },
    ffmpegPath: null,
    getMainWindow: () => null,
    download: async (url, dest) => { downloads.push(url); fs.writeFileSync(dest, writeArchive()) },
  })
  return { captions, userData, downloads }
}

test('every caption engine download is https and pinned, or that platform cannot install', () => {
  for (const [platform, download] of Object.entries(ENGINE_BINARY_DOWNLOADS)) {
    assert.match(download.url, /^https:\/\//, platform)
    if (download.sha256 !== null) assert.match(download.sha256, /^[0-9a-f]{64}$/, platform)
  }
  assert.ok(ENGINE_BINARY_DOWNLOADS.win32.sha256 && ENGINE_BINARY_DOWNLOADS.linux.sha256)
})

test('a caption engine archive that does not match its pinned hash is deleted unrun', { skip: !ENGINE_BINARY_DOWNLOADS[process.platform]?.sha256 && 'no pinned engine for this platform' }, async (t) => {
  const { captions, userData, downloads } = service(t, () => Buffer.from('not the real whisper archive'))
  const result = await captions.install({ modelId: 'tiny' })
  assert.equal(result.success, false)
  assert.match(result.error, /did not match/)
  assert.equal(downloads.length, 1, 'stopped before downloading the model')
  const engineDir = path.join(userData, 'caption-engine')
  assert.deepEqual(fs.readdirSync(path.join(engineDir, 'bin')), [], 'nothing unpacked')
  assert.equal(fs.readdirSync(engineDir).some((name) => /\.(zip|tar\.gz)$/.test(name)), false, 'archive deleted')
})
