/** Media file types the editor imports, and drop helpers (pure). */

export const MEDIA_EXTENSIONS = Object.freeze({
  video: ['.mp4', '.webm', '.mov', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'],
  images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
})
export const ALL_MEDIA_EXTENSIONS = Object.freeze([...MEDIA_EXTENSIONS.video, ...MEDIA_EXTENSIONS.audio, ...MEDIA_EXTENSIONS.images])

const extensionOf = name => {
  const match = /\.[^./\\]+$/.exec(String(name || ''))
  return match ? match[0].toLowerCase() : ''
}

/** 'video' | 'audio' | 'images' | null from a file name. */
export function getMediaCategory(name) {
  const ext = extensionOf(name)
  for (const [category, list] of Object.entries(MEDIA_EXTENSIONS)) if (list.includes(ext)) return category
  return null
}

/** Does this drag carry files from the desktop (not an in-app asset drag)? */
export function hasDesktopFiles(dataTransfer) {
  return Boolean(dataTransfer?.types && Array.from(dataTransfer.types).includes('Files'))
}

/** Files of a drop, split into importable media and skipped names. Read it
 * synchronously in the drop handler: the list is empty after an await. */
export function getDroppedMediaFiles(dataTransfer) {
  const files = Array.from(dataTransfer?.files || [])
  return {
    media: files.filter(file => getMediaCategory(file.name)),
    skipped: files.filter(file => !getMediaCategory(file.name)).map(file => file.name),
  }
}
