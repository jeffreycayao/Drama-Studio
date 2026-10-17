import {
  BookMarked, BookOpen, Clapperboard, Compass, Download, FolderOpen, HelpCircle, Lightbulb, MessageSquare,
  Music2, Package, PlayCircle, Save, Settings, SlidersHorizontal, Sparkles, Stethoscope, Users, Video, Wand2,
} from 'lucide-react'
import { openPromptLibrary } from '../stores/promptLibraryStore'

const TABS = [
  { id: 'editor', title: 'Editor', icon: Clapperboard },
  { id: 'idea-pad', title: 'Idea Pad', icon: Lightbulb, keywords: ['story', 'script', 'plot'] },
  { id: 'generate', title: 'Generate', icon: Sparkles, keywords: ['ai', 'image', 'video', 'text to video', 'image to video'] },
  { id: 'stock', title: 'Stock', icon: FolderOpen, keywords: ['pexels', 'free footage', 'b-roll'] },
  { id: 'comfyui', title: 'ComfyUI', icon: Wand2, keywords: ['nodes', 'workflow editor'] },
  { id: 'export', title: 'Export', icon: Download, keywords: ['render', 'mp4', 'deliver'] },
  { id: 'discover', title: 'Discover', icon: PlayCircle, keywords: ['tutorials', 'videos'] },
]

const SETTINGS = [
  ['storage', 'Projects & Storage', ['autosave', 'projects folder']],
  ['stock', 'Stock media', ['pexels key', 'unsplash', 'pixabay']],
  ['sfx', 'Sound effects library', ['sfx catalog']],
  ['connection', 'ComfyUI Connection', ['comfy.org api key', 'cloud key', 'address', 'port']],
  ['agents', 'Agents (MCP)', ['assistant model', 'ollama', 'lm studio', 'claude', 'openai', 'codex']],
  ['launcher', 'ComfyUI Launcher', ['start comfyui', 'logs']],
  ['paths', 'File Paths', ['output folder', 'workflows folder']],
  ['workflow-setup', 'Workflow Setup', ['missing models', 'nodes', 'dependencies', 'install']],
  ['language', 'Language', ['japanese', 'english']],
  ['appearance', 'Appearance', ['theme', 'dark']],
  ['notifications', 'Notifications', ['sound when done']],
  ['hotkeys', 'Hotkeys', ['keyboard shortcuts', 'premiere', 'resolve', 'final cut']],
  ['project', 'New Project Defaults', ['resolution', 'frame rate']],
  ['feedback', 'Send Feedback', ['bug', 'idea']],
]

/**
 * App-wide commands: workspaces, panels, settings pages, help. `handlers`
 * come from App.jsx; `t` translates titles that already exist in the app.
 */
