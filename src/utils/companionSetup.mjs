// Whether Drama Studio can hand a prompt to Drama Studio Companion yet, from
// companionLink:status (electron/companionLink/index.cjs). Sending to an AI
// site waits for 'ready': without a connected Companion nothing would fill the
// site in, so Drama Studio asks the person to install and connect it first
// (components/browserJobs/CompanionInstallSteps.jsx).

/** @returns {'unavailable' | 'link-not-ready' | 'install' | 'ready'} */
export function companionSetupState(status) {
  if (!status?.supported) return 'unavailable'
  if (!status.listening || !status.registered) return 'link-not-ready'
  if (!Array.isArray(status.paired) || status.paired.length === 0) return 'install'
  return 'ready'
}
