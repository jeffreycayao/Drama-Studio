/**
 * Free stock-media providers for the Stock tab, behind one item shape.
 *
 *   pexels     photos + videos   free API key (existing integration)
 *   unsplash   photos            free API key (Access Key)
 *   pixabay    photos + videos   free API key
 *   openverse  photos            no key; Creative Commons / public domain
 *   wikimedia  photos + videos   no key; Wikimedia Commons (licenses vary)
 *   nasa       photos + videos   no key; NASA Image and Video Library
 *
 * Every provider returns StockItem objects; downloads resolve the file URL
 * (some providers need a second request) and keep the author, license and
 * source page on the asset so credits can be given.
 *
 * @typedef {Object} StockItem
 * @property {string} provider
 * @property {string} id            Provider id (unique per provider).
 * @property {'photo'|'video'} mediaType
 * @property {string} name
 * @property {number|null} width
 * @property {number|null} height
 * @property {number|null} duration Seconds (videos).
 * @property {string} thumbnailUrl
 * @property {string} previewUrl    Playable video URL for the preview, when known.
 * @property {string} pageUrl       The item's page on the provider.
 * @property {string} author
 * @property {string} authorUrl
 * @property {string} license       e.g. "Unsplash License", "CC BY 4.0", "Public domain".
 * @property {string} licenseUrl
 * @property {string} downloadUrl   Direct file URL, or '' when resolved at download time.
 * @property {Object} extra         Provider-specific fields needed to download.
 */

import {
  getBestPexelsVideoFile, loadDefaultPexelsMedia, searchPexelsMedia, summarizePexelsMediaItem,
} from './pexelsStock.js'

export const STOCK_PER_PAGE = 20
const MAX_PAGE = 10_000
const clamp = (value, fallback, min, max) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback
}
const str = (value, max = 300) => String(value ?? '').trim().slice(0, max)
const num = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null)
const stripHtml = value => str(String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' '))
const httpsUrl = value => (/^https:\/\//i.test(String(value || '')) ? String(value) : '')
/** True when `value` is an https URL on one of `hosts` (exact match, default port, no credentials). */
const isHttpsUrlOnHost = (value, hosts) => {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && hosts.includes(url.hostname.toLowerCase())
  } catch { return false }
}
const UNSPLASH_API_HOSTS = ['api.unsplash.com']
const NASA_ASSET_HOSTS = ['images-api.nasa.gov', 'images-assets.nasa.gov']

function item(fields) {
  return {
    provider: fields.provider, id: str(fields.id, 200), mediaType: fields.mediaType === 'video' ? 'video' : 'photo',
    name: str(fields.name, 200) || `${fields.provider} ${fields.id}`, width: num(fields.width), height: num(fields.height),
    duration: num(fields.duration), thumbnailUrl: httpsUrl(fields.thumbnailUrl), previewUrl: httpsUrl(fields.previewUrl),
    pageUrl: httpsUrl(fields.pageUrl), author: str(fields.author, 200), authorUrl: httpsUrl(fields.authorUrl),
    license: str(fields.license, 80), licenseUrl: httpsUrl(fields.licenseUrl), downloadUrl: httpsUrl(fields.downloadUrl),
    extra: fields.extra || {},
  }
}

async function getJson(fetchImpl, url, init, providerLabel) {
  if (typeof fetchImpl !== 'function') throw new Error('Network requests are not available in this Drama Studio session.')
  const response = await fetchImpl(url, init)
  if (response.status === 401 || response.status === 403) throw new Error(`${providerLabel} refused the request. Check the API key in Settings › Stock.`)
  if (response.status === 429) throw new Error(`${providerLabel} rate limit reached. Wait a minute and try again.`)
  if (!response.ok) throw new Error(`${providerLabel} answered HTTP ${response.status}.`)
  return response.json()
}

const withParams = (base, params) => {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value))
  return url.toString()
}

