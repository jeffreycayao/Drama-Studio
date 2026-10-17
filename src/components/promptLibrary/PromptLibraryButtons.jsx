import { BookMarked, BookmarkPlus } from 'lucide-react'
import { openPromptLibrary } from '../../stores/promptLibraryStore'
import { useI18n } from '../../i18n/I18nContext'

/**
 * Two small buttons for a prompt field: open the library to fill the field,
 * and save what is in the field to the library.
 *   value      the field's current text
 *   onChange   (text) => void, sets the field
 *   category   the library section to open on, e.g. 'shot', 'negative', 'music'
 *   fieldLabel shown in the library title ("Prompt library for: Prompt")
 */
export default function PromptLibraryButtons({ value = '', onChange, category = 'shot', fieldLabel = '', className = '', testId = 'prompt-library' }) {
  const { t } = useI18n()
  const tr = (key, vars) => t(`promptLibrary.${key}`, vars)
  const text = String(value || '')

  const openForField = () => openPromptLibrary({
    category,
    fieldLabel,
    onUse: (chosen, mode) => {
      if (typeof onChange !== 'function') return
      const current = String(value || '')
      if (mode === 'append' && current.trim()) onChange(`${current.replace(/\s+$/, '')}${/[.,;:!?]$/.test(current.trim()) ? ' ' : ', '}${chosen}`)
      else onChange(chosen)
    },
  })

  const saveField = () => openPromptLibrary({ category, fieldLabel, draftText: text, draftCategory: category })

  const buttonClass = 'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] normal-case tracking-normal text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <button type="button" className={buttonClass} onClick={openForField} title={tr('fieldOpenHint')} data-testid={`${testId}-open`}>
        <BookMarked className="h-3 w-3" />{tr('fieldOpen')}
      </button>
      <button type="button" className={buttonClass} onClick={saveField} disabled={!text.trim()} title={tr('fieldSaveHint')} aria-label={tr('fieldSaveHint')} data-testid={`${testId}-save`}>
        <BookmarkPlus className="h-3 w-3" />
      </button>
    </span>
  )
}
