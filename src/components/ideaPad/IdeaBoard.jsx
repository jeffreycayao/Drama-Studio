import { useState } from 'react'
import { ChevronLeft, ChevronRight, GripVertical, Plus, UserPlus, X } from 'lucide-react'
import { FigureIcon, IdeaKindIcon } from './IdeaIcons'
import {
  addBoardCard, addColumn, addLane, cardCast, cellCards, ensureBoard, moveCardToCell, moveColumn,
  removeColumn, removeLane, renameColumn, renameLane, unsortedCards,
} from '../../utils/ideaBoard.mjs'
import { addIdeaNode } from '../../utils/ideaPad.mjs'

const CARD_MIME = 'application/x-drama-idea-card'

/** Inline-editable title: double-click (or click when `editable`) to rename. */
function EditableTitle({ value, onSave, className = '', label }) {
  const [draft, setDraft] = useState(null)
  if (draft !== null) {
    return <input autoFocus value={draft} aria-label={label} onChange={event => setDraft(event.target.value)}
      onBlur={() => { onSave(draft); setDraft(null) }}
      onKeyDown={event => { if (event.key === 'Enter') { onSave(draft); setDraft(null) } if (event.key === 'Escape') setDraft(null) }}
      className="w-full min-w-0 rounded border border-sf-accent bg-sf-dark-900 px-1 py-0.5 text-xs text-sf-text-primary outline-none" />
  }
  return <button type="button" onDoubleClick={() => setDraft(value)} title={`${value} (double-click to rename)`}
    className={`min-w-0 truncate text-left ${className}`}>{value}</button>
}

