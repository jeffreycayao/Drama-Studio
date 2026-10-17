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
  'gemini' | 'chatgpt' | 'claude' | 'perplexity' | 'manus' | 'grok';

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
      'div[contenteditable="true"]',
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