// ---------------------------------------------------------------- Pexels
const pexels = {
  id: 'pexels', label: 'Pexels', mediaTypes: ['videos', 'photos'], keySetting: 'pexelsApiKey', keyUrl: 'https://www.pexels.com/api/',
  homeUrl: 'https://www.pexels.com', license: 'Pexels License', note: 'Free to use; credit appreciated. New API keys may be paused.',
  normalize(raw, mediaType) {
    const summary = summarizePexelsMediaItem(raw, mediaType)
    const isPhoto = summary.mediaType === 'photo'
    return item({ ...summary, author: summary.photographer, authorUrl: summary.photographerUrl, license: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      previewUrl: isPhoto ? '' : (getBestPexelsVideoFile(raw)?.link || ''),
      downloadUrl: isPhoto ? (raw?.src?.original || raw?.src?.large2x || '') : (getBestPexelsVideoFile(raw)?.link || '') })
  },
  async search({ key, query, mediaType, page, perPage, orientation, fetchImpl }) {
    const call = query ? searchPexelsMedia : loadDefaultPexelsMedia
    const result = await call({ apiKey: key, query, mediaType, page, perPage, orientation, fetchImpl })
    return { items: result.items.map(raw => pexels.normalize(raw, mediaType)), totalResults: result.totalResults, page: result.page }
  },
}

// ---------------------------------------------------------------- Unsplash
const unsplash = {
  id: 'unsplash', label: 'Unsplash', mediaTypes: ['photos'], keySetting: 'unsplashAccessKey', keyUrl: 'https://unsplash.com/developers',
  homeUrl: 'https://unsplash.com', license: 'Unsplash License', note: 'Photos only. Free Access Key (Demo apps: 50 requests per hour).',
  normalize(raw) {
    const user = raw?.user || {}
    return item({ provider: 'unsplash', id: raw?.id, mediaType: 'photo', name: raw?.alt_description || raw?.description,
      width: raw?.width, height: raw?.height, thumbnailUrl: raw?.urls?.small, pageUrl: raw?.links?.html,
      author: user.name, authorUrl: user.links?.html, license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license',
      downloadUrl: raw?.urls?.full, extra: { downloadLocation: httpsUrl(raw?.links?.download_location) } })
  },
  async search({ key, query, page, perPage, orientation, fetchImpl }) {
    const headers = { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' }
    const orient = { landscape: 'landscape', portrait: 'portrait', square: 'squarish' }[orientation] || ''
    if (!query) {
      const list = await getJson(fetchImpl, withParams('https://api.unsplash.com/photos', { page, per_page: perPage }), { headers }, 'Unsplash')
      return { items: (Array.isArray(list) ? list : []).map(unsplash.normalize), totalResults: page * perPage + (list?.length === perPage ? perPage : 0), page }
    }
    const data = await getJson(fetchImpl, withParams('https://api.unsplash.com/search/photos', { query, page, per_page: perPage, orientation: orient, content_filter: 'high' }), { headers }, 'Unsplash')
    return { items: (data?.results || []).map(unsplash.normalize), totalResults: Number(data?.total) || 0, page }
  },
  // API guideline: register the download, then fetch the file. The Access
  // Key only goes to api.unsplash.com; any other download_location (a
  // tampered response or saved panel state) is skipped for downloadUrl.
  async resolveDownload(stock, { key, fetchImpl }) {
    if (key && isHttpsUrlOnHost(stock.extra?.downloadLocation, UNSPLASH_API_HOSTS)) {
      const data = await getJson(fetchImpl, stock.extra.downloadLocation, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } }, 'Unsplash').catch(() => null)
      if (httpsUrl(data?.url)) return data.url
    }
    return stock.downloadUrl
  },
}

