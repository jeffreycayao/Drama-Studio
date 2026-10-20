/**
 * Bug report text for a GitHub issue. The dialog shows exactly this text as
 * its preview, and the main process (electron/bugReport.cjs) puts it into the
 * new-issue URL of this repository; nothing else is sent.
 */

export const BUG_REPORT_LIMITS = { title: 120, field: 2000 }

const DIAGNOSTIC_LABELS = [
  ['appVersion', 'Drama Studio version'],
  ['platform', 'Platform'],
  ['os', 'Operating system'],
  ['gpu', 'Graphics card'],
  ['comfyConnected', 'ComfyUI connected'],
  ['screen', 'Screen'],
]

/** Removes control characters (keeps line breaks and tabs) and trims to a limit. */
export function cleanReportText(value, limit) {
  const text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function diagnosticValue(value) {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  if (value === null || value === undefined || value === '') return 'unknown'
  return cleanReportText(value, 200).replace(/\n/g, ' ')
}

export function buildBugReportTitle({ summary }) {
  const title = cleanReportText(summary, BUG_REPORT_LIMITS.title).replace(/\n/g, ' ')
  return title ? `[Bug] ${title}` : ''
}

export function buildBugReportBody({ whatHappened, steps, expected, diagnostics = null } = {}) {
  const section = (heading, value) => {
    const text = cleanReportText(value, BUG_REPORT_LIMITS.field)
    return `### ${heading}\n\n${text || '_Not given._'}`
  }
  const parts = [
    section('What happened', whatHappened),
    section('Steps to reproduce', steps),
    section('What I expected', expected),
  ]
  if (diagnostics && typeof diagnostics === 'object') {
    const rows = DIAGNOSTIC_LABELS.map(([key, label]) => `| ${label} | ${diagnosticValue(diagnostics[key]).replace(/\|/g, '/')} |`)
    parts.push(`### System\n\n| | |\n| --- | --- |\n${rows.join('\n')}`)
  }
  parts.push('_Sent from Drama Studio › Report a bug._')
  return parts.join('\n\n')
}

/** What the dialog needs before it can open GitHub. */
export function bugReportReady({ summary, whatHappened }) {
  return cleanReportText(summary, BUG_REPORT_LIMITS.title).length >= 5
    && cleanReportText(whatHappened, BUG_REPORT_LIMITS.field).length >= 10
}
