import { useRef, useCallback, useContext, useEffect } from 'react'
import { getAdjustmentValue } from '../utils/adjustments'
import { InspectorSelectionContext, InspectorInput, InspectorValue, useInspectorField } from './InspectorSelectionControls'

// A control surface over the existing per-range color params — no color model
// of its own. Disc angle writes the range's hue, radius its saturation, and
// each level slider drives the range's Resolve-trio scalar (offset/gamma/gain).
const WHEELS = [
  { key: 'global', label: 'Global', sub: 'brightness', huePath: 'hue', satPath: 'saturation', levelPath: 'brightness', levelLabel: 'Level' },
  { key: 'lift', label: 'Lift', sub: 'shadows', huePath: 'shadows.hue', satPath: 'shadows.saturation', levelPath: 'shadows.offset', levelLabel: 'Lift' },
  { key: 'gamma', label: 'Gamma', sub: 'midtones', huePath: 'midtones.hue', satPath: 'midtones.saturation', levelPath: 'midtones.gamma', levelLabel: 'Gamma' },
  { key: 'gain', label: 'Gain', sub: 'highlights', huePath: 'highlights.hue', satPath: 'highlights.saturation', levelPath: 'highlights.gain', levelLabel: 'Gain' },
]

const DISC_SIZE = 96
const PUCK_MARGIN = 8

const DISC_BACKGROUND = [
  'radial-gradient(circle, rgb(10 10 16 / 0.92) 0%, rgb(10 10 16 / 0.55) 34%, rgb(10 10 16 / 0) 72%)',
  'conic-gradient(from 90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
].join(', ')

const formatSigned = (value) => (value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`)

function Wheel({ wheel, values, onApply }) {
  const discRef = useRef(null)
  const dragValuesRef = useRef(null)
  const selection = useContext(InspectorSelectionContext)
  const hueField = useInspectorField(`color.${wheel.huePath}`)
  const satField = useInspectorField(`color.${wheel.satPath}`)
  const blockedReason = hueField?.blockedReason || satField?.blockedReason
  const mixed = hueField?.mixed || satField?.mixed

  useEffect(() => {
    const cancel = () => { dragValuesRef.current = null; selection?.endGesture() }
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('blur', cancel); cancel() }
  }, [selection?.endGesture])

  const hue = hueField?.values?.[0] ?? (Number(getAdjustmentValue(values, wheel.huePath)) || 0)
  const sat = satField?.values?.[0] ?? (Number(getAdjustmentValue(values, wheel.satPath)) || 0)
  const level = Number(getAdjustmentValue(values, wheel.levelPath)) || 0

  const radius = DISC_SIZE / 2
  const reach = radius - PUCK_MARGIN
  const angle = ((hue - 90) * Math.PI) / 180
  const puckX = radius + Math.cos(angle) * (Math.min(Math.abs(sat), 100) / 100) * reach
  const puckY = radius + Math.sin(angle) * (Math.min(Math.abs(sat), 100) / 100) * reach

  const valuesFromPointer = useCallback((event) => {
    const bounds = discRef.current.getBoundingClientRect()
    const dx = event.clientX - (bounds.left + bounds.width / 2)
    const dy = event.clientY - (bounds.top + bounds.height / 2)
    const reachPx = bounds.width / 2 - PUCK_MARGIN
    const distance = Math.min(Math.hypot(dx, dy), reachPx)
    let degrees = (Math.atan2(dy, dx) * 180) / Math.PI + 90
    if (degrees > 180) degrees -= 360
    return {
      [wheel.huePath]: Math.round(degrees),
      [wheel.satPath]: Math.round((distance / reachPx) * 100),
    }
  }, [wheel])

  const handlePointerDown = (event) => {
    if (blockedReason || event.button !== 0) return
    event.preventDefault()
    const updates = valuesFromPointer(event)
    dragValuesRef.current = updates
    onApply(updates)
    try { discRef.current.setPointerCapture(event.pointerId) } catch { /* synthetic pointers have no capturable id */ }
  }

  const handlePointerMove = (event) => {
    if (!dragValuesRef.current || blockedReason) return
    const updates = valuesFromPointer(event)
    dragValuesRef.current = updates
    onApply(updates)
  }

  const handlePointerUp = () => {
    if (!dragValuesRef.current) return
    const updates = dragValuesRef.current
    dragValuesRef.current = null
    if (!blockedReason) onApply(updates, true)
    selection?.endGesture()
  }

  const handleDiscReset = () => {
    if (blockedReason) return
    onApply({ [wheel.huePath]: 0, [wheel.satPath]: 0 }, true)
  }

  return (
    <div>
      <div className="flex justify-center">
        <div
          ref={discRef}
          role="group"
          aria-label={`${wheel.label} color wheel`}
          aria-disabled={Boolean(blockedReason)}
          data-color-wheel={wheel.key}
          data-mixed={mixed || undefined}
          className="relative rounded-full border border-sf-dark-600 cursor-crosshair"
          style={{ width: DISC_SIZE, height: DISC_SIZE, background: DISC_BACKGROUND, touchAction: 'none', ...(blockedReason ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          onDoubleClick={handleDiscReset}
          title={blockedReason || (mixed ? 'Mixed hues or saturation. Drag to set both on selected clips. Double-click to reset.' : 'Drag to push the range toward a hue. Double-click to reset.')}
        >
          {!mixed && <div
            className="absolute w-[11px] h-[11px] rounded-full border-[1.5px] border-white bg-black/40 pointer-events-none shadow-[0_0_3px_rgba(0,0,0,0.8)]"
            style={{ left: puckX, top: puckY, transform: 'translate(-50%, -50%)' }}
          />}
        </div>
      </div>
      <div className="text-center mt-1">
        <div className="text-[10px] text-sf-text-secondary font-medium leading-tight">{wheel.label}</div>
        <div className="text-[9px] text-sf-text-muted leading-tight">{wheel.sub}</div>
        <div className="text-[9px] text-sf-text-muted tabular-nums leading-tight">
          {mixed ? 'Mixed' : `H ${formatSigned(hue)}° · S ${Math.round(sat)}%`}
        </div>
      </div>
      <div className="mt-1">
        <InspectorInput
          inspectorProperty={`color.${wheel.levelPath}`}
          type="range"
          min={-100}
          max={100}
          step={1}
          value={level}
          onChange={(event) => onApply({ [wheel.levelPath]: Number(event.target.value) })}
          onMouseUp={(event) => onApply({ [wheel.levelPath]: Number(event.target.value) }, true)}
          onDoubleClick={() => onApply({ [wheel.levelPath]: 0 }, true)}
          title="Double-click to reset to 0"
          className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
        />
        <div className="flex justify-between text-[9px] text-sf-text-muted">
          <span>{wheel.levelLabel}</span>
          <span className="tabular-nums"><InspectorValue property={`color.${wheel.levelPath}`}>{formatSigned(level)}</InspectorValue></span>
        </div>
      </div>
    </div>
  )
}

export default function ColorWheels({ values, onApply }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {WHEELS.map((wheel) => (
        <Wheel key={wheel.key} wheel={wheel} values={values} onApply={onApply} />
      ))}
    </div>
  )
}
