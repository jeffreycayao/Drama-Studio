import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, Handle, MiniMap, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Bot, Clipboard, Download, FileUp, Film, HelpCircle, LayoutGrid, Loader2, Network, Plus, Send, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import {
  IDEA_FIGURES, IDEA_FIGURE_LABELS, IDEA_NODE_HELP, IDEA_NODE_KINDS, IDEA_NODE_LABELS, RELATIONSHIP_LABELS, normalizeIdeaPadData,
} from '../types/ideaPad.js'
import {
  addIdeaNode, connectIdeaNodes, removeIdeaNodes, exportIdeaPadToScreenplay,
  IDEA_AI_ACTIONS, IDEA_AI_SYSTEM, buildIdeaAiPrompt, applyIdeaAiResponse, importScreenplayToIdeaPad, buildExternalFountainPrompt,
} from '../utils/ideaPad.mjs'
import { toFountain, summarizeScreenplay, parseScreenplay } from '../utils/screenplayParser.mjs'
import { FigureIcon, IdeaKindIcon } from './ideaPad/IdeaIcons'
import { askStoryAssistant } from '../services/storyAssistant'
import PromptLibraryButtons from './promptLibrary/PromptLibraryButtons'
import { IDEA_PAD_TEMPLATES, buildIdeaPadTemplate } from '../utils/ideaPadTemplates.mjs'
import { BOARD_KINDS, cardCast, ensureBoard, isPlaced, moveCardToCell, toggleCardCast, unplaceCard } from '../utils/ideaBoard.mjs'
import IdeaBoard from './ideaPad/IdeaBoard'

const SHORT_FILM_DRAFT_KEY = 'comfystudio-short-film-easy-mode-draft-v1'
// Story Board (structured, the default) or Relationship map (free canvas).
const IDEA_VIEW_KEY = 'drama-studio-idea-pad-view'
const fieldClass = 'w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none'
const buttonClass = 'inline-flex items-center gap-1.5 rounded border border-sf-dark-600 bg-sf-dark-800 px-2.5 py-1.5 text-xs text-sf-text-primary hover:bg-sf-dark-700 disabled:opacity-40'

const SCRIPT_FILE = /.(fountain|spmd|fdx|txt)$/i
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024

