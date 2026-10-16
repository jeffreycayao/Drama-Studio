import { Info } from 'lucide-react'

/**
 * Beginner helper text: the one place "what is this option good for" copy is
 * rendered, so every hint in the app looks and reads the same.
 *
 * - variant="inline" (default): a short line under or inside a control.
 * - variant="tip": a small info icon whose text shows on hover or focus, for
 *   dense rows where an extra line would crowd the layout.
 *
 * Inline hints use text-sf-text-secondary. On a solid lime surface the global
 * on-accent rule in index.css turns that charcoal, so a hint inside a selected
 * preset button stays readable without extra props.
 */
export default function Hint({ children, variant = 'inline', className = '', label, as: Tag = 'p' }) {
  if (children == null || children === '') return null

  if (variant === 'tip') {
    const text = typeof children === 'string' ? children : label
    return (
      <span
        role="img"
        tabIndex={0}
        aria-label={text}
        title={text}
        className={`inline-flex shrink-0 cursor-help items-center text-sf-text-muted hover:text-sf-text-primary focus-visible:text-sf-text-primary focus-visible:outline-none ${className}`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    )
  }

  return (
    <Tag className={`text-[11px] leading-snug text-sf-text-secondary ${className}`}>
      {children}
    </Tag>
  )
}
