import type { PromptSiteId } from './prompt-sites';

/**
 * AI image and video sites a Drama Studio browser job can open
 * (docs/PLAN_AI_BROWSER_WORKSPACE.md). One entry per site; job-sites.ts,
 * the capture menu and the manifest are all built from this list.
 *
 * Hand-off only: the Companion fills the prompt and attaches the reference
 * files the person picked, then the person presses the site's own Generate.
 * Nothing here solves a check, gets around a limit or presses Generate.
 *
 * Selectors are plain CSS, most specific first, and end with generic
 * fallbacks so a small page change still finds the box. `mediaHosts` are the
 * hosts the site serves its results from; "Send to Drama Studio" only
 * downloads from those, after Chrome asks the person once per site.
 * Ids match JOB_SITES in electron/companionLink/jobs.cjs.
 */
export type AiSiteKind = 'image' | 'video' | 'audio';

/**
 * The extra boxes of a music site's custom mode. In custom mode the job's
 * prompt goes in `style`; lyrics and title in their own boxes.
 * `customMode` and `simpleMode` name the page's mode tabs (role="tab"):
 * the only things the Companion ever clicks.
 */
export interface SongFields {
  style: readonly string[];
  lyrics: readonly string[];
  title: readonly string[];
  customMode: readonly string[];
  simpleMode: readonly string[];
}

export interface AiSite {
  id: string;
  label: string;
  /** The prompt-fill site whose hostnames this job runs on. */
  promptSite: PromptSiteId;
  kinds: readonly AiSiteKind[];
  /** Where a job opens. Must be https on one of the prompt site's hosts. */
  url: string;
  /** Path prefixes on those hosts where the job may be filled. */
  paths: readonly string[];
  inputSelectors: readonly string[];
  /** File inputs for references, tried in order. */
  fileInputSelectors: readonly string[];
  /** Match patterns for the hosts results are served from. */
  mediaHosts: readonly string[];
  /** Music sites only. */
  song?: SongFields;
  /** Date of the last selector review. */
  revision: string;
}

const GENERIC_PROMPT_BOXES = [
  'textarea[placeholder]',
  'div[contenteditable="true"][role="textbox"]',
  'textarea',
  'div[contenteditable="true"]',
] as const;

const GENERIC_FILE_INPUTS = [
  'input[type="file"][accept*="image"]',
  'input[type="file"][accept*="video"]',
  'input[type="file"]',
] as const;

