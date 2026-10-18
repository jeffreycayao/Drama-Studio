// Single source of truth for Drama Studio's public links and repository.
// electron/captionWhisper.js keeps its own copy of PROJECT_REPO (CommonJS).
import packageJson from '../../package.json'

export const APP_NAME = 'Drama Studio'
export const APP_VERSION = packageJson.version
export const PROJECT_REPO = 'jeffreycayao/Drama-Studio'
export const PROJECT_REPO_URL = `https://github.com/${PROJECT_REPO}`
export const DISCORD_INVITE_URL = 'https://discord.gg/5nAZVQ7K4'
export const WEBSITE_URL = 'http://jepoy.dev/'
export const WEBSITE_LABEL = 'jepoy.dev'
// Partner (affiliate) link shown as the gold "Learn AI" button in the top bar.
export const LEARN_AI_URL = 'https://curzzo.com/ref/YGrLfZcAHUtr'
export const LEARN_AI_LABEL = 'Learn AI Content Generation'
// Drama Studio Companion in the Chrome Web Store (Edge installs it from there
// too). Copied from extensions/companion/store/identity.json, which the dev
// server cannot import (it forwards /extensions/ to ComfyUI); a test keeps
// them equal. electron/companionLink/registration.cjs trusts this ID.
export const COMPANION_EXTENSION_ID = 'inkjhigflcgkaganbiepogcpcfgndfog'
export const COMPANION_STORE_URL = `https://chromewebstore.google.com/detail/${COMPANION_EXTENSION_ID}`

export function getCopyrightNotice(date = new Date()) {
  return `© ${date.getFullYear()} ${APP_NAME}`
}
