import type { SiteAdapter } from './types';

/** Hosts the batch runner may touch; mirrored in the manifest. */
export const GROK_HOST_PERMISSIONS = [
  'https://grok.com/*',
  'https://*.grok.com/*',
  'https://imgen.x.ai/*',
  'https://vidgen.x.ai/*',
] as const;

export const GROK_IMAGINE_URL = 'https://grok.com/imagine';

/**
 * Grok Imagine selectors. They use the small jQuery-style dialect understood
 * by `content/dom/jquery-bridge.ts` (`:eq()`, `:contains()`, `:last()`,
 * `:visible`). When Grok changes its page, update this object, bump
 * `revision`, and run the adapter tests.
 */
const grokSelectors = {
  imagineLink: 'a[href="/imagine"], button:has(path[d^="m12 19-7-7 7-7"])',
  videoModeButton:
    'button:has(path[d^="M12 4C14.4853 4 16.5 6.01472 16.5 8.5V15.5C16.5 17.9853"]',
  imageModeButton:
    'button:has(path[d^="M14.0996 2.5C15.2032 2.5 16.0914 2.49903 16.8086 2.55762C17.5373 2.61716 18.1773 2.74327 18.7695 3.04492C19.7103 3.52429 20.4757 4.28966 20.9551 5.23047C21.2567 5.82266 21.3828 6.4627 21.4424 7.19141C21.501 7.90857 21.5 8.79681 21.5 9.90039V14.0996C21.5 15.2032 21.501 16.0914 21.4424 16.8086C21.3828 17.5373 21.2567 18.1773 20.9551 18.7695C20.4757 19.7103"]',
  imageSpeedModel: 'div[role="radiogroup"]:eq(1) button:eq(0)',
  imageQualityModel: 'div[role="radiogroup"]:eq(1) button:eq(1)',
  aspectRatioButton: 'button:has(span:contains(":"))',
  aspectRatioTemplateV3:
    'div[role="menuitemradio"]:has(span:contains("{aspectRatio}"))',
  numberOfImagesOutputButton:
    'button:has(path[d^="M12.2002 6C13.0237 6 13.7016 5.99898 14.252 6.04395C14.814 6.08987 15.3311 6.18827 15.8164"])',
  numberOfImagesOutputTemplate:
    'div[role="menuitem"]:contains("{numberOfImages}")',
  videoQuality480pItem: 'button:has(span:contains("480p"))',
  videoQuality720pItem: 'button:has(span:contains("720p"))',
  videoQuality1080pItem: 'button:has(span:contains("1080p"))',
  videoLength6sItem: 'button:has(span:contains("6s"))',
  videoLength10sItem: 'button:has(span:contains("10s"))',
  videoLength15sItem: 'button:has(span:contains("15s"))',
  plusImageButton: 'button:has(path[d="M6 6L18 18M18 6L6 18"])',
  fileInput: 'input[type="file"]',
  promptContentEditable: "form div[contenteditable='true']:eq(0)",
  promptDropUiTextarea: "div[data-testid='drop-ui'] textarea:eq(0)",
  imageUploading: 'span.animate-pulse, div.animate-spin',
  imageUploadFailed: 'svg.lucide-triangle-alert',
  removeFailedUploadedImage: 'button svg.lucide-x',
  submitButton:
    'button.rounded-full:has(path[d="M6 11L12 5M12 5L18 11M12 5V19"]):not(:disabled)',
  comparisonImage: "img[class*='hover:ring-4 hover:ring-surface-invert']",
  ignoreComparisonImageButton:
    "div.absolute > div.flex-col > button[class*='rounded-full']",
  generateVideoButton:
    'button[data-filmstrip-item="true"]:has(div[class*="animate-spin"]):eq(0), button[data-filmstrip-item="true"]:has(div:contains("%"))',
  mainArticle: 'div[id^="imagine-masonry-section-"]:last(), main article',
  generatedImageItem:
    'div[role="listitem"]:not(:has(div.invisible)) img:visible',
  shareButton: 'button:has(path[d^="M6.99609 9L11.9961 4L16.9961"]',
  moreOptionsButton:
    'div[class*="absolute"] > button:has(path[d^="M21 7H10M14 17H3M20.25 17C20.25 18.6569 18.9069 20 17.25"])',
  extendVideoMenuItem:
    'div:has(path[d^="M12.1676 2.5C13.0873 2.5 13.8275 2.49919 14.4251"]):last()',
  upscaleMenuItem:
    'button:has(path[d^="M11.7503 2.0835C12.67"]), div[role="menuitem"]:has(path[d^="M11.7503 2.0835C12.67"]):last()',
  upscale720pOption: 'div[role="menuitem"]:contains("720")',
  upscale1080pOption: 'div[role="menuitem"]:contains("1080")',
  hdButton:
    'main article:last button:contains("HD"), div.text-white:contains("HD"), div.text-white:contains("720p"), video[id="hd-video"][src]',
  downloadButton:
    'button:has(path[d^="M11.996 3v12m0 0-5-5m5 5 5-5M4 15v1a4"]), button:has(path[d^="M4.16667 13.3333C4.16667 13.9304 4.16693 14.3282 4.1919 14.6338C4.21604 14.9293 4.25893 15.0648 4.30257 15.1506C4"])*',
  percentageSvg: 'div.absolute > svg > g > circle:eq(1)',
  percentageSpan: 'div > span:contains("%")',
};

