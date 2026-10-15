import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Crop, ImagePlus, Lock, Plus, Shirt, Tag, Trash2, Unlock, UserRound, Users, X } from 'lucide-react'
import useProjectStore from '../../stores/projectStore'
import useAssetsStore from '../../stores/assetsStore'
import useTimelineStore from '../../stores/timelineStore'
import useCastLockerStore from '../../stores/castLockerStore'
import { importAsset } from '../../services/fileSystem'
import { CAST_ANGLES, createCastId, normalizeClipCastTags, normalizeSceneKey } from '../../types/cast.js'
import { useI18n } from '../../i18n/I18nContext'

const ANCHOR_OUTPUT_SIZE = 1024
const inputClass = 'w-full rounded-md border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-1.5 text-xs text-sf-text-primary placeholder:text-sf-text-muted focus:border-sf-accent-muted focus:outline-none'
const labelClass = 'mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-sf-text-muted'
const ghostButton = 'inline-flex items-center gap-1.5 rounded-md border border-sf-dark-500 bg-sf-dark-800 px-2.5 py-1 text-[11px] text-sf-text-secondary transition-colors hover:border-sf-dark-400 hover:text-sf-text-primary disabled:opacity-50'

/**
 * Text field that edits a local draft and commits on blur or Enter. Saving
 * every keystroke would run the registry normalizer, which trims spaces and
 * drops members whose name is momentarily empty.
 */
function CommitField({ value, onCommit, multiline = false, required = false, className = inputClass, ...rest }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (required && !String(draft).trim()) {
      setDraft(value)
      return
    }
    if (draft !== value) onCommit(draft)
  }
  const shared = {
    ...rest,
    className,
    value: draft,
    onChange: (event) => setDraft(event.target.value),
    onBlur: commit,
  }
  return multiline
    ? <textarea {...shared} />
    : <input {...shared} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
}

function assetUrl(asset) {
  return asset?.thumbnailUrl || asset?.url || null
}

function useProjectKey() {
  const handle = useProjectStore((state) => state.currentProjectHandle)
  const name = useProjectStore((state) => state.currentProject?.name)
  return typeof handle === 'string' ? handle : (name || null)
}

/** Import a File as a project image asset and return the new asset. */
async function importImageFile(file) {
  const { currentProjectHandle } = useProjectStore.getState()
  if (!currentProjectHandle) throw new Error('Open a saved project first.')
  const assetInfo = await importAsset(currentProjectHandle, file, 'images')
  return useAssetsStore.getState().addAsset({
    ...assetInfo,
    url: assetInfo.url || URL.createObjectURL(file),
    settings: { ...(assetInfo.settings || {}) },
  })
}

/**
 * Square crop for identity anchors. Reference-edit models copy whatever is
 * visible, so a tight head-and-shoulders crop keeps clothing out of identity.
 */
