'use strict'

/**
 * Minimal Cloudflare R2 (S3 API) client for the main process: AWS Signature
 * V4 for GET / HEAD on one bucket, no SDK. Used by the sound-effects pack
 * downloader with a read-only access key the user enters in Settings; the
 * secret never leaves the main process and is never logged.
 */

const crypto = require('crypto')
const https = require('https')

const SERVICE = 's3'
const IDLE_TIMEOUT_MS = 30000
const ENDPOINT_PATTERN = /^https:\/\/[a-f0-9]{32}\.(?:eu\.|fedramp\.)?r2\.cloudflarestorage\.com\/?$/i
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const ACCESS_KEY_ID_PATTERN = /^[A-Za-z0-9]{16,128}$/
const SECRET_PATTERN = /^[A-Za-z0-9/+=_-]{16,256}$/

class R2Error extends Error {
  constructor(message, code, status = 0) { super(message); this.code = code; this.status = status }
}

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex')
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest()

// S3 canonical URI: each path segment URI-encoded, '/' kept.
const encodeKeyPath = (key) => String(key).split('/').map((part) => encodeURIComponent(part)
  .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')

const encodeQueryValue = (value) => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

/** Validate and normalize R2 settings. Throws a readable error. */
function normalizeR2Config(config = {}) {
  const endpoint = String(config.endpoint || '').trim().replace(/\/+$/, '')
  const bucket = String(config.bucket || '').trim()
  const accessKeyId = String(config.accessKeyId || '').trim()
  const secretAccessKey = String(config.secretAccessKey || '').trim()
  const region = String(config.region || 'auto').trim() || 'auto'
  if (!ENDPOINT_PATTERN.test(`${endpoint}/`)) throw new R2Error('The R2 endpoint must look like https://<account id>.r2.cloudflarestorage.com.', 'BAD_CONFIG')
  if (!BUCKET_PATTERN.test(bucket)) throw new R2Error('The R2 bucket name is not valid.', 'BAD_CONFIG')
  if (!ACCESS_KEY_ID_PATTERN.test(accessKeyId)) throw new R2Error('The R2 access key ID is not valid.', 'BAD_CONFIG')
  if (!SECRET_PATTERN.test(secretAccessKey)) throw new R2Error('The R2 secret access key is not valid.', 'BAD_CONFIG')
  if (!/^[a-z0-9-]{1,32}$/.test(region)) throw new R2Error('The R2 region is not valid.', 'BAD_CONFIG')
  return { endpoint, bucket, accessKeyId, secretAccessKey, region }
}

/** Object keys are relative paths inside the bucket. */
function normalizeObjectKey(key) {
  const value = String(key || '').trim().replace(/^\/+/, '')
  if (!value || value.length > 1024 || value.split('/').some((part) => part === '..' || part === '.') || /[\x00-\x1f\\]/.test(value)) {
    throw new R2Error('The R2 object path is not valid.', 'BAD_CONFIG')
  }
  return value
}

/**
 * Signed request options for one object (path-style URL). `now` is
 * injectable for tests.
 */
/** AWS Signature V4 Authorization header for one request. */
function signV4({ method, host, canonicalUri, query = {}, headers = {}, payloadHash, accessKeyId, secretAccessKey, region, amzDate }) {
  const dateStamp = amzDate.slice(0, 8)
  const canonicalQuery = Object.keys(query).sort()
    .map((name) => `${encodeQueryValue(name)}=${encodeQueryValue(query[name])}`).join('&')
  const allHeaders = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  const headerNames = Object.keys(allHeaders).map((name) => name.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(allHeaders).map(([name, value]) => [name.toLowerCase(), String(value).trim()]))
  const canonicalHeaders = headerNames.map((name) => `${name}:${lower[name]}\n`).join('')
  const signedHeaders = headerNames.join(';')
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), SERVICE), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalQuery,
    signature,
  }
}

/**
 * Signed request (path-style URL, unsigned payload). `now` is injectable for
 * tests.
 */
