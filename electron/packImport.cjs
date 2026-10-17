'use strict'

/**
 * Shared pack import (main process): the zip files creators trade, and the
 * declarative `.dspack` format (docs/DSPACK_FORMAT.md).
 *
 * Trust boundary: the zip is untrusted. It is opened with yauzl and checked
 * before anything is written: entry count, declared and actual sizes, a
 * compression-ratio check against zip bombs, and paths (absolute paths and
 * ".." refuse the whole pack; links, encrypted entries and packs inside the
 * pack are skipped). Only declarative content is extracted, into a fresh
 * temporary folder: ComfyUI workflows, prompt templates and media. Code
 * (Chrome extensions, scripts, programs, installers, pickled model weights)
 * is listed so the review can explain it, but it is never written to disk,
 * run or installed.
 *
 * The renderer gets item ids and display fields. It names items by id when it
 * reads or keeps them; every path is derived here.
 */

const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const yauzl = require('yauzl')

const DEFAULT_LIMITS = Object.freeze({
  maxZipBytes: 4 * 1024 * 1024 * 1024,
  maxEntries: 5000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 512 * 1024 * 1024,
  maxTextBytes: 8 * 1024 * 1024,
  // A deflated entry that grows more than this is treated as a zip bomb
  // (real workflows and text compress ~5-30x, media ~1x).
  maxCompressionRatio: 200,
  ratioCheckMinBytes: 1024 * 1024,
  maxPathLength: 400,
  maxDepth: 16,
  maxReadmeChars: 6000,
  maxDataUrlBytes: 4 * 1024 * 1024,
  maxListedSkipped: 200,
})

const SESSION_DIR_PREFIX = 'pack-'
const TEMP_FOLDER_NAME = 'drama-studio-packs'
const KEPT_PACKS_DIR = 'imported-packs'
const SESSION_TTL_MS = 6 * 60 * 60 * 1000

