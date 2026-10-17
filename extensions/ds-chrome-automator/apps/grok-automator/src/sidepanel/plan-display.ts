const PLAN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'free-plan': 'Free plan',
  'single-license': 'Grok Automator™ license',
  'all-apps': 'All Apps license',
});

export function resolvePlanLabel(planCode: string, pro: boolean): string {
  return PLAN_LABELS[planCode] ?? (pro ? 'Active license' : 'Free plan');
}
