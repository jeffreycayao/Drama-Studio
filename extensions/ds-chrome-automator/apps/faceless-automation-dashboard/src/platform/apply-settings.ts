import type { LocalFontFamily, PlatformSettings } from '../admin/api';

const fontStacks: Record<LocalFontFamily, string> = {
  'Instrument Serif': "'Instrument Serif', Georgia, 'Times New Roman', serif",
  Manrope: "'Manrope', Arial, Helvetica, system-ui, sans-serif",
  'IBM Plex Mono': "'IBM Plex Mono', Consolas, 'Courier New', monospace",
};

function setMeta(selector: string, attribute: string, value: string): void {
  const element = document.head.querySelector<HTMLMetaElement>(selector);
  if (element) {
    element.content = value;
    return;
  }

  const meta = document.createElement('meta');
  const [name, property] = attribute.split('=');
  if (name !== undefined && property !== undefined) {
    meta.setAttribute(name, property);
  }
  meta.content = value;
  document.head.append(meta);
}

export function applyPlatformSettings(settings: PlatformSettings): void {
  const { colors, fonts } = settings.theme;
  const root = document.documentElement;

  root.style.setProperty('--canvas', colors.canvas);
  root.style.setProperty('--surface', colors.surface);
  root.style.setProperty('--ink', colors.ink);
  root.style.setProperty('--ink-muted', colors.mutedInk);
  root.style.setProperty('--line', colors.border);
  root.style.setProperty('--gold', colors.gold);
  root.style.setProperty('--fa-font-display', fontStacks[fonts.display]);
  root.style.setProperty('--fa-font-body', fontStacks[fonts.body]);
  root.style.setProperty('--fa-font-mono', fontStacks[fonts.metadata]);

  document.title = settings.seo.siteTitle;
  const themeColor = document.head.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (themeColor) themeColor.content = colors.canvas;
  setMeta(
    'meta[name="description"]',
    'name=description',
    settings.seo.siteDescription,
  );
  setMeta(
    'meta[property="og:title"]',
    'property=og:title',
    settings.seo.openGraphTitle,
  );
  setMeta(
    'meta[property="og:description"]',
    'property=og:description',
    settings.seo.openGraphDescription,
  );
  if (settings.seo.socialImageUrl !== null) {
    setMeta(
      'meta[property="og:image"]',
      'property=og:image',
      settings.seo.socialImageUrl,
    );
  } else {
    document.head.querySelector('meta[property="og:image"]')?.remove();
  }
}
