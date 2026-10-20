/** Which update notice to show for the main process's update state, or null. */
export function updateNoticeKind(update, dismissedVersion) {
  if (!update?.latestVersion || update.latestVersion === dismissedVersion) return null
  if (update.status === 'ready') return 'ready'
  if (update.status === 'available') return update.mode === 'notify' ? 'download' : 'fetch'
  return null
}
