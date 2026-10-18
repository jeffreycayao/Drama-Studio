// Settings › Browser: one plain sentence about whether Chrome and Edge can
// reach Drama Studio, from companionLink:status (electron/companionLink/index.cjs).

const formatMegabytes = (bytes) => `${Math.max(1, Math.round((Number(bytes) || 0) / 1048576))} MB`

/** @returns {{ ready: boolean, text: string }} */
export function browserLinkStatus(status) {
  if (!status?.supported) return { ready: false, text: 'The browser link is available on Windows for now.' }
  if (!status.listening) {
    return {
      ready: false,
      text: status.serverError === 'EADDRINUSE'
        ? 'Another Drama Studio window has the browser link. Close it to use the link here.'
        : 'The browser link could not start. Restart Drama Studio and try again.',
    }
  }
  if (status.registered) {
    return {
      ready: true,
      text: status.portable && status.connectorBytes
        ? `Ready. Chrome and Edge can reach Drama Studio while it is open. This portable copy keeps a browser connector (${formatMegabytes(status.connectorBytes)}) in its settings folder for that.`
        : 'Ready. Chrome and Edge can reach Drama Studio while it is open.',
    }
  }
  switch (status.registrationReason) {
    case 'not-started':
    case 'preparing':
      return {
        ready: false,
        text: status.portable
          ? 'Setting up the browser link for this portable copy. The first time takes a few seconds.'
          : 'Setting up the browser link…',
      }
    case 'skipped':
      return { ready: false, text: 'This copy of Drama Studio is set not to register with Chrome and Edge, so the browser reaches your other copy instead.' }
    case 'no-extension-ids':
      return { ready: false, text: 'The browser link turns on once a Companion extension ID is listed under Developer: extension IDs below.' }
    case 'connector-failed':
      return {
        ready: false,
        text: 'The browser link can’t work in this portable copy: Drama Studio could not set up its browser connector, which needs about 320 MB in your settings folder. Free some disk space and restart Drama Studio, or use the installer version.',
      }
    default:
      return { ready: false, text: 'Drama Studio could not register itself with Chrome and Edge. Restart Drama Studio and try again.' }
  }
}
