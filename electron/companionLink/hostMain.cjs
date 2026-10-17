'use strict'

// Native-host mode of the Drama Studio executable: `Drama Studio.exe
// --ds-companion-host [--ds-companion-user-data=<dir>] chrome-extension://<id>/ …`,
// started by the browser through ds-companion-host.cmd. electron/main.js
// calls this before anything else and stops there, so no window, server,
// settings move or single-app logic runs.
//
// Replies go out on stderr, not stdout: Electron writes "\r\n" to stdout as
// it starts on Windows, before any app code runs, which would break the
// browser's length-prefixed framing. The launcher therefore hands the
// browser's pipe to the host as stderr (2>&1) and sends stdout to NUL, and
// this process must never print anything else to stderr.

const fs = require('fs')
const net = require('net')
const path = require('path')
const { runCompanionHost, findExtensionOrigin } = require('./host.cjs')
const { companionDir, companionPipePath, currentUsername, readPairingSecret } = require('./pairing.cjs')
const { CURRENT_FOLDER_NAME, LEGACY_FOLDER_NAME } = require('../userDataMigration')

const REPLY_FD = 2

function writeAll(fd, buffer) {
  let offset = 0
  while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset)
}

/** Diagnostics only when DS_COMPANION_HOST_LOG names a file. */
function createLog() {
  const file = process.env.DS_COMPANION_HOST_LOG
  if (!file) return () => {}
  return (message) => {
    try { fs.appendFileSync(file, `${new Date().toISOString()} [companion-host] ${message}\n`) } catch { /* best effort */ }
  }
}

/**
 * The running app's settings folder, where its link secret is. The launcher
 * the app writes names it; the installer's launcher relies on the default.
 */
function resolveAppUserDataDir(app) {
  const named = app.commandLine.getSwitchValue('ds-companion-user-data')
  if (named) return named
  const current = path.join(app.getPath('appData'), CURRENT_FOLDER_NAME)
  const legacy = path.join(app.getPath('appData'), LEGACY_FOLDER_NAME)
  return fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy
}

function runCompanionHostMode(app) {
  const log = createLog()
  // Nothing but protocol frames may reach the browser's pipe.
  for (const name of ['log', 'info', 'debug', 'warn', 'error', 'trace']) console[name] = (...args) => log(args.join(' '))
  process.removeAllListeners('warning')
  process.on('warning', (warning) => log(`warning: ${warning?.message || warning}`))
  // Electron would show a modal error box for an uncaught error; just stop.
  process.on('uncaughtException', (error) => { log(`uncaught: ${error?.stack || error}`); app.exit(1) })
  process.on('unhandledRejection', (error) => { log(`unhandled: ${error?.stack || error}`); app.exit(1) })
  app.disableHardwareAcceleration()

  const appUserDataDir = resolveAppUserDataDir(app)
  // Chromium still starts in this process and keeps profile files in
  // userData; give it a folder of its own so it never touches the running
  // app's profile.
  const hostProfile = path.join(companionDir(appUserDataDir), 'host-profile')
  app.setPath('userData', hostProfile)
  app.setPath('sessionData', hostProfile)

  const pipePath = companionPipePath({ username: currentUsername(), userDataDir: appUserDataDir })
  // Electron's process.stdin is an empty stub on Windows; read the real handle.
  const input = fs.createReadStream(null, { fd: 0, autoClose: false })
  runCompanionHost({
    input,
    writeOutput: (buffer) => writeAll(REPLY_FD, buffer),
    origin: findExtensionOrigin(process.argv),
    connect: () => net.connect(pipePath),
    readSecret: () => readPairingSecret(appUserDataDir),
    log,
  }).then((code) => app.exit(code), () => app.exit(1))
}

module.exports = { runCompanionHostMode }
