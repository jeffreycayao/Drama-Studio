/**
 * Import media files dropped from the desktop (or picked) into the open
 * project. Shared by the Assets panel, the timeline (files dropped on a
 * track become clips) and the Editor-wide drop fallback, so every drop
 * target imports the same way: copy into the project, add to the bin,
 * queue playback cache / proxy / thumbnails for videos.
 */
import useAssetsStore from '../stores/assetsStore'
import { importAsset, isElectron } from './fileSystem'
import { canImportGifMedia, importGifAsset, isGifFilename } from './gifImport'
import { enqueuePlaybackTranscode } from './playbackCache'
import { enqueueProxyTranscode, isProxyPlaybackEnabled } from './proxyCache'

import { getMediaCategory } from '../utils/mediaFiles.mjs'

export { ALL_MEDIA_EXTENSIONS, MEDIA_EXTENSIONS, getDroppedMediaFiles, getMediaCategory, hasDesktopFiles } from '../utils/mediaFiles.mjs'

/**
 * Import files into the project. Returns the new assets in input order;
 * failures are reported per file and do not stop the rest. Each item is a
 * File, or (desktop build) an absolute path that is copied into the project.
 * @returns {Promise<{ assets: object[], failed: { name: string, error: string }[] }>}
 */
export async function importMediaFiles(files, { projectHandle, folderId = null, isCurrent = () => true } = {}) {
  if (!projectHandle) throw new Error('Open a project before importing media.')
  const assets = []
  const failed = []
  for (const file of files || []) {
    const isPath = typeof file === 'string'
    const name = isPath ? file.split(/[\\/]/).pop() : file?.name
    const category = getMediaCategory(name)
    if (!category) { failed.push({ name: name || 'file', error: 'Unsupported file type.' }); continue }
    try {
      const assetInfo = !isPath && isGifFilename(name) && canImportGifMedia()
        ? await importGifAsset(projectHandle, file)
        : await importAsset(projectHandle, file, category)
      // A path import has no File to make a blob URL from; without this the
      // asset had no preview until the project was reopened.
      const pathUrl = isPath && !assetInfo.url && assetInfo.absolutePath && isElectron()
        ? await window.electronAPI.getFileUrlDirect?.(assetInfo.absolutePath).catch(() => null)
        : null
      if (!isCurrent()) throw new Error('The project changed during the import.')
      const store = useAssetsStore.getState()
      const asset = store.addAsset({
        ...assetInfo,
        url: assetInfo.url || pathUrl || (typeof URL !== 'undefined' && file instanceof Blob ? URL.createObjectURL(file) : null),
        folderId,
        settings: { ...(assetInfo.settings || {}), duration: assetInfo.duration, fps: assetInfo.fps },
      })
      if (!asset) throw new Error('The file could not be added to the project.')
      const isVideo = assetInfo.type === 'video'
      const isAnimatedGif = assetInfo.settings?.gifSource?.animated === true
      if (isVideo && !isAnimatedGif && isElectron() && asset.absolutePath) {
        enqueuePlaybackTranscode(projectHandle, asset.id, asset.absolutePath).catch(() => {})
        if (isProxyPlaybackEnabled()) enqueueProxyTranscode(projectHandle, asset.id, asset.absolutePath).catch(() => {})
      }
      if (isVideo && assetInfo.duration > 0.5) {
        const projectPath = typeof projectHandle === 'string' ? projectHandle : null
        store.generateAssetSprite?.(asset.id, projectPath)?.catch?.(() => {})
        store.generateAssetPoster?.(asset.id, projectPath)?.catch?.(() => {})
      }
      assets.push(asset)
    } catch (error) {
      failed.push({ name: name || 'file', error: error?.message || String(error) })
    }
  }
  return { assets, failed }
}