function CropDialog({ file, onCancel, onConfirm }) {
  const { t } = useI18n()
  const [url] = useState(() => URL.createObjectURL(file))
  const [natural, setNatural] = useState(null)
  const [crop, setCrop] = useState({ x: 0.5, y: 0.4, size: 0.6 }) // center + side, as fractions of the short edge
  const [busy, setBusy] = useState(false)
  const frameRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => () => URL.revokeObjectURL(url), [url])

  const shortEdge = natural ? Math.min(natural.w, natural.h) : 1
  const sidePx = crop.size * shortEdge
  const clampCenter = (next) => {
    if (!natural) return next
    const half = sidePx / 2
    return {
      ...next,
      x: Math.min(Math.max(next.x, half / natural.w), 1 - half / natural.w),
      y: Math.min(Math.max(next.y, half / natural.h), 1 - half / natural.h),
    }
  }

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: crop }
  }
  const onPointerMove = (event) => {
    const drag = dragRef.current
    const frame = frameRef.current?.getBoundingClientRect()
    if (!drag || !frame) return
    setCrop(clampCenter({
      ...drag.origin,
      x: drag.origin.x + (event.clientX - drag.startX) / frame.width,
      y: drag.origin.y + (event.clientY - drag.startY) / frame.height,
    }))
  }

  const confirm = async () => {
    if (!natural) return
    setBusy(true)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = ANCHOR_OUTPUT_SIZE
      canvas.height = ANCHOR_OUTPUT_SIZE
      canvas.getContext('2d').drawImage(
        image,
        crop.x * natural.w - sidePx / 2,
        crop.y * natural.h - sidePx / 2,
        sidePx,
        sidePx,
        0,
        0,
        ANCHOR_OUTPUT_SIZE,
        ANCHOR_OUTPUT_SIZE,
      )
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      const base = file.name.replace(/\.[^.]+$/, '') || 'anchor'
      await onConfirm(new File([blob], `${base}_anchor.png`, { type: 'image/png' }))
    } finally {
      setBusy(false)
    }
  }

  const box = natural ? {
    left: `${(crop.x - sidePx / natural.w / 2) * 100}%`,
    top: `${(crop.y - sidePx / natural.h / 2) * 100}%`,
    width: `${(sidePx / natural.w) * 100}%`,
    height: `${(sidePx / natural.h) * 100}%`,
  } : null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-4 shadow-2xl">
        <div className="mb-1 font-display text-sm font-bold text-sf-text-primary">{t('castLocker.crop.title')}</div>
        <div className="mb-3 text-xs text-sf-text-muted">{t('castLocker.crop.help')}</div>
        <div ref={frameRef} className="relative mx-auto w-fit select-none overflow-hidden rounded-md bg-black">
          <img
            src={url}
            alt=""
            draggable={false}
            className="block max-h-[52vh] max-w-full"
            onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
          />
          {box && (
            <div
              className="absolute cursor-move border-2 border-sf-accent shadow-[0_0_0_9999px_rgba(22,20,15,0.6)]"
              style={box}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => { dragRef.current = null }}
            />
          )}
        </div>
        <label className="mt-3 flex items-center gap-3 text-[11px] text-sf-text-secondary">
          {t('castLocker.crop.size')}
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.01"
            value={crop.size}
            onChange={(event) => setCrop((prev) => clampCenter({ ...prev, size: Number(event.target.value) }))}
            className="flex-1 accent-[rgb(var(--sf-accent))]"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onCancel} disabled={busy}>{t('common.cancel', undefined, 'Cancel')}</button>
          <button
            type="button"
            onClick={confirm}
            disabled={!natural || busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-sf-accent px-3 py-1 text-[11px] font-semibold text-sf-accent-on hover:bg-sf-accent-hover disabled:opacity-50"
          >
            <Crop className="h-3 w-3" />
            {t('castLocker.crop.use')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Pick an existing project image, or upload (optionally cropping) a new one. */
function ImageSlot({ label, assetId, crop = false, onChange, compact = false, stacked = false }) {
  const { t } = useI18n()
  const assets = useAssetsStore((state) => state.assets)
  const imageAssets = useMemo(() => assets.filter((asset) => asset.type === 'image'), [assets])
  const asset = imageAssets.find((item) => item.id === assetId) || null
  const fileInputRef = useRef(null)
  const [pendingFile, setPendingFile] = useState(null)
  const [error, setError] = useState('')

  const importAndSet = async (file) => {
    setError('')
    try {
      const created = await importImageFile(file)
      onChange(created?.id || null)
    } catch (importError) {
      setError(importError?.message || String(importError))
    }
  }

  const size = stacked ? 'aspect-square w-full' : compact ? 'h-16 w-16' : 'h-24 w-24'
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className={stacked ? 'flex flex-col gap-1.5' : 'flex items-start gap-2'}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`${size} shrink-0 overflow-hidden rounded-lg border border-dashed border-sf-dark-500 bg-sf-dark-900 text-sf-text-muted transition-colors hover:border-sf-accent-muted hover:text-sf-text-primary`}
          title={t('castLocker.upload')}
        >
          {assetUrl(asset)
            ? <img src={assetUrl(asset)} alt="" className="h-full w-full object-cover" />
            : <ImagePlus className="mx-auto h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <select
            value={asset ? asset.id : ''}
            onChange={(event) => onChange(event.target.value || null)}
            className={inputClass}
          >
            <option value="">{t('castLocker.pickAsset')}</option>
            {imageAssets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {asset && (
            <button type="button" className="text-[10px] text-sf-text-muted hover:text-sf-error" onClick={() => onChange(null)}>
              {t('castLocker.clear')}
            </button>
          )}
          {error && <div className="text-[10px] text-sf-error">{error}</div>}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (crop) setPendingFile(file)
          else importAndSet(file)
        }}
      />
      {pendingFile && (
        <CropDialog
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onConfirm={async (cropped) => {
            await importAndSet(cropped)
            setPendingFile(null)
          }}
        />
      )}
    </div>
  )
}