const TEXT_TEMPLATE_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'fountain'])
const SHOT_LIST_EXTENSIONS = new Set(['csv', 'tsv'])
const MEDIA_EXTENSIONS = {
  image: new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']),
  audio: new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']),
  video: new Set(['mp4', 'webm', 'mov', 'm4v']),
  lut: new Set(['cube']),
}
const MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const CODE_TYPES_BY_EXTENSION = {
  script: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'wasm', 'sh', 'bash', 'zsh', 'command', 'applescript', 'scpt', 'lua', 'rb', 'pl', 'php'],
  'windows-script': ['bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'wsf', 'wsh', 'jse', 'hta', 'reg', 'lnk', 'url', 'inf'],
  python: ['py', 'pyc', 'pyo', 'pyw', 'pyd', 'ipynb', 'whl'],
  program: ['exe', 'com', 'scr', 'dll', 'sys', 'so', 'dylib', 'jar', 'app', 'elf', 'out', 'appimage', 'run'],
  installer: ['msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'msp', 'dmg', 'pkg', 'mpkg', 'deb', 'rpm', 'apk', 'xapk', 'ipa'],
  'extension-package': ['crx', 'xpi', 'vsix'],
  'web-page': ['html', 'htm', 'xhtml', 'svg'],
}
const CODE_TYPE_BY_EXTENSION = new Map(Object.entries(CODE_TYPES_BY_EXTENSION).flatMap(([type, list]) => list.map((ext) => [ext, type])))
const ARCHIVE_EXTENSIONS = new Set(['zip', 'dspack', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab', 'iso'])
// Pickled weights (.ckpt/.pt/.pth/.bin) can run code when loaded; even
// .safetensors are only fetched through Workflow Setup, from their source.
const MODEL_EXTENSIONS = new Set(['safetensors', 'ckpt', 'pt', 'pth', 'bin', 'gguf', 'onnx', 'sft', 'pkl', 'pickle', 'npz', 'h5'])
const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.gitignore', '.gitattributes', '.npmignore'])
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i
const BAD_SEGMENT = /[\x00-\x1f<>:"|?*]/
const README_NAME = /^(readme|read[\s_-]*me|about|instructions|使い方|説明|お読みください)(\.[a-z0-9]+)?$/i
const UI_ONLY_NODE_TYPES = new Set(['MarkdownNote', 'Note', 'Reroute', 'PrimitiveNode', 'GetNode', 'SetNode'])

// What a code tool says it does, from its manifest and readme. Used only to
// point at Drama Studio's built-in equivalent, never to decide to run it.
const TOOL_PATTERNS = [
  ['long-video', /seedance|long[\s_-]*(video|shot|clip)|\b(60|90|120|180|240|300|600)\s*(s|sec|secs|seconds|秒)\b|chain(ed|s|ing)?\s+(clips?|shots?|videos?)|stitch|extend(s|ed|ing)?\s+(the\s+)?(video|clip)|last[\s_-]*frame|長尺|長編/i],
  ['limit-bypass', /bypass|unlimited|no[\s_-]*limits?|without\s+limits?|remove[\s_-]*limits?|crack(ed)?|free\s+credits?|quota|rate[\s_-]*limit|captcha|multi[\s_-]*account|account\s+switch|制限解除|無制限|回避/i],
  ['automation', /auto[\s_-]*(click|clicker|submit|generate|generation|queue|download|refresh)|batch\s+generat|macro|\bbot\b|自動生成|自動化/i],
]

class PackImportError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

const extensionOf = (name) => {
  const match = /\.([^./]+)$/.exec(String(name || ''))
  return match ? match[1].toLowerCase() : ''
}

const stripExtension = (name) => String(name || '').replace(/\.[^./]+$/, '')

/** Readable title from a file name ("seedance_long-shot_v2.json" → "seedance long-shot v2"). */
function titleFromFileName(name) {
  return stripExtension(path.posix.basename(String(name || ''))).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'
}

/**
 * Check one zip entry name. Returns { rel } for a usable path and { skip } for
 * a name that is harmless but unusable. Throws UNSAFE_PATH for names that try
 * to leave the folder (absolute, drive letter, UNC, "..").
 */
function checkEntryPath(rawName, limits = DEFAULT_LIMITS) {
  const text = String(rawName || '').replace(/\\/g, '/')
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text)) {
    throw new PackImportError('A file in this pack points outside its folder.', 'UNSAFE_PATH')
  }
  const parts = text.split('/')
  if (parts.some((part) => part === '..')) {
    throw new PackImportError('A file in this pack points outside its folder.', 'UNSAFE_PATH')
  }
  const clean = parts.filter((part) => part !== '.' && part !== '')
  if (!clean.length) return { skip: 'ignored' }
  if (text.length > limits.maxPathLength || clean.length > limits.maxDepth) return { skip: 'bad-name' }
  if (clean.some((part) => part === '__MACOSX' || part.startsWith('._') || part === '.git' || part === 'node_modules')) return { skip: 'ignored' }
  if (IGNORED_NAMES.has(clean[clean.length - 1].toLowerCase())) return { skip: 'ignored' }
  for (const part of clean) {
    if (part.length > 160 || BAD_SEGMENT.test(part) || WINDOWS_RESERVED.test(part) || /[. ]$/.test(part)) return { skip: 'bad-name' }
  }
  return { rel: clean.join('/') }
}

/** Absolute path for a checked relative path; throws if it would leave `root`. */
function resolveInside(root, relative) {
  const base = path.resolve(root)
  const full = path.resolve(base, ...String(relative).split('/'))
  if (full === base || !full.startsWith(base + path.sep)) {
    throw new PackImportError('A file in this pack points outside its folder.', 'UNSAFE_PATH')
  }
  return full
}

const isSymlinkEntry = (entry) => ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000

/** First-pass kind from the name alone. JSON is settled after reading it. */
function classifyByName(rel) {
  const base = path.posix.basename(rel)
  const ext = extensionOf(base)
  if (ext === 'json') return { kind: 'json' }
  if (TEXT_TEMPLATE_EXTENSIONS.has(ext)) return { kind: README_NAME.test(base) ? 'readme' : 'template', subtype: ext === 'fountain' ? 'script' : 'prompt' }
  if (SHOT_LIST_EXTENSIONS.has(ext)) return { kind: 'template', subtype: 'shot-list' }
  for (const [mediaType, list] of Object.entries(MEDIA_EXTENSIONS)) if (list.has(ext)) return { kind: 'media', mediaType }
  if (CODE_TYPE_BY_EXTENSION.has(ext)) return { kind: 'code', codeType: CODE_TYPE_BY_EXTENSION.get(ext) }
  if (ARCHIVE_EXTENSIONS.has(ext)) return { kind: 'skip', reason: 'archive' }
  if (MODEL_EXTENSIONS.has(ext)) return { kind: 'skip', reason: 'model' }
  if (!ext && README_NAME.test(base)) return { kind: 'readme', subtype: 'prompt' }
  return { kind: 'skip', reason: 'unsupported' }
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** 'api' | 'ui' | null for parsed JSON. */
function detectWorkflowFormat(json) {
  if (!isPlainObject(json)) return null
  if (Array.isArray(json.nodes) && ('links' in json || 'last_node_id' in json || 'version' in json)) {
    return json.nodes.some((node) => isPlainObject(node) && typeof node.type === 'string') ? 'ui' : null
  }
  const values = Object.values(json)
  if (!values.length) return null
  // Every top-level value of an API prompt is a node.
  return values.every((node) => isPlainObject(node) && typeof node.class_type === 'string' && node.class_type.trim()) ? 'api' : null
}

/** Node types a workflow uses (for display; the renderer runs the dependency check). */
function workflowNodeTypes(json, format) {
  const types = new Set()
  if (format === 'api') {
    for (const node of Object.values(json)) types.add(String(node.class_type).trim())
  } else if (format === 'ui') {
    const nodes = [...json.nodes, ...((json.definitions?.subgraphs || []).flatMap((graph) => (Array.isArray(graph?.nodes) ? graph.nodes : [])))]
    for (const node of nodes) {
      const type = String(node?.type || '').trim()
      if (type && !UI_ONLY_NODE_TYPES.has(type) && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(type)) types.add(type)
    }
  }
  return Array.from(types)
}

const isChromeExtensionManifest = (json) => isPlainObject(json) && 'manifest_version' in json
  && (typeof json.name === 'string' || isPlainObject(json.background) || Array.isArray(json.content_scripts) || isPlainObject(json.action))

const cleanText = (value, max = 200) => (typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, max) : '')
const cleanRelPath = (value) => cleanText(value, 400).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '')

/** A `.dspack` manifest (docs/DSPACK_FORMAT.md) or null. Unknown fields are ignored. */
function parseDsPackManifest(json) {
  if (!isPlainObject(json) || String(json.format || '').toLowerCase() !== 'dspack') return null
  const contents = []
  for (const entry of Array.isArray(json.contents) ? json.contents.slice(0, 2000) : []) {
    if (!isPlainObject(entry)) continue
    const entryPath = cleanRelPath(entry.path)
    if (!entryPath) continue
    contents.push({
      path: entryPath,
      type: cleanText(entry.type, 40).toLowerCase(),
      title: cleanText(entry.title, 120),
      description: cleanText(entry.description, 600),
      cover: cleanRelPath(entry.cover),
    })
  }
  const homepage = cleanText(json.homepage, 300)
  return {
    formatVersion: Number(json.formatVersion) || 1,
    name: cleanText(json.name, 120),
    author: cleanText(json.author, 120),
    version: cleanText(json.version, 40),
    license: cleanText(json.license, 80),
    description: cleanText(json.description, 1000),
    homepage: /^https:\/\//i.test(homepage) ? homepage : '',
    contents,
  }
}

/** Tool patterns ('long-video', 'limit-bypass', 'automation') named in free text. */
function detectToolPatterns(...texts) {
  const text = texts.filter(Boolean).join('\n').slice(0, 200000)
  return TOOL_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([id]) => id)
}

