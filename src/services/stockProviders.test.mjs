import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STOCK_PROVIDERS, buildStockAssetRecord, downloadStockItem, normalizeStockPanelResults, searchStock, stockCreditLine, stockProvidersFor,
} from './stockProviders.js'

/** fetch stub: routes by URL prefix, records calls. */
function fakeFetch(routes) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} })
    const route = routes.find(([prefix]) => String(url).startsWith(prefix))
    if (!route) return { ok: false, status: 404, json: async () => ({}) }
    const [, body, status = 200] = route
    return { ok: status < 400, status, json: async () => body, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) }
  }
  return { impl, calls }
}

test('six providers; three need no key; photo-only sources are excluded from videos', () => {
  assert.deepEqual(STOCK_PROVIDERS.map(provider => provider.id), ['pexels', 'unsplash', 'pixabay', 'openverse', 'wikimedia', 'nasa'])
  assert.deepEqual(STOCK_PROVIDERS.filter(provider => !provider.keySetting).map(provider => provider.id), ['openverse', 'wikimedia', 'nasa'])
  assert.deepEqual(stockProvidersFor('videos').map(provider => provider.id), ['pexels', 'pixabay', 'wikimedia', 'nasa'])
})

test('keys are required where the provider needs one; media types are checked', async () => {
  await assert.rejects(searchStock({ provider: 'unsplash', query: 'x', mediaType: 'photos' }), /free Unsplash API key/)
  await assert.rejects(searchStock({ provider: 'unsplash', key: 'k', query: 'x', mediaType: 'videos' }), /has no videos/)
})

test('Unsplash: Client-ID header, normalized photos, download is registered first', async () => {
  const { impl, calls } = fakeFetch([
    ['https://api.unsplash.com/search/photos', { total: 1, results: [{ id: 'abc', width: 4000, height: 3000, alt_description: 'red door',
      urls: { small: 'https://images.unsplash.com/s', full: 'https://images.unsplash.com/full' },
      links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download' },
      user: { name: 'Ana', links: { html: 'https://unsplash.com/@ana' } } }] }],
    ['https://api.unsplash.com/photos/abc/download', { url: 'https://images.unsplash.com/tracked' }],
    ['https://images.unsplash.com/tracked', {}],
  ])
  const result = await searchStock({ provider: 'unsplash', key: 'KEY', query: 'door', mediaType: 'photos', orientation: 'square', fetchImpl: impl })
  assert.equal(calls[0].headers.Authorization, 'Client-ID KEY')
  assert.match(calls[0].url, /orientation=squarish/)
  const [photo] = result.items
  assert.deepEqual([photo.id, photo.name, photo.author, photo.license, photo.mediaType], ['abc', 'red door', 'Ana', 'Unsplash License', 'photo'])
  assert.equal(stockCreditLine(photo), 'Photo by Ana on Unsplash · Unsplash License')
  const downloaded = await downloadStockItem(photo, { key: 'KEY', fetchImpl: impl, mainDownload: null })
  assert.equal(calls.at(-2).url, 'https://api.unsplash.com/photos/abc/download')
  assert.equal(calls.at(-1).url, 'https://images.unsplash.com/tracked')
  assert.equal(downloaded.file.name, 'unsplash_abc.jpg')
})

test('Pixabay videos and photos normalize; the desktop app downloads through main', async () => {
  const { impl, calls } = fakeFetch([
    ['https://pixabay.com/api/videos/', { totalHits: 900, hits: [{ id: 7, tags: 'ocean, waves', duration: 12, pageURL: 'https://pixabay.com/videos/id-7/', user: 'Bo', user_id: 3,
      videos: { large: { url: 'https://cdn.pixabay.com/v/large.mp4', width: 1920, height: 1080, thumbnail: 'https://cdn.pixabay.com/v/t.jpg' }, small: { url: 'https://cdn.pixabay.com/v/small.mp4' } } }] }],
    ['https://pixabay.com/api/', { totalHits: 2, hits: [{ id: 8, tags: 'tree', imageWidth: 10, imageHeight: 20, webformatURL: 'https://cdn.pixabay.com/p/w.jpg', largeImageURL: 'https://cdn.pixabay.com/p/l.jpg' }] }],
  ])
  const videos = await searchStock({ provider: 'pixabay', key: 'K', query: 'ocean', mediaType: 'videos', fetchImpl: impl })
  assert.match(calls[0].url, /key=K/)
  assert.equal(videos.totalResults, 500, 'Pixabay pages stop at 500 hits')
  const [video] = videos.items
  assert.deepEqual([video.mediaType, video.duration, video.previewUrl, video.downloadUrl, video.authorUrl],
    ['video', 12, 'https://cdn.pixabay.com/v/small.mp4', 'https://cdn.pixabay.com/v/large.mp4', 'https://pixabay.com/users/Bo-3/'])
  const photos = await searchStock({ provider: 'pixabay', key: 'K', query: 'tree', mediaType: 'photos', fetchImpl: impl })
  assert.equal(photos.items[0].downloadUrl, 'https://cdn.pixabay.com/p/l.jpg')
  const requests = []
  const result = await downloadStockItem(video, { fetchImpl: impl, mainDownload: async input => { requests.push(input); return { success: true, path: 'C:/tmp/pixabay_7.mp4', mime: 'video/mp4' } } })
  assert.deepEqual(requests, [{ url: 'https://cdn.pixabay.com/v/large.mp4', provider: 'pixabay', id: '7', mediaType: 'video' }])
  assert.deepEqual(result, { path: 'C:/tmp/pixabay_7.mp4', mime: 'video/mp4', category: 'video', assetType: 'video' })
})

