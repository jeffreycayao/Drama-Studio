import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Video, Image as ImageIcon, Download, Loader2, ExternalLink, AlertCircle, Play, X, Home, KeyRound } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import { importAsset, isElectron } from '../services/fileSystem'
import { enqueuePlaybackTranscode } from '../services/playbackCache'
import { enqueueProxyTranscode, isProxyPlaybackEnabled } from '../services/proxyCache'
import { getStockApiKey } from '../services/pexelsSettings'
import { DRAMA_STUDIO_OPEN_STOCK_EVENT, readPexelsStockPanelState, writePexelsStockPanelState } from '../services/pexelsStock'
import {
  STOCK_PER_PAGE, STOCK_PROVIDERS, buildStockAssetRecord, downloadStockItem, getStockProvider, normalizeStockPanelResults,
  searchStock, stockCreditLine,
} from '../services/stockProviders'
import { useI18n } from '../i18n/I18nContext'

const PER_PAGE = STOCK_PER_PAGE

const toggleClass = active => `px-3 py-2 text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active
  ? 'bg-sf-accent text-sf-accent-on' : 'bg-sf-dark-800 text-sf-text-muted hover:bg-sf-dark-700'}`

/** Stock tab: search free photo and video libraries (Pexels, Unsplash,
 * Pixabay, Openverse, Wikimedia Commons, NASA) and import results into the
 * project with their author and license kept on the asset. */
