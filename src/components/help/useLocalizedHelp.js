import { useEffect, useMemo, useState } from 'react'
import { HELP_ARTICLES, HELP_CATEGORIES } from '../../config/helpGuide'
import {
  helpPackLanguage, localizeHelpArticles, localizeHelpCategories, localizePopularQuestions,
} from '../../utils/helpLocale.mjs'

// Loaded once, on demand: English users never download the Japanese guide.
const packLoaders = {
  ja: () => import('../../config/helpGuideJa/index.js').then((module) => module.HELP_JA),
}
const loadedPacks = {}

/**
 * The Help Center content in the app language, falling back to English for
 * anything a language pack does not cover.
 */
export default function useLocalizedHelp(language) {
  const packLanguage = helpPackLanguage(language)
  const [pack, setPack] = useState(() => (packLanguage ? loadedPacks[packLanguage] || null : null))

  useEffect(() => {
    if (!packLanguage) { setPack(null); return undefined }
    if (loadedPacks[packLanguage]) { setPack(loadedPacks[packLanguage]); return undefined }
    let cancelled = false
    packLoaders[packLanguage]?.()
      .then((loaded) => {
        loadedPacks[packLanguage] = loaded
        if (!cancelled) setPack(loaded)
      })
      .catch((error) => console.warn('[help] could not load the translated guide', error))
    return () => { cancelled = true }
  }, [packLanguage])

  return useMemo(() => {
    const articles = localizeHelpArticles(HELP_ARTICLES, pack)
    const categories = localizeHelpCategories(HELP_CATEGORIES, pack)
    return {
      pack,
      translated: Boolean(pack),
      articles,
      byId: Object.fromEntries(articles.map((article) => [article.id, article])),
      categories,
      categoryById: Object.fromEntries(categories.map((category) => [category.id, category])),
      localizePopular: (popular) => localizePopularQuestions(popular, pack),
    }
  }, [pack])
}
