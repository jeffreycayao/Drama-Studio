export const FRAME_RATE = 24

export const TRANSITION_DURATIONS = [
  { frames: 6, seconds: 6 / FRAME_RATE },
  { frames: 12, seconds: 12 / FRAME_RATE },
  { frames: 24, seconds: 24 / FRAME_RATE },
  { frames: 48, seconds: 48 / FRAME_RATE },
]

export const TRANSITION_TYPES = [
  { id: 'dissolve', name: 'Cross Dissolve', icon: '⚪' },
  { id: 'fade-black', name: 'Fade to Black', icon: '⬛' },
  { id: 'fade-white', name: 'Fade to White', icon: '⬜' },
  { id: 'dip-color', name: 'Dip to Color', icon: '🎨' },
  { id: 'flash', name: 'Flash Cut', icon: '⚡' },
  { id: 'wipe-left', name: 'Wipe Left', icon: '◀' },
  { id: 'wipe-right', name: 'Wipe Right', icon: '▶' },
  { id: 'wipe-up', name: 'Wipe Up', icon: '▲' },
  { id: 'wipe-down', name: 'Wipe Down', icon: '▼' },
  // Note: the push-* display names keep the historical slide-* ids so
  // transitions saved in existing projects keep working. Both clips move,
  // which is a Push in industry naming.
  { id: 'slide-left', name: 'Push Left', icon: '⇠' },
  { id: 'slide-right', name: 'Push Right', icon: '⇢' },
  { id: 'slide-up', name: 'Push Up', icon: '⇡' },
  { id: 'slide-down', name: 'Push Down', icon: '⇣' },
  { id: 'whip-left', name: 'Whip Pan Left', icon: '🌪' },
  { id: 'whip-right', name: 'Whip Pan Right', icon: '🌪' },
  { id: 'zoom-in', name: 'Zoom In', icon: '🔍' },
  { id: 'zoom-out', name: 'Zoom Out', icon: '🔎' },
  { id: 'cross-zoom', name: 'Cross Zoom', icon: '🌀' },
  { id: 'blur', name: 'Blur Dissolve', icon: '💨' },
  // Shape reveals and covers (the incoming clip over an untouched outgoing one).
  { id: 'iris-open', name: 'Iris Open', icon: '◉' },
  { id: 'iris-close', name: 'Iris Close', icon: '◎' },
  { id: 'diamond', name: 'Diamond', icon: '◆' },
  { id: 'clock-wipe', name: 'Clock Wipe', icon: '◔' },
  { id: 'barn-door-h', name: 'Barn Door Open', icon: '⇹' },
  { id: 'barn-door-v', name: 'Barn Door Vertical', icon: '⇳' },
  { id: 'box-in', name: 'Box Grow', icon: '▣' },
  { id: 'diagonal-tl', name: 'Diagonal Wipe ↘', icon: '◤' },
  { id: 'diagonal-tr', name: 'Diagonal Wipe ↙', icon: '◥' },
  { id: 'blinds-h', name: 'Blinds', icon: '☰' },
  { id: 'blinds-v', name: 'Blinds Vertical', icon: '⫼' },
  { id: 'cover-left', name: 'Slide Over Left', icon: '⇤' },
  { id: 'cover-right', name: 'Slide Over Right', icon: '⇥' },
  { id: 'cover-up', name: 'Slide Over Up', icon: '⤒' },
  { id: 'cover-down', name: 'Slide Over Down', icon: '⤓' },
]

export const TRANSITION_CATEGORIES = [
  {
    id: 'dissolve',
    label: 'Dissolve',
    items: ['dissolve', 'blur', 'fade-black', 'fade-white', 'dip-color', 'flash'],
  },
  {
    id: 'motion',
    label: 'Motion',
    items: ['slide-left', 'slide-right', 'slide-up', 'slide-down', 'cover-left', 'cover-right', 'cover-up', 'cover-down', 'whip-left', 'whip-right', 'zoom-in', 'zoom-out', 'cross-zoom'],
  },
  {
    id: 'shape',
    label: 'Shape',
    items: ['iris-open', 'iris-close', 'diamond', 'clock-wipe', 'box-in', 'barn-door-h', 'barn-door-v', 'blinds-h', 'blinds-v'],
  },
  {
    id: 'wipe',
    label: 'Wipe',
    items: ['wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'diagonal-tl', 'diagonal-tr'],
  },
]

export const TRANSITION_DEFAULT_SETTINGS = {
  'zoom-in': { zoomAmount: 0.1 },
  'zoom-out': { zoomAmount: 0.1 },
  blur: { blurAmount: 8 },
  'cross-zoom': { zoomAmount: 0.4, blurAmount: 12 },
  'whip-left': { blurAmount: 16 },
  'whip-right': { blurAmount: 16 },
  flash: { color: '#FFFFFF' },
  'dip-color': { color: '#000000' },
  'blinds-h': { slats: 8 },
  'blinds-v': { slats: 8 },
}
