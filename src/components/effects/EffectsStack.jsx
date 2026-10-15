import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  RotateCcw,
  Diamond,
  Waves,
  Radio,
  Sparkles,
  CircleDot,
  Sun,
  RectangleHorizontal,
  MoveRight,
  Tv,
} from 'lucide-react'
import {
  EFFECT_PICKER_GROUPS,
  EFFECT_TYPES,
  getEffectTypeDefinition,
  getEffectPropertyId,
  isManagedEffectType,
  normalizeEffectSettings,
  getAnimatedEffectSettings,
} from '../../utils/effects'
import { getKeyframeAtTime, getKeyframeTimeTolerance } from '../../utils/keyframes'
import useTimelineStore from '../../stores/timelineStore'
import {
  getMultiClipEffectGroups,
  getMultiClipEffectFieldState,
  getMultiClipEffectOperationBlock,
} from '../../utils/multiClipEffects'

const EFFECT_ICONS = {
  cameraShake: Waves,
  glslCameraShake: Waves,
  gaussianBlur: CircleDot,
  directionalBlur: MoveRight,
  glslDirectionalBlur: MoveRight,
  glslLensBlur: CircleDot,
  glslFisheye: CircleDot,
  chromaticAberration: Radio,
  glslChromaWarp: Radio,
  glslDigitalGlitch: Radio,
  sharpen: CircleDot,
  glslSharpen: CircleDot,
  filmGrain: Sparkles,
  glslFilmGrain: Sparkles,
  glslFilmLook: Sun,
  glslFlicker: Sparkles,
  glow: Sun,
  halation: Sun,
  vhsDamage: Tv,
  glslVhsLook: Tv,
  vignette: CircleDot,
  glslVignette: CircleDot,
  letterbox: RectangleHorizontal,
}

