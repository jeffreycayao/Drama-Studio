import { AI_SITES, type AiSite, type AiSiteKind } from '../sites/ai-sites';

/**
 * What the side panel's Sites tab shows for each supported AI site, built
 * from AI_SITES so the list never drifts from what the Companion really
 * fills. Plain data; SitesPanel.vue renders it.
 */
export interface SiteCatalogEntry {
  id: string;
  label: string;
  url: string;
  kinds: readonly AiSiteKind[];
  /** Short, plain notes on what works there, in display order. */
  features: string[];
  /** How a result comes back to Drama Studio. */
  sendBack: 'button' | 'right-click';
}

const KIND_LABELS: Record<AiSiteKind, string> = {
  image: 'Images',
  video: 'Video',
  audio: 'Songs',
};

export function kindsLabel(kinds: readonly AiSiteKind[]): string {
  return kinds.map((kind) => KIND_LABELS[kind]).join(' · ');
}

export function catalogEntry(site: AiSite): SiteCatalogEntry {
  const features = ['Fills your prompt'];
  if (site.song) features.push('Fills style, lyrics and title');
  if (site.fileInputSelectors.length > 0 && !site.kinds.includes('audio'))
    features.push('Adds your reference files');
  if (site.aspectMenu) features.push('Sets the shape for you');
  const sendBack = site.resultMedia?.length ? 'button' : 'right-click';
  features.push(
    sendBack === 'button'
      ? 'Send to Drama Studio button on results'
      : 'Right-click a result › Send to Drama Studio',
  );
  return {
    id: site.id,
    label: site.label,
    url: site.url,
    kinds: site.kinds,
    features,
    sendBack,
  };
}

export const SITE_CATALOG: readonly SiteCatalogEntry[] =
  AI_SITES.map(catalogEntry);