// ---------------------------------------------------------------- Pixabay
const pixabayVideoFile = videos => videos?.large?.url ? videos.large : videos?.medium?.url ? videos.medium : videos?.small?.url ? videos.small : videos?.tiny || null
const pixabay = {
  id: 'pixabay', label: 'Pixabay', mediaTypes: ['videos', 'photos'], keySetting: 'pixabayApiKey', keyUrl: 'https://pixabay.com/api/docs/',
  homeUrl: 'https://pixabay.com', license: 'Pixabay Content License', note: 'Photos and videos. Free API key (100 requests per minute).',
  normalize(raw, mediaType) {
    const base = { provider: 'pixabay', id: raw?.id, name: raw?.tags, pageUrl: raw?.pageURL, author: raw?.user,
      authorUrl: raw?.user && raw?.user_id ? `https://pixabay.com/users/${encodeURIComponent(raw.user)}-${raw.user_id}/` : '',
      license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/' }
    if (mediaType === 'videos') {
      const file = pixabayVideoFile(raw?.videos)
      return item({ ...base, mediaType: 'video', width: file?.width, height: file?.height, duration: raw?.duration,
        thumbnailUrl: file?.thumbnail || raw?.videos?.medium?.thumbnail || (raw?.picture_id ? `https://i.vimeocdn.com/video/${raw.picture_id}_640x360.jpg` : ''),
        previewUrl: raw?.videos?.small?.url || file?.url, downloadUrl: file?.url })
    }
    return item({ ...base, mediaType: 'photo', width: raw?.imageWidth, height: raw?.imageHeight, thumbnailUrl: raw?.webformatURL,
      downloadUrl: raw?.largeImageURL || raw?.webformatURL })
  },
  async search({ key, query, mediaType, page, perPage, orientation, fetchImpl }) {
    const base = mediaType === 'videos' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/'
    const data = await getJson(fetchImpl, withParams(base, {
      key, q: query.slice(0, 100), page, per_page: Math.max(3, perPage), safesearch: 'true', order: 'popular',
      ...(mediaType === 'videos' ? {} : { image_type: 'photo', orientation: { landscape: 'horizontal', portrait: 'vertical' }[orientation] || '' }),
    }), {}, 'Pixabay')
    return { items: (data?.hits || []).map(raw => pixabay.normalize(raw, mediaType)), totalResults: Math.min(Number(data?.totalHits) || 0, 500), page }
  },
}

// ---------------------------------------------------------------- Openverse
const openverseLicense = (raw) => {
  const code = str(raw?.license).toLowerCase()
  if (code === 'cc0') return 'CC0 (public domain)'
  if (code === 'pdm') return 'Public domain'
  return `CC ${code.toUpperCase()}${raw?.license_version ? ` ${raw.license_version}` : ''}`.trim()
}
const openverse = {
  id: 'openverse', label: 'Openverse', mediaTypes: ['photos'], keySetting: null, keyUrl: '', homeUrl: 'https://openverse.org',
  license: 'Creative Commons', note: 'No key. Openly licensed photos from museums, Flickr and more; credit the author as the license asks.',
  normalize(raw) {
    return item({ provider: 'openverse', id: raw?.id, mediaType: 'photo', name: raw?.title, width: raw?.width, height: raw?.height,
      thumbnailUrl: raw?.thumbnail, pageUrl: raw?.foreign_landing_url, author: raw?.creator, authorUrl: raw?.creator_url,
      license: openverseLicense(raw), licenseUrl: raw?.license_url, downloadUrl: raw?.url, extra: { source: str(raw?.source, 60) } })
  },
  async search({ query, page, perPage, orientation, fetchImpl }) {
    const data = await getJson(fetchImpl, withParams('https://api.openverse.org/v1/images/', {
      q: query || 'cinematic landscape', page, page_size: Math.min(perPage, 20), mature: 'false',
      license_type: 'commercial,modification', aspect_ratio: { landscape: 'wide', portrait: 'tall', square: 'square' }[orientation] || '',
    }), {}, 'Openverse')
    return { items: (data?.results || []).map(openverse.normalize), totalResults: Math.min(Number(data?.result_count) || 0, 240), page }
  },
}

// ---------------------------------------------------------------- Wikimedia Commons
const wikimedia = {
  id: 'wikimedia', label: 'Wikimedia Commons', mediaTypes: ['videos', 'photos'], keySetting: null, keyUrl: '', homeUrl: 'https://commons.wikimedia.org',
  license: 'Various free licenses', note: 'No key. Free-licensed photos and videos (videos are WebM); check each file’s license and credit line.',
  normalize(page, mediaType) {
    const info = page?.imageinfo?.[0] || {}
    const meta = info.extmetadata || {}
    const title = str(page?.title).replace(/^File:/, '').replace(/\.[A-Za-z0-9]+$/, '').replace(/_/g, ' ')
    return item({ provider: 'wikimedia', id: page?.pageid, mediaType: mediaType === 'videos' ? 'video' : 'photo',
      name: stripHtml(meta.ObjectName?.value) || title, width: info.width, height: info.height, duration: info.duration,
      thumbnailUrl: info.thumburl, previewUrl: mediaType === 'videos' ? info.url : '', pageUrl: info.descriptionurl,
      author: stripHtml(meta.Artist?.value), license: stripHtml(meta.LicenseShortName?.value) || 'See file page',
      licenseUrl: meta.LicenseUrl?.value || info.descriptionurl, downloadUrl: info.url, extra: { mime: str(info.mime, 60) } })
  },
  async search({ query, mediaType, page, perPage, fetchImpl }) {
    const filter = mediaType === 'videos' ? 'filetype:video' : 'filetype:bitmap'
    const data = await getJson(fetchImpl, withParams('https://commons.wikimedia.org/w/api.php', {
      action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: 6,
      gsrsearch: `${query || 'cinematic'} ${filter}`, gsrlimit: perPage, gsroffset: (page - 1) * perPage,
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: 640, iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ObjectName',
    }), {}, 'Wikimedia Commons')
    const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))
    const items = pages.map(entry => wikimedia.normalize(entry, mediaType)).filter(entry => entry.downloadUrl)
    const more = Boolean(data?.continue?.gsroffset)
    return { items, totalResults: (page - 1) * perPage + items.length + (more ? perPage : 0), page }
  },
}