function MemberEditor({ member, update, remove }) {
  const { t } = useI18n()
  const [sceneDraft, setSceneDraft] = useState('')
  const [sceneWardrobeDraft, setSceneWardrobeDraft] = useState('')

  const setWardrobe = (wardrobeId, patch) => update((draft) => {
    draft.wardrobes = draft.wardrobes.map((item) => (item.id === wardrobeId ? { ...item, ...patch } : item))
  })

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={labelClass}>{t('castLocker.name')}</span>
          <CommitField required value={member.name} onCommit={(name) => update((draft) => { draft.name = name })} />
        </label>
        <label>
          <span className={labelClass}>{t('castLocker.aliases')}</span>
          <CommitField
            value={member.aliases.join(', ')}
            placeholder={t('castLocker.aliasesPlaceholder')}
            onCommit={(text) => update((draft) => { draft.aliases = text.split(',').map((alias) => alias.trim()).filter(Boolean) })}
          />
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>{t('castLocker.identityNotes')}</span>
        <CommitField
          multiline
          className={`${inputClass} min-h-[52px] resize-y`}
          value={member.identityNotes}
          placeholder={t('castLocker.identityPlaceholder')}
          onCommit={(notes) => update((draft) => { draft.identityNotes = notes })}
        />
      </label>

      <section>
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-sf-text-primary"><UserRound className="h-3.5 w-3.5 text-sf-accent" />{t('castLocker.anchors.title')}</div>
        <p className="mb-3 text-[11px] leading-relaxed text-sf-text-muted">{t('castLocker.anchors.help')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {CAST_ANGLES.map((angle) => (
            <ImageSlot
              key={angle}
              label={t(`castLocker.angles.${angle}`)}
              assetId={member.anchors[angle]}
              crop
              stacked
              onChange={(assetId) => update((draft) => { draft.anchors = { ...draft.anchors, [angle]: assetId } })}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-sf-text-primary"><Shirt className="h-3.5 w-3.5 text-sf-accent" />{t('castLocker.wardrobe.title')}</div>
          <button
            type="button"
            className={ghostButton}
            onClick={() => update((draft) => {
              const wardrobe = { id: createCastId('ward'), name: t('castLocker.wardrobe.newName', { n: draft.wardrobes.length + 1 }), keywords: '', referenceAssetId: null }
              draft.wardrobes = [...draft.wardrobes, wardrobe]
              if (!draft.defaultWardrobeId) draft.defaultWardrobeId = wardrobe.id
            })}
          >
            <Plus className="h-3 w-3" />{t('castLocker.wardrobe.add')}
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-sf-text-muted">{t('castLocker.wardrobe.help')}</p>
        <div className="space-y-3">
          {member.wardrobes.map((wardrobe) => (
            <div key={wardrobe.id} className="rounded-lg border border-sf-dark-700 bg-sf-dark-900 p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <CommitField required value={wardrobe.name} onCommit={(name) => setWardrobe(wardrobe.id, { name })} />
                  <CommitField
                    multiline
                    className={`${inputClass} min-h-[44px] resize-y`}
                    value={wardrobe.keywords}
                    placeholder={t('castLocker.wardrobe.keywordsPlaceholder')}
                    onCommit={(keywords) => setWardrobe(wardrobe.id, { keywords })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={ghostButton}
                      disabled={member.defaultWardrobeId === wardrobe.id}
                      onClick={() => update((draft) => { draft.defaultWardrobeId = wardrobe.id })}
                    >
                      {member.defaultWardrobeId === wardrobe.id ? <><Check className="h-3 w-3" />{t('castLocker.wardrobe.isDefault')}</> : t('castLocker.wardrobe.makeDefault')}
                    </button>
                    <button
                      type="button"
                      className={`${ghostButton} hover:!text-sf-error`}
                      onClick={() => update((draft) => {
                        draft.wardrobes = draft.wardrobes.filter((item) => item.id !== wardrobe.id)
                        if (draft.defaultWardrobeId === wardrobe.id) draft.defaultWardrobeId = draft.wardrobes[0]?.id || null
                        draft.sceneWardrobes = Object.fromEntries(Object.entries(draft.sceneWardrobes).filter(([, id]) => id !== wardrobe.id))
                      })}
                    >
                      <Trash2 className="h-3 w-3" />{t('castLocker.remove')}
                    </button>
                  </div>
                </div>
                <ImageSlot compact label={t('castLocker.wardrobe.reference')} assetId={wardrobe.referenceAssetId} onChange={(assetId) => setWardrobe(wardrobe.id, { referenceAssetId: assetId })} />
              </div>
            </div>
          ))}
        </div>

        {member.wardrobes.length > 0 && (
          <div className="mt-3">
            <span className={labelClass}>{t('castLocker.wardrobe.perScene')}</span>
            <div className="space-y-1.5">
              {Object.entries(member.sceneWardrobes).map(([scene, wardrobeId]) => (
                <div key={scene} className="flex items-center gap-2 text-[11px] text-sf-text-secondary">
                  <span className="min-w-0 flex-1 truncate">{scene}</span>
                  <span className="text-sf-text-muted">→</span>
                  <span className="min-w-0 flex-1 truncate">{member.wardrobes.find((item) => item.id === wardrobeId)?.name}</span>
                  <button type="button" className="text-sf-text-muted hover:text-sf-error" aria-label={t('castLocker.remove')}
                    onClick={() => update((draft) => { const next = { ...draft.sceneWardrobes }; delete next[scene]; draft.sceneWardrobes = next })}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input className={inputClass} value={sceneDraft} placeholder={t('castLocker.wardrobe.scenePlaceholder')} onChange={(event) => setSceneDraft(event.target.value)} />
                <select className={inputClass} value={sceneWardrobeDraft} onChange={(event) => setSceneWardrobeDraft(event.target.value)}>
                  <option value="">{t('castLocker.wardrobe.pickOutfit')}</option>
                  {member.wardrobes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button
                  type="button"
                  className={ghostButton}
                  disabled={!normalizeSceneKey(sceneDraft) || !sceneWardrobeDraft}
                  onClick={() => {
                    update((draft) => { draft.sceneWardrobes = { ...draft.sceneWardrobes, [normalizeSceneKey(sceneDraft)]: sceneWardrobeDraft } })
                    setSceneDraft('')
                    setSceneWardrobeDraft('')
                  }}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <button type="button" className={`${ghostButton} hover:!text-sf-error`} onClick={remove}>
        <Trash2 className="h-3 w-3" />{t('castLocker.removeMember')}
      </button>
    </div>
  )
}

function ShotTagging({ members }) {
  const { t } = useI18n()
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds)
  const clips = useTimelineStore((state) => state.clips)
  const setClipCast = useTimelineStore((state) => state.setClipCast)
  const selected = useMemo(() => clips.filter((clip) => selectedClipIds?.includes(clip.id)), [clips, selectedClipIds])
  const currentTags = useMemo(() => normalizeClipCastTags(selected[0]?.cast), [selected])
  const [message, setMessage] = useState('')

  if (members.length === 0) return null
  const toggle = (castId) => {
    const has = currentTags.some((tag) => tag.castId === castId)
    const next = has
      ? currentTags.filter((tag) => tag.castId !== castId)
      : [...currentTags, { castId, wardrobeId: members.find((member) => member.id === castId)?.defaultWardrobeId || null }]
    const result = setClipCast(selected.map((clip) => clip.id), next)
    setMessage(result.ok ? t('castLocker.tags.saved', { count: result.count }) : result.reason)
  }
  const setOutfit = (castId, wardrobeId) => {
    const next = currentTags.map((tag) => (tag.castId === castId ? { ...tag, wardrobeId: wardrobeId || null } : tag))
    setClipCast(selected.map((clip) => clip.id), next)
  }

  return (
    <section className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-sf-text-primary"><Tag className="h-3.5 w-3.5 text-sf-accent" />{t('castLocker.tags.title')}</div>
      {selected.length === 0 ? (
        <p className="text-[11px] text-sf-text-muted">{t('castLocker.tags.selectClips')}</p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-sf-text-muted">{t('castLocker.tags.help', { count: selected.length })}</p>
          <div className="space-y-1.5">
            {members.map((member) => {
              const tag = currentTags.find((item) => item.castId === member.id)
              return (
                <div key={member.id} className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs text-sf-text-secondary">
                    <input type="checkbox" checked={Boolean(tag)} onChange={() => toggle(member.id)} className="accent-[rgb(var(--sf-accent))]" />
                    <span className="truncate">{member.name}</span>
                  </label>
                  {tag && member.wardrobes.length > 0 && (
                    <select className={`${inputClass} w-40`} value={tag.wardrobeId || ''} onChange={(event) => setOutfit(member.id, event.target.value)}>
                      {member.wardrobes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
          {message && <div className="mt-2 text-[10px] text-sf-text-muted">{message}</div>}
        </>
      )}
    </section>
  )
}

export default function CastLockerDrawer() {
  const { t } = useI18n()
  const open = useCastLockerStore((state) => state.open)
  const focusCastId = useCastLockerStore((state) => state.focusCastId)
  const closeDrawer = useCastLockerStore((state) => state.closeDrawer)
  const activeLock = useCastLockerStore((state) => state.activeLock)
  const lockProjectKey = useCastLockerStore((state) => state.lockProjectKey)
  const setActiveLock = useCastLockerStore((state) => state.setActiveLock)
  const clearActiveLock = useCastLockerStore((state) => state.clearActiveLock)
  const castData = useProjectStore((state) => state.currentProject?.cast)
  const hasProject = useProjectStore((state) => Boolean(state.currentProject))
  const projectKey = useProjectKey()
  const members = castData?.members || []
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (open) setSelectedId((current) => focusCastId || current || members[0]?.id || null)
  }, [open, focusCastId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const save = (mutate) => {
    const { getCastData, setCastData } = useProjectStore.getState()
    const draft = JSON.parse(JSON.stringify(getCastData()))
    mutate(draft)
    setCastData(draft)
  }
  const selected = members.find((member) => member.id === selectedId) || null
  const lockIsHere = activeLock && lockProjectKey === projectKey
  const lockedMember = lockIsHere ? members.find((member) => member.id === activeLock.castId) : null

  const addMember = () => {
    const id = createCastId('cast')
    save((draft) => {
      draft.members.push({ id, name: t('castLocker.newMember', { n: draft.members.length + 1 }), anchors: {}, wardrobes: [], aliases: [], identityNotes: '', sceneWardrobes: {} })
    })
    setSelectedId(id)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={closeDrawer}>
      <aside
        className="flex h-full w-full max-w-[560px] flex-col border-l border-sf-dark-600 bg-sf-dark-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        aria-label={t('castLocker.title')}
      >
        <header className="flex items-start justify-between gap-3 border-b border-sf-dark-700 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 font-display text-base font-bold text-sf-text-primary"><Users className="h-4 w-4 text-sf-accent" />{t('castLocker.title')}</div>
            <p className="mt-1 text-xs text-sf-text-muted">{t('castLocker.intro')}</p>
          </div>
          <button type="button" onClick={closeDrawer} className="rounded-md p-1.5 text-sf-text-muted hover:bg-sf-dark-800 hover:text-sf-text-primary" aria-label={t('common.close', undefined, 'Close')}>
            <X className="h-4 w-4" />
          </button>
        </header>

        {!hasProject ? (
          <div className="p-5 text-sm text-sf-text-muted">{t('castLocker.noProject')}</div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${member.id === selectedId
                    ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary'
                    : 'border-sf-dark-600 bg-sf-dark-900 text-sf-text-secondary hover:border-sf-dark-400'}`}
                >
                  {member.name}{lockedMember?.id === member.id ? ' 🔒' : ''}
                </button>
              ))}
              <button type="button" className={ghostButton} onClick={addMember}><Plus className="h-3 w-3" />{t('castLocker.addMember')}</button>
            </div>

            {members.length === 0 && <p className="text-xs leading-relaxed text-sf-text-muted">{t('castLocker.empty')}</p>}

            {selected && (
              <>
                <section className="flex flex-wrap items-center gap-2 rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-3">
                  <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-sf-text-secondary">
                    {lockedMember?.id === selected.id ? t('castLocker.lock.on', { name: selected.name }) : t('castLocker.lock.help')}
                  </div>
                  {lockedMember?.id === selected.id ? (
                    <button type="button" className={ghostButton} onClick={clearActiveLock}><Unlock className="h-3 w-3" />{t('castLocker.lock.release')}</button>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md bg-sf-accent px-3 py-1 text-[11px] font-semibold text-sf-accent-on hover:bg-sf-accent-hover"
                      onClick={() => setActiveLock({ castId: selected.id, wardrobeId: selected.defaultWardrobeId }, projectKey)}
                    >
                      <Lock className="h-3 w-3" />{t('castLocker.lock.apply')}
                    </button>
                  )}
                </section>

                <MemberEditor
                  key={selected.id}
                  member={selected}
                  update={(mutate) => save((draft) => {
                    const target = draft.members.find((member) => member.id === selected.id)
                    if (target) mutate(target)
                  })}
                  remove={() => {
                    if (lockedMember?.id === selected.id) clearActiveLock()
                    save((draft) => { draft.members = draft.members.filter((member) => member.id !== selected.id) })
                    setSelectedId(null)
                  }}
                />
              </>
            )}

            <ShotTagging members={members} />

            <p className="border-t border-sf-dark-800 pt-3 text-[10px] leading-relaxed text-sf-text-muted">{t('castLocker.consent')}</p>
          </div>
        )}
      </aside>
    </div>
  )
}