function EffectParamSlider({
  clip,
  effect,
  param,
  value,
  animatedValue,
  hasKeyframeHere,
  hasAnyKeyframes,
  onChange,
  onCommit,
  onReset,
  onToggleKeyframe,
  onPrevKeyframe,
  onNextKeyframe,
  batchField,
  endGesture,
}) {
  const touchedRef = useRef(false)
  const endGestureRef = useRef(endGesture)
  endGestureRef.current = endGesture
  const isBatch = Boolean(batchField)
  const disabled = Boolean(batchField?.blockedReason)
  const mixed = Boolean(batchField?.mixed)

  useEffect(() => {
    if (!isBatch) return undefined
    const finish = () => {
      if (!touchedRef.current) return
      touchedRef.current = false
      endGestureRef.current?.()
    }
    window.addEventListener('blur', finish)
    return () => { window.removeEventListener('blur', finish); finish() }
  }, [isBatch])

  const finishBatchGesture = (event) => {
    if (!touchedRef.current) return
    touchedRef.current = false
    if (!disabled) onCommit(Number(event.currentTarget.value))
    endGestureRef.current?.()
  }
  const formatValue = (num) => {
    if (param.step != null && param.step < 1) {
      return `${Number(num).toFixed(2)}${param.unit || ''}`
    }
    return `${Math.round(num)}${param.unit || ''}`
  }

  if (param.type === 'toggle') {
    const enabled = !mixed && Number(value) >= 0.5
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-sf-text-secondary flex-1">{param.label}</span>
        {mixed && <span data-effect-value={param.key} className="text-[10px] text-sf-text-muted">Mixed</span>}
        <button
          type="button"
          aria-label={param.label}
          role="checkbox"
          aria-checked={mixed ? 'mixed' : enabled}
          data-effect-param={param.key}
          data-mixed={mixed || undefined}
          disabled={disabled}
          onClick={() => {
            if (disabled) return
            const next = enabled ? 0 : 1
            onChange(next)
            onCommit(next)
            endGestureRef.current?.()
          }}
          className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            enabled ? 'bg-sf-accent' : 'bg-sf-dark-600'
          }`}
          title={batchField?.blockedReason || (mixed ? 'Mixed values. Click to enable on selected clips.' : `Toggle ${param.label}`)}
        >
          <div className={`w-3 h-3 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0.5'
          }`} />
        </button>
        <KeyframeDiamond
          hasKeyframeHere={hasKeyframeHere}
          hasAnyKeyframes={hasAnyKeyframes}
          onToggle={onToggleKeyframe}
          onPrev={onPrevKeyframe}
          onNext={onNextKeyframe}
          disabled={isBatch}
        />
      </div>
    )
  }

  const displayValue = animatedValue != null ? animatedValue : value
  const isAnimated = animatedValue != null && Math.abs(animatedValue - value) > 0.001

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-[10px] text-sf-text-secondary">{param.label}</label>
        <div className="flex items-center gap-1">
          <span data-effect-value={param.key} className={`text-[10px] ${isAnimated ? 'text-sf-accent' : 'text-sf-text-muted'}`}>
            {mixed ? 'Mixed' : formatValue(displayValue)}
          </span>
          <KeyframeDiamond
            hasKeyframeHere={hasKeyframeHere}
            hasAnyKeyframes={hasAnyKeyframes}
            onToggle={onToggleKeyframe}
            onPrev={onPrevKeyframe}
            onNext={onNextKeyframe}
            disabled={isBatch}
          />
        </div>
      </div>
      <input
        type="range"
        aria-label={param.label}
        aria-valuetext={mixed ? 'Mixed' : undefined}
        data-effect-param={param.key}
        data-mixed={mixed || undefined}
        disabled={disabled}
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(e) => {
          if (disabled) return
          if (isBatch) touchedRef.current = true
          onChange(parseFloat(e.target.value))
        }}
        onMouseUp={isBatch ? finishBatchGesture : (e) => onCommit(parseFloat(e.target.value))}
        onPointerUp={isBatch ? finishBatchGesture : undefined}
        onPointerCancel={isBatch ? finishBatchGesture : undefined}
        onLostPointerCapture={isBatch ? finishBatchGesture : undefined}
        onBlur={isBatch ? finishBatchGesture : undefined}
        onKeyUp={isBatch ? finishBatchGesture : (e) => onCommit(parseFloat(e.target.value))}
        onDoubleClick={() => { if (!disabled) onReset() }}
        title={batchField?.blockedReason || (mixed ? 'Mixed values. Adjust to set the same value on selected clips. Double-click to reset.' : 'Double-click to reset to default')}
        className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent disabled:opacity-40 disabled:cursor-not-allowed"
      />
    </div>
  )
}

function KeyframeDiamond({ hasKeyframeHere, hasAnyKeyframes, onToggle, onPrev, onNext, disabled = false }) {
  return (
    <div className="flex items-center gap-0.5">
      {hasAnyKeyframes && (
        <button
          type="button"
          onClick={() => { if (!disabled) onPrev() }}
          disabled={disabled}
          data-effect-keyframe="prev"
          className="p-0.5 rounded text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-600 disabled:opacity-30 disabled:cursor-not-allowed"
          title={disabled ? 'Select one clip to edit keyframes' : 'Previous keyframe'}
        >
          <ChevronUp className="w-2.5 h-2.5 -rotate-90" />
        </button>
      )}
      <button
        type="button"
        onClick={() => { if (!disabled) onToggle() }}
        disabled={disabled}
        data-effect-keyframe="toggle"
        className={`p-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          hasKeyframeHere
            ? 'text-sf-warning'
            : hasAnyKeyframes
              ? 'text-sf-accent'
              : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-600'
        }`}
        title={disabled ? 'Select one clip to edit keyframes' : hasKeyframeHere ? 'Remove keyframe at current time' : 'Add keyframe at current time'}
      >
        <Diamond className="w-3 h-3" fill={hasKeyframeHere ? 'currentColor' : 'none'} />
      </button>
      {hasAnyKeyframes && (
        <button
          type="button"
          onClick={() => { if (!disabled) onNext() }}
          disabled={disabled}
          data-effect-keyframe="next"
          className="p-0.5 rounded text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-600 disabled:opacity-30 disabled:cursor-not-allowed"
          title={disabled ? 'Select one clip to edit keyframes' : 'Next keyframe'}
        >
          <ChevronDown className="w-2.5 h-2.5 -rotate-90" />
        </button>
      )}
    </div>
  )
}

function EffectCard({
  clip,
  effect,
  index,
  totalCount,
  playheadPosition,
  onUpdate,
  onToggle,
  onRemove,
  onReorder,
  onResetEffect,
  onSetKeyframe,
  onRemoveKeyframe,
  onGoToKeyframe,
  batch,
  group,
}) {
  const [expanded, setExpanded] = useState(true)
  const timelineFps = useTimelineStore((state) => state.timelineFps)
  const definition = getEffectTypeDefinition(effect.type)
  const Icon = EFFECT_ICONS[effect.type] || Sparkles
  const clipTime = playheadPosition - (clip?.startTime || 0)
  const normalizedEffect = useMemo(() => normalizeEffectSettings(effect), [effect])
  const animatedEffect = useMemo(() => getAnimatedEffectSettings(clip, effect, clipTime), [clip, effect, clipTime])

  if (!definition) return null

  const fieldFor = (property) => batch
    ? getMultiClipEffectFieldState(batch.selection, group, property, getEffectTypeDefinition)
    : null
  const operationBlock = (keys) => batch
    ? getMultiClipEffectOperationBlock(batch.selection, group, keys, getEffectTypeDefinition)
    : ''
  const enabledField = fieldFor('enabled')
  const enabled = batch ? enabledField.values?.[0] !== false : effect.enabled
  const toggleLabel = enabledField?.mixed ? 'Enable effect on selected clips' : enabled ? 'Disable effect' : 'Enable effect'
  const resetBlock = operationBlock(Object.keys(definition.defaults))
  const removeBlock = operationBlock(null)
  const duplicateLabel = batch && EFFECT_TYPES.some((entry) => entry.id !== effect.type && entry.label === definition.label)
  const displayLabel = `${definition.label}${duplicateLabel ? (effect.type.startsWith('glsl') ? ' (GPU)' : ' (Legacy)') : ''}${group?.repeated ? ` ${group.ordinal + 1}` : ''}`

  const handleParamChange = (paramKey, value) => {
    if (batch) {
      if (!fieldFor(paramKey).blockedReason) batch.apply({ action: 'update', group, settings: { [paramKey]: value } }, true)
      return
    }
    const nextSettings = { ...normalizedEffect.settings, [paramKey]: value }
    onUpdate(effect.id, { settings: nextSettings }, false)
  }
  const handleParamCommit = (paramKey, value) => {
    if (batch) {
      if (!fieldFor(paramKey).blockedReason) batch.apply({ action: 'update', group, settings: { [paramKey]: value } })
      batch.endGesture()
      return
    }
    const nextSettings = { ...normalizedEffect.settings, [paramKey]: value }
    onUpdate(effect.id, { settings: nextSettings }, true)
  }
  const handleParamReset = (paramKey) => {
    if (batch) {
      if (!fieldFor(paramKey).blockedReason) batch.apply({ action: 'update', group, settings: { [paramKey]: definition.defaults[paramKey] } })
      return
    }
    const nextSettings = { ...normalizedEffect.settings, [paramKey]: definition.defaults[paramKey] }
    onUpdate(effect.id, { settings: nextSettings }, true)
  }

  const handlePresetSelect = (preset) => {
    if (batch) {
      if (!operationBlock(Object.keys(preset.settings))) batch.apply({ action: 'update', group, settings: { ...preset.settings } })
      return
    }
    onUpdate(effect.id, {
      settings: { ...normalizedEffect.settings, ...preset.settings },
    }, true)
  }

  return (
    <div
      data-effect-type={effect.type}
      data-effect-ordinal={group?.ordinal ?? index}
      data-effect-group={group?.key ?? effect.id}
      className={`bg-sf-dark-800 rounded overflow-hidden border ${enabled ? 'border-sf-dark-700' : 'border-sf-dark-800'}`}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 bg-sf-dark-700">
        <button
          type="button"
          data-effect-action="enabled"
          data-mixed={enabledField?.mixed || undefined}
          aria-label={toggleLabel}
          aria-pressed={enabledField?.mixed ? 'mixed' : Boolean(enabled)}
          disabled={Boolean(enabledField?.blockedReason)}
          onClick={() => {
            if (batch) {
              if (!enabledField.blockedReason) batch.apply({ action: 'enabled', group, enabled: enabledField.mixed || !enabled })
              return
            }
            onToggle(effect.id)
          }}
          className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${enabled && !enabledField?.mixed ? 'text-sf-accent' : 'text-sf-text-muted'}`}
          title={enabledField?.blockedReason || (enabledField?.mixed ? 'Mixed enabled states. Click to enable on selected clips.' : toggleLabel)}
        >
          {enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        </button>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <Icon className="w-3 h-3 flex-shrink-0 text-sf-text-secondary" />
          <span className="text-[11px] text-sf-text-primary">{displayLabel}</span>
        </button>

        <button
          type="button"
          data-effect-action="up"
          aria-label="Move up"
          onClick={() => { if (!batch) onReorder(effect.id, -1) }}
          disabled={Boolean(batch) || index === 0}
          className="p-1 hover:bg-sf-dark-600 rounded text-sf-text-muted hover:text-sf-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={batch ? 'Select one clip to reorder its effects' : 'Move up'}
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          data-effect-action="down"
          aria-label="Move down"
          onClick={() => { if (!batch) onReorder(effect.id, 1) }}
          disabled={Boolean(batch) || index === totalCount - 1}
          className="p-1 hover:bg-sf-dark-600 rounded text-sf-text-muted hover:text-sf-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={batch ? 'Select one clip to reorder its effects' : 'Move down'}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          type="button"
          data-effect-action="reset"
          aria-label="Reset effect to defaults"
          disabled={Boolean(resetBlock)}
          onClick={() => {
            if (batch) {
              if (!resetBlock) batch.apply({ action: 'reset', group })
              return
            }
            onResetEffect(effect.id)
          }}
          className="p-1 hover:bg-sf-dark-600 rounded text-sf-text-muted hover:text-sf-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={resetBlock || 'Reset effect to defaults'}
        >
          <RotateCcw className="w-3 h-3" />
        </button>
        <button
          type="button"
          data-effect-action="remove"
          aria-label="Remove effect"
          disabled={Boolean(removeBlock)}
          onClick={() => {
            if (batch) {
              if (!removeBlock) batch.apply({ action: 'remove', group })
              return
            }
            onRemove(effect.id)
          }}
          className="p-1 hover:bg-sf-dark-600 rounded text-sf-text-muted hover:text-sf-error transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={removeBlock || 'Remove effect'}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {expanded && (
        <div className="p-2 space-y-2">
          {enabledField?.mixed && <p className="text-[10px] text-sf-text-muted" data-effect-enabled-value="mixed">Enabled: Mixed</p>}
          {definition.description && (
            <p className="text-[10px] text-sf-text-muted">{definition.description}</p>
          )}

          {definition.presets && definition.presets.length > 0 && (
            <div>
              <div className="text-[10px] text-sf-text-muted mb-1">Presets</div>
              <div className="flex flex-wrap gap-1">
                {definition.presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-effect-preset={preset.id}
                    disabled={Boolean(operationBlock(Object.keys(preset.settings)))}
                    title={operationBlock(Object.keys(preset.settings)) || undefined}
                    onClick={() => handlePresetSelect(preset)}
                    className="px-2 py-0.5 rounded text-[10px] border border-sf-dark-600 bg-sf-dark-900 text-sf-text-secondary hover:border-sf-accent hover:text-sf-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {definition.params.map((param) => {
            const propertyId = getEffectPropertyId(effect.id, param.key)
            const paramKeyframes = clip?.keyframes?.[propertyId] || []
            const keyframeAtTime = getKeyframeAtTime(paramKeyframes, clipTime, getKeyframeTimeTolerance(timelineFps))
            const hasKeyframeHere = !!keyframeAtTime
            const hasAnyKeyframes = paramKeyframes.length > 0
            const baseValue = normalizedEffect.settings[param.key]
            const liveValue = animatedEffect.settings[param.key]
            const batchField = fieldFor(param.key)

            return (
              <EffectParamSlider
                key={param.key}
                clip={clip}
                effect={effect}
                param={param}
                value={batchField?.values?.[0] ?? baseValue}
                animatedValue={!batch && hasAnyKeyframes ? liveValue : null}
                batchField={batchField}
                endGesture={batch?.endGesture}
                hasKeyframeHere={hasKeyframeHere}
                hasAnyKeyframes={hasAnyKeyframes}
                onChange={(val) => handleParamChange(param.key, val)}
                onCommit={(val) => handleParamCommit(param.key, val)}
                onReset={() => handleParamReset(param.key)}
                onToggleKeyframe={() => {
                  if (batch) return
                  if (hasKeyframeHere) {
                    onRemoveKeyframe(propertyId, clipTime)
                  } else {
                    onSetKeyframe(propertyId, clipTime, liveValue)
                  }
                }}
                onPrevKeyframe={() => onGoToKeyframe(propertyId, 'prev')}
                onNextKeyframe={() => onGoToKeyframe(propertyId, 'next')}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Render the effect stack for a clip, limited to the managed stylistic
 * effect types (camera shake, chromatic aberration, film grain, vignette).
 *
 * Mask effects are managed by the existing Inspector UI so we skip them
 * here to avoid duplicating controls.
 */
export default function EffectsStack({
  clip,
  playheadPosition,
  addEffect,
  removeEffect,
  updateEffect,
  toggleEffect,
  reorderEffect,
  setKeyframe,
  removeKeyframe,
  goToNextKeyframe,
  goToPrevKeyframe,
  batch = null,
}) {
  const [isAddOpen, setIsAddOpen] = useState(false)
  const batchSelectionSignature = batch
    ? `${batch.selection.selected.map((entry) => entry.id).sort().join('|')}:${batch.selection.visual.map((entry) => entry.id).sort().join('|')}`
    : ''
  useEffect(() => { setIsAddOpen(false) }, [batchSelectionSignature])
  const sharedGroups = useMemo(
    () => batch ? getMultiClipEffectGroups(batch.selection, getEffectTypeDefinition) : [],
    [batch?.selection]
  )
  const managedEffects = useMemo(
    () => batch ? sharedGroups.map((group) => group.effect) : (clip?.effects || []).filter((effect) => isManagedEffectType(effect?.type)),
    [clip?.effects, batch, sharedGroups]
  )
  const hasUnsharedEffects = batch?.selection.visual.some((entry) => (
    (Array.isArray(entry.effects) ? entry.effects : []).filter((effect) => isManagedEffectType(effect?.type)).length > sharedGroups.length
  ))

  const handleAdd = useCallback((typeId) => {
    const def = getEffectTypeDefinition(typeId)
    if (!def) return
    if (batch) {
      if (batch.selection.visual.length === 0) return
      batch.apply({ action: 'add', type: typeId })
      setIsAddOpen(false)
      return
    }
    addEffect(clip.id, {
      type: typeId,
      settings: { ...def.defaults },
    })
    setIsAddOpen(false)
  }, [addEffect, clip, batch])

  const handleReset = useCallback((effectId) => {
    if (batch) return
    const effect = managedEffects.find((e) => e.id === effectId)
    if (!effect) return
    const def = getEffectTypeDefinition(effect.type)
    if (!def) return
    updateEffect(clip.id, effectId, { settings: { ...def.defaults } }, true)
  }, [managedEffects, updateEffect, clip, batch])

  const handleReorder = useCallback((effectId, direction) => {
    if (batch) return
    const allEffects = clip?.effects || []
    const fromIndex = allEffects.findIndex((e) => e.id === effectId)
    if (fromIndex === -1) return

    const managedPositions = allEffects
      .map((e, i) => (isManagedEffectType(e?.type) ? i : -1))
      .filter((i) => i !== -1)
    const managedPos = managedPositions.indexOf(fromIndex)
    if (managedPos === -1) return

    const targetManagedPos = managedPos + direction
    if (targetManagedPos < 0 || targetManagedPos >= managedPositions.length) return

    const targetIndex = managedPositions[targetManagedPos]
    const steps = targetIndex - fromIndex
    const stepDir = steps > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(steps); i += 1) {
      reorderEffect(clip.id, effectId, stepDir)
    }
  }, [reorderEffect, clip, batch])

  const handleGoToKeyframe = useCallback((propertyId, direction) => {
    if (batch) return
    if (direction === 'prev') {
      goToPrevKeyframe(clip.id, propertyId)
    } else {
      goToNextKeyframe(clip.id, propertyId)
    }
  }, [clip, goToNextKeyframe, goToPrevKeyframe, batch])

  const handleSetKeyframe = useCallback((propertyId, clipTime, value) => {
    if (batch) return
    setKeyframe(clip.id, propertyId, clipTime, value, 'easeInOut', { saveHistory: true })
  }, [setKeyframe, clip, batch])

  const handleRemoveKeyframe = useCallback((propertyId, clipTime) => {
    if (batch) return
    removeKeyframe(clip.id, propertyId, clipTime, { saveHistory: true })
  }, [removeKeyframe, clip, batch])

  return (
    <div className="space-y-2" data-testid="effects-stack">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-sf-text-muted uppercase tracking-wider">
          Effects{managedEffects.length > 0 ? ` (${managedEffects.length})` : ''}
        </div>
        <div className="relative">
          <button
            type="button"
            data-effect-action="add"
            disabled={Boolean(batch && batch.selection.visual.length === 0)}
            onClick={() => setIsAddOpen((prev) => !prev)}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-sf-dark-600 bg-sf-dark-800 text-[10px] text-sf-text-secondary hover:border-sf-accent hover:text-sf-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus className="w-3 h-3" />
            Add Effect
          </button>
          {isAddOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl min-w-[230px] max-h-80 overflow-y-auto py-1">
              {EFFECT_PICKER_GROUPS.map((group) => (
                <div key={group.id} className="py-1">
                  <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-sf-text-muted">
                    {group.label}
                  </div>
                  {group.effects.map((def) => {
                    const Icon = EFFECT_ICONS[def.id] || Sparkles
                    return (
                      <button
                        key={def.id}
                        type="button"
                        data-effect-add={def.id}
                        onClick={() => handleAdd(def.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-sf-dark-700 transition-colors"
                      >
                        <Icon className="w-3.5 h-3.5 text-sf-text-secondary" />
                        <span className="text-[11px] text-sf-text-primary">{def.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {batch && <p className="text-[10px] text-sf-text-muted" data-testid="shared-effects-note">
        {hasUnsharedEffects
          ? 'Only effects with the same type and count on every editable selected clip appear here. Select one clip to edit unmatched effects; they stay unchanged here.'
          : 'Edit matching effects together. Other effects on each clip stay unchanged.'}
        {sharedGroups.some((group) => group.repeated) && ' Numbered copies match their order within each effect type.'}
      </p>}

      {managedEffects.length === 0 && (
        <div className="text-[10px] text-sf-text-muted italic bg-sf-dark-900/40 border border-dashed border-sf-dark-700 rounded p-3 text-center">
          {batch
            ? batch.selection.visual.length === 0
              ? 'No editable visual clips selected.'
              : 'No shared effects. Add an effect to the selected clips, or select one clip to edit its own stack.'
            : 'No effects on this clip. Add one to get started.'}
        </div>
      )}

      {managedEffects.map((effect, managedIdx) => {
        return (
          <EffectCard
            key={batch ? `${sharedGroups[managedIdx].key}:${sharedGroups[managedIdx].members.map((member) => `${member.clipId}/${member.effectId}`).join('|')}` : effect.id}
            clip={batch ? batch.selection.visual[0] : clip}
            effect={effect}
            batch={batch}
            group={batch ? sharedGroups[managedIdx] : null}
            index={managedIdx}
            totalCount={managedEffects.length}
            playheadPosition={playheadPosition}
            onUpdate={(effectId, updates, saveHistory) => updateEffect(clip.id, effectId, updates, saveHistory)}
            onToggle={(effectId) => toggleEffect(clip.id, effectId)}
            onRemove={(effectId) => removeEffect(clip.id, effectId)}
            onReorder={handleReorder}
            onResetEffect={handleReset}
            onSetKeyframe={handleSetKeyframe}
            onRemoveKeyframe={handleRemoveKeyframe}
            onGoToKeyframe={handleGoToKeyframe}
          />
        )
      })}
    </div>
  )
}