function StockPanel() {
  const { t } = useI18n()
  const persistedState = readPexelsStockPanelState()
  const [providerId, setProviderId] = useState(getStockProvider(persistedState?.provider).id)
  const provider = getStockProvider(providerId)
  const [apiKey, setApiKey] = useState(null)
  const [keyChecked, setKeyChecked] = useState(false)
  const [searchQuery, setSearchQuery] = useState(persistedState?.searchQuery || '')
  const [mediaType, setMediaType] = useState(persistedState?.mediaType === 'photos' ? 'photos' : 'videos')
  const [results, setResults] = useState(() => normalizeStockPanelResults(persistedState?.results, {
    provider: getStockProvider(persistedState?.provider).id, mediaType: persistedState?.mediaType === 'photos' ? 'photos' : 'videos' }))
  const [page, setPage] = useState(Math.max(1, Number(persistedState?.page) || 1))
  const [totalResults, setTotalResults] = useState(Math.max(0, Number(persistedState?.totalResults) || 0))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [addingId, setAddingId] = useState(null)
  const [isDefaultContent, setIsDefaultContent] = useState(Boolean(persistedState?.isDefaultContent ?? true))
  const [preview, setPreview] = useState(null) // { item, url }

  const { currentProjectHandle } = useProjectStore()
  const { addAsset } = useAssetsStore()
  const effectiveType = provider.mediaTypes.includes(mediaType) ? mediaType : provider.mediaTypes[0]
  const needsKey = Boolean(provider.keySetting)
  const ready = !needsKey || Boolean(apiKey)

  const refreshKey = useCallback(() => {
    setKeyChecked(false)
    getStockApiKey(provider.keySetting).then(key => { setApiKey(key?.trim() || null); setKeyChecked(true) })
  }, [provider.keySetting])
  useEffect(() => { refreshKey() }, [refreshKey])

  useEffect(() => {
    writePexelsStockPanelState({ provider: providerId, searchQuery, mediaType: effectiveType, results, page, totalResults, isDefaultContent })
  }, [providerId, searchQuery, effectiveType, results, page, totalResults, isDefaultContent])

  // MCP searches (Pexels) can open an already-mounted Stock tab.
  useEffect(() => {
    const handler = (event) => {
      const state = event?.detail?.stockState
      if (!state || !Array.isArray(state.results)) return
      const nextProvider = getStockProvider(state.provider).id
      const nextType = state.mediaType === 'photos' ? 'photos' : 'videos'
      setProviderId(nextProvider)
      setSearchQuery(String(state.searchQuery || ''))
      setMediaType(nextType)
      setResults(normalizeStockPanelResults(state.results, { provider: nextProvider, mediaType: nextType }))
      setPage(Math.max(1, Number(state.page) || 1))
      setTotalResults(Math.max(0, Number(state.totalResults) || 0))
      setIsDefaultContent(Boolean(state.isDefaultContent))
      setError(null)
      setPreview(null)
    }
    window.addEventListener(DRAMA_STUDIO_OPEN_STOCK_EVENT, handler)
    return () => window.removeEventListener(DRAMA_STUDIO_OPEN_STOCK_EVENT, handler)
  }, [])

  const run = useCallback(async ({ query, pageNum = 1, browse = false }) => {
    if (!ready) { setError(`Add your free ${provider.label} API key in Settings › Stock.`); return }
    setError(null)
    setLoading(true)
    try {
      const response = await searchStock({ provider: provider.id, key: apiKey, query: browse ? '' : query, mediaType: effectiveType, page: pageNum, perPage: PER_PAGE })
      setResults(response.items)
      setTotalResults(response.totalResults)
      setPage(response.page)
      setIsDefaultContent(browse)
    } catch (err) {
      setError(err.message || t('stock.searchFailed'))
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [ready, provider, apiKey, effectiveType, t])

  const search = useCallback((pageNum = 1) => {
    const query = searchQuery.trim()
    if (!query) { setError(t('stock.searchTermRequired')); return }
    run({ query, pageNum })
  }, [searchQuery, run, t])
  const loadDefaultContent = useCallback((pageNum = 1) => run({ browse: true, pageNum }), [run])

  // Switching source or media type: repeat the current search (or browse).
  const [lastContext, setLastContext] = useState(`${providerId}|${effectiveType}`)
  useEffect(() => {
    const context = `${providerId}|${effectiveType}`
    if (!keyChecked || !ready) return
    if (context === lastContext && results.length > 0) return
    setLastContext(context)
    if (searchQuery.trim() && !isDefaultContent) search(1)
    else loadDefaultContent(1)
  }, [providerId, effectiveType, keyChecked, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddToProject = async (item) => {
    if (!currentProjectHandle) { setError(t('stock.projectRequired')); return }
    setAddingId(item.id)
    setError(null)
    try {
      const downloaded = await downloadStockItem(item, { key: apiKey || '' })
      const assetInfo = await importAsset(currentProjectHandle, downloaded.path || downloaded.file, downloaded.category)
      const blobUrl = downloaded.blob ? URL.createObjectURL(downloaded.blob) : null
      const newAsset = addAsset(buildStockAssetRecord({ stock: item, query: searchQuery, imported: assetInfo, blobUrl, assetType: downloaded.assetType }))
      if (downloaded.assetType === 'video' && isElectron() && currentProjectHandle && newAsset?.absolutePath) {
        enqueuePlaybackTranscode(currentProjectHandle, newAsset.id, newAsset.absolutePath).catch(() => {})
        if (isProxyPlaybackEnabled()) enqueueProxyTranscode(currentProjectHandle, newAsset.id, newAsset.absolutePath).catch(() => {})
      }
    } catch (err) {
      setError(err.message || t('stock.addFailed'))
    } finally {
      setAddingId(null)
    }
  }

  const openPreview = async (item) => {
    if (item.previewUrl) { setPreview({ item, url: item.previewUrl }); return }
    // NASA lists video files in a separate manifest.
    try {
      const resolver = getStockProvider(item.provider).resolveDownload
      const url = resolver ? await resolver(item, { key: apiKey || '', fetchImpl: globalThis.fetch }) : item.downloadUrl
      setPreview({ item, url })
    } catch (err) { setError(err.message) }
  }

  const totalPages = Math.ceil(totalResults / PER_PAGE)
  const loadPage = (pageNum) => isDefaultContent ? loadDefaultContent(pageNum) : search(pageNum)
  const canGoHome = Boolean(searchQuery.trim()) || !isDefaultContent
  const handleGoHome = () => { setSearchQuery(''); setPreview(null); loadDefaultContent(1) }
  const providerOptions = useMemo(() => STOCK_PROVIDERS.map(item => ({ ...item, free: !item.keySetting })), [])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-sf-dark-950" data-testid="stock-panel">
      <div className="flex-shrink-0 p-4 border-b border-sf-dark-700 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-sf-text-primary">{t('stock.title')}</h1>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Stock source">
            {providerOptions.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === providerId}
              onClick={() => { setProviderId(item.id); setResults([]); setPreview(null) }} title={`${item.label}: ${item.note}`} data-testid={`stock-provider-${item.id}`}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${item.id === providerId
                ? 'border-sf-accent bg-sf-accent text-sf-accent-on' : 'border-sf-dark-600 bg-sf-dark-800 text-sf-text-secondary hover:bg-sf-dark-700'}`}>
              {item.label}{item.free ? <span className={`ml-1 text-[9px] ${item.id === providerId ? '' : 'text-sf-success'}`}>no key</span> : null}
            </button>)}
          </div>
          <a href={provider.homeUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-sf-text-muted hover:text-sf-accent flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />{provider.note}
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sf-text-muted" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search(1)}
              placeholder={`Search ${provider.label}`} aria-label="Search stock media"
              className="w-full pl-8 pr-3 py-2 bg-sf-dark-800 border border-sf-dark-600 rounded-lg text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent" />
          </div>
          <div className="flex rounded-lg overflow-hidden border border-sf-dark-600">
            <button onClick={() => setMediaType('videos')} disabled={!provider.mediaTypes.includes('videos')} className={toggleClass(effectiveType === 'videos')}
              title={provider.mediaTypes.includes('videos') ? '' : `${provider.label} has photos only`}>
              <Video className="w-3.5 h-3.5" />{t('stock.videos')}
            </button>
            <button onClick={() => setMediaType('photos')} disabled={!provider.mediaTypes.includes('photos')} className={toggleClass(effectiveType === 'photos')}>
              <ImageIcon className="w-3.5 h-3.5" />{t('stock.photos')}
            </button>
          </div>
          <button onClick={() => search(1)} disabled={loading || !searchQuery.trim() || !ready}
            className="px-4 py-2 bg-sf-accent hover:bg-sf-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-sf-accent-on text-sm font-medium rounded-lg flex items-center gap-2 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{t('stock.search')}
          </button>
          <button onClick={handleGoHome} disabled={loading || !canGoHome || !ready} title={t('stock.homeHelp')}
            className="px-3 py-2 bg-sf-dark-800 border border-sf-dark-600 hover:bg-sf-dark-700 disabled:opacity-50 disabled:cursor-not-allowed text-sf-text-secondary text-sm font-medium rounded-lg flex items-center gap-2 transition-colors">
            <Home className="w-4 h-4" />{t('stock.home')}
          </button>
        </div>
      </div>

      {keyChecked && !ready && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-3">
            <KeyRound className="w-10 h-10 text-sf-accent mx-auto" />
            <p className="text-sm text-sf-text-primary">{provider.label} needs a free API key.</p>
            <p className="text-xs text-sf-text-muted">Get one at{' '}
              <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-sf-accent hover:underline">{provider.keyUrl.replace(/^https:\/\//, '')}</a>
              {' '}and paste it in Settings › Stock. Or pick a source marked <span className="text-sf-success">no key</span>: Openverse, Wikimedia Commons or NASA.</p>
            <button onClick={refreshKey} className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-primary">{t('stock.refreshKey')}</button>
          </div>
        </div>
      )}

      {ready && error && (
        <div className="flex-shrink-0 px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-sm text-red-400 flex items-center gap-2" role="alert">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      {ready && (
        <div className="flex-1 overflow-auto p-4">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-sf-accent animate-spin" /></div>
          ) : results.length === 0 && !error ? (
            <div className="text-center py-20 text-sf-text-muted text-sm">{searchQuery.trim() ? t('stock.noResults') : t('stock.enterSearch')}</div>
          ) : (
            <>
              {isDefaultContent && <p className="text-xs text-sf-text-muted mb-3">Browsing {provider.label}. {t('stock.defaultHelp')}</p>}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {results.map((item) => {
                  const isAdding = addingId === item.id
                  const isVideo = item.mediaType === 'video'
                  return (
                    <div key={`${item.provider}-${item.id}`} className="bg-sf-dark-800 border border-sf-dark-600 rounded-lg overflow-hidden group" data-testid="stock-result">
                      <div className={`aspect-video bg-sf-dark-700 relative ${isVideo ? 'cursor-pointer' : ''}`}
                        onClick={isVideo ? () => openPreview(item) : undefined} role={isVideo ? 'button' : undefined} aria-label={isVideo ? t('stock.previewVideo') : undefined}>
                        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt={item.name} loading="lazy" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                        {isVideo && item.duration && <span className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-white">{Math.round(item.duration)}s</span>}
                        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          {isVideo && <button onClick={(e) => { e.stopPropagation(); openPreview(item) }} title={t('stock.preview')} aria-label={t('stock.previewVideo')}
                            className="p-2 bg-white/90 hover:bg-white rounded-full text-sf-dark-900 shadow-lg"><Play className="w-5 h-5 fill-current" /></button>}
                          <button onClick={(e) => { e.stopPropagation(); handleAddToProject(item) }} disabled={!currentProjectHandle || isAdding}
                            className="px-3 py-1.5 bg-sf-accent hover:bg-sf-accent-hover disabled:opacity-50 text-sf-accent-on text-xs font-medium rounded flex items-center gap-1.5">
                            {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}{t('stock.addToProject')}
                          </button>
                        </div>
                      </div>
                      <div className="p-2">
                        <p className="text-[10px] text-sf-text-primary truncate" title={item.name}>{item.name}</p>
                        <p className="text-[9px] text-sf-text-muted truncate" title={stockCreditLine(item)}>
                          {item.author || provider.label}{item.license ? ` · ${item.license}` : ''}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button onClick={() => loadPage(page - 1)} disabled={page <= 1 || loading} className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 disabled:opacity-50 rounded text-xs text-sf-text-primary">{t('stock.previous')}</button>
                  <span className="text-xs text-sf-text-muted">{t('stock.page', { page, pages: totalPages, results: totalResults })}</span>
                  <button onClick={() => loadPage(page + 1)} disabled={page >= totalPages || loading} className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 disabled:opacity-50 rounded text-xs text-sf-text-primary">{t('stock.next')}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)} role="dialog" aria-modal="true" aria-label={t('stock.videoPreview')}>
          <div className="relative bg-sf-dark-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreview(null)} className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors" aria-label={t('stock.closePreview')}><X className="w-5 h-5" /></button>
            <div className="flex-1 min-h-0 flex items-center justify-center p-4">
              <video src={preview.url} controls className="max-w-full max-h-[70vh] w-full rounded" preload="metadata" />
            </div>
            <div className="flex items-center justify-between gap-4 p-4 border-t border-sf-dark-600">
              <p className="text-sm text-sf-text-muted truncate flex-1" title={stockCreditLine(preview.item)}>{stockCreditLine(preview.item)}{preview.item.duration ? ` · ${Math.round(preview.item.duration)}s` : ''}</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setPreview(null)} className="px-3 py-1.5 bg-sf-dark-600 hover:bg-sf-dark-500 rounded text-sm text-sf-text-primary">{t('common.close')}</button>
                <button onClick={() => { handleAddToProject(preview.item); setPreview(null) }} disabled={!currentProjectHandle || addingId === preview.item.id}
                  className="px-4 py-1.5 bg-sf-accent hover:bg-sf-accent-hover disabled:opacity-50 text-sf-accent-on text-sm font-medium rounded flex items-center gap-1.5">
                  {addingId === preview.item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{t('stock.addToProject')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-shrink-0 px-4 py-2 border-t border-sf-dark-700 text-[10px] text-sf-text-muted">
        Results from <a href={provider.homeUrl} target="_blank" rel="noopener noreferrer" className="text-sf-accent hover:underline">{provider.label}</a> ({provider.license}).
        {' '}Author and license are saved on each imported asset; credit creators as the license asks.
      </div>
    </div>
  )
}

export default StockPanel
