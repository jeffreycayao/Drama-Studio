import {
  ArrowRightLeft, AudioLines, Subtitles, Download, Languages, Music, Pencil, Sparkles, Waves,
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
      where: 'Right-click a music clip',
      clipTypes: ['audio'],
      available: () => {
        const ready = needClip(['audio', 'video'], 'a music or video clip')
        if (ready !== true) return ready
        return clip.assetId ? true : 'This clip has no media to analyze.'
      },
      run: () => handlers.detectBeats(clip.id),
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