function signRequest(config, { method = 'GET', key, query = {}, headers = {}, now = new Date() }) {
  const { endpoint, bucket, accessKeyId, secretAccessKey, region } = config
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const canonicalUri = `/${bucket}${key ? `/${encodeKeyPath(key)}` : ''}`
  const payloadHash = 'UNSIGNED-PAYLOAD'
  const { authorization, canonicalQuery } = signV4({
    method, host: new URL(endpoint).host, canonicalUri, query, headers, payloadHash, accessKeyId, secretAccessKey, region, amzDate,
  })
  const url = `${endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`
  const outHeaders = { ...headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, Authorization: authorization }
  return { url, method, headers: outHeaders }
}

/** Send a signed request. Resolves the response stream (caller consumes it). */
function r2Request(config, { method = 'GET', key, query, headers, signal, request = https.request } = {}) {
  const signed = signRequest(config, { method, key, query, headers })
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new R2Error('Download paused or canceled.', 'ABORTED')); return }
    const req = request(signed.url, { method, headers: { 'User-Agent': 'DramaStudio-SFX/1', ...signed.headers } }, (res) => resolve(res))
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new R2Error('The R2 request timed out.', 'TIMEOUT')))
    req.on('error', (error) => reject(signal?.aborted ? new R2Error('Download paused or canceled.', 'ABORTED') : error))
    signal?.addEventListener('abort', () => req.destroy(new R2Error('Download paused or canceled.', 'ABORTED')), { once: true })
    req.end()
  })
}

/** Readable message for an S3 error status (never echoes credentials). */
function describeR2Status(status) {
  if (status === 403) return 'R2 refused the request (HTTP 403). Check the access key and that it can read this bucket.'
  if (status === 404) return 'That file is not in the R2 bucket (HTTP 404).'
  return `R2 answered HTTP ${status}.`
}

async function headObject(config, key) {
  const res = await r2Request(config, { method: 'HEAD', key })
  res.resume()
  if (res.statusCode !== 200) throw new R2Error(describeR2Status(res.statusCode), 'HTTP_STATUS', res.statusCode)
  return {
    size: Number(res.headers['content-length']),
    etag: String(res.headers.etag || '').replace(/"/g, ''),
    lastModified: String(res.headers['last-modified'] || ''),
  }
}

async function getObjectText(config, key, { limit = 32 * 1024 * 1024 } = {}) {
  const res = await r2Request(config, { method: 'GET', key })
  if (res.statusCode !== 200) { res.resume(); throw new R2Error(describeR2Status(res.statusCode), 'HTTP_STATUS', res.statusCode) }
  const chunks = []
  let size = 0
  for await (const chunk of res) {
    size += chunk.length
    if (size > limit) { res.destroy(); throw new R2Error('The file is too large.', 'TOO_LARGE') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Read R2 settings from a key file like the one Cloudflare's dashboard
 * guides produce ("- Endpoint: …", "Access Key ID: …", "Secret Access Key:
 * …", "- Bucket: …", "- File: …"). Missing fields come back empty.
 */
function parseR2KeyFile(text) {
  const out = { endpoint: '', region: '', bucket: '', objectKey: '', catalogKey: '', accessKeyId: '', secretAccessKey: '' }
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = /^-?\s*([A-Za-z_ ]{2,40}?)\s*[:=]\s*(.+)$/.exec(line)
    if (!match) continue
    const name = match[1].trim().toLowerCase().replace(/\s+/g, ' ')
    const value = match[2].trim().replace(/^["']|["'],?$/g, '')
    if (name === 'endpoint' && !out.endpoint) out.endpoint = value
    else if (name === 'region' && !out.region) out.region = value
    else if (name === 'bucket' && !out.bucket) out.bucket = value
    else if (name === 'file' && !out.objectKey) {
      const files = value.match(/[A-Za-z0-9._\-/]+\.(?:zip|tsv|json|csv)/gi) || []
      out.objectKey = files.find((file) => /\.zip$/i.test(file)) || ''
      out.catalogKey = files.find((file) => /\.(tsv|csv|json)$/i.test(file)) || ''
    } else if ((name === 'access key id' || name === 'aws_access_key_id') && ACCESS_KEY_ID_PATTERN.test(value)) out.accessKeyId = value
    else if ((name === 'secret access key' || name === 'aws_secret_access_key') && SECRET_PATTERN.test(value)) out.secretAccessKey = value
  }
  return out
}

module.exports = {
  R2Error,
  describeR2Status,
  getObjectText,
  headObject,
  normalizeObjectKey,
  normalizeR2Config,
  parseR2KeyFile,
  r2Request,
  signRequest,
  signV4,
}
