import { X } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

export default function ConfirmDialog({
  isOpen,
  title,
  message = '',
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  // Optional radio choice shown under the message:
  // [{ id, label, description?, danger? }], with `choice` and `onChoiceChange`.
  choices = null,
  choice = null,
  onChoiceChange,
  onConfirm,
  onCancel,
}) {
  const { t } = useI18n()
  if (!isOpen) return null

  const resolvedTitle = title || t('confirmDialog.title')
  const resolvedConfirmLabel = confirmLabel || t('confirmDialog.confirm')
  const resolvedCancelLabel = cancelLabel || t('common.cancel')

  const confirmToneClass = tone === 'danger'
    ? 'bg-sf-error hover:bg-red-500 text-white'
    : 'bg-sf-accent hover:bg-sf-accent-hover text-sf-accent-on'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div
        className="w-full max-w-md mx-4 rounded-xl border border-sf-dark-600 bg-sf-dark-900 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-sf-dark-700">
          <h3 className="text-sm font-medium text-sf-text-primary">{resolvedTitle}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded hover:bg-sf-dark-700 text-sf-text-muted"
            title={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 text-sm text-sf-text-secondary whitespace-pre-line">
          {message}
          {Array.isArray(choices) && choices.length > 0 && (
            <div role="radiogroup" aria-label={resolvedTitle} className="mt-3 space-y-1.5 whitespace-normal" data-testid="confirm-dialog-choices">
              {choices.map((option) => {
                const selected = choice === option.id
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                      selected
                        ? (option.danger ? 'border-sf-error/60 bg-sf-error/10' : 'border-sf-accent/50 bg-sf-accent/10')
                        : 'border-sf-dark-600 hover:border-sf-dark-500'
                    }`}
                  >
                    <input
                      type="radio"
                      name="confirm-dialog-choice"
                      value={option.id}
                      checked={selected}
                      onChange={() => onChoiceChange?.(option.id)}
                      className={`mt-0.5 ${option.danger ? 'accent-sf-error' : 'accent-sf-accent'}`}
                      data-testid={`confirm-choice-${option.id}`}
                    />
                    <span className="min-w-0">
                      <span className={`block text-xs font-medium ${option.danger ? 'text-sf-error' : 'text-sf-text-primary'}`}>{option.label}</span>
                      {option.description && <span className="mt-0.5 block text-[11px] leading-snug text-sf-text-muted">{option.description}</span>}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-sf-dark-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary text-xs"
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded text-xs ${confirmToneClass}`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
