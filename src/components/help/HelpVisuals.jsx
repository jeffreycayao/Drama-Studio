import { createContext, useContext } from 'react'
import {
  ArrowDown, ArrowRight, AudioLines, BookOpen, Bot, Check, Cloud, Cpu, Eye, FileVideo, Film, Folder,
  FolderOpen, Image as ImageIcon, LayoutGrid, MessageSquare, MousePointerClick, Music, PenLine,
  Play, RotateCcw, Scissors, SlidersHorizontal, Sparkles, Upload, UserRound, Users, Wand2,
} from 'lucide-react'

/**
 * Plain-language diagrams for the Help Center, built from theme tokens so
 * they follow every theme. Ids are referenced by `{ type: 'visual', id }`
 * blocks in src/config/helpGuide.js (and checked by helpSearch.test.mjs).
 *
 * Every label goes through tr(label), where label is the English text; a Help language pack maps
 * those English strings to its language (helpGuideJa/visuals.js, checked by
 * helpGuideJa.test.mjs). Missing ones stay in English.
 */

const TextContext = createContext((text) => text)
const useTr = () => useContext(TextContext)

function Node({ icon: Icon, title, sub, tone = 'default', className = '' }) {
  const tr = useTr()
  const tones = {
    default: 'border-sf-dark-600 bg-sf-dark-800/80',
    accent: 'border-sf-accent/50 bg-sf-accent/10',
    blue: 'border-sf-blue/40 bg-sf-blue/10',
    quiet: 'border-sf-dark-700 bg-sf-dark-900/70',
  }
  const iconTones = {
    default: 'bg-sf-dark-700 text-sf-text-secondary',
    accent: 'bg-sf-accent text-sf-accent-on',
    blue: 'bg-sf-blue/80 text-sf-accent-on',
    quiet: 'bg-sf-dark-800 text-sf-text-muted',
  }
  return (
    <div className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 shadow-[0_1px_0_rgb(255_255_255/0.04)_inset] ${tones[tone]} ${className}`}>
      {Icon && (
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconTones[tone]}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[12px] font-semibold leading-tight text-sf-text-primary">{tr(title)}</div>
        {sub && <div className="text-[10.5px] leading-snug text-sf-text-muted">{tr(sub)}</div>}
      </div>
    </div>
  )
}

function Arrow({ down = false }) {
  const Icon = down ? ArrowDown : ArrowRight
  return <Icon className={`h-4 w-4 shrink-0 text-sf-accent/80 ${down ? 'mx-auto' : ''}`} aria-hidden="true" />
}

function Flow({ children }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

function Frame({ caption, children }) {
  const tr = useTr()
  return (
    <figure className="my-4 overflow-hidden rounded-2xl border border-sf-dark-700 bg-gradient-to-b from-sf-dark-800/60 to-sf-dark-900/60 p-4">
      {children}
      {caption && <figcaption className="mt-3 text-[11px] leading-relaxed text-sf-text-muted">{tr(caption)}</figcaption>}
    </figure>
  )
}

function Steps({ items }) {
  const tr = useTr()
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(118px,1fr))]">
      {items.map(({ icon: Icon, title, sub }, index) => (
        <li key={title} className="relative rounded-xl border border-sf-dark-600 bg-sf-dark-800/70 px-3 py-3">
          <span className="font-mono text-[10px] text-sf-accent">{String(index + 1).padStart(2, '0')}</span>
          <div className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-sf-text-primary">
            <Icon className="h-3.5 w-3.5 text-sf-accent" aria-hidden="true" />{tr(title)}
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-sf-text-muted">{tr(sub)}</p>
        </li>
      ))}
    </ol>
  )
}

function BigPicture() {
  const tr = useTr()
  return (
    <Frame caption="Every step happens in one app, and the AI Assistant can help at any of them.">
      <Flow>
        <Node icon={BookOpen} title="Plan" sub="Idea Pad, Cast" />
        <Arrow />
        <Node icon={Sparkles} title="Make" sub="Generate with AI" tone="accent" />
        <Arrow />
        <Node icon={Scissors} title="Edit" sub="Timeline" />
        <Arrow />
        <Node icon={Upload} title="Deliver" sub="Export" />
      </Flow>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-sf-dark-500 px-3 py-2 text-[11px] text-sf-text-secondary">
        <MessageSquare className="h-3.5 w-3.5 text-sf-accent" aria-hidden="true" />
        {tr('AI Assistant: ask for edits, ideas or fixes at any step')}
      </div>
    </Frame>
  )
}

function ScreenMap() {
  const tr = useTr()
  const box = 'flex items-center justify-center rounded-lg border border-sf-dark-600 bg-sf-dark-800/80 p-2 text-center text-[10.5px] text-sf-text-secondary'
  return (
    <Frame caption="The Editor: media on the left, preview in the middle, the selected clip's settings on the right, timeline at the bottom.">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 2fr 1fr', gridTemplateRows: 'auto 92px 72px' }}>
        <div className="col-span-3 flex flex-wrap items-center justify-between gap-1 rounded-lg border border-sf-dark-600 bg-sf-dark-950 px-2 py-1.5 text-[10px]">
          <span className="flex flex-wrap gap-1">
            <span className="rounded bg-sf-dark-600 px-1.5 py-0.5 font-medium text-sf-text-primary shadow-[inset_0_-2px_0_rgb(var(--sf-accent))]">{tr('Editor')}</span>
            {['Idea Pad', 'Motion Studio', 'Generate', 'Stock'].map((tab) => <span key={tab} className="px-1 py-0.5 text-sf-text-muted">{tr(tab)}</span>)}
          </span>
          <span className="flex flex-wrap items-center gap-1 text-sf-text-muted">
            <span className="rounded border border-sf-accent/50 px-1.5 text-sf-text-primary">{tr('Help')}</span>
            <span>{tr('Assistant')}</span>
            <span className="rounded border border-sf-dark-600 px-1">{tr('Cast')} · {tr('Prompts')} · ComfyUI</span>
            <span className="rounded bg-sf-accent px-1.5 py-0.5 font-medium text-sf-accent-on">{tr('Export')}</span>
          </span>
        </div>
        <div className={box}><span><FolderOpen className="mx-auto mb-1 h-4 w-4 text-sf-accent" />{tr('Assets, effects, text, sounds')}</span></div>
        <div className={`${box} bg-black/40`}><span><Play className="mx-auto mb-1 h-4 w-4 text-sf-accent" />{tr('Preview')}</span></div>
        <div className={box}><span><SlidersHorizontal className="mx-auto mb-1 h-4 w-4 text-sf-accent" />{tr('Inspector (clip settings)')}</span></div>
        <div className={`${box} col-span-3`}><span><Film className="mx-auto mb-1 h-4 w-4 text-sf-accent" />{tr('Timeline: tracks and clips. Switch below it to Mixer, Dope Sheet or Scopes.')}</span></div>
      </div>
    </Frame>
  )
}

function ProjectFolder() {
  const tr = useTr()
  const row = (depth, icon, name, note, strong = false) => (
    <div className="flex items-center gap-1.5 py-0.5 font-mono text-[11px]" style={{ paddingLeft: depth * 14 }}>
      {icon}
      <span className={strong ? 'text-sf-text-primary' : 'text-sf-text-secondary'}>{name}</span>
      {note && <span className="ml-auto pl-2 font-sans text-[10px] text-sf-text-muted">{tr(note)}</span>}
    </div>
  )
  const folder = <Folder className="h-3.5 w-3.5 shrink-0 text-sf-accent" aria-hidden="true" />
  const file = <FileVideo className="h-3.5 w-3.5 shrink-0 text-sf-text-muted" aria-hidden="true" />
  return (
    <Frame caption="Left: what is really on your disk. Right: the same files as the Assets panel organizes them. Tidying folders in the app never moves your files.">
      <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-950/70 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sf-text-muted">{tr('On your computer')}</div>
          {row(0, folder, tr('My Project/'), null, true)}
          {row(1, file, 'project.comfystudio', 'your edit')}
          {row(1, folder, 'assets/')}
          {row(2, folder, 'video/', 'all videos')}
          {row(2, folder, 'images/', 'all images')}
          {row(2, folder, 'audio/', 'music, voices, sfx')}
          {row(1, folder, 'renders/', 'exports')}
          {row(1, folder, 'autosave/', 'backups')}
          {row(1, folder, 'cache/', 'temporary')}
        </div>
        <div className="flex items-center justify-center text-[10px] text-sf-text-muted md:flex-col">
          <ArrowRight className="hidden h-5 w-5 text-sf-accent md:block" aria-hidden="true" />
          <ArrowDown className="h-5 w-5 text-sf-accent md:hidden" aria-hidden="true" />
          <span className="ml-2 md:ml-0 md:mt-1">{tr('same files')}</span>
        </div>
        <div className="rounded-xl border border-sf-accent/30 bg-sf-dark-950/70 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sf-text-muted">{tr('In the Assets panel')}</div>
          {row(0, folder, tr('Generated'), null, true)}
          {row(1, folder, tr('Images › workflow name'))}
          {row(1, folder, tr('Videos › workflow name'))}
          {row(1, folder, tr('Audio'))}
          {row(0, folder, tr('Stock › Pexels › your search'), null, true)}
          {row(0, folder, tr('Sound Effects'), null, true)}
          {row(0, folder, tr('Imported from ComfyUI'), null, true)}
          {row(0, folder, tr('Captions'), null, true)}
          {row(0, folder, tr('Your own folders'), null, true)}
        </div>
      </div>
    </Frame>
  )
}

function GenerationFlow() {
  const tr = useTr()
  return (
    <Frame caption="Local and cloud results take the same road home: they are saved in your project and show up in Assets, ready to edit.">
      <div className="grid items-center gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1.15fr_auto_1fr]">
        <Node icon={PenLine} title="You describe it" sub="Generate tab" tone="accent" />
        <Arrow />
        <Node icon={Wand2} title="ComfyUI" sub="the AI engine" />
        <Arrow />
        <div className="grid gap-1.5">
          <Node icon={Cpu} title="Your graphics card" sub="Local: free" tone="quiet" />
          <Node icon={Cloud} title="Cloud service" sub="Uses credits" tone="blue" />
        </div>
        <Arrow />
        <Node icon={FolderOpen} title="Your project" sub="Assets › Generated" tone="accent" />
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-sf-text-secondary">
        <MousePointerClick className="h-3.5 w-3.5 text-sf-accent" aria-hidden="true" />
        {tr('Then drag it onto the timeline, or ask the Assistant to place it.')}
      </div>
    </Frame>
  )
}

function LocalVsCloud() {
  const tr = useTr()
  const card = (icon, title, tone, points) => (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center gap-2 text-[13px] font-semibold text-sf-text-primary">{icon}{tr(title)}</div>
      <ul className="mt-2 space-y-1">
        {points.map((point) => (
          <li key={point} className="flex gap-1.5 text-[11px] leading-snug text-sf-text-secondary">
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-sf-accent" aria-hidden="true" />{tr(point)}
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <Frame>
      <div className="grid gap-3 md:grid-cols-2">
        {card(<Cpu className="h-4 w-4 text-sf-accent" />, 'Local: on your PC', 'border-sf-dark-600 bg-sf-dark-800/70', [
          'Free to run as much as you like',
          'Private: nothing leaves your computer',
          'Needs an NVIDIA card (12–16 GB for video)',
          'Big model downloads, first run is slow',
        ])}
        {card(<Cloud className="h-4 w-4 text-sf-blue" />, 'Cloud: on their computers', 'border-sf-blue/30 bg-sf-blue/5', [
          'Works on any PC, even a laptop',
          'Top commercial models, fast and steady',
          'Paid per result with credits',
          'Your prompt and images go to the provider',
        ])}
      </div>
    </Frame>
  )
}

function PcTiers() {
  const tr = useTr()
  const max = 24
  const tasks = [
    { label: 'AI video', cuts: [12, 16] },
    { label: 'AI images', cuts: [6, 12] },
    { label: 'Local Assistant', cuts: [6, 12] },
  ]
  return (
    <Frame caption="Graphics card memory (VRAM) on an NVIDIA card. Find yours in Setup Doctor. AMD, Intel and Mac: use the cloud for video.">
      <div className="space-y-2.5">
        {tasks.map(({ label, cuts }) => (
          <div key={label} className="grid items-center gap-2 sm:grid-cols-[120px_1fr]">
            <span className="text-[11px] font-medium text-sf-text-secondary">{tr(label)}</span>
            <div className="flex h-6 overflow-hidden rounded-md text-[9.5px] font-medium">
              <div className="flex items-center justify-center bg-sf-blue/25 text-sf-text-primary" style={{ width: `${(cuts[0] / max) * 100}%` }}>{tr('cloud')}</div>
              <div className="flex items-center justify-center bg-sf-warning/30 text-sf-text-primary" style={{ width: `${((cuts[1] - cuts[0]) / max) * 100}%` }}>{tr('limited')}</div>
              <div className="flex flex-1 items-center justify-center bg-sf-accent/80 text-sf-accent-on">{tr('good')}</div>
            </div>
          </div>
        ))}
        <div className="grid sm:grid-cols-[120px_1fr]">
          <span />
          <div className="relative h-3 font-mono text-[9.5px] text-sf-text-muted">
            {[0, 6, 12, 16, 24].map((gb) => (
              <span
                key={gb}
                className="absolute top-0 whitespace-nowrap"
                style={gb === 0 ? { left: 0 } : gb === max ? { right: 0 } : { left: `${(gb / max) * 100}%`, transform: 'translateX(-50%)' }}
              >
                {gb === max ? '24+ GB' : gb}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  )
}

function ImageToVideo() {
  return (
    <Frame>
      <Steps items={[
        { icon: ImageIcon, title: 'Pick a picture', sub: 'From Assets, or a frame on the timeline' },
        { icon: PenLine, title: 'Describe the motion', sub: '"she turns and smiles, slow push-in"' },
        { icon: LayoutGrid, title: 'Choose a workflow', sub: 'LTX / WAN locally, Kling / Vidu in the cloud' },
        { icon: Sparkles, title: 'Queue it', sub: 'Keep editing while it runs' },
        { icon: Film, title: 'It lands in Assets', sub: 'Generated › Videos, ready to drag in' },
      ]} />
    </Frame>
  )
}

function ConsistencyPath() {
  const tr = useTr()
  return (
    <Frame caption="Text to video invents a new face each time. Make the character once as an image, save it in the Cast Locker, then animate it shot after shot.">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900/70 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sf-text-muted">{tr('Text to video only')}</div>
          <Flow>
            <Node icon={PenLine} title="Prompt" tone="quiet" />
            <Arrow />
            <div className="flex gap-1">
              {['A', 'B', 'C'].map((face) => (
                <span key={face} className="flex h-9 w-9 items-center justify-center rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-[11px] text-sf-text-muted">
                  <UserRound className="h-4 w-4" aria-hidden="true" />{face}
                </span>
              ))}
            </div>
          </Flow>
          <p className="mt-2 text-[10.5px] text-sf-warning">{tr('A different person in every shot')}</p>
        </div>
        <div className="rounded-xl border border-sf-accent/40 bg-sf-accent/5 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sf-text-muted">{tr('Recommended')}</div>
          <Flow>
            <Node icon={ImageIcon} title="Image" tone="quiet" />
            <Arrow />
            <Node icon={Users} title="Cast Locker" tone="accent" />
            <Arrow />
            <div className="flex gap-1">
              {[1, 2, 3].map((shot) => (
                <span key={shot} className="flex h-9 w-9 items-center justify-center rounded-lg border border-sf-accent/50 bg-sf-dark-800 text-[11px] text-sf-text-primary">
                  <UserRound className="h-4 w-4 text-sf-accent" aria-hidden="true" />A
                </span>
              ))}
            </div>
          </Flow>
          <p className="mt-2 text-[10.5px] text-sf-success">{tr('The same person in every shot')}</p>
        </div>
      </div>
    </Frame>
  )
}

function EditingFlow() {
  const tr = useTr()
  return (
    <Frame>
      <Flow>
        <Node icon={FolderOpen} title="Assets" sub="your media" />
        <Arrow />
        <Node icon={Film} title="Timeline" sub="drag, cut, arrange" tone="accent" />
        <Arrow />
        <Node icon={SlidersHorizontal} title="Inspector" sub="adjust the clip" />
        <Arrow />
        <Node icon={Eye} title="Preview" sub="watch it" />
        <Arrow />
        <Node icon={Upload} title="Export" sub="finished file" />
      </Flow>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10.5px] text-sf-text-muted">
        {[
          [Music, 'Mixer for sound'],
          [AudioLines, 'Captions'],
          [Bot, 'Assistant can do any step'],
        ].map(([Icon, label]) => (
          <span key={label} className="inline-flex items-center gap-1 rounded-full border border-sf-dark-600 px-2 py-0.5">
            <Icon className="h-3 w-3 text-sf-accent" aria-hidden="true" />{tr(label)}
          </span>
        ))}
      </div>
    </Frame>
  )
}

function AssistantFlow() {
  return (
    <Frame caption="Nothing changes until you click Apply, and every applied change can be undone.">
      <Steps items={[
        { icon: MessageSquare, title: 'You ask', sub: '"Remove the pauses on Track 1"' },
        { icon: Eye, title: 'It looks first', sub: 'Reads your timeline and clips' },
        { icon: LayoutGrid, title: 'It shows a preview', sub: 'Exactly what would change' },
        { icon: Check, title: 'You click Apply', sub: 'Or ask for changes' },
        { icon: RotateCcw, title: 'Undo any time', sub: 'Normal undo, plus checkpoints' },
      ]} />
    </Frame>
  )
}

const VISUALS = {
  'big-picture': BigPicture,
  'screen-map': ScreenMap,
  'project-folder': ProjectFolder,
  'generation-flow': GenerationFlow,
  'local-vs-cloud': LocalVsCloud,
  'pc-tiers': PcTiers,
  'image-to-video': ImageToVideo,
  'consistency-path': ConsistencyPath,
  'editing-flow': EditingFlow,
  'assistant-flow': AssistantFlow,
}

/** @param {{ id: string, text?: Record<string, string> }} props  text: English label -> translation */
export default function HelpVisual({ id, text = null }) {
  const Visual = VISUALS[id]
  if (!Visual) return null
  const tr = text ? (value) => text[value] || value : (value) => value
  return (
    <TextContext.Provider value={tr}>
      <Visual />
    </TextContext.Provider>
  )
}