const openZip = (file) => new Promise((resolve, reject) => {
  yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: false, validateEntrySizes: true, decodeStrings: true },
    (error, zip) => (error ? reject(error) : resolve(zip)))
})

/** Map yauzl's own refusals onto pack error codes. */
function zipError(error) {
  if (error instanceof PackImportError) return error
  const message = String(error?.message || error || '')
  if (/invalid relative path|absolute path|invalid characters in fileName/i.test(message)) {
    return new PackImportError('A file in this pack points outside its folder.', 'UNSAFE_PATH')
  }
  if (/too many bytes|too few bytes|uncompressedSize|compressed size/i.test(message)) {
    return new PackImportError('This pack lies about the size of its files.', 'ZIP_BOMB')
  }
  if (/end of central directory|not a zip|invalid .*signature|unsupported compression|multi-disk|zip64/i.test(message)) {
    return new PackImportError('This file is not a zip that Drama Studio can open.', 'NOT_ZIP')
  }
  return new PackImportError(message || 'The pack could not be read.', 'READ_FAILED')
}

/** Every entry of the central directory, without reading any data. */
function listEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = []
    zip.on('entry', (entry) => { entries.push(entry); zip.readEntry() })
    zip.on('end', () => resolve(entries))
    zip.on('error', (error) => reject(zipError(error)))
    zip.readEntry()
  })
}