export const AI_SITES: readonly AiSite[] = [
  {
    id: 'grok-imagine',
    label: 'Grok Imagine',
    promptSite: 'grok',
    kinds: ['image', 'video'],
    url: 'https://grok.com/imagine',
    paths: ['/imagine'],
    inputSelectors: [
      "div[data-testid='drop-ui'] textarea",
      "form div[contenteditable='true']",
    ],
    fileInputSelectors: ['input[type="file"]'],
    mediaHosts: [
      'https://grok.com/*',
      'https://*.grok.com/*',
      'https://imgen.x.ai/*',
      'https://vidgen.x.ai/*',
    ],
    revision: '2026-10-17',
  },
  {
    id: 'google-flow',
    label: 'Google Flow',
    promptSite: 'flow',
    kinds: ['video', 'image'],
    url: 'https://flow.google.com/',
    paths: ['/'],
    inputSelectors: [
      'textarea[id*="prompt" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="video" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: [
      'https://flow.google.com/*',
      'https://labs.google/*',
      'https://*.googleusercontent.com/*',
      'https://storage.googleapis.com/*',
    ],
    revision: '2026-10-18',
  },
  {
    id: 'kling',
    label: 'Kling AI',
    promptSite: 'kling',
    kinds: ['video', 'image'],
    url: 'https://kling.ai/app/text-to-video/new',
    paths: ['/'],
    inputSelectors: [
      'div[contenteditable="true"][class*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: ['https://*.kling.ai/*', 'https://*.klingai.com/*'],
    revision: '2026-10-18',
  },
  {
    id: 'runway',
    label: 'Runway',
    promptSite: 'runway',
    kinds: ['video', 'image'],
    url: 'https://app.runwayml.com/',
    paths: ['/'],
    inputSelectors: [
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'textarea[aria-label*="prompt" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: ['https://*.runwayml.com/*', 'https://*.runwayml.cloud/*'],
    revision: '2026-10-18',
  },
  {
    id: 'hailuo',
    label: 'Hailuo AI',
    promptSite: 'hailuo',
    kinds: ['video', 'image'],
    url: 'https://hailuoai.video/create',
    paths: ['/'],
    inputSelectors: [
      'textarea[placeholder*="describe" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: [
      'https://hailuoai.video/*',
      'https://*.hailuoai.video/*',
      'https://*.hailuoai.com/*',
    ],
    revision: '2026-10-18',
  },
  {
    id: 'luma',
    label: 'Luma Dream Machine',
    promptSite: 'luma',
    kinds: ['video', 'image'],
    url: 'https://dream-machine.lumalabs.ai/',
    paths: ['/'],
    inputSelectors: [
      'textarea[placeholder*="imagine" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: ['https://*.lumalabs.ai/*', 'https://*.cdn-luma.com/*'],
    revision: '2026-10-18',
  },
  {
    id: 'pika',
    label: 'Pika',
    promptSite: 'pika',
    kinds: ['video'],
    url: 'https://create.pika.art/',
    paths: ['/'],
    inputSelectors: [
      'textarea[placeholder*="describe" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: ['https://pika.art/*', 'https://*.pika.art/*'],
    revision: '2026-10-18',
  },
  {
    id: 'chatgpt-images',
    label: 'ChatGPT images',
    promptSite: 'chatgpt',
    kinds: ['image'],
    url: 'https://chatgpt.com/',
    paths: ['/'],
    inputSelectors: [
      'textarea#prompt-textarea',
      '#prompt-textarea[contenteditable="true"]',
      'textarea#mobile-composer-prompt',
    ],
    fileInputSelectors: [
      'input[type="file"][multiple]',
      ...GENERIC_FILE_INPUTS,
    ],
    mediaHosts: ['https://*.oaiusercontent.com/*', 'https://chatgpt.com/*'],
    revision: '2026-10-18',
  },
  {
    id: 'gemini-images',
    label: 'Gemini',
    promptSite: 'gemini',
    kinds: ['image', 'video'],
    url: 'https://gemini.google.com/app',
    paths: ['/'],
    inputSelectors: ['div[contenteditable="true"][role="textbox"]'],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: ['https://*.googleusercontent.com/*'],
    revision: '2026-10-18',
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    promptSite: 'midjourney',
    kinds: ['image', 'video'],
    url: 'https://www.midjourney.com/imagine',
    paths: ['/'],
    inputSelectors: [
      'textarea#desktop_input_bar',
      'textarea[placeholder*="imagine" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: ['https://cdn.midjourney.com/*'],
    revision: '2026-10-18',
  },
  {
    id: 'ideogram',
    label: 'Ideogram',
    promptSite: 'ideogram',
    kinds: ['image'],
    url: 'https://ideogram.ai/t/explore',
    paths: ['/'],
    inputSelectors: [
      'textarea[placeholder*="describe" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: ['https://ideogram.ai/*', 'https://*.ideogram.ai/*'],
    revision: '2026-10-18',
  },
  {
    id: 'leonardo',
    label: 'Leonardo',
    promptSite: 'leonardo',
    kinds: ['image', 'video'],
    url: 'https://app.leonardo.ai/image-generation',
    paths: ['/'],
    inputSelectors: [
      'textarea[placeholder*="prompt" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: GENERIC_FILE_INPUTS,
    mediaHosts: ['https://cdn.leonardo.ai/*', 'https://*.leonardo.ai/*'],
    revision: '2026-10-18',
  },
  {
    id: 'suno',
    label: 'Suno',
    promptSite: 'suno',
    kinds: ['audio'],
    url: 'https://suno.com/create',
    paths: ['/'],
    // Simple mode: one "song description" box.
    inputSelectors: [
      'textarea[placeholder*="describe" i]',
      'textarea[placeholder*="song" i]',
      'textarea[aria-label*="description" i]',
      ...GENERIC_PROMPT_BOXES,
    ],
    fileInputSelectors: [
      'input[type="file"][accept*="audio"]',
      'input[type="file"]',
    ],
    mediaHosts: [
      'https://*.suno.com/*',
      'https://suno.com/*',
      'https://*.suno.ai/*',
    ],
    song: {
      // Checked live on suno.com/create (signed in), 2026-10-18: the style
      // box's placeholder is a rotating example, so its wrapper's test id is
      // the reliable handle; lyrics is a Lexical editor; modes are tabs.
      style: [
        '[data-testid="create-form-styles-wrapper"] textarea',
        'textarea[placeholder*="style" i]',
        'textarea[aria-label*="style" i]',
        'input[placeholder*="style" i]',
        'textarea[placeholder*="genre" i]',
      ],
      lyrics: [
        'div[contenteditable="true"][aria-label*="lyric" i]',
        'textarea[placeholder*="lyric" i]',
        'textarea[aria-label*="lyric" i]',
      ],
      title: ['input[placeholder*="title" i]', 'input[aria-label*="title" i]'],
      customMode: ['Advanced', 'Custom'],
      simpleMode: ['Simple'],
    },
    revision: '2026-10-18',
  },
];

export function findAiSite(id: string): AiSite | null {
  return AI_SITES.find((site) => site.id === id) ?? null;
}

/** True when `hostname` is covered by a `https://host/*` match pattern. */
export function hostMatchesPattern(pattern: string, hostname: string): boolean {
  const match = /^https:\/\/([^/]+)\/\*$/.exec(pattern);
  if (!match?.[1]) return false;
  const host = match[1].toLowerCase();
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('*.')) {
    const base = host.slice(2);
    return name === base || name.endsWith(`.${base}`);
  }
  return name === host;
}

/** Sites whose pages are on `hostname` (several share one host). */
export function aiSitesOnPromptSite(promptSiteId: string): AiSite[] {
  return AI_SITES.filter((site) => site.promptSite === promptSiteId);
}

/** Every media host pattern, for the optional permissions and the menu. */
export const AI_SITE_MEDIA_PATTERNS: readonly string[] = [
  ...new Set(AI_SITES.flatMap((site) => site.mediaHosts)),
];