export function buildAppCommands(handlers, context = {}, t = (_key, _vars, fallback) => fallback) {
  if (!handlers) return []
  const needProject = () => (context.hasProject ? true : 'Open a project first.')
  return [
    ...TABS.map((tab) => ({
      id: `tab.${tab.id}`,
      title: `Go to ${t(`topTabs.${tab.id}`, undefined, tab.title)}`,
      group: 'Go to',
      icon: tab.icon,
      keywords: tab.keywords,
      where: 'Top bar',
      run: () => handlers.setMainTab(tab.id),
    })),
    { id: 'panel.mixer', title: 'Show the audio mixer', group: 'Panels', icon: SlidersHorizontal, keywords: ['volume', 'faders', 'mute', 'solo'], where: 'Under the timeline › Mixer', run: () => handlers.showBottomView('mixer') },
    { id: 'panel.dopesheet', title: 'Show the dope sheet (keyframes)', group: 'Panels', icon: SlidersHorizontal, keywords: ['keyframes', 'animation', 'easing'], where: 'Under the timeline › Dope Sheet', run: () => handlers.showBottomView('dopesheet') },
    { id: 'panel.scopes', title: 'Show scopes', group: 'Panels', icon: SlidersHorizontal, keywords: ['waveform', 'vectorscope', 'color'], where: 'Under the timeline › Scopes', run: () => handlers.showBottomView('scopes') },
    { id: 'audio.auto-duck', title: 'Auto-duck music under dialogue…', group: 'Audio', icon: Music2, keywords: ['ducking', 'music too loud', 'lower music'], where: 'Under the timeline › Mixer › Auto-duck…', available: needProject, run: () => handlers.openAutoDuck() },
    { id: 'packs.import', title: t('packImport.command', undefined, 'Import a workflow pack (.zip)…'), group: 'Generate', icon: Package, keywords: ['pack', 'zip', 'dspack', 'shared workflows', 'import workflows', 'seedance', 'prompt templates', 'chrome extension'], where: 'Generate › My Workflows › Import pack…, or drop a .zip on the app', run: () => handlers.openPackImport() },
    { id: 'prompts.open', title: t('promptLibrary.commandOpen', undefined, 'Open the prompt library'), group: 'AI', icon: BookMarked, keywords: ['prompts', 'templates', 'ideas', 'loglines', 'saved prompts', 'negative prompt'], where: 'Drama Studio menu › Prompt library', run: () => openPromptLibrary() },
    { id: 'prompts.new', title: t('promptLibrary.commandNew', undefined, 'Save a new prompt to the library…'), group: 'AI', icon: BookMarked, keywords: ['add prompt', 'new template', 'save prompt'], where: 'Prompt library › New prompt', run: () => openPromptLibrary({ newPrompt: true }) },
    { id: 'app.assistant', title: 'Open the AI Assistant', group: 'AI', icon: MessageSquare, keywords: ['chat', 'ai edit', 'agent'], where: 'Top bar › Assistant', run: () => handlers.toggleAssistant() },
    { id: 'app.cast', title: 'Open the Cast Locker', group: 'AI', icon: Users, keywords: ['characters', 'face', 'wardrobe', 'consistent'], where: 'Top bar › Cast', run: () => handlers.openCastLocker() },
    { id: 'app.export-subtitles', title: 'Export with subtitle files…', group: 'Captions', icon: Video, keywords: ['srt', 'vtt', 'subtitles'], where: 'Export › Subtitles', run: () => handlers.setMainTab('export') },
    { id: 'app.save', title: 'Save project', group: 'Edit', icon: Save, keywords: ['save'], where: 'Bottom bar › Save', available: needProject, run: () => handlers.saveProject() },
    { id: 'help.center', title: 'Open the Help Center', group: 'Help', icon: HelpCircle, keywords: ['guide', 'how to', 'faq'], shortcut: 'F1', where: 'Top bar › Help', run: () => handlers.openHelp() },
    { id: 'help.whats-new', title: "What's new", group: 'Help', icon: Sparkles, keywords: ['new features', 'changelog', 'latest'], where: 'Help Center home', run: () => handlers.openHelp() },
    { id: 'help.setup-doctor', title: 'Check my setup (Setup Doctor)', group: 'Help', icon: Stethoscope, keywords: ['missing', 'gpu', 'vram', 'requirements', 'local or cloud'], where: 'Bottom bar › Drama Studio › Getting Started', run: () => handlers.openGettingStarted() },
    { id: 'help.tour', title: 'Start the guided tour', group: 'Help', icon: Compass, keywords: ['tour', 'walkthrough', 'onboarding'], where: 'Getting Started', run: () => handlers.startTour() },
    { id: 'help.getting-started', title: 'Getting Started', group: 'Help', icon: BookOpen, where: 'Bottom bar › Drama Studio menu', run: () => handlers.openGettingStarted() },
    ...SETTINGS.map(([id, title, keywords]) => ({
      id: `settings.${id}`,
      title: `Settings: ${t(`settings.sections.${id}.title`, undefined, title)}`,
      group: 'Settings',
      icon: Settings,
      keywords: ['settings', 'preferences', ...keywords],
      where: 'Bottom bar › Drama Studio › Settings',
      run: () => handlers.openSettings(id),
    })),
  ]
}
