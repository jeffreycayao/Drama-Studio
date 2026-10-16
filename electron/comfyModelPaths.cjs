'use strict'

/**
 * Where a ComfyUI install keeps its models, beyond <root>/models.
 *
 * ComfyUI reads extra model folders from <root>/extra_model_paths.yaml and
 * from any --extra-model-paths-config file. Comfy Desktop uses the second
 * form: it keeps one YAML per installation in
 * <appData>/Comfy Desktop/instance-model-paths/<installation id>.yaml (the
 * installation list is <appData>/Comfy Desktop/installations.json) and marks
 * the user's shared models folder `is_default: true`. ComfyUI puts default
 * folders first, so that is where it saves models, and where workflow setup
 * should download them.
 *
 * Main process only: the renderer gets folder paths for display, never the
 * config contents.
 */

const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const yaml = require('js-yaml')

const EXTRA_MODEL_PATH_CONFIG_NAMES = Object.freeze(['extra_model_paths.yaml', 'extra_model_paths.yml'])
const COMFY_DESKTOP_DIR_NAME = 'Comfy Desktop'
const MAX_CONFIG_BYTES = 1024 * 1024
const SAFE_INSTALLATION_ID = /^[A-Za-z0-9._-]{1,128}$/

function normalizeModelSearchKey(value = '') {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function expandPathVariables(value = '', { env = process.env, homedir = os.homedir() } = {}) {
  let expanded = String(value || '').trim()
  if (!expanded) return ''

  if (expanded === '~' || expanded.startsWith(`~${path.sep}`) || expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(homedir, expanded.slice(1))
  }

  expanded = expanded.replace(/%([^%]+)%/g, (match, name) => env[name] ?? match)
  expanded = expanded.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, plain) => {
    const name = braced || plain
    return env[name] ?? match
  })

  return expanded
}

function splitExtraModelPathValue(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => splitExtraModelPathValue(entry))
  }
  if (typeof value !== 'string') return []
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

// Comfy Desktop writes folders as 'checkpoints/'; drop the trailing separator.
function cleanFolderPath(folderPath) {
  const trimmed = String(folderPath || '').trim()
  if (!trimmed) return ''
  const normalized = path.normalize(trimmed)
  const root = path.parse(normalized).root
  return normalized.length > root.length ? normalized.replace(/[\\/]+$/, '') : normalized
}

function addExtraModelSearchPath(pathsByKey, key, folderPath) {
  const normalizedKey = normalizeModelSearchKey(key)
  const normalizedPath = cleanFolderPath(folderPath)
  if (!normalizedKey || !normalizedPath) return
  if (!pathsByKey.has(normalizedKey)) pathsByKey.set(normalizedKey, [])
  const entries = pathsByKey.get(normalizedKey)
  if (!entries.some((entry) => entry.toLowerCase() === normalizedPath.toLowerCase())) {
    entries.push(normalizedPath)
  }
}