test('Openverse, Wikimedia and NASA (no key) normalize; NASA resolves the file from its manifest', async () => {
  const { impl } = fakeFetch([
    ['https://api.openverse.org/v1/images/', { result_count: 3, results: [{ id: 'ov1', title: 'Rain', url: 'https://live.staticflickr.com/1.jpg', thumbnail: 'https://api.openverse.org/t/ov1',
      creator: 'Sora', creator_url: 'https://flickr.com/sora', license: 'by', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/', foreign_landing_url: 'https://flickr.com/p/1' }] }],
    ['https://commons.wikimedia.org/w/api.php', { continue: { gsroffset: 20 }, query: { pages: { 5: { pageid: 5, index: 1, title: 'File:Ocean_waves.webm',
      imageinfo: [{ url: 'https://upload.wikimedia.org/o.webm', thumburl: 'https://upload.wikimedia.org/o.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ocean_waves.webm', width: 1280, height: 720, duration: 9.5,
        extmetadata: { Artist: { value: '<a href="x">Mo</a>' }, LicenseShortName: { value: 'CC0' }, LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' } } }] } } } }],
    ['https://images-api.nasa.gov/search', { collection: { metadata: { total_hits: 42 }, items: [{ href: 'http://images-assets.nasa.gov/video/L1/collection.json',
      data: [{ nasa_id: 'L1', title: 'Launch', center: 'KSC' }], links: [{ href: 'http://images-assets.nasa.gov/video/L1/L1~thumb.jpg', render: 'image' }] }] } }],
    ['https://images-assets.nasa.gov/video/L1/collection.json', ['http://images-assets.nasa.gov/video/L1/L1~orig.mp4', 'http://images-assets.nasa.gov/video/L1/L1~medium.mp4']],
  ])
  const [ov] = (await searchStock({ provider: 'openverse', query: 'rain', mediaType: 'photos', fetchImpl: impl })).items
  assert.deepEqual([ov.license, ov.author, ov.downloadUrl], ['CC BY 2.0', 'Sora', 'https://live.staticflickr.com/1.jpg'])
  const wiki = await searchStock({ provider: 'wikimedia', query: 'ocean', mediaType: 'videos', fetchImpl: impl, perPage: 20 })
  assert.deepEqual([wiki.items[0].name, wiki.items[0].author, wiki.items[0].license, wiki.items[0].duration], ['Ocean waves', 'Mo', 'CC0', 9.5])
  assert.equal(wiki.totalResults, 21, 'more pages exist')
  const [launch] = (await searchStock({ provider: 'nasa', query: 'launch', mediaType: 'videos', fetchImpl: impl })).items
  assert.deepEqual([launch.id, launch.thumbnailUrl, launch.license], ['L1', 'https://images-assets.nasa.gov/video/L1/L1~thumb.jpg', 'Public domain (NASA)'])
  const requests = []
  await downloadStockItem(launch, { fetchImpl: impl, mainDownload: async input => { requests.push(input.url); return { success: true, path: 'p' } } })
  assert.deepEqual(requests, ['https://images-assets.nasa.gov/video/L1/L1~medium.mp4'], 'prefers ~large, then ~medium, before ~orig')
})

test('asset records keep the credit; MCP raw Pexels results still load', () => {
  const stock = { provider: 'openverse', id: 'ov1', mediaType: 'photo', name: 'Rain', author: 'Sora', authorUrl: 'https://flickr.com/sora',
    license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', pageUrl: 'https://flickr.com/p/1', duration: null }
  const record = buildStockAssetRecord({ stock, query: 'rain', imported: { name: 'openverse_ov1.jpg' }, assetType: 'image' })
  assert.equal(record.type, 'image')
  assert.equal(record.stockSource.credit, 'Photo by Sora on Openverse · CC BY 2.0')
  assert.equal(record.settings.stockSource.licenseUrl, 'https://creativecommons.org/licenses/by/2.0/')
  const [pexels] = normalizeStockPanelResults([{ id: 9, alt: 'city', width: 1, height: 1, photographer: 'P', url: 'https://www.pexels.com/photo/9/',
    src: { medium: 'https://images.pexels.com/m.jpg', original: 'https://images.pexels.com/o.jpg' } }], { provider: 'pexels', mediaType: 'photos' })
  assert.deepEqual([pexels.provider, pexels.id, pexels.downloadUrl, pexels.author], ['pexels', '9', 'https://images.pexels.com/o.jpg', 'P'])
})
