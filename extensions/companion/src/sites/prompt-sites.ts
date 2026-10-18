/**
 * AI chat sites the prompt-fill module can type into. Selectors are plain
 * CSS, tried in order from most to least specific. The Companion never
 * presses Send: the person reviews and submits the prompt.
 */
export interface PromptSite {
  id: PromptSiteId;
  label: string;
  /** Exact hostnames (no wildcards). */
  hostnames: readonly string[];
  inputSelectors: readonly string[];
  /** The site reads `?q=` itself, so a query-string prompt is left alone. */
  handlesQueryParameter?: boolean;
}

export type PromptSiteId =
  | 'gemini'
  | 'chatgpt'
  | 'claude'
  | 'perplexity'
  | 'manus'
  | 'grok'
  | 'flow'
  | 'kling'
  | 'runway'
  | 'hailuo'
  | 'luma'
  | 'pika'
  | 'midjourney'
  | 'ideogram'
  | 'leonardo'
  | 'suno';

/** Prompt boxes most image and video sites use, tried last. */
const GENERIC_INPUTS = [
  'textarea[placeholder]',
  'div[contenteditable="true"][role="textbox"]',
  'textarea',
  'div[contenteditable="true"]',
] as const;

export const PROMPT_SITES: readonly PromptSite[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    hostnames: ['gemini.google.com'],
    inputSelectors: [
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"].ql-editor',
      'div[contenteditable="true"]',
    ],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    hostnames: ['chatgpt.com', 'chat.openai.com'],
    inputSelectors: [
      'textarea#prompt-textarea',
      '#prompt-textarea[contenteditable="true"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="ChatGPT"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
  },
  {
    id: 'claude',
    label: 'Claude',
    hostnames: ['claude.ai'],
    inputSelectors: [
      'div[contenteditable="true"][data-testid]',
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][placeholder]',
      'div[contenteditable="true"]',
    ],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    hostnames: ['www.perplexity.ai', 'perplexity.ai'],
    inputSelectors: [
      'textarea[placeholder*="Ask"]',
      'textarea',
      'div[contenteditable="true"]',
    ],
    handlesQueryParameter: true,
  },
  {
    id: 'manus',
    label: 'Manus',
    hostnames: ['manus.im', 'app.manus.im'],
    inputSelectors: [
      'textarea[placeholder*="What"]',
      'textarea[placeholder*="can"]',
      'textarea',
      'div[contenteditable="true"]',
    ],
  },
  {
    id: 'grok',
    label: 'Grok',
    hostnames: ['grok.com'],
    inputSelectors: [
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Grok"]',
      "div[data-testid='drop-ui'] textarea",
      'textarea',
      'div[contenteditable="true"]',
    ],
  },
  // Image and video sites (browser jobs, ai-sites.ts adds each one's own
  // prompt boxes in front of these).
  {
    id: 'flow',
    label: 'Google Flow',
    hostnames: ['flow.google.com', 'labs.google'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'kling',
    label: 'Kling AI',
    hostnames: ['kling.ai', 'www.kling.ai', 'app.klingai.com', 'klingai.com'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'runway',
    label: 'Runway',
    hostnames: ['app.runwayml.com'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'hailuo',
    label: 'Hailuo AI',
    hostnames: ['hailuoai.video', 'www.hailuoai.video'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'luma',
    label: 'Luma Dream Machine',
    hostnames: ['dream-machine.lumalabs.ai'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'pika',
    label: 'Pika',
    hostnames: ['create.pika.art', 'pika.art', 'www.pika.art'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    hostnames: ['www.midjourney.com', 'midjourney.com'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'ideogram',
    label: 'Ideogram',
    hostnames: ['ideogram.ai'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'leonardo',
    label: 'Leonardo',
    hostnames: ['app.leonardo.ai'],
    inputSelectors: GENERIC_INPUTS,
  },
  {
    id: 'suno',
    label: 'Suno',
    hostnames: ['suno.com', 'www.suno.com'],
    inputSelectors: GENERIC_INPUTS,
  },
];

/** Content-script match patterns, one per hostname. */
export const PROMPT_FILL_MATCHES: string[] = PROMPT_SITES.flatMap((site) =>
  site.hostnames.map((hostname) => `https://${hostname}/*`),
);

export function promptSiteForHostname(hostname: string): PromptSite | null {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return (
    PROMPT_SITES.find((site) => site.hostnames.includes(normalized)) ?? null
  );
}
