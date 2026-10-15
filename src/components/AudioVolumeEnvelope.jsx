import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import useTimelineStore from '../stores/timelineStore'
import {
  AUDIO_VOLUME_ENVELOPE_MIN_DB,
  AUDIO_VOLUME_ENVELOPE_MAX_DB,
  getAudioVolumeEnvelopeDb,
  normalizeAudioVolumeEnvelope,
} from '../utils/audioVolumeEnvelope.mjs'

// Selection/mode are transient editor state, never project data or history.
const useEnvelopeEditor = create(() => ({ clipId: null, pointId: null, enabled: false, dragging: false, status: '' }))
export const resetAudioVolumeEnvelopeEditor = () => useEnvelopeEditor.setState({ clipId: null, pointId: null, enabled: false, dragging: false, status: '' })
export const getSingleAudioEnvelopeTarget = (clips, tracks, selectedClipIds) => {
  if (![1, 2].includes(selectedClipIds.length) || new Set(selectedClipIds).size !== selectedClipIds.length) return null
  const selected = selectedClipIds.map(id => clips.find(clip => clip.id === id)).filter(Boolean)
  if (selected.length !== selectedClipIds.length) return null
  const audio = selected.filter(clip => clip.type === 'audio' && tracks.find(track => track.id === clip.trackId)?.type === 'audio')
  if (audio.length !== 1) return null
  if (selected.length === 1) return audio[0]
  const picture = selected.find(clip => clip !== audio[0])
  const group = typeof audio[0].linkGroupId === 'string' ? audio[0].linkGroupId.trim() : ''
  return group && typeof picture.linkGroupId === 'string' && group === picture.linkGroupId.trim()
    && tracks.find(track => track.id === picture.trackId)?.type === 'video' ? audio[0] : null
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const safeFps = (fps) => Number.isFinite(Number(fps)) && Number(fps) > 0 ? Number(fps) : 24
const snapTime = (time, duration, fps) => clamp(Math.round(time * safeFps(fps)) / safeFps(fps), 0, duration)
const formatDb = (db) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
const isUndoRedoKey = event => (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(String(event.key).toLowerCase())
const visiblePoints = (envelope, duration) => envelope.points.filter(point => (
  point.time >= envelope.offsetSeconds - 1e-7 && point.time <= envelope.offsetSeconds + duration + 1e-7
))
const lockReason = (clip, track) => (
  clip?.locked || clip?.syncLocked || clip?.lockMode === 'sync' || clip?.syncLock?.mode === 'sync'
  || track?.locked || track?.syncLocked || track?.lockMode === 'sync' || track?.syncLock?.mode === 'sync'
) ? 'Unlock this clip and its track to edit volume points.' : ''
const selectPoint = (clipId, pointId) => useEnvelopeEditor.setState({ clipId, pointId, status: '' })

const applyEnvelope = (clip, envelope) => {
  const state = useTimelineStore.getState()
  if (getSingleAudioEnvelopeTarget(state.clips, state.tracks, state.selectedClipIds)?.id !== clip.id) {
    useEnvelopeEditor.setState({ clipId: clip.id, status: 'Select one audio clip or its linked picture-and-sound pair before editing volume points.' })
    return false
  }
  const result = state.updateAudioVolumeEnvelope?.(clip.id, envelope, true, clip)
  useEnvelopeEditor.setState({ clipId: clip.id, status: result?.ok ? '' : result?.reason || 'The volume edit could not be applied.' })
  return result?.ok === true
}

const addPoint = (clip, localTime, fps) => {
  const envelope = normalizeAudioVolumeEnvelope(clip.volumeEnvelope)
  const time = envelope.offsetSeconds + snapTime(localTime, clip.duration, fps)
  const existing = envelope.points.find(point => Math.abs(point.time - time) < 1e-7)
  if (existing) { selectPoint(clip.id, existing.id); return }
  const point = {
    id: `volume-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    time,
    db: getAudioVolumeEnvelopeDb(clip, time - envelope.offsetSeconds),
  }
  if (applyEnvelope(clip, { ...envelope, points: [...envelope.points, point].sort((a, b) => a.time - b.time) })) {
    selectPoint(clip.id, point.id)
  }
}

const deletePoint = (clip, pointId) => {
  const envelope = normalizeAudioVolumeEnvelope(clip.volumeEnvelope)
  if (applyEnvelope(clip, { ...envelope, points: envelope.points.filter(point => point.id !== pointId) })) {
    selectPoint(clip.id, null)
  }
}

export default function AudioVolumeEnvelope({ clip, track, width, height, fps }) {
  const editor = useEnvelopeEditor()
  const enabled = editor.clipId === clip.id && editor.enabled && !lockReason(clip, track)
  const svgRef = useRef(null)
  const dragRef = useRef(null)
  const [draft, setDraft] = useState(null)
  const envelope = useMemo(() => normalizeAudioVolumeEnvelope(clip.volumeEnvelope), [clip.volumeEnvelope])
  const shownEnvelope = draft || envelope
  const points = visiblePoints(shownEnvelope, clip.duration)
  const top = Math.min(24, Math.max(4, height - 8))
  const plotHeight = Math.max(4, height - top - 4)
  const dbToY = db => top + (AUDIO_VOLUME_ENVELOPE_MAX_DB - db) / (AUDIO_VOLUME_ENVELOPE_MAX_DB - AUDIO_VOLUME_ENVELOPE_MIN_DB) * plotHeight
  const timeToX = time => time / clip.duration * width
  const shownClip = { ...clip, volumeEnvelope: shownEnvelope }
  const pathPoints = [
    [0, getAudioVolumeEnvelopeDb(shownClip, 0)],
    ...points.map(point => [point.time - shownEnvelope.offsetSeconds, point.db]),
    [clip.duration, getAudioVolumeEnvelopeDb(shownClip, clip.duration)],
  ]
  const path = pathPoints.map(([time, db], index) => `${index ? 'L' : 'M'} ${timeToX(time)} ${dbToY(db)}`).join(' ')

  const cancelDrag = useCallback((unmounting = false) => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag) {
      try { drag.target.releasePointerCapture(drag.pointerId) } catch (_) { /* Capture may already be released. */ }
      useEnvelopeEditor.setState({ dragging: false })
    }
    if (!unmounting) setDraft(null)
  }, [])

  useEffect(() => {
    if (dragRef.current && (!enabled || dragRef.current.clip !== clip)) cancelDrag()
  }, [clip, enabled, cancelDrag])

  useEffect(() => {
    const move = event => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      event.preventDefault()
      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      if (!drag.moved && Math.hypot(deltaX, deltaY) < 3) return
      drag.moved = true
      const index = drag.envelope.points.findIndex(point => point.id === drag.point.id)
      const previous = drag.envelope.points[index - 1]
      const next = drag.envelope.points[index + 1]
      const offset = drag.envelope.offsetSeconds
      const min = Math.max(0, previous ? previous.time - offset + 1 / safeFps(fps) : 0)
      const max = Math.min(clip.duration, next ? next.time - offset - 1 / safeFps(fps) : clip.duration)
      const localTime = drag.point.time - offset + deltaX / drag.rect.width * clip.duration
      const time = Math.abs(deltaX) >= 2 && min <= max ? offset + clamp(snapTime(localTime, clip.duration, fps), min, max) : drag.point.time
      const db = Math.abs(deltaY) < 1 ? drag.point.db : clamp(Math.round((drag.point.db - deltaY / drag.plotHeight
        * (AUDIO_VOLUME_ENVELOPE_MAX_DB - AUDIO_VOLUME_ENVELOPE_MIN_DB)) * 10) / 10,
      AUDIO_VOLUME_ENVELOPE_MIN_DB, AUDIO_VOLUME_ENVELOPE_MAX_DB)
      drag.draft = { ...drag.envelope, points: drag.envelope.points.map(point => point.id === drag.point.id ? { ...point, time, db } : point) }
      setDraft(drag.draft)
    }
    const finish = event => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const nextEnvelope = drag.draft
      cancelDrag()
      applyEnvelope(drag.clip, nextEnvelope)
    }
    const cancel = () => cancelDrag()
    const escape = event => {
      if (!dragRef.current || event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelDrag()
      resetAudioVolumeEnvelopeEditor()
      event.target?.blur?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', escape, true)
      cancelDrag(true)
    }
  }, [clip, fps, cancelDrag])

  const startDrag = (event, point) => {
    if (!enabled || event.button !== 0 || dragRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    selectPoint(clip.id, point.id)
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    dragRef.current = {
      clip, point, envelope, draft: envelope, rect, plotHeight,
      startX: event.clientX, startY: event.clientY,
      pointerId: event.pointerId, target: event.currentTarget,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    useEnvelopeEditor.setState({ dragging: true })
  }

  const handleKeyDown = event => {
    if (isUndoRedoKey(event) && !dragRef.current) return
    event.stopPropagation()
    if (isUndoRedoKey(event)) { event.preventDefault(); cancelDrag(); return }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelDrag()
      resetAudioVolumeEnvelopeEditor()
      event.target?.blur?.()
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && editor.pointId) {
      event.preventDefault()
      if (!dragRef.current) deletePoint(clip, editor.pointId)
    }
  }

  return <svg
    ref={svgRef}
    data-testid="audio-envelope-overlay"
    data-audio-envelope-editor="true"
    aria-label="Audio volume envelope"
    viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
    className={`absolute inset-0 h-full w-full overflow-hidden ${enabled ? 'z-[25]' : 'z-[15]'}`}
    style={{ pointerEvents: 'none' }}
    onMouseDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
    onKeyDown={handleKeyDown}
    onKeyUp={event => event.stopPropagation()}
  >
    <path d={path} fill="none" stroke="#fde68a" strokeWidth={1.5} opacity={enabled ? 1 : 0.6} vectorEffect="non-scaling-stroke" />
    <path data-testid="audio-envelope-line" d={path} fill="none" stroke="transparent" strokeWidth={10}
      style={{ pointerEvents: enabled ? 'stroke' : 'none', cursor: 'crosshair' }}
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => {
        event.preventDefault(); event.stopPropagation()
        const rect = svgRef.current?.getBoundingClientRect()
        if (enabled && rect?.width) addPoint(clip, (event.clientX - rect.left) / rect.width * clip.duration, fps)
      }}>
      <title>{enabled ? 'Double-click to add a volume point' : 'Volume envelope — enable point editing in the Inspector'}</title>
    </path>
    {points.map(point => <circle key={point.id}
      data-testid="audio-envelope-point" data-envelope-point-id={point.id}
      cx={timeToX(point.time - shownEnvelope.offsetSeconds)} cy={dbToY(point.db)}
      r={enabled ? 4 : 2} fill={editor.pointId === point.id && enabled ? '#ffffff' : '#fde68a'} stroke="#292524" strokeWidth={1}
      role="button" tabIndex={enabled ? 0 : -1}
      aria-label={`Volume point at ${(point.time - shownEnvelope.offsetSeconds).toFixed(3)} seconds, ${formatDb(point.db)}`}
      aria-pressed={editor.pointId === point.id && enabled}
      style={{ pointerEvents: enabled ? 'all' : 'none', cursor: 'move' }}
      onFocus={() => { if (enabled) selectPoint(clip.id, point.id) }}
      onPointerDown={event => startDrag(event, point)}
      onLostPointerCapture={() => { if (dragRef.current) cancelDrag() }}
    ><title>{formatDb(point.db)} · {(point.time - shownEnvelope.offsetSeconds).toFixed(3)}s</title></circle>)}
  </svg>
}

export function AudioVolumeEnvelopeInspector({ clip, track, fps }) {
  const editor = useEnvelopeEditor()
  const playheadPosition = useTimelineStore(state => state.playheadPosition)
  const playheadInClip = Number.isFinite(playheadPosition) && playheadPosition >= clip.startTime - 1e-7
    && playheadPosition <= clip.startTime + clip.duration + 1e-7
  const fieldSession = useRef(null)
  const envelope = useMemo(() => normalizeAudioVolumeEnvelope(clip.volumeEnvelope), [clip.volumeEnvelope])
  const visible = visiblePoints(envelope, clip.duration)
  const point = editor.clipId === clip.id ? visible.find(candidate => candidate.id === editor.pointId) : null
  const enabled = editor.clipId === clip.id && editor.enabled
  const reason = lockReason(clip, track)
  const [timeInput, setTimeInput] = useState('')
  const [dbInput, setDbInput] = useState('')

  useEffect(() => {
    fieldSession.current = null
    setTimeInput(point ? String(Number((point.time - envelope.offsetSeconds).toFixed(6))) : '')
    setDbInput(point ? String(point.db) : '')
  }, [clip, point?.id, point?.time, point?.db, envelope.offsetSeconds])

  const commitField = field => {
    const session = fieldSession.current
    fieldSession.current = null
    if (!session?.changed || session.clip !== clip || session.pointId !== point?.id || !point) return
    const raw = field === 'time' ? timeInput : dbInput
    const value = raw.trim() === '' ? NaN : Number(raw)
    const localTime = field === 'time' ? value : point.time - envelope.offsetSeconds
    const db = field === 'db' ? value : point.db
    if (!Number.isFinite(value) || localTime < 0 || localTime > clip.duration || db < AUDIO_VOLUME_ENVELOPE_MIN_DB || db > AUDIO_VOLUME_ENVELOPE_MAX_DB) {
      useEnvelopeEditor.setState({ status: `Use a time inside this clip and a level from ${AUDIO_VOLUME_ENVELOPE_MIN_DB} to +${AUDIO_VOLUME_ENVELOPE_MAX_DB} dB.` })
      return
    }
    const time = field === 'time' ? envelope.offsetSeconds + snapTime(localTime, clip.duration, fps) : point.time
    if (envelope.points.some(candidate => candidate.id !== point.id && Math.abs(candidate.time - time) < 1e-7)) {
      useEnvelopeEditor.setState({ status: 'A volume point already exists at this time. Choose another frame.' })
      return
    }
    const next = { ...envelope, points: envelope.points.map(candidate => candidate.id === point.id ? { ...candidate, time, db } : candidate).sort((a, b) => a.time - b.time) }
    if (applyEnvelope(session.clip, next)) {
      setTimeInput(String(Number((time - envelope.offsetSeconds).toFixed(6))))
      setDbInput(String(db))
    }
  }

  const onFieldKeyDown = event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      fieldSession.current = null
      setTimeInput(point ? String(Number((point.time - envelope.offsetSeconds).toFixed(6))) : '')
      setDbInput(point ? String(point.db) : '')
      event.currentTarget.blur()
    }
  }

  return <section data-testid="audio-envelope-inspector" data-audio-envelope-editor="true"
    className="space-y-2 border-b border-sf-dark-700 p-3"
    onKeyDown={event => {
      if (isUndoRedoKey(event) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); fieldSession.current = null; resetAudioVolumeEnvelopeEditor(); event.target?.blur?.() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !['INPUT', 'TEXTAREA'].includes(event.target.tagName) && point && !reason && !editor.dragging) {
        event.preventDefault(); deletePoint(clip, point.id)
      }
    }}
    onKeyUp={event => event.stopPropagation()}
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-[10px] uppercase tracking-wider text-sf-text-muted">Volume envelope</h4>
      <button type="button" data-testid="audio-envelope-clear" disabled={!envelope.points.length || Boolean(reason) || editor.dragging}
        className="text-[10px] text-sf-text-secondary hover:text-sf-text-primary disabled:opacity-40"
        onClick={() => { if (applyEnvelope(clip, { version: 1, offsetSeconds: 0, points: [] })) selectPoint(clip.id, null) }}>Clear envelope</button>
    </div>
    <button type="button" data-testid="audio-envelope-edit" aria-pressed={enabled} disabled={Boolean(reason)}
      className={`rounded border px-2 py-1 text-[11px] disabled:opacity-40 ${enabled ? 'border-sf-accent bg-sf-accent/15 text-sf-accent' : 'border-sf-dark-600 text-sf-text-secondary hover:bg-sf-dark-700'}`}
      onClick={event => {
        if (enabled) { resetAudioVolumeEnvelopeEditor(); event.currentTarget.blur() }
        else useEnvelopeEditor.setState({ clipId: clip.id, pointId: visible[0]?.id || null, enabled: true, status: '' })
      }}>
      {enabled ? 'Done editing points' : 'Edit points on timeline'}
    </button>
    <p className="text-[10px] leading-relaxed text-sf-text-muted">
      Double-click the line to add; drag points to shape volume. Changes apply on release. Levels are relative to Clip Gain; fades stay separate.
    </p>
    {enabled && <>
      <button type="button" data-testid="audio-envelope-add" disabled={Boolean(reason) || editor.dragging || !playheadInClip}
        title={playheadInClip ? 'Add a volume point at the timeline playhead' : 'Move the playhead inside this clip first'}
        className="rounded border border-sf-dark-600 px-2 py-1 text-[10px] text-sf-text-secondary hover:bg-sf-dark-700 disabled:opacity-40"
        onClick={() => {
          const localTime = useTimelineStore.getState().playheadPosition - clip.startTime
          if (localTime >= 0 && localTime <= clip.duration) addPoint(clip, localTime, fps)
        }}>Add point at playhead</button>
      {!playheadInClip && <p className="text-[10px] text-sf-text-muted">Move the playhead inside this clip to add a point.</p>}
      {point ? <>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <label className="min-w-0 text-[10px] text-sf-text-muted">Time in clip (s)
            <input data-testid="audio-envelope-time" aria-label="Volume point time in clip (seconds)" type="number" min="0" max={clip.duration} step={1 / safeFps(fps)}
              value={timeInput} disabled={Boolean(reason) || editor.dragging}
              onFocus={() => { fieldSession.current = { clip, pointId: point.id, initialValue: timeInput, changed: false } }}
              onChange={event => {
                if (fieldSession.current) fieldSession.current.changed = event.target.value !== fieldSession.current.initialValue
                setTimeInput(event.target.value)
              }}
              onBlur={() => commitField('time')} onKeyDown={onFieldKeyDown}
              className="mt-1 w-full min-w-0 rounded border border-sf-dark-600 bg-sf-dark-700 px-2 py-1 text-xs text-sf-text-primary" />
          </label>
          <label className="min-w-0 text-[10px] text-sf-text-muted">Level (dB)
            <input data-testid="audio-envelope-db" aria-label="Volume point level (dB)" type="number" min={AUDIO_VOLUME_ENVELOPE_MIN_DB} max={AUDIO_VOLUME_ENVELOPE_MAX_DB} step="0.1"
              value={dbInput} disabled={Boolean(reason) || editor.dragging}
              onFocus={() => { fieldSession.current = { clip, pointId: point.id, initialValue: dbInput, changed: false } }}
              onChange={event => {
                if (fieldSession.current) fieldSession.current.changed = event.target.value !== fieldSession.current.initialValue
                setDbInput(event.target.value)
              }}
              onBlur={() => commitField('db')} onKeyDown={onFieldKeyDown}
              className="mt-1 w-full min-w-0 rounded border border-sf-dark-600 bg-sf-dark-700 px-2 py-1 text-xs text-sf-text-primary" />
          </label>
        </div>
        <button type="button" data-testid="audio-envelope-delete" disabled={Boolean(reason) || editor.dragging}
          className="text-[10px] text-sf-text-secondary hover:text-sf-error disabled:opacity-40"
          onClick={() => deletePoint(clip, point.id)}>Delete point</button>
      </> : <p className="text-[10px] text-sf-text-muted">Select a point to edit its exact time and level.</p>}
    </>}
    {envelope.points.length > visible.length && <p className="text-[10px] text-sf-text-muted">{envelope.points.length - visible.length} point(s) outside the current trim are preserved.</p>}
    <p data-testid="audio-envelope-status" role="status" aria-live="polite" className="break-words text-[10px] text-sf-error">{reason || (editor.clipId === clip.id ? editor.status : '')}</p>
  </section>
}
