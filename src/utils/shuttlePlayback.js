const FAST_RATES = [1, 2, 4, 8]
const SLOW_RATES = [0.5, 0.25, 0.125]

// Slow and fast shuttle are separate ladders. Changing direction or ladder
// starts at its first speed; repeated taps stop at the end, never wrap.
export function nextShuttleRate(state, direction, slow = false) {
  const sign = direction === 'reverse' ? -1 : 1
  const rates = slow ? SLOW_RATES : FAST_RATES
  const current = Number(state.playbackRate)
  if (!state.isPlaying || Math.sign(current) !== sign) return sign * rates[0]
  const index = rates.indexOf(Math.abs(current))
  return sign * rates[Math.min(index + 1, rates.length - 1)]
}

export function getShuttleKeyAction(event, kHeld = false) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null
  const key = String(event.key || '').toLowerCase()
  if (key === 'k') return { type: 'pause' }
  if (key !== 'j' && key !== 'l') return null
  return {
    type: kHeld ? 'hold-slow' : event.shiftKey ? 'step-slow' : 'fast',
    direction: key === 'j' ? 'reverse' : 'forward',
  }
}