// ---------------------------------------------------------------- NASA
const nasa = {
  id: 'nasa', label: 'NASA', mediaTypes: ['videos', 'photos'], keySetting: null, keyUrl: '', homeUrl: 'https://images.nasa.gov',
  license: 'Public domain (NASA)', note: 'No key. Space, Earth and aviation photos and videos; NASA media is generally not copyrighted (logos excepted).',
  normalize(entry, mediaType) {
    const data = entry?.data?.[0] || {}
    const thumb = (entry?.links || []).find(link => link?.render === 'image' || /thumb|small/i.test(link?.href || ''))?.href
    return item({ provider: 'nasa', id: data.nasa_id, mediaType: mediaType === 'videos' ? 'video' : 'photo', name: data.title,
      thumbnailUrl: thumb ? thumb.replace(/^http:/, 'https:') : '', pageUrl: data.nasa_id ? `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}` : '',
      author: data.photographer || data.secondary_creator || data.center || 'NASA', license: 'Public domain (NASA)',
      licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/', extra: { assetUrl: entry?.href ? String(entry.href).replace(/^http:/, 'https:') : '' } })
  },
  async search({ query, mediaType, page, perPage, fetchImpl }) {
    const data = await getJson(fetchImpl, withParams('https://images-api.nasa.gov/search', {
      q: query || 'earth from space', media_type: mediaType === 'videos' ? 'video' : 'image', page, page_size: perPage,
    }), {}, 'NASA')
    const items = (data?.collection?.items || []).map(entry => nasa.normalize(entry, mediaType)).filter(entry => entry.id)
    return { items, totalResults: Math.min(Number(data?.collection?.metadata?.total_hits) || 0, 10_000), page }
  },
  // The search result links to a manifest listing the files of each size.
  // Only NASA's own hosts are trusted for it; otherwise ask the asset API.
  async resolveDownload(stock, { fetchImpl }) {
    const manifestUrl = isHttpsUrlOnHost(stock.extra?.assetUrl, NASA_ASSET_HOSTS)
      ? stock.extra.assetUrl
      : `https://images-api.nasa.gov/asset/${encodeURIComponent(stock.id)}`
    const data = await getJson(fetchImpl, manifestUrl, {}, 'NASA')
    const files = (Array.isArray(data) ? data : (data?.collection?.items || []).map(entry => entry?.href))
      .map(href => String(href || '').replace(/^http:/, 'https:')).filter(Boolean)
    const pick = stock.mediaType === 'video'
      ? ['~large.mp4', '~medium.mp4', '~orig.mp4', '.mp4']
      : ['~large.jpg', '~orig.jpg', '~medium.jpg', '.jpg', '.png']
    for (const suffix of pick) {
      const found = files.find(href => href.toLowerCase().endsWith(suffix))
      if (found) return found
    }
    throw new Error('NASA lists no downloadable file for this item.')
  },
}

export const STOCK_PROVIDERS = Object.freeze([pexels, unsplash, pixabay, openverse, wikimedia, nasa])
export const getStockProvider = id => STOCK_PROVIDERS.find(provider => provider.id === id) || STOCK_PROVIDERS[0]

/** Providers that can serve this media type. */
export const stockProvidersFor = mediaType => STOCK_PROVIDERS.filter(provider => provider.mediaTypes.includes(mediaType === 'photos' ? 'photos' : 'videos'))

/** Search (or browse, with an empty query) one provider. */
export async function searchStock({ provider: providerId, key = '', query = '', mediaType = 'videos', page = 1, perPage = STOCK_PER_PAGE, orientation = '', fetchImpl = globalThis.fetch } = {}) {
  const provider = getStockProvider(providerId)
  const type = mediaType === 'photos' ? 'photos' : 'videos'
  if (!provider.mediaTypes.includes(type)) throw new Error(`${provider.label} has no ${type}. Pick another source.`)
  if (provider.keySetting && !String(key || '').trim()) throw new Error(`Add your free ${provider.label} API key in Settings › Stock.`)
  const result = await provider.search({ key: String(key || '').trim(), query: str(query, 200).replace(/\s+/g, ' '), mediaType: type,
    page: clamp(page, 1, 1, MAX_PAGE), perPage: clamp(perPage, STOCK_PER_PAGE, 1, 80), orientation, fetchImpl })
  return { provider: provider.id, query: str(query, 200), mediaType: type, ...result }
}

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov' }

/**
 * Download one StockItem. In the desktop app main fetches it into a temp
 * file ({ path }); otherwise it is fetched here ({ file, blob }).
 */
export async function downloadStockItem(stock, { key = '', fetchImpl = globalThis.fetch, mainDownload = globalThis.window?.electronAPI?.stock?.download } = {}) {
  const provider = getStockProvider(stock?.provider)
  if (typeof fetchImpl !== 'function') throw new Error('Network requests are not available in this Drama Studio session.')
  const url = provider.resolveDownload ? await provider.resolveDownload(stock, { key, fetchImpl }) : stock.downloadUrl
  if (!httpsUrl(url)) throw new Error(`${provider.label} gave no downloadable file for this item.`)
  const isVideoItem = stock.mediaType === 'video'
  if (typeof mainDownload === 'function') {
    const result = await mainDownload({ url, provider: provider.id, id: stock.id, mediaType: stock.mediaType })
    if (!result?.success) throw new Error(result?.error || `Could not download from ${provider.label}.`)
    return { path: result.path, mime: result.mime, category: isVideoItem ? 'video' : 'images', assetType: isVideoItem ? 'video' : 'image' }
  }
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`Could not download from ${provider.label} (HTTP ${response.status}).`)
  const blob = await response.blob()
  const urlExt = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(new URL(url).pathname)?.[1]?.toLowerCase()
  const isVideo = stock.mediaType === 'video'
  const ext = EXT_BY_MIME[blob.type] || (urlExt && /^(jpe?g|png|webp|gif|mp4|webm|ogv|mov)$/.test(urlExt) ? urlExt.replace('jpeg', 'jpg') : (isVideo ? 'mp4' : 'jpg'))
  const safeId = String(stock.id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60)
  const mime = blob.type || (isVideo ? 'video/mp4' : 'image/jpeg')
  return {
    blob,
    file: new File([blob], `${provider.id}_${safeId}.${ext}`, { type: mime }),
    category: isVideo ? 'video' : 'images',
    assetType: isVideo ? 'video' : 'image',
  }
}

/** Credit line for an item ("Photo by X on Unsplash · Unsplash License"). */
export function stockCreditLine(stock) {
  const provider = getStockProvider(stock?.provider)
  const kind = stock?.mediaType === 'video' ? 'Video' : 'Photo'
  return [`${kind}${stock?.author ? ` by ${stock.author}` : ''} on ${provider.label}`, stock?.license].filter(Boolean).join(' · ')
}

/** Asset record for an imported StockItem; keeps author, license and links. */
export function buildStockAssetRecord({ stock, query = '', imported = {}, blobUrl = null, folderId = null, assetType, sourceTool = 'stock_panel' }) {
  const stockSource = {
    provider: stock.provider, id: stock.id, mediaType: stock.mediaType, query: str(query, 200), pageUrl: stock.pageUrl,
    photographer: stock.author, photographerUrl: stock.authorUrl, author: stock.author, authorUrl: stock.authorUrl,
    license: stock.license, licenseUrl: stock.licenseUrl, credit: stockCreditLine(stock), alt: stock.name,
  }
  return {
    ...imported,
    // The title reads better in the bin than the file name.
    name: stock.name ? `${stock.name.slice(0, 80)} (${getStockProvider(stock.provider).label})` : (imported?.name || `${getStockProvider(stock.provider).label}_${stock.id}`),
    type: assetType || (stock.mediaType === 'video' ? 'video' : 'image'),
    url: blobUrl || imported?.url || null,
    folderId: folderId || null,
    isImported: true,
    sourceTool,
    stockSource,
    settings: { ...(imported?.settings || {}), ...(stock.duration ? { duration: stock.duration } : {}), stockSource },
  }
}

/** Panel state saved by MCP holds raw Pexels results; normalize those. */
export function normalizeStockPanelResults(results = [], { provider = 'pexels', mediaType = 'videos' } = {}) {
  return (Array.isArray(results) ? results : []).map(entry => {
    if (entry && typeof entry.provider === 'string' && 'thumbnailUrl' in entry) return entry
    try { return provider === 'pexels' ? pexels.normalize(entry, mediaType) : null } catch { return null }
  }).filter(Boolean)
}
