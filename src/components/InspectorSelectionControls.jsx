import { createContext, useContext, useRef } from 'react'
import { MULTI_CLIP_FIELDS } from '../utils/multiClipInspector'
import { isComposingKeyEvent } from '../utils/transportKeyboardGuards.mjs'

// Selection metadata augments the original Inspector controls, not their layout
// or interaction model. A single selection receives the original props unchanged.
export const InspectorSelectionContext = createContext(null)
const labels = new Map(MULTI_CLIP_FIELDS.map(field => [field.id, field.label]))
export function useInspectorField(property) {
  const selection = useContext(InspectorSelectionContext)
  return selection && property ? selection.getField(property) : null
}

export function InspectorValue({ property, children }) {
  const field = useInspectorField(property)
  return field?.mixed ? <span title="Selected clips have different values">Mixed</span> : children
}

export function InspectorInput({ inspectorProperty, ...props }) {
  const field = useInspectorField(inspectorProperty)
  const selection = useContext(InspectorSelectionContext)
  const touched = useRef(false)
  const label = props['aria-label'] || labels.get(inspectorProperty)
  if (!field) return <input {...props} aria-label={label} data-inspector-property={inspectorProperty} />
  const disabled = props.disabled || Boolean(field.blockedReason)
  const numeric = props.type === 'number' || props.type === 'range'
  const finish = (event, handler) => {
    if (touched.current && !disabled) handler?.(event)
    touched.current = false
    selection.endGesture()
  }
  return <input {...props}
    aria-label={label}
    data-inspector-property={inspectorProperty}
    data-mixed={field.mixed || undefined}
    disabled={disabled}
    ref={element => { if (element && props.type === 'checkbox') element.indeterminate = field.mixed }}
    value={numeric ? (field.mixed && props.type === 'number' ? '' : field.values?.[0] ?? props.value) : props.value}
    placeholder={field.mixed ? 'Mixed' : props.placeholder}
    aria-valuetext={field.mixed ? 'Mixed' : undefined}
    title={field.blockedReason || (field.mixed ? 'Mixed values. Adjust to set the same value on selected clips.' : props.title)}
    onChange={event => {
      if (disabled || (numeric && (event.target.value === '' || !Number.isFinite(Number(event.target.value))))) return
      touched.current = true
      props.onChange?.(event)
    }}
    onMouseUp={event => finish(event, props.onMouseUp)}
    onPointerUp={event => finish(event, props.onPointerUp || props.onMouseUp)}
    onPointerCancel={event => finish(event, props.onPointerCancel || props.onMouseUp)}
    onLostPointerCapture={event => finish(event, props.onLostPointerCapture)}
    onBlur={event => finish(event, props.onBlur)}
    onKeyUp={event => { props.onKeyUp?.(event); if (props.type === 'range') finish(event, props.onMouseUp) }}
    onKeyDown={event => {
      props.onKeyDown?.(event)
      if (event.key === 'Enter' && !isComposingKeyEvent(event) && !event.defaultPrevented) {
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.blur()
      }
    }}
    onDoubleClick={event => { if (!disabled) props.onDoubleClick?.(event) }}
  />
}

export function InspectorSelect({ inspectorProperty, children, ...props }) {
  const field = useInspectorField(inspectorProperty)
  return <select {...props} aria-label={labels.get(inspectorProperty)}
    disabled={props.disabled || Boolean(field?.blockedReason)}
    value={field?.mixed ? '' : props.value}
    title={field?.blockedReason || props.title}>
    {field?.mixed && <option value="" disabled>Mixed</option>}
    {children}
  </select>
}