export type GrokSelectors = typeof grokSelectors;

export const grokAdapter = {
  site: 'grok',
  label: 'Grok Imagine',
  revision: '2026-10-17',
  selectors: grokSelectors,
  health: [['promptContentEditable', 'promptDropUiTextarea']],
  page: {
    textScopes: [
      '[role="alert"]',
      '[role="alertdialog"]',
      '[role="dialog"]',
      '[role="status"]',
      '[aria-live="assertive"]',
      '[aria-live="polite"]',
      '[data-sonner-toast]',
    ],
    signals: [
      {
        reason: 'captcha',
        message:
          'Grok is asking you to prove you are human. Solve the check in the tab yourself, then start the batch again.',
        selectors: [
          'iframe[src*="challenges.cloudflare.com"]',
          'iframe[src*="recaptcha"]',
          'iframe[src*="hcaptcha.com"]',
          'iframe[src*="arkoselabs"]',
          '.cf-turnstile',
          '#challenge-form',
        ],
        patterns: [
          /verify (?:that )?you(?: are|'re) (?:a )?human/i,
          /are you a robot/i,
          /complete the (?:security )?check/i,
        ],
      },
      {
        reason: 'usage-limit',
        message:
          'Grok says you have reached a usage limit. Wait until it resets, then start the batch again.',
        patterns: [
          /rate limit/i,
          /usage limit/i,
          /too many requests/i,
          /(?:you(?:'ve| have)? )?reached (?:your|the) (?:daily |hourly |monthly )?(?:generation |image |video )?limit/i,
          /limit reached/i,
          /out of (?:credits|generations)/i,
          /no (?:credits|generations) left/i,
        ],
      },
      {
        reason: 'moderation',
        message:
          'Grok blocked a result under its content rules. Review the prompt before you run the batch again.',
        patterns: [
          /content moderated/i,
          /violates? (?:our|the) (?:usage |content )?polic(?:y|ies)/i,
          /against (?:our|the) (?:usage |content )?polic(?:y|ies)/i,
          /can(?:'|no)t (?:generate|create) (?:that|this)/i,
        ],
      },
      {
        reason: 'sign-in',
        message:
          'Grok wants you to sign in. Sign in to your own account in the tab, then start the batch again.',
        selectors: [
          'a[href^="/sign-in"]',
          'a[href*="accounts.x.ai/sign-in"]',
          'a[href*="/i/flow/login"]',
        ],
        paths: [/^\/sign-?in\b/i, /^\/login\b/i],
        patterns: [/sign in to continue/i, /log in to continue/i],
      },
    ],
  },
} as const satisfies SiteAdapter<GrokSelectors>;

export type GrokAdapter = typeof grokAdapter;
