import {
  ArrowRightLeft, AudioLines, Clipboard, Crosshair, Download, Hourglass, Languages, Layers, MoveHorizontal,
  Music, Pencil, ScanFace, Sparkles, Subtitles, Waves,
} from 'lucide-react'
import { canChainFromClip } from '../utils/frameChaining.mjs'
import { canLipSyncClip } from '../utils/lipSyncPlan.mjs'

/**
 * Commands for actions that live in the timeline's clip menu and toolbar
 * overflow. `handlers` come from Timeline.jsx (see commandHandlersRef);
 * `context` from services/commandContext.js. Each command says where it
 * normally lives and, when it cannot run, what to select first.
 */
export function buildTimelineCommands(handlers, context = {}) {
  if (!handlers) return []
  const { clip, track, clipType, captionsClip } = context
  const needClip = (types, label) => {
    if (!clip) return `Select ${label} on the timeline first.`
    if (!types.includes(clipType)) return `Select ${label} on the timeline first.`
    return true
  }
  const liveCaptions = clipType === 'captions' ? clip : captionsClip
  const anyClip = ['video', 'image', 'audio', 'text', 'shape', 'adjustment', 'captions']
  const needSelection = () => (context.selectionCount > 0 ? true : 'Select a clip on the timeline first.')

  return [
    {
      id: 'captions.add',
      title: 'Add captions to the timeline…',
      group: 'Captions',
      icon: Subtitles,
      keywords: ['transcribe', 'subtitles', 'auto captions'],
      where: 'Timeline toolbar › Captions',
      run: () => handlers.addCaptions(),
    },
    {
      id: 'captions.translate',
      title: 'Translate captions…',
      group: 'Captions',
      icon: Languages,
      keywords: ['language', 'dubbing', 'subtitles', 'spanish', 'japanese'],
      where: 'Right-click the captions clip',
      clipTypes: ['captions'],
      available: () => (liveCaptions ? true : 'Add captions to the timeline first.'),
      run: () => handlers.openTranslateCaptions(liveCaptions.id),
    },
    {
      id: 'captions.save-srt',
      title: 'Save subtitles (.srt)…',
      group: 'Captions',
      icon: Download,
      keywords: ['subtitle file', 'export srt', 'youtube captions'],
      where: 'Right-click the captions clip, or Export › Subtitles',
      clipTypes: ['captions'],
      available: () => (liveCaptions ? true : 'Add captions to the timeline first.'),
      run: () => handlers.saveSubtitleFile('srt'),
    },
    {
      id: 'captions.save-vtt',
      title: 'Save subtitles (.vtt)…',
      group: 'Captions',
      icon: Download,
      keywords: ['webvtt', 'subtitle file', 'web player'],
      where: 'Export › Subtitles',
      available: () => (liveCaptions ? true : 'Add captions to the timeline first.'),
      run: () => handlers.saveSubtitleFile('vtt'),
    },
    {
      id: 'captions.edit',
      title: 'Edit captions…',
      group: 'Captions',
      icon: Pencil,
      keywords: ['fix words', 'caption style'],
      where: 'Right-click the captions clip',
      clipTypes: ['captions'],
      available: () => (liveCaptions ? true : 'Add captions to the timeline first.'),
      run: () => handlers.editCaptions(liveCaptions),
    },
    {
      id: 'clip.continue-last-frame',
      title: 'Continue from last frame (AI)…',
      group: 'AI',
      icon: Sparkles,
      keywords: ['extend shot', 'next shot', 'chain', 'longer video'],
      where: 'Right-click a video or image clip',
      clipTypes: ['video', 'image'],
      available: () => {
        const ready = needClip(['video', 'image'], 'a video or image clip')
        if (ready !== true) return ready
        return canChainFromClip(clip, track) ? true : 'This clip cannot be continued (hidden track or no picture).'
      },
      run: () => handlers.continueFromLastFrame(clip),
    },
    {
      id: 'clip.lip-sync',
      title: 'Lip-sync to dialogue (sync.so)…',
      group: 'AI',
      icon: AudioLines,
      keywords: ['mouth', 'talking', 'sync voice', 'dubbing'],
      where: 'Right-click a video clip',
      clipTypes: ['video'],
      available: () => {
        const ready = needClip(['video'], 'a video clip')
        if (ready !== true) return ready
        return canLipSyncClip(clip, track) ? true : 'Lip-sync needs a video clip on a visible track.'
      },
      run: () => handlers.openLipSync(clip.id),
    },
    {
      id: 'clip.smart-replace',
      title: 'Smart Replace…',
      group: 'Edit',
      icon: ArrowRightLeft,
      keywords: ['swap media', 'replace clip', 'new take'],
      where: 'Right-click a clip',
      clipTypes: ['video', 'image', 'audio'],
      available: () => {
        const ready = needClip(['video', 'image', 'audio'], 'a clip')
        if (ready !== true) return ready
        const eligibility = handlers.getSmartReplaceEligibility(clip.id)
        return eligibility?.ok ? true : (eligibility?.reason || 'This clip cannot be replaced.')
      },
      run: () => handlers.openSmartReplace(clip.id),
    },
    {
      id: 'clip.detect-beats',
      title: 'Detect beats → markers',
      group: 'Audio',
      icon: Waves,
      keywords: ['beat sync', 'cut to the beat', 'rhythm', 'bpm'],
      where: 'Right-click a music or video clip',
      clipTypes: ['audio', 'video'],
      available: () => {
        const ready = needClip(['audio', 'video'], 'a music or video clip')
        if (ready !== true) return ready
        return clip.assetId ? true : 'This clip has no media to analyze.'
      },
      run: () => handlers.detectBeats(clip.id),
    },
    // Pro editing tools: also in the clip right-click menu.
    {
      id: 'clip.add-mask',
      title: 'Add mask…',
      group: 'Edit',
      icon: ScanFace,
      keywords: ['matte', 'cut out', 'roto', 'background removal', 'isolate'],
      where: 'Right-click a video or image clip › Add Mask',
      clipTypes: ['video', 'image'],
      available: () => needClip(['video', 'image'], 'a video or image clip'),
      run: () => handlers.openMaskPicker(clip.id),
    },
    {
      id: 'clip.compound-create',
      title: 'Create compound clip…',
      group: 'Edit',
      icon: Layers,
      keywords: ['group clips', 'nest', 'nested sequence', 'combine'],
      where: 'Right-click selected clips',
      clipTypes: anyClip,
      available: () => {
        const ready = needSelection()
        if (ready !== true) return ready
        return handlers.canCreateCompound?.() === false ? 'Compounds cannot contain another compound.' : true
      },
      run: () => handlers.openCompoundCreate(),
    },
    {
      id: 'clip.paste-attributes',
      title: 'Paste attributes…',
      group: 'Edit',
      icon: Clipboard,
      keywords: ['copy look', 'copy effects', 'copy settings', 'match settings'],
      where: 'Right-click a clip (copy a clip first)',
      clipTypes: anyClip,
      available: () => {
        const ready = needSelection()
        if (ready !== true) return ready
        return handlers.hasAttributeClipboard?.() ? true : 'Copy a clip first (Ctrl+C), then select the clips to paste onto.'
      },
      run: () => handlers.openPasteAttributes(),
    },
    {
      id: 'clip.match-frame',
      title: 'Match frame in source player',
      group: 'Edit',
      icon: Crosshair,
      keywords: ['source frame', 'find original', 'reverse match'],
      where: 'Right-click a video or audio clip',
      clipTypes: ['video', 'audio'],
      available: () => {
        const ready = needClip(['video', 'audio'], 'a video or audio clip')
        if (ready !== true) return ready
        const assetType = context.asset?.type
        return assetType === 'video' || assetType === 'audio' ? true : 'This clip has no source media.'
      },
      run: () => handlers.openMatchFrame(clip),
    },
    {
      id: 'clip.move-by-offset',
      title: 'Move by offset…',
      group: 'Edit',
      icon: MoveHorizontal,
      keywords: ['nudge', 'shift', 'exact timecode', 'offset'],
      where: 'Right-click a clip',
      clipTypes: anyClip,
      available: needSelection,
      run: () => handlers.openMoveOffset(),
    },
    {
      id: 'clip.change-duration',
      title: 'Change duration…',
      group: 'Edit',
      icon: Hourglass,
      keywords: ['length', 'extend', 'shorten', 'exact duration'],
      where: 'Right-click a clip',
      clipTypes: anyClip,
      available: needSelection,
      run: () => handlers.openDurationDelta(),
    },
    {
      id: 'music.generate',
      title: 'Generate music…',
      group: 'AI',
      icon: Music,
      keywords: ['song', 'soundtrack', 'ace-step', 'yue', 'background music', 'lyrics'],
      where: 'Timeline toolbar › … › Generate Music',
      run: () => handlers.openMusicPopover(),
    },
  ]
}
