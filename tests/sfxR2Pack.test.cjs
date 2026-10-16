// Private R2 sound-effects pack (electron/r2Client.cjs, electron/sfxR2Pack.cjs):
// SigV4 signing, key-file parsing, safe extraction, the local catalog and the
// source router. No network: zips are built here, R2 is never called.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')

const r2 = require('../electron/r2Client.cjs')
const pack = require('../electron/sfxR2Pack.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sfx-r2-'))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** Minimal zip writer (stored or deflated entries) for test fixtures. */
function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data, deflate = false } of files) {
    const raw = Buffer.from(data)
    const body = deflate ? zlib.deflateRawSync(raw) : raw
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = zlib.crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

test('SigV4 matches the AWS S3 "GET Object" example', () => {
  const result = r2.signV4({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', canonicalUri: '/test.txt', headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', amzDate: '20130524T000000Z',
  })
  assert.equal(result.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
})

const fakeConfig = {
  endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, region: 'auto', bucket: 'sfx-drama-studio',
  accessKeyId: 'A'.repeat(32), secretAccessKey: 'b'.repeat(64),
}

test('R2 requests are path-style, signed, and never carry the secret', () => {
  const config = r2.normalizeR2Config(fakeConfig)
  const signed = r2.signRequest(config, { key: 'sfx/viral sfx (1).zip', headers: { Range: 'bytes=10-' }, now: new Date('2026-10-16T00:00:00Z') })
  assert.equal(signed.url, `${fakeConfig.endpoint}/sfx-drama-studio/sfx/viral%20sfx%20%281%29.zip`)
  assert.match(signed.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=A{32}\/20261016\/auto\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify(signed).includes(fakeConfig.secretAccessKey))
  assert.throws(() => r2.normalizeR2Config({ ...fakeConfig, endpoint: 'https://evil.example.com' }), /endpoint/)
  assert.throws(() => r2.normalizeR2Config({ ...fakeConfig, endpoint: 'http://' + fakeConfig.endpoint.slice(8) }), /endpoint/)
  assert.throws(() => r2.normalizeObjectKey('sfx/../secrets.zip'), /not valid/)
  assert.equal(r2.describeR2Status(403).includes('403'), true)
})

test('key files in the Cloudflare guide format parse; code snippets are ignored', () => {
  const text = [
    'import boto3, zipfile',
    `s3 = boto3.client("s3", endpoint_url="${fakeConfig.endpoint}",`,
    '    aws_access_key_id="not-a-real-id",',
    '',
    'Settings your app also needs:',
    `- Endpoint: ${fakeConfig.endpoint}`,
    '- Region: auto',
    '- Bucket: sfx-drama-studio',
    '- File: sfx/viral-sfx-library.zip, plus sfx/catalog.tsv if the app should search first',
    '',
    `Access Key ID: ${fakeConfig.accessKeyId}`,
    `Secret Access Key: ${fakeConfig.secretAccessKey}`,
  ].join('\r\n')
  assert.deepEqual(r2.parseR2KeyFile(text), {
    endpoint: fakeConfig.endpoint, region: 'auto', bucket: 'sfx-drama-studio', objectKey: 'sfx/viral-sfx-library.zip',
    catalogKey: 'sfx/catalog.tsv', accessKeyId: fakeConfig.accessKeyId, secretAccessKey: fakeConfig.secretAccessKey,
  })
})

test('only safe relative audio paths are accepted', () => {
  assert.equal(pack.safeRelativeAudioPath('accent\\3d-box\\Box.MP3'), 'accent/3d-box/Box.MP3')
  for (const bad of ['../x.mp3', 'a/../../x.mp3', '/abs.mp3', 'C:/x.mp3', 'a/readme.txt', '__MACOSX/a.mp3', 'a/.hidden.mp3', 'a//b.mp3', 'a/b?.mp3']) {
    assert.equal(pack.safeRelativeAudioPath(bad), null, bad)
  }
  assert.throws(() => pack.resolveInside(tmp, '../outside.mp3'), /escapes/)
})

test('catalog.tsv becomes metadata keyed by path', () => {
  const tsv = 'id\tfile\tcategory\tdurationSeconds\tonsetMs\tpeakMs\tshape\ttone\ttags\tdescription\r\n'
    + 'sfx-00001\taccent/3d-box/3d-box-ease-in.mp3\taccent\t1.061\t70\t390\tswell\twarm\taccent,box,ease\t3D Box Ease In: 1.06s warm accent.\r\n'
    + 'bad\t../evil.mp3\tx\t1\t0\t0\t\t\t\t\r\n'
  const meta = pack.parseCatalogTsv(tsv)
  assert.equal(meta.size, 1)
  assert.deepEqual(meta.get('accent/3d-box/3d-box-ease-in.mp3'), {
    id: 'sfx-00001', category: 'accent', duration: 1.061, tags: ['accent', 'box', 'ease', 'swell', 'warm'],
    description: '3D Box Ease In: 1.06s warm accent.',
  })
})

test('extraction keeps audio only, then the local catalog groups by folder', async () => {
  const lib = path.join(tmp, 'lib')
  const zipFile = path.join(tmp, 'pack.zip')
  fs.writeFileSync(zipFile, buildZip([
    { name: 'viral-sfx-library/', data: '' },
    { name: 'viral-sfx-library/accent/3d-box/3d-box-ease-in.mp3', data: 'ID3 fake mp3 one' },
    { name: 'viral-sfx-library/whoosh/fast/swish_01.mp3', data: 'ID3 fake mp3 two'.repeat(50), deflate: true },
    { name: 'viral-sfx-library/readme.txt', data: 'not audio' },
    { name: 'viral-sfx-library/accent/.DS_Store.mp3', data: 'hidden' },
  ]))
  const progress = []
  const result = await pack.extractAudioZip(zipFile, path.join(lib, pack.FILES_DIR), { onEntry: (p) => progress.push(p) })
  assert.deepEqual(result, { extracted: 2, skipped: 2 })
  assert.equal(progress.at(-1).total, 5)
  assert.equal(fs.readFileSync(path.join(lib, 'files', 'viral-sfx-library', 'whoosh', 'fast', 'swish_01.mp3'), 'utf8'), 'ID3 fake mp3 two'.repeat(50))
  assert.ok(!fs.existsSync(path.join(lib, 'files', 'viral-sfx-library', 'readme.txt')))

  const tsv = 'id\tfile\tcategory\tdurationSeconds\ttags\tdescription\n'
    + 'sfx-00001\taccent/3d-box/3d-box-ease-in.mp3\taccent\t1.061\taccent,box\t3D Box Ease In: 1.06s warm accent.\n'
  const catalog = await pack.buildLocalCatalog(lib, tsv)
  assert.equal(catalog.matched, 1)
  assert.deepEqual(catalog.entries.map((e) => [e.id.startsWith('sfx-') ? e.id.slice(0, 4) : e.id, e.name, e.category, e.subCategory, e.duration]), [
    ['sfx-', '3D Box Ease In', 'accent', '3d-box', 1.061],
    ['sfx-', 'Swish 01', 'whoosh', 'fast', 0],
  ])
  assert.equal(catalog.entries[0].id, 'sfx-00001')
  assert.equal(catalog.entries[0].localPath, 'viral-sfx-library/accent/3d-box/3d-box-ease-in.mp3')
})

test('a zip with a path-traversal entry is refused and writes nothing outside', async () => {
  const zipFile = path.join(tmp, 'evil.zip')
  fs.writeFileSync(zipFile, buildZip([{ name: '../../evil.mp3', data: 'x' }]))
  const dest = path.join(tmp, 'evil-dest', 'files')
  await assert.rejects(pack.extractAudioZip(zipFile, dest))
  assert.ok(!fs.existsSync(path.join(tmp, 'evil.mp3')))
  assert.ok(!fs.existsSync(path.join(tmp, '..', 'evil.mp3')))
})

test('an installed pack works offline (no keys) and the router picks it', async () => {
  const lib = path.join(tmp, 'lib')
  fs.writeFileSync(path.join(lib, pack.PACK_FILE), JSON.stringify({ objectKey: 'sfx/viral-sfx-library.zip', size: 123, installedAt: '2026-10-16T00:00:00Z' }))
  const events = []
  const source = pack.createR2PackSource({ getConfig: async () => null, getLibraryDir: async () => lib, emit: (...args) => events.push(args) })
  const catalog = await source.getCatalog()
  assert.equal(catalog.installed, true)
  assert.equal(catalog.hasKeys, false)
  assert.equal(catalog.entries.length, 2)
  const id = catalog.entries[0].id
  const resolved = await source.resolve(id)
  assert.equal(resolved.cached, true)
  assert.ok(resolved.path.startsWith(path.join(lib, 'files')))
  assert.deepEqual(await source.status([id, 'nope']), { [id]: 'cached', nope: 'unknown' })
  await assert.rejects(source.resolve('nope'), /not in the pack/)
  await assert.rejects(source.packStart(), /R2 access keys/)

  const urlLibrary = { getCatalog: async () => ({ configured: false, entries: [] }), packStatus: () => ({ state: 'idle', source: 'url' }) }
  let settings = { sfxLibrary: { source: 'r2-pack' } }
  const router = pack.createSfxSourceRouter({ urlLibrary, r2Pack: source, readSettings: async () => settings })
  assert.equal((await router.getCatalog()).source, 'r2-pack')
  assert.equal(router.packStatus().source, 'r2-pack')
  settings = { sfxLibrary: { catalogUrl: 'https://x/c.json' } }
  assert.equal((await router.getCatalog()).configured, false)
  assert.equal(router.packStatus().source, 'url')

  const info = await source.clearCache()
  assert.equal(info.installed, false)
  assert.ok(!fs.existsSync(path.join(lib, 'files')))
  assert.equal((await source.getCatalog()).installed, false)
})
