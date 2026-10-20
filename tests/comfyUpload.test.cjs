'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { uploadLocalFileToComfy, registerComfyUploadIpc } = require('../electron/comfyUpload.cjs')

test('uploads the file from disk as a file-backed blob, not a buffer', async () => {
  const opened = []
  const sent = []
  const result = await uploadLocalFileToComfy(
    { endpoint: 'http://127.0.0.1:8188', filePath: path.resolve('/videos/talk #1.mp4'), filename: 'talk #1.mp4' },
    {
      openAsBlob: async (filePath) => { opened.push(filePath); return new Blob(['video-bytes']) },
      fetch: async (url, init) => { sent.push({ url: String(url), form: init.body }); return { ok: true, json: async () => ({ name: 'talk _1.mp4' }) } },
    },
  )
  assert.deepEqual(result, { name: 'talk _1.mp4' })
  assert.deepEqual(opened, [path.resolve('/videos/talk #1.mp4')])
  assert.equal(sent[0].url, 'http://127.0.0.1:8188/upload/image')
  assert.equal(sent[0].form.get('image').name, 'talk _1.mp4', 'the name is made safe')
  assert.equal(sent[0].form.get('type'), 'input')
  assert.equal(sent[0].form.get('overwrite'), 'true')
})

test('a ComfyUI under a path keeps that path', async () => {
  const urls = []
  await uploadLocalFileToComfy({ endpoint: 'https://gpu.example/comfy', filePath: path.resolve('/a.wav'), filename: 'a.wav' }, {
    openAsBlob: async () => new Blob(['x']),
    fetch: async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({}) } },
  })
  assert.deepEqual(urls, ['https://gpu.example/comfy/upload/image'])
})

test('bad input is refused before anything is read', async () => {
  const deps = { openAsBlob: async () => { throw new Error('must not read') }, fetch: async () => { throw new Error('must not send') } }
  await assert.rejects(uploadLocalFileToComfy({ endpoint: 'file:///etc', filePath: path.resolve('/a') }, deps), /http or https/)
  await assert.rejects(uploadLocalFileToComfy({ endpoint: 'not a url', filePath: path.resolve('/a') }, deps), /not valid/)
  await assert.rejects(uploadLocalFileToComfy({ endpoint: 'http://127.0.0.1:8188', filePath: 'relative/a.mp4' }, deps), /absolute/)
})

test('a real upload streams the file to the server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-upload-'))
  const file = path.join(dir, 'clip.mp4')
  fs.writeFileSync(file, Buffer.alloc(3 * 1024 * 1024, 7))
  let received = 0
  const server = http.createServer((req, res) => {
    req.on('data', (chunk) => { received += chunk.length })
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name: 'clip.mp4' })) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await uploadLocalFileToComfy({ endpoint: `http://127.0.0.1:${server.address().port}`, filePath: file, filename: 'clip.mp4' })
    assert.equal(result.name, 'clip.mp4')
    assert.ok(received > 3 * 1024 * 1024, `server got ${received} bytes`)
  } finally {
    server.close()
  }
})

test('the IPC handler reports errors instead of throwing', async () => {
  const handlers = new Map()
  registerComfyUploadIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, { openAsBlob: async () => new Blob(['x']), fetch: async () => ({ ok: false, status: 400, text: async () => 'bad' }) })
  const result = await handlers.get('comfy:uploadLocalFile')({}, { endpoint: 'http://127.0.0.1:8188', filePath: path.resolve('/a.mp4') })
  assert.equal(result.success, false)
  assert.match(result.error, /400 - bad/)
})