/** Read (or write to `toFile`) one entry, counting the bytes that really come out. */
function readEntryData(zip, entry, { onBytes, maxBytes, toFile = null }) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) { reject(zipError(error)); return }
      const chunks = []
      let size = 0
      let out = null
      let failed = false
      const fail = (failure) => {
        if (failed) return
        failed = true
        stream.destroy()
        if (out) out.destroy()
        reject(zipError(failure))
      }
      if (toFile) {
        // 'wx': never follow or replace something already there.
        out = fs.createWriteStream(toFile, { flags: 'wx' })
        out.on('error', fail)
        out.on('finish', () => { if (!failed) resolve(size) })
      }
      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) { fail(new PackImportError('A file in this pack is larger than it says.', 'ZIP_BOMB')); return }
        try { onBytes(chunk.length) } catch (limitError) { fail(limitError); return }
        if (!out) { chunks.push(chunk); return }
        if (!out.write(chunk)) { stream.pause(); out.once('drain', () => stream.resume()) }
      })
      stream.on('error', fail)
      stream.on('end', () => {
        if (failed) return
        if (out) out.end()
        else resolve(Buffer.concat(chunks))
      })
    })
  })
}

const isUnder = (rel, root) => root === '' || rel.startsWith(`${root}/`)

function commonTopFolder(paths) {
  if (!paths.length) return ''
  const top = paths[0].split('/')[0]
  return paths.every((item) => item.includes('/') && item.split('/')[0] === top) ? top : ''
}

