import { Activity, Clapperboard, Spline, StickyNote, Tv } from 'lucide-react'

/**
 * Idea Pad icons: figure silhouettes for character cards (chosen per
 * character) and one icon per card type. Figures are simple filled shapes in
 * a 24×24 box and use currentColor, so they follow the theme.
 */
const FIGURE_PATHS = {
  // Head and rounded shoulders.
  person: <>
    <circle cx="12" cy="7" r="3.6" />
    <path d="M4.5 21c0-4.4 3.4-7.6 7.5-7.6s7.5 3.2 7.5 7.6z" />
  </>,
  // Long hair framing the face, dress widening to the hem.
  woman: <>
    <path d="M12 2.6c-2.9 0-4.6 2.2-4.6 5 0 1.9-.5 3.5-1.3 4.6 1.4.5 2.9.6 4 .2a4.3 4.3 0 0 0 3.8 0c1.1.4 2.6.3 4-.2-.8-1.1-1.3-2.7-1.3-4.6 0-2.8-1.7-5-4.6-5z" />
    <path d="M8.6 14.2h6.8l3.6 6.8H5z" />
  </>,
  // Short hair, broad shoulders, open collar.
  man: <>
    <path d="M12 3c-2.3 0-3.9 1.5-3.9 3.6v1.1c0 2.4 1.7 4.3 3.9 4.3s3.9-1.9 3.9-4.3V6.6C15.9 4.5 14.3 3 12 3z" />
    <path d="M3.5 21c.3-4 3-6.6 6.4-7.3L12 16.5l2.1-2.8c3.4.7 6.1 3.3 6.4 7.3z" />
  </>,
  // Big head, small body.
  child: <>
    <circle cx="12" cy="8.5" r="3.9" />
    <path d="M7.6 21c0-3.4 2-5.6 4.4-5.6s4.4 2.2 4.4 5.6z" />
  </>,
  // Slight stoop and a walking cane.
  elder: <>
    <circle cx="10.6" cy="6.4" r="3.1" />
    <path d="M5.5 21c0-4.3 1.6-7.6 4.7-8.2 2.1-.4 3.6.6 4.3 2.1l.6 1.4H13l-.4 4.7z" />
    <path d="M16.2 13.4h1.1v7.6h-1.1z" />
    <path d="M16.2 13.4c0-1 .7-1.6 1.6-1.6h.7v1.1h-.7c-.3 0-.5.2-.5.5z" />
  </>,
  // Three people.
  group: <>
    <circle cx="12" cy="6.2" r="2.9" />
    <path d="M7 16.6c0-3.3 2.2-5.6 5-5.6s5 2.3 5 5.6z" />
    <circle cx="5.2" cy="10" r="2.3" />
    <path d="M1.2 19.5c0-2.6 1.7-4.4 4-4.4 1 0 1.9.3 2.6.9a7.6 7.6 0 0 0-1.7 3.5z" />
    <circle cx="18.8" cy="10" r="2.3" />
    <path d="M22.8 19.5c0-2.6-1.7-4.4-4-4.4-1 0-1.9.3-2.6.9a7.6 7.6 0 0 1 1.7 3.5z" />
  </>,
  // Horns, wide eyes, claws.
  creature: <>
    <path d="M6.4 2.5 9 6.2a6 6 0 0 1 6 0l2.6-3.7.3 4.9a6.1 6.1 0 0 1 .4 2.3c0 3.4-2.8 5.6-6.3 5.6s-6.3-2.2-6.3-5.6c0-.8.1-1.6.4-2.3z" />
    <path d="M4 21.5c.4-3.3 2.4-5.4 5-6.1l3 1.7 3-1.7c2.6.7 4.6 2.8 5 6.1l-1.6-1-1.4 1-1.4-1-1.4 1H10.4l-1.4-1-1.4 1-1.4-1z" />
  </>,
}
const EYES = { creature: <><circle cx="10" cy="9.2" r="1" className="fill-sf-dark-900" /><circle cx="14" cy="9.2" r="1" className="fill-sf-dark-900" /></> }

export function FigureIcon({ figure = 'person', className = 'h-4 w-4', title }) {
  const shape = FIGURE_PATHS[figure] || FIGURE_PATHS.person
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
    {title && <title>{title}</title>}
    {shape}
    {EYES[figure] || null}
  </svg>
}

const KIND_ICONS = { arc: Spline, episode: Tv, beat: Activity, scene: Clapperboard, note: StickyNote }

/** Icon for a card type; characters use their figure. */
export function IdeaKindIcon({ kind, figure, className = 'h-3.5 w-3.5' }) {
  if (kind === 'character') return <FigureIcon figure={figure || 'person'} className={className} />
  const Icon = KIND_ICONS[kind] || StickyNote
  return <Icon className={className} aria-hidden="true" />
}
