/**
 * Side-panel copy. English only for now; keep every user-facing string here
 * so a translation can be added in one place later.
 */
const english = {
  description:
    'Sends your Drama Studio prompts to AI sites, runs Grok Imagine batches and brings results back to your project.',
  control: 'Batch',
  settings: 'Settings',
  debug: 'Activity',
  openGrok: 'Open Grok Imagine',
  notOnGrok: 'Switch to a Grok Imagine tab to run a batch.',
  pageChecked: 'The tab is checked every two seconds.',
  siteChanged:
    'Grok changed its page and the Companion cannot find the prompt box. An update is pending; Run is paused.',
  tipTitle: 'Before you start',
} as const;

export type MessageKey = keyof typeof english;

export function t(key: MessageKey): string {
  return english[key];
}