const samePath = (a, b) => {
  const left = path.resolve(String(a || ''))
  const right = path.resolve(String(b || ''))
  return process.platform === 'win32' || process.platform === 'darwin'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

async function readSmallTextFile(filePath) {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('not a file')
  if (stat.size > MAX_CONFIG_BYTES) throw new Error('file is too large')
  return fs.readFile(filePath, 'utf8')
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

/**
 * Parse one extra_model_paths YAML the way ComfyUI's load_extra_path_config
 * does: base_path (relative to the YAML), one or more folders per key, and
 * is_default sections. Returns every folder per key, plus the folder each key
 * of an is_default section maps to.
 */
function parseExtraModelPathConfig(raw, configPath, options = {}) {
  const pathsByKey = new Map()
  const defaultDirsByKey = new Map()
  const warnings = []
  const config = yaml.load(raw) || {}
  const yamlDir = path.dirname(configPath)
  const label = path.basename(configPath)

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { pathsByKey, defaultDirsByKey, defaultBasePath: '', warnings: [`${label} did not contain a valid mapping of model paths.`] }
  }

  let defaultBasePath = ''
  for (const sectionName of Object.keys(config)) {
    const section = config[sectionName]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue

    let basePath = ''
    if (typeof section.base_path === 'string' && section.base_path.trim()) {
      basePath = expandPathVariables(section.base_path, options)
      if (basePath && !path.isAbsolute(basePath)) basePath = path.resolve(yamlDir, basePath)
    }
    const isDefault = section.is_default === true || String(section.is_default).toLowerCase() === 'true'
    if (isDefault && basePath) defaultBasePath = cleanFolderPath(basePath)

    for (const key of Object.keys(section)) {
      if (key === 'base_path' || key === 'is_default') continue
      const folders = splitExtraModelPathValue(section[key])
      for (const [index, configuredPath] of folders.entries()) {
        let resolvedPath = expandPathVariables(configuredPath, options)
        if (!resolvedPath) continue
        if (basePath) {
          resolvedPath = path.join(basePath, resolvedPath)
        } else if (!path.isAbsolute(resolvedPath)) {
          resolvedPath = path.resolve(yamlDir, resolvedPath)
        }
        addExtraModelSearchPath(pathsByKey, key, resolvedPath)
        // ComfyUI inserts every folder of a default section at the front, so
        // the section's first folder for a key is where it saves new files.
        if (isDefault && index === 0) defaultDirsByKey.set(normalizeModelSearchKey(key), cleanFolderPath(resolvedPath))
      }
    }
  }
  return { pathsByKey, defaultDirsByKey, defaultBasePath, warnings }
}

/**
 * The Comfy Desktop installation whose ComfyUI folder is `comfyRoot`, and its
 * per-installation model paths YAML. Returns null for plain ComfyUI installs.
 */
async function findComfyDesktopModelPathConfig(comfyRoot, { appDataDir } = {}) {
  if (!comfyRoot || !appDataDir) return null
  const desktopDir = path.join(appDataDir, COMFY_DESKTOP_DIR_NAME)
  let installations = []
  try {
    installations = JSON.parse(await readSmallTextFile(path.join(desktopDir, 'installations.json')))
  } catch {
    return null
  }
  if (!Array.isArray(installations)) return null

  for (const installation of installations) {
    const installPath = typeof installation?.installPath === 'string' ? installation.installPath.trim() : ''
    const id = String(installation?.id || '')
    if (!installPath || !SAFE_INSTALLATION_ID.test(id) || id.startsWith('.')) continue
    if (!samePath(comfyRoot, installPath) && !samePath(comfyRoot, path.join(installPath, 'ComfyUI'))) continue
    const configPath = path.join(desktopDir, 'instance-model-paths', `${id}.yaml`)
    if (!(await isFile(configPath))) return null
    return { configPath, installationId: id, installationName: String(installation?.name || '') }
  }
  return null
}

/**
 * All extra model folders ComfyUI would use for this root, in ComfyUI's load
 * order: <root>/extra_model_paths.yaml first, then the Comfy Desktop config
 * (passed on the command line, so loaded later; a later default wins).
 */
async function loadComfyModelPaths(comfyRoot, { appDataDir = '', env, homedir } = {}) {
  const result = {
    configPath: '',
    configPaths: [],
    pathsByKey: new Map(),
    pathCount: 0,
    defaultDirsByKey: new Map(),
    defaultBasePath: '',
    comfyDesktop: null,
    warnings: [],
  }
  const normalizedRoot = String(comfyRoot || '').trim()
  if (!normalizedRoot) return result

  const configs = []
  for (const filename of EXTRA_MODEL_PATH_CONFIG_NAMES) {
    const candidate = path.join(normalizedRoot, filename)
    if (await isFile(candidate)) {
      configs.push(candidate)
      break
    }
  }
  const desktop = await findComfyDesktopModelPathConfig(normalizedRoot, { appDataDir })
  if (desktop) {
    configs.push(desktop.configPath)
    result.comfyDesktop = desktop
  }

  for (const configPath of configs) {
    try {
      const parsed = parseExtraModelPathConfig(await readSmallTextFile(configPath), configPath, { env, homedir })
      result.configPaths.push(configPath)
      result.warnings.push(...parsed.warnings)
      for (const [key, folders] of parsed.pathsByKey) {
        for (const folder of folders) addExtraModelSearchPath(result.pathsByKey, key, folder)
      }
      if (parsed.defaultDirsByKey.size > 0) {
        result.defaultDirsByKey = parsed.defaultDirsByKey
        result.defaultBasePath = parsed.defaultBasePath
      }
    } catch (error) {
      result.warnings.push(`Could not read ${path.basename(configPath)}: ${error?.message || String(error)}`)
    }
  }

  result.configPath = result.configPaths.join(', ')
  result.pathCount = Array.from(result.pathsByKey.values()).reduce((total, entries) => total + entries.length, 0)
  return result
}

/**
 * Folder a model with this targetSubdir (e.g. "checkpoints" or
 * "diffusion_models/wan") should download into: the default extra folder
 * mapped for its top-level key, else <root>/models/<targetSubdir>. Never
 * returns a folder outside the chosen base.
 */
function resolveModelDownloadFolder({ modelsPath, targetSubdir = '', defaultDirsByKey = new Map() } = {}) {
  const parts = String(targetSubdir || '').replace(/\\/g, '/').split('/').filter(Boolean)
  if (!parts.length || parts.some((part) => part === '..' || part === '.')) return modelsPath
  const fallback = path.join(modelsPath, ...parts)
  const mapped = defaultDirsByKey.get(normalizeModelSearchKey(parts[0]))
  if (!mapped) return fallback
  const folder = path.join(mapped, ...parts.slice(1))
  const relative = path.relative(mapped, folder)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return fallback
  return folder
}

module.exports = {
  EXTRA_MODEL_PATH_CONFIG_NAMES,
  addExtraModelSearchPath,
  expandPathVariables,
  findComfyDesktopModelPathConfig,
  loadComfyModelPaths,
  normalizeModelSearchKey,
  parseExtraModelPathConfig,
  resolveModelDownloadFolder,
  splitExtraModelPathValue,
}