function BoardCard({ node, pad, selected, laneColor, onSelect }) {
  const cast = cardCast(pad, node.id).map(id => pad.nodes.find(item => item.id === id)).filter(Boolean)
  return <div draggable data-testid="idea-board-card" data-card-id={node.id}
    onDragStart={event => { event.dataTransfer.setData(CARD_MIME, node.id); event.dataTransfer.effectAllowed = 'move' }}
    onClick={event => { event.stopPropagation(); onSelect(node.id) }}
    className={`group cursor-pointer rounded-md border bg-sf-dark-800 px-2 py-1.5 text-left shadow-sm transition-colors hover:border-sf-dark-400 ${selected ? 'border-sf-accent ring-1 ring-sf-accent/50' : 'border-sf-dark-600'}`}
    style={{ borderLeftWidth: 3, borderLeftColor: laneColor || undefined }}>
    <div className="flex items-start gap-1">
      <IdeaKindIcon kind={node.kind} className="mt-0.5 h-3 w-3 shrink-0 text-sf-accent" />
      <span className="min-w-0 flex-1 break-words text-[11.5px] font-medium leading-snug text-sf-text-primary">{node.title || 'Untitled'}</span>
      <GripVertical className="h-3 w-3 shrink-0 text-sf-text-muted opacity-0 group-hover:opacity-100" aria-hidden="true" />
    </div>
    {node.kind === 'scene' && node.heading && <div className="mt-0.5 truncate font-mono text-[9px] text-sf-text-secondary">{node.heading}</div>}
    {node.body && <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-sf-text-muted">{node.body}</div>}
    {cast.length > 0 && <div className="mt-1 flex flex-wrap gap-0.5">
      {cast.slice(0, 5).map(character => <span key={character.id} title={character.title}
        className="inline-flex items-center gap-0.5 rounded bg-sf-dark-700 px-1 py-px text-[9px] text-sf-text-secondary">
        <FigureIcon figure={character.figure || 'person'} className="h-2.5 w-2.5" />{character.title.split(' ')[0]}</span>)}
      {cast.length > 5 && <span className="text-[9px] text-sf-text-muted">+{cast.length - 5}</span>}
    </div>}
  </div>
}

/**
 * Story Board: sections (acts, episodes) across, plotlines down, beat and
 * scene cards in the cells. Left to right is the story order. Cards are
 * dragged between cells; anything not placed yet waits in Unsorted.
 */
export default function IdeaBoard({ pad, setPad, selectedId, onSelect }) {
  const board = (pad.board ? pad : ensureBoard(pad)).board
  const [dropCell, setDropCell] = useState(null)
  const unsorted = unsortedCards(pad)
  const characters = pad.nodes.filter(node => node.kind === 'character')

  const dropAt = (event, columnId, laneId) => {
    const id = event.dataTransfer.getData(CARD_MIME)
    setDropCell(null)
    if (!id) return
    event.preventDefault()
    // Insert before the card under the pointer, or at the end of the cell.
    const target = event.target.closest?.('[data-card-id]')
    const cards = cellCards(pad, columnId, laneId).filter(node => node.id !== id)
    const index = target ? cards.findIndex(node => node.id === target.dataset.cardId) : -1
    setPad(current => moveCardToCell(current, id, columnId, laneId, index >= 0 ? index : Infinity))
  }
  const allowDrop = (event, cell) => {
    if (!Array.from(event.dataTransfer.types || []).includes(CARD_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropCell !== cell) setDropCell(cell)
  }
  const add = (kind, columnId, laneId) => {
    const result = addBoardCard(pad, kind, columnId, laneId)
    setPad(result.pad)
    onSelect(result.node.id)
  }
  const addCharacter = () => {
    const result = addIdeaNode(pad, 'character', { x: characters.length * 260, y: -260 }, { title: 'New character', figure: 'person' })
    setPad(result.pad)
    onSelect(result.node.id)
  }
  const gridTemplate = `11rem repeat(${board.columns.length}, minmax(13.5rem, 1fr)) 3rem`

  return <div className="flex h-full min-h-0 flex-col" data-testid="idea-board" onClick={() => onSelect(null)}>
    {/* Cast */}
    <div className="flex items-center gap-2 overflow-x-auto border-b border-sf-dark-700 bg-sf-dark-900/60 px-3 py-2" data-testid="idea-board-cast">
      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-sf-text-muted">Cast</span>
      {characters.map(character => <button key={character.id} type="button"
        onClick={event => { event.stopPropagation(); onSelect(character.id) }}
        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors ${selectedId === character.id ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary' : 'border-sf-dark-600 bg-sf-dark-800 text-sf-text-secondary hover:border-sf-dark-400'}`}
        title={[character.role, character.want && `Wants: ${character.want}`].filter(Boolean).join(' · ') || character.title}>
        <FigureIcon figure={character.figure || 'person'} className="h-4 w-4 text-sf-accent" />{character.title}
        {character.role && <span className="text-[9.5px] text-sf-text-muted">{character.role}</span>}
      </button>)}
      <button type="button" onClick={event => { event.stopPropagation(); addCharacter() }} data-testid="idea-board-add-character"
        className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-sf-dark-500 px-2 py-1 text-[11px] text-sf-text-muted hover:border-sf-accent/60 hover:text-sf-text-primary">
        <UserPlus className="h-3 w-3" />Character</button>
    </div>

    {/* Unsorted tray */}
    {unsorted.length > 0 && <div className="border-b border-sf-dark-700 bg-sf-warning/5 px-3 py-2" data-testid="idea-board-unsorted">
      <div className="mb-1 text-[10.5px] text-sf-text-secondary"><span className="font-semibold text-sf-text-primary">Unsorted ({unsorted.length})</span> · drag each card into the section and plotline where it happens.</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {unsorted.map(node => <div key={node.id} className="w-48 shrink-0">
          <BoardCard node={node} pad={pad} selected={selectedId === node.id} onSelect={onSelect} />
        </div>)}
      </div>
    </div>}

    {/* Grid */}
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: gridTemplate }}>
        <div className="sticky left-0 z-10 bg-sf-dark-950 px-1 pb-1 text-[9.5px] font-mono uppercase tracking-[0.14em] text-sf-text-muted self-end">Plotlines ↓ · Story →</div>
        {board.columns.map((column, index) => <div key={column.id} data-testid="idea-board-column"
          className="group flex items-center gap-1 rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1.5">
          <span className="font-mono text-[10px] text-sf-accent">{index + 1}</span>
          <EditableTitle value={column.title} label="Section name" className="flex-1 text-xs font-semibold text-sf-text-primary"
            onSave={title => setPad(current => renameColumn(current, column.id, title))} />
          <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
            <button type="button" disabled={index === 0} onClick={() => setPad(current => moveColumn(current, column.id, -1))} title="Move this section earlier"
              className="rounded p-0.5 text-sf-text-muted hover:bg-sf-dark-700 disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
            <button type="button" disabled={index === board.columns.length - 1} onClick={() => setPad(current => moveColumn(current, column.id, 1))} title="Move this section later"
              className="rounded p-0.5 text-sf-text-muted hover:bg-sf-dark-700 disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
            {board.columns.length > 1 && <button type="button" onClick={() => setPad(current => removeColumn(current, column.id))} title="Remove this section (its cards move to Unsorted)"
              className="rounded p-0.5 text-sf-text-muted hover:bg-sf-error/20 hover:text-sf-error"><X className="h-3 w-3" /></button>}
          </span>
        </div>)}
        <button type="button" onClick={event => { event.stopPropagation(); setPad(current => addColumn(current)) }} title="Add a section (act, episode, chapter)"
          data-testid="idea-board-add-column"
          className="flex items-center justify-center rounded-md border border-dashed border-sf-dark-500 text-sf-text-muted hover:border-sf-accent/60 hover:text-sf-text-primary"><Plus className="h-3.5 w-3.5" /></button>

        {board.lanes.map(lane => <div key={lane.id} className="contents">
          <div className="group sticky left-0 z-10 flex items-start gap-1.5 rounded-md bg-sf-dark-900 px-2 py-2" data-testid="idea-board-lane"
            style={{ boxShadow: `inset 3px 0 0 ${lane.color || 'rgb(var(--sf-accent))'}` }}>
            <EditableTitle value={lane.title} label="Plotline name" className="flex-1 pl-1 text-xs font-medium text-sf-text-primary"
              onSave={title => setPad(current => renameLane(current, lane.id, title))} />
            {board.lanes.length > 1 && <button type="button" onClick={() => setPad(current => removeLane(current, lane.id))} title="Remove this plotline (its cards move to Unsorted)"
              className="rounded p-0.5 text-sf-text-muted opacity-0 hover:bg-sf-error/20 hover:text-sf-error group-hover:opacity-100"><X className="h-3 w-3" /></button>}
          </div>
          {board.columns.map(column => {
            const cell = `${column.id}|${lane.id}`
            const cards = cellCards(pad, column.id, lane.id)
            return <div key={cell} data-testid="idea-board-cell" data-column={column.id} data-lane={lane.id}
              onDragOver={event => allowDrop(event, cell)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropCell(null) }}
              onDrop={event => dropAt(event, column.id, lane.id)}
              className={`group/cell flex min-h-[5.5rem] flex-col gap-1.5 rounded-md border p-1.5 transition-colors ${dropCell === cell ? 'border-sf-accent bg-sf-accent/10' : 'border-sf-dark-700 bg-sf-dark-900/40'}`}>
              {cards.map(node => <BoardCard key={node.id} node={node} pad={pad} laneColor={lane.color} selected={selectedId === node.id} onSelect={onSelect} />)}
              <div className={`mt-auto flex gap-1 ${cards.length ? 'opacity-0 group-hover/cell:opacity-100' : ''} transition-opacity`}>
                <button type="button" onClick={event => { event.stopPropagation(); add('beat', column.id, lane.id) }}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary"><Plus className="h-2.5 w-2.5" />Beat</button>
                <button type="button" onClick={event => { event.stopPropagation(); add('scene', column.id, lane.id) }}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary"><Plus className="h-2.5 w-2.5" />Scene</button>
              </div>
            </div>
          })}
          <div />
        </div>)}
        <button type="button" onClick={event => { event.stopPropagation(); setPad(current => addLane(current)) }} data-testid="idea-board-add-lane"
          title="Add a plotline: a subplot, a romance, or one character's journey"
          className="sticky left-0 flex items-center gap-1 rounded-md border border-dashed border-sf-dark-500 px-2 py-1.5 text-[11px] text-sf-text-muted hover:border-sf-accent/60 hover:text-sf-text-primary">
          <Plus className="h-3 w-3" />Plotline</button>
      </div>
      <p className="mt-3 max-w-3xl text-[10.5px] leading-relaxed text-sf-text-muted">
        Read left to right: that is the order of your story, and the order Copy script and Send to Short Film use. Rows are plotlines that run side by side, like the main plot, a romance or one character’s change. Drag cards to move them; double-click a section or plotline name to rename it.
      </p>
    </div>
  </div>
}