function makeSlug(text) {
  return String(text || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'pack'
}

/**
 * Inspect a pack: validate it, extract the declarative files into
 * `sessionDir`, classify everything. Electron-free; the IPC layer and the
 * tests both use it. Returns { result, items } or throws PackImportError.
 */
async function inspectPackFile(zipPath, sessionDir, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  let stat
  try {
    stat = await fsp.lstat(zipPath)
  } catch {
    throw new PackImportError('That file could not be found.', 'NOT_FOUND')
  }
  if (!stat.isFile()) throw new PackImportError('Choose a .zip or .dspack file.', 'NOT_ZIP')
  if (stat.size > limits.maxZipBytes) throw new PackImportError('This pack is too large to import.', 'TOO_BIG')

  let zip
  try {
    zip = await openZip(zipPath)
  } catch (error) {
    throw zipError(error)
  }
  try {
    // The count comes from the end record, before any entry is read.
    if (zip.entryCount > limits.maxEntries) {
      throw new PackImportError(`This pack has ${zip.entryCount} files; the limit is ${limits.maxEntries}.`, 'TOO_MANY_FILES')
    }
    const rawEntries = await listEntries(zip)
    if (rawEntries.length > limits.maxEntries) throw new PackImportError('This pack has too many files.', 'TOO_MANY_FILES')

    // Pass 1: names, links, declared sizes. A hostile path refuses the whole pack.
    const skipped = []
    const candidates = []
    let declaredTotal = 0
    const seenLower = new Set()
    for (const entry of rawEntries) {
      const checked = checkEntryPath(entry.fileName, limits)
      if (/\/$/.test(entry.fileName)) continue
      if (checked.skip) {
        if (checked.skip !== 'ignored') skipped.push({ path: String(entry.fileName).slice(0, 200), reason: checked.skip })
        continue
      }
      const rel = checked.rel
      if (isSymlinkEntry(entry)) { skipped.push({ path: rel, reason: 'link' }); continue }
      if (entry.isEncrypted()) { skipped.push({ path: rel, reason: 'encrypted' }); continue }
      if (seenLower.has(rel.toLowerCase())) { skipped.push({ path: rel, reason: 'duplicate' }); continue }
      seenLower.add(rel.toLowerCase())
      const size = Number(entry.uncompressedSize) || 0
      const compressed = Number(entry.compressedSize) || 0
      if (size >= limits.ratioCheckMinBytes && size > Math.max(1, compressed) * limits.maxCompressionRatio) {
        throw new PackImportError('This pack looks like a zip bomb (a tiny file that unpacks to a huge one).', 'ZIP_BOMB')
      }
      const byName = classifyByName(rel)
      if (byName.kind === 'skip') { skipped.push({ path: rel, reason: byName.reason }); continue }
      // Code is listed, never read or written.
      if (byName.kind === 'code') { candidates.push({ entry, rel, size, ...byName }); continue }
      const cap = byName.kind === 'media' ? limits.maxFileBytes : limits.maxTextBytes
      if (size > cap) { skipped.push({ path: rel, reason: 'too-large' }); continue }
      declaredTotal += size
      candidates.push({ entry, rel, size, ...byName })
    }
    if (declaredTotal > limits.maxTotalBytes) {
      throw new PackImportError('This pack unpacks to more than Drama Studio will import at once.', 'TOO_BIG')
    }

    // Pass 2: read JSON and text (capped, in memory) to settle what they are.
    let written = 0
    const onBytes = (count) => {
      written += count
      if (written > limits.maxTotalBytes) throw new PackImportError('This pack unpacks to more than it says.', 'ZIP_BOMB')
    }
    const buffers = new Map()
    const extensionRoots = []
    let manifest = null
    let manifestRel = ''
    for (const item of candidates) {
      if (item.kind !== 'json' && item.kind !== 'template' && item.kind !== 'readme') continue
      const data = await readEntryData(zip, item.entry, { onBytes, maxBytes: Math.min(item.size, limits.maxTextBytes) })
      buffers.set(item.rel, data)
      if (item.kind !== 'json') continue
      let json = null
      try {
        json = JSON.parse(data.toString('utf8').replace(/^﻿/, ''))
      } catch {
        item.kind = 'skip'
        item.reason = 'unreadable'
        continue
      }
      const base = path.posix.basename(item.rel).toLowerCase()
      if (base === 'manifest.json' && isChromeExtensionManifest(json)) {
        item.kind = 'code'
        item.codeType = 'chrome-extension'
        const dir = path.posix.dirname(item.rel)
        extensionRoots.push({ root: dir === '.' ? '' : dir, name: cleanText(json.name, 120), description: cleanText(json.description, 600) })
        continue
      }
      const dspack = base === 'manifest.json' ? parseDsPackManifest(json) : null
      if (dspack) {
        if (!manifest || item.rel.split('/').length < manifestRel.split('/').length) {
          manifest = dspack
          manifestRel = item.rel
        }
        item.kind = 'manifest'
        continue
      }
      const format = detectWorkflowFormat(json)
      if (format) {
        item.kind = 'workflow'
        item.format = format
        item.nodeTypes = workflowNodeTypes(json, format)
        item.nodeCount = format === 'api' ? Object.keys(json).length : json.nodes.length
      } else {
        item.kind = 'template'
        item.subtype = 'json'
      }
    }

    // Everything inside a Chrome extension's folder belongs to the extension
    // (its icons and popup.html are not media or templates).
    const codeGroups = new Map()
    const addToGroup = (key, init, rel) => {
      if (!codeGroups.has(key)) codeGroups.set(key, { ...init, files: [], fileCount: 0 })
      const group = codeGroups.get(key)
      group.fileCount += 1
      if (group.files.length < 20) group.files.push(rel)
    }
    for (const item of candidates) {
      const ext = extensionRoots.filter((root) => isUnder(item.rel, root.root)).sort((a, b) => b.root.length - a.root.length)[0]
      if (ext) {
        addToGroup(`ext:${ext.root}`, { type: 'chrome-extension', root: ext.root, name: ext.name, description: ext.description }, item.rel)
        item.kind = 'code-member'
        continue
      }
      if (item.kind === 'code') addToGroup(`type:${item.codeType}`, { type: item.codeType, root: '', name: '', description: '' }, item.rel)
    }

    const topFolder = commonTopFolder(candidates.map((item) => item.rel))
    const zipBase = stripExtension(path.basename(zipPath)).replace(/_+/g, ' ').trim()
    const packName = manifest?.name || (topFolder ? topFolder.replace(/_+/g, ' ') : '') || zipBase || 'Shared pack'

    // Readme: the shallowest one outside any code folder; other readmes are notes.
    const readmeItem = candidates
      .filter((item) => item.kind === 'readme')
      .sort((a, b) => a.rel.split('/').length - b.rel.split('/').length || a.rel.length - b.rel.length)[0] || null
    const readmeText = readmeItem ? buffers.get(readmeItem.rel).toString('utf8').replace(/^﻿/, '') : ''
    for (const item of candidates) if (item.kind === 'readme' && item !== readmeItem) { item.kind = 'template'; item.subtype = 'prompt' }

    // A tool's own manifest names what it does; the pack name and read-me
    // describe the pack as a whole and are reported once.
    const code = Array.from(codeGroups.values()).map((group, index) => ({
      id: `c${index}`,
      ...group,
      patterns: detectToolPatterns(group.name, group.description),
    }))
    const shownPatterns = new Set(code.flatMap((group) => group.patterns))
    const toolPatterns = code.length
      ? detectToolPatterns(packName, zipBase, readmeText.slice(0, 20000)).filter((pattern) => !shownPatterns.has(pattern))
      : []

    // Pass 3: write the declarative files into the session folder.
    const filesDir = path.join(sessionDir, 'files')
    await fsp.mkdir(filesDir, { recursive: true })
    const manifestDir = manifestRel && path.posix.dirname(manifestRel) !== '.' ? path.posix.dirname(manifestRel) : ''
    const localPath = (rel) => (manifestDir && rel.startsWith(`${manifestDir}/`) ? rel.slice(manifestDir.length + 1) : rel)
    const manifestByPath = new Map((manifest?.contents || []).map((entry) => [entry.path, entry]))
    const coverPaths = new Set((manifest?.contents || []).map((entry) => entry.cover).filter(Boolean))
    const items = new Map()
    let index = 0
    const keepItem = async (item) => {
      const target = resolveInside(filesDir, item.rel)
      await fsp.mkdir(path.dirname(target), { recursive: true })
      if (buffers.has(item.rel)) {
        await fsp.writeFile(target, buffers.get(item.rel), { flag: 'wx' })
      } else {
        await readEntryData(zip, item.entry, { onBytes, maxBytes: Math.min(item.size, limits.maxFileBytes), toFile: target })
      }
      const record = { id: `i${index++}`, rel: item.rel, absolutePath: target, kind: item.kind, size: item.size, mediaType: item.mediaType, format: item.format }
      items.set(record.id, record)
      return record
    }

    const workflows = []
    const templates = []
    const media = []
    const coverIds = new Map()
    let readmeRecord = null
    for (const item of candidates) {
      if (!['workflow', 'template', 'media', 'readme'].includes(item.kind)) {
        if (item.kind === 'skip') skipped.push({ path: item.rel, reason: item.reason || 'unsupported' })
        continue
      }
      let record
      try {
        record = await keepItem(item)
      } catch (error) {
        if (error?.code === 'EEXIST') { skipped.push({ path: item.rel, reason: 'duplicate' }); continue }
        throw zipError(error)
      }
      const entryInfo = manifestByPath.get(localPath(item.rel)) || null
      const name = path.posix.basename(item.rel)
      const base = { id: record.id, path: item.rel, name, size: item.size, description: entryInfo?.description || '' }
      if (item.kind === 'workflow') {
        workflows.push({
          ...base,
          title: entryInfo?.title || titleFromFileName(name),
          format: item.format,
          nodeCount: item.nodeCount,
          nodeTypes: item.nodeTypes.slice(0, 300),
          coverPath: entryInfo?.cover || '',
        })
      } else if (item.kind === 'template') {
        templates.push({ ...base, title: entryInfo?.title || titleFromFileName(name), subtype: item.subtype || 'prompt' })
      } else if (item.kind === 'media') {
        // Covers become workflow thumbnails instead of assets.
        if (coverPaths.has(localPath(item.rel))) { coverIds.set(localPath(item.rel), record.id); continue }
        media.push({ ...base, title: entryInfo?.title || titleFromFileName(name), mediaType: item.mediaType, absolutePath: record.absolutePath })
      } else {
        record.isReadme = true
        readmeRecord = record
      }
    }
    for (const workflow of workflows) {
      workflow.coverId = workflow.coverPath ? (coverIds.get(workflow.coverPath) || '') : ''
      delete workflow.coverPath
    }

    const result = {
      name: packName,
      slug: makeSlug(packName),
      fileName: path.basename(zipPath),
      isDsPack: Boolean(manifest),
      manifest: manifest ? {
        name: manifest.name, author: manifest.author, version: manifest.version, license: manifest.license,
        description: manifest.description, homepage: manifest.homepage,
      } : null,
      readme: readmeRecord ? {
        id: readmeRecord.id,
        path: readmeRecord.rel,
        text: readmeText.slice(0, limits.maxReadmeChars),
        truncated: readmeText.length > limits.maxReadmeChars,
      } : null,
      workflows,
      templates,
      media,
      code,
      toolPatterns,
      skipped: skipped.slice(0, limits.maxListedSkipped),
      skippedCount: skipped.length,
      totals: { entries: rawEntries.length, extractedBytes: written },
    }
    if (!workflows.length && !templates.length && !media.length && !code.length && !result.readme) {
      throw new PackImportError('Nothing in this pack can be imported.', 'EMPTY')
    }
    return { result, items }
  } finally {
    try { zip.close() } catch { /* already closed */ }
  }
}

/**
 * Pack sessions for the IPC layer: one temporary folder per opened pack,
 * removed on discard, on quit, and when stale.
 */
function createPackImporter({ tempRoot = path.join(os.tmpdir(), TEMP_FOLDER_NAME), getUserDataDir, limits = {}, now = () => Date.now() } = {}) {
  const sessions = new Map()

  async function removeSession(id) {
    const session = sessions.get(id)
    sessions.delete(id)
    if (session) await fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {})
  }

  async function sweepStale() {
    for (const [id, session] of sessions) if (now() - session.createdAt > SESSION_TTL_MS) await removeSession(id)
    let names = []
    try { names = await fsp.readdir(tempRoot) } catch { return }
    const active = new Set(Array.from(sessions.values()).map((session) => path.basename(session.dir)))
    for (const name of names) {
      if (!name.startsWith(SESSION_DIR_PREFIX) || active.has(name)) continue
      const full = path.join(tempRoot, name)
      try {
        const stat = await fsp.lstat(full)
        if (now() - stat.mtimeMs > SESSION_TTL_MS) await fsp.rm(full, { recursive: true, force: true })
      } catch { /* gone already */ }
    }
  }

  async function inspect(zipPath) {
    const file = String(zipPath || '')
    if (!file || !path.isAbsolute(file) || !/\.(zip|dspack)$/i.test(file)) {
      return { ok: false, code: 'NOT_ZIP', error: 'Choose a .zip or .dspack file.' }
    }
    await sweepStale()
    await fsp.mkdir(tempRoot, { recursive: true })
    const dir = await fsp.mkdtemp(path.join(tempRoot, SESSION_DIR_PREFIX))
    try {
      const { result, items } = await inspectPackFile(file, dir, { limits })
      const packId = crypto.randomBytes(12).toString('hex')
      sessions.set(packId, { dir, items, result, createdAt: now() })
      return { ok: true, packId, ...result }
    } catch (error) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
      const failure = zipError(error)
      return { ok: false, code: failure.code, error: failure.message }
    }
  }

  function getItem(packId, itemId) {
    const session = sessions.get(String(packId || ''))
    if (!session) throw new PackImportError('This pack is no longer open. Open it again.', 'EXPIRED')
    const item = session.items.get(String(itemId || ''))
    if (!item) throw new PackImportError('That file is not part of this pack.', 'NOT_IN_PACK')
    resolveInside(path.join(session.dir, 'files'), item.rel)
    return { session, item }
  }

  /** A workflow as parsed JSON, a template/readme/LUT as text, an image as a data URL (covers). */
  async function readItem(packId, itemId) {
    try {
      const { item } = getItem(packId, itemId)
      const name = path.posix.basename(item.rel)
      if (item.kind === 'media') {
        if (item.mediaType === 'lut') return { ok: true, kind: 'text', name, text: await fsp.readFile(item.absolutePath, 'utf8') }
        const mime = MIME_BY_EXTENSION[extensionOf(item.rel)]
        const maxBytes = limits.maxDataUrlBytes || DEFAULT_LIMITS.maxDataUrlBytes
        if (!mime || item.size > maxBytes) return { ok: false, code: 'NOT_READABLE', error: 'This file cannot be previewed.' }
        const data = await fsp.readFile(item.absolutePath)
        return { ok: true, kind: 'dataUrl', name, dataUrl: `data:${mime};base64,${data.toString('base64')}` }
      }
      const text = (await fsp.readFile(item.absolutePath, 'utf8')).replace(/^﻿/, '')
      if (item.kind === 'workflow') return { ok: true, kind: 'workflow', format: item.format, name, graph: JSON.parse(text) }
      return { ok: true, kind: 'text', name, text }
    } catch (error) {
      const failure = error instanceof PackImportError ? error : new PackImportError(error?.message || 'Could not read that file.', 'READ_FAILED')
      return { ok: false, code: failure.code, error: failure.message }
    }
  }

  /**
   * Keep the chosen templates and the readme in userData/imported-packs/<slug>/
   * with a pack.json that notes where the pack came from and what was imported.
   */
  async function keep(packId, { itemIds = [], imported = {} } = {}) {
    try {
      const session = sessions.get(String(packId || ''))
      if (!session) throw new PackImportError('This pack is no longer open. Open it again.', 'EXPIRED')
      const userData = typeof getUserDataDir === 'function' ? getUserDataDir() : ''
      if (!userData) throw new PackImportError('The app data folder is not available.', 'NO_USERDATA')
      const keptRoot = path.join(userData, KEPT_PACKS_DIR)
      let folder = path.join(keptRoot, session.result.slug)
      for (let n = 2; fs.existsSync(folder) && n < 1000; n += 1) folder = path.join(keptRoot, `${session.result.slug}-${n}`)
      const wanted = new Set((Array.isArray(itemIds) ? itemIds : []).map(String))
      if (session.result.readme) wanted.add(session.result.readme.id)
      await fsp.mkdir(folder, { recursive: true })
      const saved = []
      for (const id of wanted) {
        const item = session.items.get(id)
        if (!item || (item.kind !== 'template' && !item.isReadme)) continue
        const target = resolveInside(folder, item.rel)
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await fsp.copyFile(item.absolutePath, target, fs.constants.COPYFILE_EXCL)
        saved.push(item.rel)
      }
      const counts = isPlainObject(imported)
        ? Object.fromEntries(Object.entries(imported).filter(([key, value]) => /^[a-z]{1,20}$/.test(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)]))
        : {}
      await fsp.writeFile(path.join(folder, 'pack.json'), JSON.stringify({
        name: session.result.name,
        source: session.result.fileName,
        manifest: session.result.manifest,
        importedAt: new Date(now()).toISOString(),
        files: saved,
        imported: counts,
        notImported: session.result.code.map((group) => ({ type: group.type, name: group.name, fileCount: group.fileCount })),
      }, null, 2), 'utf8')
      return { ok: true, folder, slug: path.basename(folder), saved }
    } catch (error) {
      const failure = error instanceof PackImportError ? error : new PackImportError(error?.message || 'Could not keep the pack files.', 'KEEP_FAILED')
      return { ok: false, code: failure.code, error: failure.message }
    }
  }

  async function discard(packId) {
    await removeSession(String(packId || ''))
    return { ok: true }
  }

  async function discardAll() {
    await Promise.all(Array.from(sessions.keys()).map(removeSession))
  }

  return { inspect, readItem, keep, discard, discardAll, sweepStale, get sessionCount() { return sessions.size } }
}

