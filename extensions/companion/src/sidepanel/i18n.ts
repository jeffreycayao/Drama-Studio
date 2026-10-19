/**
 * Side-panel copy. English only for now; keep every user-facing string here
 * so a translation can be added in one place later.
 */
const english = {
  description:
    'Sends your Drama Studio prompts and references to 13 AI sites and brings the results back to your project.',
  sites: 'Sites',
  sitesTitle: 'Supported sites',
  sitesIntro:
    'Start a job in Drama Studio (Generate › AI Sites) and the Companion fills the site for you. You always press Generate yourself.',
  sitesNote:
    'Send to Drama Studio adds the result to the open project, under AI Sites. Chrome asks once per site before the first download.',
  control: 'Grok batch',
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