const IdeaCard = memo(function IdeaCard({ data, selected }) {
  const isCharacter = data.kind === 'character'
  return <div className={`w-56 rounded-lg border bg-sf-dark-800 px-3 py-2 shadow ${selected ? 'border-sf-accent' : 'border-sf-dark-600'}`}>
    <Handle type="target" position={Position.Left} className="!bg-sf-dark-500" />
    <div className="flex items-start gap-2">
      {isCharacter
        ? <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sf-dark-700 text-sf-accent" title={IDEA_FIGURE_LABELS[data.figure || 'person']}>
          <FigureIcon figure={data.figure || 'person'} className="h-6 w-6" /></div>
        : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-sf-text-muted" title={IDEA_NODE_HELP[data.kind]}>
          {!isCharacter && <IdeaKindIcon kind={data.kind} className="h-3 w-3 text-sf-accent" />}
          <span>{IDEA_NODE_LABELS[data.kind]}{data.role ? ` · ${data.role}` : ''}</span>
        </div>
        <div className="text-xs font-medium text-sf-text-primary break-words">{data.title || 'Untitled'}</div>
      </div>
    </div>
    {data.heading && <div className="mt-0.5 font-mono text-[9px] text-sf-text-secondary break-words">{data.heading}</div>}
    {data.body && <div className="mt-1 line-clamp-3 text-[10px] text-sf-text-muted break-words">{data.body}</div>}
    <Handle type="source" position={Position.Right} className="!bg-sf-accent" />
  </div>
})
const nodeTypes = { idea: IdeaCard }

/** Idea Pad: build the story on the Story Board (sections across, plotlines
 * down, beats and scenes in the cells, left to right is the story order),
 * map character relationships on the canvas, ask the Assistant model for
 * twists, conflict or a scene outline, then export a Fountain screenplay. */
export default function IdeaPadWorkspace() {
  const projectHandle = useProjectStore(state => state.currentProjectHandle)
  const projectName = useProjectStore(state => state.currentProject?.name)
  const [pad, setPad] = useState(() => useProjectStore.getState().getIdeaPadData())
  const [selection, setSelection] = useState({ node: null, edge: null })
  const [linkLabel, setLinkLabel] = useState('leads to')
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState('')
  const padRef = useRef(pad)
  padRef.current = pad
  const flow = useRef(null)
  const fileInput = useRef(null)
  const [dropActive, setDropActive] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [sceneCount, setSceneCount] = useState(8)
  const [promptCopied, setPromptCopied] = useState(false)
  const [view, setViewState] = useState(() => {
    try { return localStorage.getItem(IDEA_VIEW_KEY) === 'map' ? 'map' : 'board' } catch { return 'board' }
  })
  const setView = (next) => {
    setViewState(next)
    try { localStorage.setItem(IDEA_VIEW_KEY, next) } catch { /* the choice just is not remembered */ }
    if (next === 'map') setTimeout(() => flow.current?.fitView?.({ padding: 0.2 }), 50)
  }
  const selectCard = (id) => setSelection({ node: id, edge: null })

  // Reload on project switch; save (debounced) to the project document.
  // Saves only land in the project this pad was loaded from, so a pending
  // save or the unmount flush can never overwrite a newly opened project.
  const loadedHandle = useRef(projectHandle)
  const persist = useCallback((value, handle) => {
    if (handle === loadedHandle.current && useProjectStore.getState().currentProjectHandle === handle) {
      useProjectStore.getState().setIdeaPadData(value)
    }
  }, [])
  useEffect(() => {
    if (loadedHandle.current === projectHandle) return
    loadedHandle.current = projectHandle
    setPad(useProjectStore.getState().getIdeaPadData())
    setSelection({ node: null, edge: null })
  }, [projectHandle])
  useEffect(() => {
    const handle = loadedHandle.current
    const timer = setTimeout(() => persist(pad, handle), 400)
    return () => clearTimeout(timer)
  }, [pad, persist])
  useEffect(() => () => persist(padRef.current, loadedHandle.current), [persist])

  const nodes = useMemo(() => pad.nodes.map(node => ({ id: node.id, type: 'idea', position: node.position, data: node,
    selected: selection.node === node.id })), [pad.nodes, selection.node])
  const edges = useMemo(() => pad.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label,
    selected: selection.edge === edge.id, animated: edge.label === 'leads to',
    labelStyle: { fill: 'rgb(var(--sf-text-secondary))', fontSize: 10 },
    labelBgStyle: { fill: 'rgb(var(--sf-dark-800))' } })), [pad.edges, selection.edge])

  const onNodesChange = useCallback((changes) => {
    let next = padRef.current
    const removed = []
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        next = { ...next, nodes: next.nodes.map(node => node.id === change.id ? { ...node, position: change.position } : node) }
      } else if (change.type === 'select' && change.selected) setSelection({ node: change.id, edge: null })
      else if (change.type === 'remove') removed.push(change.id)
    }
    if (removed.length) { next = removeIdeaNodes(next, removed); setSelection({ node: null, edge: null }) }
    if (next !== padRef.current) setPad(next)
  }, [])
  const onEdgesChange = useCallback((changes) => {
    const removed = changes.filter(change => change.type === 'remove').map(change => change.id)
    const selected = changes.find(change => change.type === 'select' && change.selected)
    if (selected) setSelection({ node: null, edge: selected.id })
    if (removed.length) setPad(current => ({ ...current, edges: current.edges.filter(edge => !removed.includes(edge.id)) }))
  }, [])
  const onConnect = useCallback(({ source, target }) => setPad(current => connectIdeaNodes(current, source, target, linkLabel)), [linkLabel])

  const addCard = (kind) => {
    const center = flow.current?.screenToFlowPosition?.({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 0, y: 0 }
    // First free slot on a 260×150 grid around the view center (cards are 224 px wide).
    const taken = padRef.current.nodes
    let spot = { x: center.x - 112, y: center.y - 40 }
    for (let index = 0; index < 60; index += 1) {
      const candidate = { x: center.x - 112 + ((index % 5) - 2) * 260, y: center.y - 40 + Math.floor(index / 5) * 150 }
      if (!taken.some(node => Math.abs(node.position.x - candidate.x) < 240 && Math.abs(node.position.y - candidate.y) < 120)) { spot = candidate; break }
    }
    const result = addIdeaNode(padRef.current, kind, spot,
      kind === 'scene' ? { heading: 'INT. LOCATION - DAY' } : {})
    setPad(result.pad)
    setSelection({ node: result.node.id, edge: null })
  }
  const updateNode = (id, patch) => setPad(current => normalizeIdeaPadData({ ...current,
    nodes: current.nodes.map(node => node.id === id ? { ...node, ...patch } : node) }))
  // Import a .fountain (or .fdx) screenplay as cards. Picked or dropped.
  const importScriptFile = async (file) => {
    if (!file) return
    if (!SCRIPT_FILE.test(file.name || '')) { setMessage('Drop a .fountain screenplay (or .fdx / .txt).'); return }
    if (file.size > MAX_SCRIPT_BYTES) { setMessage('That script is larger than 2 MB.'); return }
    try {
      const play = parseScreenplay(await file.text(), file.name)
      if (!play.scenes.length && !play.characters.length) { setMessage(`No scenes or characters found in ${file.name}. Scene headings start with INT. or EXT.`); return }
      const result = importScreenplayToIdeaPad(padRef.current, play, { fileName: file.name })
      setPad(result.pad)
      setSelection({ node: null, edge: null })
      const { characters, reusedCharacters, scenes, skippedScenes } = result.created
      setMessage(`Imported ${scenes} scene${scenes === 1 ? '' : 's'} and ${characters} new character${characters === 1 ? '' : 's'} from ${file.name}${reusedCharacters ? ` (${reusedCharacters} already on the pad)` : ''}${skippedScenes ? `; ${skippedScenes} scenes over the limit were skipped` : ''}.`)
      setTimeout(() => flow.current?.fitView?.({ padding: 0.15, duration: 300 }), 50)
    } catch (error) { setMessage(error.message || 'Could not read that script.') }
  }
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files')
  const onCanvasDragOver = (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }
  const onCanvasDrop = (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    setDropActive(false)
    importScriptFile(event.dataTransfer.files?.[0])
  }
  const externalPrompt = useMemo(() => buildExternalFountainPrompt(pad, { brief, sceneCount, title: projectName || '' }),
    [pad, brief, sceneCount, projectName])
  const copyExternalPrompt = async () => {
    try { await navigator.clipboard.writeText(externalPrompt); setPromptCopied(true); setTimeout(() => setPromptCopied(false), 2000) }
    catch { setMessage('Could not copy. Select the prompt text and copy it.') }
  }

  const selectedNode = pad.nodes.find(node => node.id === selection.node) || null
  const selectedEdge = pad.edges.find(edge => edge.id === selection.edge) || null

  const runAi = async (action) => {
    if (!selectedNode || busy) return
    const focusId = selectedNode.id
    setBusy(action); setMessage(`${IDEA_AI_ACTIONS[action].label}…`)
    try {
      const { text } = await askStoryAssistant({ system: IDEA_AI_SYSTEM, prompt: buildIdeaAiPrompt(action, padRef.current, focusId), requestId: `ideapad-${action}-${Date.now()}` })
      const result = applyIdeaAiResponse(action, padRef.current, focusId, text)
      if (!result.ok) { setMessage(result.reason); return }
      let nextPad = result.pad
      // An expanded beat's new scene goes right after the beat on the Story Board.
      const focus = padRef.current.nodes.find(node => node.id === focusId)
      if (action === 'expand' && focus?.column && focus?.lane && result.created?.[0]) {
        const cell = nextPad.nodes.filter(node => node.column === focus.column && node.lane === focus.lane && node.id !== result.created[0])
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        nextPad = moveCardToCell(nextPad, result.created[0], focus.column, focus.lane, cell.findIndex(node => node.id === focusId) + 1)
      }
      setPad(nextPad)
      setMessage(action === 'expand' ? 'Added a scene card after this beat.' : `Added ${result.created.length} idea card${result.created.length === 1 ? '' : 's'}. Keep, edit or delete them.`)
    } catch (error) { setMessage(error.message || 'The Assistant could not answer.') }
    finally { setBusy(null) }
  }

  const exportScript = () => {
    const play = exportIdeaPadToScreenplay(padRef.current, { title: projectName || null })
    const summary = summarizeScreenplay(play)
    if (!summary.scenes) throw new Error('Add beats or scenes to the Story Board before exporting.')
    return { play, fountain: toFountain(play), summary }
  }
  const copyScript = async () => {
    try { const { fountain, summary } = exportScript(); await navigator.clipboard.writeText(fountain); setMessage(`Copied ${summary.scenes} scenes as Fountain.`) }
    catch (error) { setMessage(error.message) }
  }
  const saveScript = async () => {
    try {
      const { fountain, play } = exportScript()
      const api = window.electronAPI
      if (!api?.saveFileDialog) {
        const url = URL.createObjectURL(new Blob([fountain], { type: 'text/plain' }))
        Object.assign(document.createElement('a'), { href: url, download: `${play.title || 'script'}.fountain` }).click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        return
      }
      const picked = await api.saveFileDialog({ title: 'Save screenplay', defaultPath: `${(play.title || 'script').replace(/[<>:"/\\|?*]/g, '_')}.fountain`,
        filters: [{ name: 'Fountain screenplay', extensions: ['fountain'] }] })
      const filePath = typeof picked === 'string' ? picked : picked?.filePath
      if (!filePath) return
      const written = await api.writeFile(filePath, fountain, { encoding: 'utf8' })
      setMessage(written?.success === false ? (written.error || 'Could not save the script.') : `Saved ${filePath}`)
    } catch (error) { setMessage(error.message) }
  }
  const sendToShortFilm = () => {
    try {
      const { play, summary } = exportScript()
      const screenplay = toFountain(play, { includeTitlePage: false })
      try {
        const raw = JSON.parse(localStorage.getItem(SHORT_FILM_DRAFT_KEY) || '{}')
        const draft = { ...(raw.draft || raw), screenplay, ...(play.title ? { title: play.title } : {}) }
        localStorage.setItem(SHORT_FILM_DRAFT_KEY, JSON.stringify({ ...raw, draft }))
      } catch { /* the live event below still updates an open Short Film view */ }
      window.dispatchEvent(new CustomEvent('drama-short-film-import-screenplay', { detail: { screenplay, title: play.title } }))
      window.dispatchEvent(new CustomEvent('comfystudio-open-generate-tab', { detail: { source: 'idea-pad' } }))
      setMessage(`Sent ${summary.scenes} scenes to Short Film. Open Generate › Director › Short Film to plan shots.`)
    } catch (error) { setMessage(error.message) }
  }

  const aiActions = selectedNode ? Object.entries(IDEA_AI_ACTIONS).filter(([, action]) => action.kinds.includes(selectedNode.kind)) : []
  return <div className="flex h-full min-h-0 w-full bg-sf-dark-950" data-testid="idea-pad">
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-sf-dark-700 px-3 py-2">
        <span className="mr-1 text-sm font-semibold text-sf-text-primary">Idea Pad</span>
        <div className="inline-flex rounded-md border border-sf-dark-600 bg-sf-dark-900 p-0.5" role="tablist" aria-label="Idea Pad view">
          {[['board', LayoutGrid, 'Story Board', 'Sections across, plotlines down: build the story in order'], ['map', Network, 'Relationship map', 'A free canvas to link characters, arcs and notes']].map(([id, Icon, label, tip]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} title={tip} data-testid={`idea-pad-view-${id}`}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${view === id ? 'bg-sf-accent font-semibold text-sf-accent-on' : 'text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary'}`}>
              <Icon className="h-3.5 w-3.5" />{label}</button>
          ))}
        </div>
        {view === 'map' && IDEA_NODE_KINDS.map(kind => <button key={kind} type="button" className={buttonClass} onClick={() => addCard(kind)}
          title={`Add a ${IDEA_NODE_LABELS[kind].toLowerCase()}: ${IDEA_NODE_HELP[kind]}`} data-testid={`idea-pad-add-${kind}`}>
          <Plus className="h-3 w-3 text-sf-text-muted" /><IdeaKindIcon kind={kind} className="h-3.5 w-3.5 text-sf-accent" />{IDEA_NODE_LABELS[kind]}</button>)}
        {view === 'map' && <label className="ml-2 flex items-center gap-1.5 text-[11px] text-sf-text-muted">New links
          <select value={linkLabel} onChange={event => setLinkLabel(event.target.value)} aria-label="Label for new links"
            className="rounded border border-sf-dark-600 bg-sf-dark-800 px-1.5 py-1 text-xs text-sf-text-primary">
            {RELATIONSHIP_LABELS.map(label => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => fileInput.current?.click()} data-testid="idea-pad-import"
            title="Import a .fountain screenplay (or .fdx) as character and scene cards. You can also drop the file on the canvas."><FileUp className="h-3 w-3" />Import .fountain</button>
          <input ref={fileInput} type="file" accept=".fountain,.spmd,.fdx,.txt" className="hidden" data-testid="idea-pad-import-input"
            onChange={event => { importScriptFile(event.target.files?.[0]); event.target.value = '' }} />
          <button type="button" className={buttonClass} onClick={() => setPromptOpen(open => !open)} aria-expanded={promptOpen} data-testid="idea-pad-ai-prompt"
            title="Get a prompt for ChatGPT, Claude or Gemini that writes a .fountain screenplay from this Idea Pad"><Bot className="h-3 w-3" />AI prompt</button>
          <button type="button" className={buttonClass} onClick={copyScript} title="Copy the connected story as a Fountain screenplay"><Clipboard className="h-3 w-3" />Copy script</button>
          <button type="button" className={buttonClass} onClick={saveScript}><Download className="h-3 w-3" />Save .fountain</button>
          <button type="button" data-testid="idea-pad-send-short-film" onClick={sendToShortFilm}
            className="inline-flex items-center gap-1.5 rounded bg-sf-accent px-2.5 py-1.5 text-xs font-medium text-sf-accent-on hover:bg-sf-accent-hover"><Film className="h-3 w-3" />Send to Short Film</button>
        </div>
      </div>
      {view === 'board' && (pad.board || pad.nodes.length > 0) && <div className="min-h-0 flex-1">
        <IdeaBoard pad={pad} setPad={setPad} selectedId={selection.node} onSelect={selectCard} />
      </div>}
      <div className={`relative min-h-0 flex-1 ${view === 'board' && (pad.board || pad.nodes.length > 0) ? 'hidden' : ''}`} onDragOver={onCanvasDragOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false) }}
        onDrop={onCanvasDrop} data-testid="idea-pad-canvas">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onInit={instance => { flow.current = instance }} onPaneClick={() => setSelection({ node: null, edge: null })}
          defaultViewport={pad.viewport || { x: 80, y: 80, zoom: 0.9 }} colorMode="dark" deleteKeyCode={['Delete', 'Backspace']} proOptions={{ hideAttribution: true }}>
          <Background gap={24} color="rgb(var(--sf-dark-700))" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.5)" nodeColor="rgb(var(--sf-dark-500))" />
        </ReactFlow>
        {!pad.nodes.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto max-w-lg rounded-lg border border-sf-dark-700 bg-sf-dark-900/95 p-5 text-xs text-sf-text-muted" data-testid="idea-pad-templates">
            <p className="mb-1 text-sm text-sf-text-primary">Start from a template</p>
            <p>A ready-made story skeleton: characters, an arc and the beats in order. Rename and rewrite every card.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {IDEA_PAD_TEMPLATES.map(template => (
                <button key={template.id} type="button" data-template-id={template.id}
                  onClick={() => { setPad(buildIdeaPadTemplate(template.id)); setSelection({ node: null, edge: null }); setView('board') }}
                  className="rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-2.5 text-left transition-colors hover:border-sf-accent/60 hover:bg-sf-dark-700">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-sf-text-primary"><Sparkles className="h-3 w-3 text-sf-accent" />{template.title}</span>
                  <span className="mt-1 block text-[11px] leading-snug text-sf-text-muted">{template.description}</span>
                </button>
              ))}
            </div>
            <button type="button" data-testid="idea-pad-start-blank" onClick={() => { setPad(ensureBoard({ ...padRef.current, nodes: [], edges: [] })); setView('board') }}
              className="mt-3 inline-flex items-center gap-1.5 rounded border border-sf-dark-600 bg-sf-dark-800 px-2.5 py-1.5 text-xs text-sf-text-primary hover:bg-sf-dark-700">
              <LayoutGrid className="h-3 w-3 text-sf-accent" />Start blank: three acts, one plotline</button>
            <p className="mt-1">Drag from a card’s right dot to another card to link them. Use “leads to” for story order and labels like “loves” or “rivals” for relationships. Have a script already? Drop a <span className="text-sf-text-secondary">.fountain</span> file here, or use <span className="text-sf-text-secondary">AI prompt</span> to have ChatGPT write one.</p>
          </div>
        </div>}
        {dropActive && <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-sf-accent bg-sf-dark-950/70">
          <p className="flex items-center gap-2 text-sm text-sf-text-primary"><FileUp className="h-4 w-4 text-sf-accent" />Drop a .fountain screenplay to add its characters and scenes</p>
        </div>}
        {promptOpen && <section className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[min(30rem,calc(100%-1.5rem))] flex-col rounded-lg border border-sf-dark-600 bg-sf-dark-900 shadow-2xl"
          role="dialog" aria-label="Prompt for an external AI" data-testid="idea-pad-ai-prompt-panel">
          <header className="flex items-start gap-2 border-b border-sf-dark-700 px-3 py-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-semibold text-sf-text-primary">Write the script with ChatGPT (or any AI)</h3>
              <p className="mt-0.5 text-[10px] text-sf-text-muted">1. Copy the prompt. 2. Paste it into ChatGPT, Claude or Gemini. 3. Save the reply as <span className="font-mono">story.fountain</span>. 4. Drop it on this canvas.</p>
            </div>
            <button type="button" onClick={() => setPromptOpen(false)} aria-label="Close" className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700"><X className="h-3.5 w-3.5" /></button>
          </header>
          <div className="space-y-2 overflow-y-auto px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] text-sf-text-muted">
              <span id="idea-pad-brief-label">What should it write?</span>
              <PromptLibraryButtons value={brief} onChange={setBrief} category="idea" fieldLabel="What should it write?" testId="idea-pad-brief-library" />
            </div>
            <label className="block text-[10px] text-sf-text-muted">
              <textarea className={`${fieldClass} mt-0.5`} rows={2} value={brief} onChange={event => setBrief(event.target.value)} aria-labelledby="idea-pad-brief-label"
                placeholder="e.g. Episode 1 of a revenge micro-drama: a maid discovers the heir she serves is her lost twin" />
            </label>
            <label className="flex items-center gap-2 text-[10px] text-sf-text-muted">Scenes
              <input type="number" min={1} max={60} value={sceneCount} onChange={event => setSceneCount(event.target.value)} className={`${fieldClass} w-20`} />
            </label>
            <textarea className={`${fieldClass} font-mono text-[10px]`} rows={12} readOnly value={externalPrompt} aria-label="Prompt to copy" data-testid="idea-pad-ai-prompt-text" />
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-sf-dark-700 px-3 py-2">
            <button type="button" className={buttonClass} onClick={() => fileInput.current?.click()}><FileUp className="h-3 w-3" />Import the reply…</button>
            <button type="button" onClick={copyExternalPrompt} data-testid="idea-pad-ai-prompt-copy"
              className="inline-flex items-center gap-1.5 rounded bg-sf-accent px-2.5 py-1.5 text-xs font-medium text-sf-accent-on hover:bg-sf-accent-hover"><Clipboard className="h-3 w-3" />{promptCopied ? 'Copied' : 'Copy prompt'}</button>
          </footer>
        </section>}
      </div>
    </div>
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-sf-dark-700 p-3 space-y-3">
      {!selectedNode && !selectedEdge && <div className="space-y-2 text-xs text-sf-text-muted">
        <p>Select a card to edit it.</p>
        {view === 'board'
          ? <p className="text-[11px] leading-relaxed">The <span className="text-sf-text-secondary">Story Board</span> is where the story takes shape: each column is a part of the story (an act or an episode) and each row is a plotline. Put beats and scenes in the cells; left to right is the order everything happens.</p>
          : <p className="text-[11px] leading-relaxed">The <span className="text-sf-text-secondary">Relationship map</span> is for who is connected to whom. Drag from a card’s right dot to another card and pick a label like “loves”, “rivals” or “family”.</p>}
      </div>}
      {selectedEdge && <div className="space-y-2">
        <h3 className="text-xs font-semibold text-sf-text-primary">Link</h3>
        <select value={RELATIONSHIP_LABELS.includes(selectedEdge.label) ? selectedEdge.label : ''} aria-label="Link label" className={fieldClass}
          onChange={event => setPad(current => ({ ...current, edges: current.edges.map(edge => edge.id === selectedEdge.id ? { ...edge, label: event.target.value } : edge) }))}>
          {!RELATIONSHIP_LABELS.includes(selectedEdge.label) && <option value="">{selectedEdge.label}</option>}
          {RELATIONSHIP_LABELS.map(label => <option key={label} value={label}>{label}</option>)}
        </select>
        <button type="button" className={buttonClass} onClick={() => { setPad(current => ({ ...current, edges: current.edges.filter(edge => edge.id !== selectedEdge.id) })); setSelection({ node: null, edge: null }) }}><Trash2 className="h-3 w-3" />Remove link</button>
      </div>}
      {selectedNode && <div className="space-y-2" key={selectedNode.id}>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-sf-text-primary" title={IDEA_NODE_HELP[selectedNode.kind]}>
          <IdeaKindIcon kind={selectedNode.kind} figure={selectedNode.figure} className="h-4 w-4 text-sf-accent" />{IDEA_NODE_LABELS[selectedNode.kind]}
          <HelpCircle className="h-3 w-3 text-sf-text-muted" aria-hidden="true" />
        </h3>
        <p className="text-[10px] leading-relaxed text-sf-text-muted">{IDEA_NODE_HELP[selectedNode.kind]}</p>
        <input className={fieldClass} aria-label="Title" value={selectedNode.title} onChange={event => updateNode(selectedNode.id, { title: event.target.value })} />
        {selectedNode.kind === 'scene' && <input className={`${fieldClass} font-mono`} aria-label="Scene heading" placeholder="INT. LOCATION - NIGHT"
          value={selectedNode.heading || ''} onChange={event => updateNode(selectedNode.id, { heading: event.target.value })} />}
        {selectedNode.kind === 'character' && <>
          <div role="radiogroup" aria-label="Figure" className="grid grid-cols-4 gap-1">
            {IDEA_FIGURES.map(figure => {
              const active = (selectedNode.figure || 'person') === figure
              return <button key={figure} type="button" role="radio" aria-checked={active} title={IDEA_FIGURE_LABELS[figure]}
                onClick={() => updateNode(selectedNode.id, { figure })} data-testid={`idea-figure-${figure}`}
                className={`flex flex-col items-center gap-0.5 rounded border px-1 py-1.5 text-[9px] ${active ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary' : 'border-sf-dark-600 text-sf-text-muted hover:bg-sf-dark-700'}`}>
                <FigureIcon figure={figure} className={`h-6 w-6 ${active ? 'text-sf-accent' : ''}`} />{IDEA_FIGURE_LABELS[figure]}</button>
            })}
          </div>
          <input className={fieldClass} aria-label="Role" placeholder="Role (protagonist, rival…)" value={selectedNode.role || ''} onChange={event => updateNode(selectedNode.id, { role: event.target.value })} />
          <input className={fieldClass} aria-label="Want" placeholder="What do they want?" value={selectedNode.want || ''} onChange={event => updateNode(selectedNode.id, { want: event.target.value })} />
          <input className={fieldClass} aria-label="Inner conflict" placeholder="What holds them back?" value={selectedNode.wound || ''} onChange={event => updateNode(selectedNode.id, { wound: event.target.value })} />
        </>}
        {selectedNode.kind === 'scene' && selectedNode.fountain !== undefined && <label className="block text-[10px] text-sf-text-muted">Scene script (Fountain, used on export)
          <textarea className={`${fieldClass} mt-0.5 font-mono text-[10px]`} rows={8} value={selectedNode.fountain}
            onChange={event => updateNode(selectedNode.id, { fountain: event.target.value })} />
        </label>}
        {BOARD_KINDS.includes(selectedNode.kind) && (() => {
          const boardPad = ensureBoard(pad)
          const placed = isPlaced(boardPad, selectedNode)
          const characters = pad.nodes.filter(node => node.kind === 'character')
          const cast = new Set(cardCast(pad, selectedNode.id))
          return <div className="space-y-2 rounded-md border border-sf-dark-700 bg-sf-dark-900/60 p-2" data-testid="idea-card-placement">
            <p className="text-[10px] uppercase tracking-wider text-sf-text-muted">On the Story Board</p>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-sf-text-muted">Section
                <select className={`${fieldClass} mt-0.5`} value={placed ? selectedNode.column : ''} aria-label="Section"
                  onChange={event => setPad(current => moveCardToCell(current, selectedNode.id, event.target.value, (placed ? selectedNode.lane : null) || ensureBoard(current).board.lanes[0].id))}>
                  {!placed && <option value="">Unsorted</option>}
                  {boardPad.board.columns.map(column => <option key={column.id} value={column.id}>{column.title}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-sf-text-muted">Plotline
                <select className={`${fieldClass} mt-0.5`} value={placed ? selectedNode.lane : ''} aria-label="Plotline"
                  onChange={event => setPad(current => moveCardToCell(current, selectedNode.id, (placed ? selectedNode.column : null) || ensureBoard(current).board.columns[0].id, event.target.value))}>
                  {!placed && <option value="">Unsorted</option>}
                  {boardPad.board.lanes.map(lane => <option key={lane.id} value={lane.id}>{lane.title}</option>)}
                </select>
              </label>
            </div>
            {placed && <button type="button" className={buttonClass} onClick={() => setPad(current => unplaceCard(current, selectedNode.id))}><Undo2 className="h-3 w-3" />Take off the board</button>}
            <p className="pt-1 text-[10px] uppercase tracking-wider text-sf-text-muted">Who is in it</p>
            {characters.length ? <div className="flex flex-wrap gap-1">
              {characters.map(character => {
                const on = cast.has(character.id)
                return <button key={character.id} type="button" aria-pressed={on} onClick={() => setPad(current => toggleCardCast(current, selectedNode.id, character.id))}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] ${on ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary' : 'border-sf-dark-600 text-sf-text-muted hover:border-sf-dark-400 hover:text-sf-text-secondary'}`}>
                  <FigureIcon figure={character.figure || 'person'} className="h-3 w-3" />{character.title}</button>
              })}
            </div> : <p className="text-[10px] text-sf-text-muted">Add characters in the Cast row above the board.</p>}
          </div>
        })()}
        <textarea className={fieldClass} rows={8} aria-label="Notes" placeholder={selectedNode.kind === 'scene' ? 'What happens in this scene' : 'Notes'}
          value={selectedNode.body} onChange={event => updateNode(selectedNode.id, { body: event.target.value })} />
        {aiActions.length > 0 && <div className="space-y-1.5 border-t border-sf-dark-700 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-sf-text-muted">AI collaborator</p>
          {aiActions.map(([id, action]) => <button key={id} type="button" className={`${buttonClass} w-full`} disabled={Boolean(busy)} onClick={() => runAi(id)}>
            {busy === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{action.label}</button>)}
          <p className="text-[10px] text-sf-text-muted">Uses the Assistant model from Settings › Agents. Suggestions arrive as new cards.</p>
        </div>}
        <button type="button" className={buttonClass} onClick={() => { setPad(current => removeIdeaNodes(current, [selectedNode.id])); setSelection({ node: null, edge: null }) }}><Trash2 className="h-3 w-3" />Delete card</button>
      </div>}
      {message && <p role="status" className="text-xs text-sf-text-secondary break-words">{message}</p>}
      <p className="text-[10px] text-sf-text-muted"><Send className="mr-1 inline h-3 w-3" />Saved with the project.</p>
    </aside>
  </div>
}