/** IPC: packs:choose / packs:inspect / packs:readItem / packs:keep / packs:discard. */
function registerPackImportIpc({ ipcMain, dialog, app, getMainWindow, importer }) {
  const allowed = (event) => {
    const win = getMainWindow?.()
    return !win || event.sender === win.webContents
  }
  const denied = { ok: false, code: 'NOT_ALLOWED', error: 'Not allowed.' }
  ipcMain.handle('packs:choose', async (event) => {
    if (!allowed(event)) return denied
    const win = getMainWindow?.()
    const options = {
      title: 'Import pack',
      properties: ['openFile'],
      defaultPath: app.getPath('downloads'),
      filters: [{ name: 'Packs (.zip, .dspack)', extensions: ['zip', 'dspack'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return { ok: false, code: 'CANCELED' }
    return importer.inspect(result.filePaths[0])
  })
  ipcMain.handle('packs:inspect', async (event, filePath) => (allowed(event) ? importer.inspect(String(filePath || '')) : denied))
  ipcMain.handle('packs:readItem', async (event, packId, itemId) => (allowed(event) ? importer.readItem(packId, itemId) : denied))
  ipcMain.handle('packs:keep', async (event, packId, options) => (allowed(event) ? importer.keep(packId, isPlainObject(options) ? options : {}) : denied))
  ipcMain.handle('packs:discard', async (event, packId) => (allowed(event) ? importer.discard(packId) : denied))
}

module.exports = {
  DEFAULT_LIMITS,
  KEPT_PACKS_DIR,
  PackImportError,
  checkEntryPath,
  classifyByName,
  createPackImporter,
  detectToolPatterns,
  detectWorkflowFormat,
  inspectPackFile,
  parseDsPackManifest,
  registerPackImportIpc,
  resolveInside,
  workflowNodeTypes,
}
