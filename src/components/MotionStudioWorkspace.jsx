import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Clapperboard, Film, Image as ImageIcon, Info, Loader2, Mic, Music2, Plus, Sparkles, Trash2, Volume2, Wand2 } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import { useI18n } from '../i18n/I18nContext'
import { getChatBackendConfig, resolveChatTarget } from '../services/chatBackend'
import { writeEditPlan, writePlan } from '../services/motion/motionOrchestrator'
import { applyMotionSteps } from '../services/motion/motionApply'
import {
  RECIPES,
  RECIPE_BY_ID,
  ROLES,
  STAGES,
  assetDuration,
  assetIdsToRefs,
  buildInventory,
  guessRole,
  newProductionId,
  normalizeBrief,
  normalizeEditPlan,
  quickAssemble,
  refsToAssetIds,
} from '../utils/motion/contracts.mjs'
import { describeSteps, editPlanToSteps } from '../utils/motion/editPlanToSteps.mjs'
import { reviewEditPlan } from '../utils/motion/review.mjs'

const button = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const primary = `${button} bg-sf-accent text-sf-dark-900 hover:brightness-110`
const quiet = `${button} border border-sf-dark-600 text-sf-text-secondary hover:border-sf-dark-500 hover:bg-sf-dark-700 hover:text-sf-text-primary`
const field = 'w-full rounded-md border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-1.5 text-xs text-sf-text-primary placeholder:text-sf-text-muted focus:border-sf-accent focus:outline-none'
const ROLE_ICON = { footage: Film, image: ImageIcon, voice: Mic, music: Music2, sfx: Volume2 }
const fmt = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`
}
const nowIso = () => new Date().toISOString()

/**
 * Motion Studio (docs/PLAN_MOTION_STUDIO.md): pick the elements, answer a few
 * questions, approve the AI's scene plan, then build the edit on a NEW
 * timeline in one step. Plain code applies the plan; the AI never touches
 * the timeline directly.
 */
export default function MotionStudioWorkspace({ onOpenEditor }) {
  const { t } = useI18n()
  const tr = (key, vars, fallback) => t(`motionStudio.${key}`, vars, fallback)
  const hasProject = useProjectStore((state) => Boolean(state.currentProject))
  const motion = useProjectStore((state) => state.currentProject?.motion)
  const setMotionData = useProjectStore((state) => state.setMotionData)
  const assets = useAssetsStore((state) => state.assets)
  const productions = motion?.productions || []
  const [activeId, setActiveId] = useState(() => productions[0]?.id || null)
  const [picking, setPicking] = useState(productions.length === 0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null)
  const [model, setModel] = useState({ label: '', model: '' })

  useEffect(() => {
    let alive = true
    getChatBackendConfig().then((config) => { if (alive) setModel(resolveChatTarget(config)) }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!activeId && productions.length) setActiveId(productions[0].id)
  }, [activeId, productions])

  const production = productions.find((item) => item.id === activeId) || null
  const recipe = production ? RECIPE_BY_ID[production.recipeId] : null
  const mediaAssets = useMemo(() => (assets || []).filter((asset) => ['video', 'audio', 'image'].includes(asset?.type)), [assets])
  const selectedAssets = useMemo(() => {
    if (!production) return []
    const ids = new Set(production.elementIds)
    return mediaAssets.filter((asset) => ids.has(asset.id))
  }, [production, mediaAssets])
  const inventory = useMemo(() => buildInventory(selectedAssets, production?.roles || {}), [selectedAssets, production?.roles])
  const brief = useMemo(() => (recipe ? normalizeBrief({ ...recipe.defaults, ...(production?.answers || {}) }, recipe) : null), [recipe, production?.answers])
  // Saved by asset id; refs are rebuilt from the elements ticked right now.
  const plan = useMemo(() => (production?.plan ? assetIdsToRefs(production.plan, inventory) : null), [production?.plan, inventory])
  const editPlan = useMemo(() => (production?.edit ? normalizeEditPlan(assetIdsToRefs(production.edit, inventory), inventory, brief || {}) : null), [production?.edit, inventory, brief])
  const keep = (value) => refsToAssetIds(value, inventory)
  const built = useMemo(() => { try { return editPlan?.cuts?.length ? editPlanToSteps(editPlan) : null } catch { return null } }, [editPlan])
  const summary = built ? describeSteps(built) : null
  const findings = useMemo(() => (editPlan ? reviewEditPlan(editPlan, { brief, recipe }) : []), [editPlan, brief, recipe])

  const save = (changes) => {
    const next = productions.map((item) => (item.id === activeId ? { ...item, ...changes, updatedAt: nowIso() } : item))
    setMotionData?.({ version: 1, productions: next })
  }
  const run = async (label, fn) => {
    setBusy(label); setError('')
    try { await fn() } catch (err) { setError(err?.message || String(err)) } finally { setBusy(''); setProgress(null) }
  }

  const createProduction = (recipeId) => {
    const r = RECIPE_BY_ID[recipeId]
    const id = newProductionId()
    const elementIds = mediaAssets.map((asset) => asset.id)
    const item = { id, recipeId, title: r.title, createdAt: nowIso(), updatedAt: nowIso(), stage: 'elements', elementIds, roles: {}, answers: {}, plan: null, planApproved: false, edit: null, applied: null }
    setMotionData?.({ version: 1, productions: [item, ...productions] })
    setActiveId(id); setPicking(false); setError('')
  }
  const removeProduction = (id) => {
    setMotionData?.({ version: 1, productions: productions.filter((item) => item.id !== id) })
    if (id === activeId) setActiveId(productions.find((item) => item.id !== id)?.id || null)
  }

  const hasModel = Boolean(model?.model)
  const stageIndex = production ? STAGES.indexOf(production.stage) : 0
  const canReach = (stage) => {
    if (!production) return false
    if (stage === 'elements' || stage === 'brief') return true
    if (stage === 'plan') return inventory.some((item) => item.role === 'footage' || item.role === 'image')
    if (stage === 'edit') return Boolean(production.planApproved || production.edit)
    return Boolean(production.edit)
  }

  const doWritePlan = () => run('plan', async () => {
    const written = await writePlan({ recipe, brief, inventory })
    save({ plan: keep(written), planApproved: false, stage: 'plan' })
  })
  const doQuickAssemble = () => run('quick', async () => {
    save({ edit: keep(quickAssemble(inventory, brief, recipe)), stage: 'edit', planApproved: true })
  })
  const doWriteEdit = () => run('edit', async () => {
    const edit = await writeEditPlan({ recipe, brief, inventory, plan })
    save({ edit: keep(edit), stage: 'edit' })
  })
  const doApply = () => run('apply', async () => {
    const result = await applyMotionSteps(built, { onProgress: setProgress })
    save({ applied: { timelineId: result.timelineId, at: nowIso(), name: built.timelineName }, stage: 'review' })
    if (result.skipped.length) setError(tr('applySkipped', { list: result.skipped.map((s) => s.op).join(', ') }, 'Done. Some optional steps were skipped: {{list}}.'))
  })
  const doRevise = (pace) => run('quick', async () => {
    const answers = { ...(production.answers || {}), pace }
    const nextBrief = normalizeBrief({ ...recipe.defaults, ...answers }, recipe)
    save({ answers, edit: keep(quickAssemble(inventory, nextBrief, recipe)), stage: 'edit' })
  })

  if (!hasProject) {
    return <div className="flex flex-1 items-center justify-center text-sm text-sf-text-muted">{tr('noProject', undefined, 'Open a project to use Motion Studio.')}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 bg-sf-dark-950 text-sf-text-primary" data-testid="motion-studio">
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-sf-dark-700 bg-sf-dark-900">
        <div className="flex items-center justify-between gap-2 border-b border-sf-dark-700 px-3 py-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 font-display text-sm font-semibold"><Clapperboard className="h-4 w-4 text-sf-accent" />{tr('title', undefined, 'Motion Studio')}</h1>
            <p className="mt-0.5 text-[11px] text-sf-text-muted">{tr('tagline', undefined, 'AI plans the edit; you approve it.')}</p>
          </div>
          <button type="button" className={quiet} onClick={() => setPicking(true)} data-testid="motion-new" title={tr('newProduction', undefined, 'New production')}><Plus className="h-3.5 w-3.5" /></button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {productions.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => { setActiveId(item.id); setPicking(false) }} data-testid="motion-production"
                className={`group flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left ${item.id === activeId && !picking ? 'bg-sf-dark-700' : 'hover:bg-sf-dark-800'}`}>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{item.title}</span>
                  <span className="block truncate text-[10px] text-sf-text-muted">{RECIPE_BY_ID[item.recipeId]?.title} · {tr(`stages.${item.stage}`, undefined, item.stage)}</span>
                </span>
                <span role="button" tabIndex={0} aria-label={tr('delete', undefined, 'Delete')} onClick={(event) => { event.stopPropagation(); removeProduction(item.id) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); removeProduction(item.id) } }}
                  className="rounded p-1 text-sf-text-muted opacity-0 hover:bg-sf-dark-600 hover:text-sf-text-primary group-hover:opacity-100"><Trash2 className="h-3 w-3" /></span>
              </button>
            </li>
          ))}
          {!productions.length && <li className="px-2 py-6 text-center text-[11px] text-sf-text-muted">{tr('empty', undefined, 'No productions yet.')}</li>}
        </ul>
        <div className="border-t border-sf-dark-700 px-3 py-2 text-[10px] text-sf-text-muted">
          {hasModel ? tr('model', { label: model.label, model: model.model }, 'AI: {{label}} · {{model}}') : tr('noModel', undefined, 'No AI model set. Quick assemble still works; for AI plans choose a model in Settings › Agents.')}
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {picking || !production ? (
          <section className="mx-auto max-w-4xl space-y-4 px-6 py-8" data-testid="motion-recipes">
            <div>
              <h2 className="font-display text-xl font-semibold">{tr('pickRecipe', undefined, 'What are you making?')}</h2>
              <p className="mt-1 max-w-2xl text-sm text-sf-text-secondary">{tr('pickRecipeHelp', undefined, 'Pick a recipe. Motion Studio uses the media already in this project, writes a scene plan for you to approve, and then builds the edit on a new timeline you can keep editing.')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {RECIPES.map((item) => (
                <button key={item.id} type="button" onClick={() => createProduction(item.id)} data-testid={`motion-recipe-${item.id}`}
                  className="rounded-lg border border-sf-dark-600 bg-sf-dark-800 p-4 text-left transition-colors hover:border-sf-accent/60 hover:bg-sf-dark-700">
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{tr(`recipes.${item.id}.title`, undefined, item.title)}</span><span className="rounded border border-sf-dark-600 px-1.5 py-0.5 font-mono text-[10px] text-sf-text-muted">{item.defaults.aspect}</span></span>
                  <span className="mt-1 block text-xs text-sf-text-secondary">{tr(`recipes.${item.id}.blurb`, undefined, item.blurb)}</span>
                </button>
              ))}
            </div>
            {!mediaAssets.length && <p className="flex items-center gap-2 rounded-md border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-xs text-sf-text-secondary"><Info className="h-3.5 w-3.5 text-sf-accent" />{tr('noMedia', undefined, 'This project has no media yet. Import footage, images, voice or music first, or make some in Generate.')}</p>}
          </section>
        ) : (
          <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
            <header className="flex flex-wrap items-center gap-3">
              <input className="min-w-0 flex-1 bg-transparent font-display text-lg font-semibold outline-none" value={production.title} aria-label={tr('productionTitle', undefined, 'Production name')}
                onChange={(event) => save({ title: event.target.value })} data-testid="motion-title" />
              <span className="text-xs text-sf-text-muted">{tr(`recipes.${recipe.id}.title`, undefined, recipe.title)}</span>
            </header>

            <nav className="flex flex-wrap items-center gap-1" aria-label={tr('stagesLabel', undefined, 'Steps')}>
              {STAGES.map((stage, index) => (
                <button key={stage} type="button" disabled={!canReach(stage)} onClick={() => save({ stage })} data-testid={`motion-stage-${stage}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${production.stage === stage ? 'bg-sf-accent text-sf-dark-900' : index < stageIndex ? 'bg-sf-dark-700 text-sf-text-primary' : 'text-sf-text-secondary hover:bg-sf-dark-800'} disabled:opacity-40`}>
                  <span className="font-mono text-[10px]">{index + 1}</span>{tr(`stages.${stage}`, undefined, stage)}
                  {index < STAGES.length - 1 && <ChevronRight className="ml-1 h-3 w-3 opacity-50" />}
                </button>
              ))}
            </nav>

            {error && <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="alert"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{error}</p>}

            {production.stage === 'elements' && (
              <section className="space-y-3" data-testid="motion-elements">
                <p className="text-sm text-sf-text-secondary">{tr('elementsHelp', undefined, 'Tick the media to use and say what each one is. Audio is guessed as music, voice or sound effect from its name.')}</p>
                <div className="overflow-hidden rounded-lg border border-sf-dark-700">
                  {mediaAssets.map((asset) => {
                    const checked = production.elementIds.includes(asset.id)
                    const role = production.roles[asset.id] || guessRole(asset)
                    const Icon = ROLE_ICON[role] || Film
                    return (
                      <label key={asset.id} className="flex items-center gap-3 border-b border-sf-dark-700 px-3 py-2 text-xs last:border-b-0 hover:bg-sf-dark-900">
                        <input type="checkbox" checked={checked} data-testid="motion-element" onChange={() => save({ elementIds: checked ? production.elementIds.filter((id) => id !== asset.id) : [...production.elementIds, asset.id] })} />
                        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-sf-text-muted" />
                        <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                        <span className="w-14 text-right font-mono text-[10px] text-sf-text-muted">{asset.type === 'image' ? '—' : fmt(assetDuration(asset))}</span>
                        <select className={`${field} w-28`} value={role} aria-label={tr('role', undefined, 'Role')} onChange={(event) => save({ roles: { ...production.roles, [asset.id]: event.target.value } })}
                          disabled={!checked}>
                          {ROLES.filter((r) => (asset.type === 'audio' ? ['voice', 'music', 'sfx'] : asset.type === 'image' ? ['image'] : ['footage']).includes(r)).map((r) => <option key={r} value={r}>{tr(`roles.${r}`, undefined, r)}</option>)}
                        </select>
                      </label>
                    )
                  })}
                  {!mediaAssets.length && <p className="px-3 py-6 text-center text-xs text-sf-text-muted">{tr('noMedia', undefined, 'This project has no media yet.')}</p>}
                </div>
                <div className="flex justify-end"><button type="button" className={primary} onClick={() => save({ stage: 'brief' })} disabled={!production.elementIds.length} data-testid="motion-next">{tr('next', undefined, 'Next')}<ChevronRight className="h-3.5 w-3.5" /></button></div>
              </section>
            )}

            {production.stage === 'brief' && (
              <section className="space-y-3" data-testid="motion-brief">
                <div className="grid gap-3 sm:grid-cols-2">
                  {recipe.questions.map((q) => (
                    <label key={q.id} className={`block text-xs text-sf-text-secondary ${q.kind === 'text' ? 'sm:col-span-2' : ''}`}>{tr(`questions.${recipe.id}.${q.id}`, undefined, q.label)}{q.optional ? ` (${tr('optional', undefined, 'optional')})` : ''}
                      {q.kind === 'choice' ? (
                        <select className={`${field} mt-1`} value={production.answers[q.id] ?? recipe.defaults[q.id] ?? q.options[0]} onChange={(event) => save({ answers: { ...production.answers, [q.id]: event.target.value } })}>
                          {q.options.map((option) => <option key={option} value={option}>{tr(`options.${option}`, undefined, option)}</option>)}
                        </select>
                      ) : (
                        <input className={`${field} mt-1`} type={q.kind === 'number' ? 'number' : 'text'} min={q.min} max={q.max} placeholder={q.placeholder || ''} data-testid={`motion-q-${q.id}`}
                          value={production.answers[q.id] ?? (q.kind === 'number' ? recipe.defaults[q.id] || '' : '')} onChange={(event) => save({ answers: { ...production.answers, [q.id]: event.target.value } })} />
                      )}
                    </label>
                  ))}
                  <label className="block text-xs text-sf-text-secondary">{tr('paceLabel', undefined, 'Pace')}
                    <select className={`${field} mt-1`} value={production.answers.pace || recipe.defaults.pace} onChange={(event) => save({ answers: { ...production.answers, pace: event.target.value } })}>
                      {['calm', 'steady', 'energetic'].map((p) => <option key={p} value={p}>{tr(`pace.${p}`, undefined, p)}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className={quiet} onClick={doQuickAssemble} disabled={Boolean(busy)} data-testid="motion-quick">{busy === 'quick' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}{tr('quickAssemble', undefined, 'Quick assemble (no AI)')}</button>
                  <button type="button" className={primary} onClick={doWritePlan} disabled={Boolean(busy) || !hasModel || !canReach('plan')} data-testid="motion-write-plan">{busy === 'plan' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{tr('writePlan', undefined, 'Write the plan with AI')}</button>
                </div>
              </section>
            )}

            {production.stage === 'plan' && (
              <section className="space-y-3" data-testid="motion-plan">
                {!plan ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sf-dark-700 bg-sf-dark-900 p-4 text-xs text-sf-text-secondary">
                    {tr('planEmpty', undefined, 'No plan yet. The AI writes scenes from your brief and elements; you approve them before anything is built.')}
                    <button type="button" className={primary} onClick={doWritePlan} disabled={Boolean(busy) || !hasModel}>{busy === 'plan' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{tr('writePlan', undefined, 'Write the plan with AI')}</button>
                  </div>
                ) : (
                  <>
                    <div><h3 className="text-sm font-semibold">{plan.title}</h3>{plan.logline && <p className="text-xs text-sf-text-secondary">{plan.logline}</p>}</div>
                    <ol className="grid gap-2 sm:grid-cols-2">
                      {plan.scenes.map((scene, index) => (
                        <li key={scene.id} className="rounded-lg border border-sf-dark-700 bg-sf-dark-900 p-3 text-xs">
                          <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{index + 1}. {scene.title}</span><span className="font-mono text-[10px] text-sf-text-muted">{fmt(scene.seconds)}</span></div>
                          {scene.purpose && <p className="mt-1 text-sf-text-secondary">{scene.purpose}</p>}
                          {scene.overlay && <p className="mt-1 text-[11px] text-sf-text-muted">“{scene.overlay}”</p>}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {scene.shots.map((shot, i) => shot.ref
                              ? <span key={i} className="rounded bg-sf-dark-700 px-1.5 py-0.5 text-[10px]">{inventory.find((item) => item.ref === shot.ref)?.name || shot.ref}</span>
                              : <span key={i} className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-200" title={tr('missingShot', undefined, 'Missing shot: make it in Generate or film it')}>{tr('needs', undefined, 'Needs')}: {shot.need}</span>)}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" className={quiet} onClick={doWritePlan} disabled={Boolean(busy) || !hasModel}>{tr('rewritePlan', undefined, 'Write again')}</button>
                      <button type="button" className={primary} onClick={() => save({ planApproved: true, stage: 'edit' })} data-testid="motion-approve-plan"><Check className="h-3.5 w-3.5" />{tr('approvePlan', undefined, 'Approve plan')}</button>
                    </div>
                  </>
                )}
              </section>
            )}

            {production.stage === 'edit' && (
              <section className="space-y-3" data-testid="motion-edit">
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className={quiet} onClick={doQuickAssemble} disabled={Boolean(busy)}>{busy === 'quick' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}{tr('quickAssemble', undefined, 'Quick assemble (no AI)')}</button>
                  <button type="button" className={quiet} onClick={doWriteEdit} disabled={Boolean(busy) || !hasModel || !plan} data-testid="motion-write-edit">{busy === 'edit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{tr('writeEdit', undefined, 'Build the edit with AI')}</button>
                </div>
                {summary ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="motion-summary">
                      {[[tr('sum.length', undefined, 'Length'), summary.length], [tr('sum.shots', undefined, 'Shots'), summary.shots], [tr('sum.titles', undefined, 'Titles'), summary.titles], [tr('sum.transitions', undefined, 'Transitions'), summary.transitions],
                        [tr('sum.voice', undefined, 'Voice clips'), summary.voice], [tr('sum.music', undefined, 'Music'), summary.music ? tr('yes', undefined, 'Yes') : tr('no', undefined, 'No')], [tr('sum.ducking', undefined, 'Music ducks under voice'), summary.ducking ? tr('yes', undefined, 'Yes') : tr('no', undefined, 'No')], [tr('sum.captions', undefined, 'Captions'), summary.captions ? tr('yes', undefined, 'Yes') : tr('no', undefined, 'No')]].map(([label, value]) => (
                        <div key={label} className="rounded-md border border-sf-dark-700 bg-sf-dark-900 px-3 py-2"><div className="font-display text-base font-semibold">{value}</div><div className="text-[10px] text-sf-text-muted">{label}</div></div>
                      ))}
                    </div>
                    <div className="max-h-72 overflow-auto rounded-lg border border-sf-dark-700">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-sf-dark-800 text-[10px] uppercase tracking-wider text-sf-text-muted"><tr><th className="px-3 py-1.5">#</th><th className="px-3 py-1.5">{tr('col.shot', undefined, 'Shot')}</th><th className="px-3 py-1.5">{tr('col.from', undefined, 'From')}</th><th className="px-3 py-1.5">{tr('col.length', undefined, 'Length')}</th><th className="px-3 py-1.5">{tr('col.transition', undefined, 'Into it')}</th></tr></thead>
                        <tbody>{editPlan.cuts.map((cut, index) => (
                          <tr key={index} className="border-t border-sf-dark-700"><td className="px-3 py-1.5 font-mono text-sf-text-muted">{index + 1}</td><td className="px-3 py-1.5">{inventory.find((item) => item.ref === cut.ref)?.name}</td><td className="px-3 py-1.5 font-mono">{cut.kind === 'video' ? `${cut.inSeconds.toFixed(1)} s` : '—'}</td><td className="px-3 py-1.5 font-mono">{cut.seconds.toFixed(1)} s</td><td className="px-3 py-1.5">{index === 0 ? '—' : cut.transition}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-sf-text-muted">{tr('applyNote', undefined, 'Creates a new timeline in this project. Your current timeline is not changed.')}</p>
                      <button type="button" className={primary} onClick={doApply} disabled={Boolean(busy) || !built} data-testid="motion-apply">{busy === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}{busy === 'apply' && progress ? tr('applying', { done: progress.index, total: progress.total }, 'Building… {{done}}/{{total}}') : tr('apply', undefined, 'Create timeline')}</button>
                    </div>
                  </>
                ) : (
                  <p className="rounded-lg border border-sf-dark-700 bg-sf-dark-900 p-4 text-xs text-sf-text-secondary">{tr('editEmpty', undefined, 'No edit yet. Build it with AI from the approved plan, or quick assemble without AI.')}</p>
                )}
              </section>
            )}

            {production.stage === 'review' && (
              <section className="space-y-3" data-testid="motion-review">
                {production.applied && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sf-accent/40 bg-sf-accent/10 px-4 py-3 text-xs">
                    <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-sf-accent" />{tr('applied', { name: production.applied.name }, 'Built “{{name}}”. Keep editing it like any timeline; Undo works as usual.')}</span>
                    <button type="button" className={primary} onClick={() => onOpenEditor?.()} data-testid="motion-open-editor">{tr('openEditor', undefined, 'Open in the editor')}</button>
                  </div>
                )}
                <ul className="space-y-1.5" data-testid="motion-findings">
                  {findings.map((finding, index) => (
                    <li key={index} className="flex items-start gap-2 rounded-md border border-sf-dark-700 bg-sf-dark-900 px-3 py-2 text-xs text-sf-text-secondary">
                      {finding.level === 'info' ? <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sf-text-muted" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-300" />}{finding.text}
                    </li>
                  ))}
                  {!findings.length && <li className="text-xs text-sf-text-muted">{tr('noFindings', undefined, 'No problems found.')}</li>}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={quiet} onClick={() => doRevise('energetic')} disabled={Boolean(busy)}>{tr('tighter', undefined, 'Make it tighter')}</button>
                  <button type="button" className={quiet} onClick={() => doRevise('calm')} disabled={Boolean(busy)}>{tr('calmer', undefined, 'Make it calmer')}</button>
                  <span className="self-center text-[11px] text-sf-text-muted">{tr('reviseNote', undefined, 'Revisions rebuild the plan; press Create timeline again to make a new version.')}</span>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
