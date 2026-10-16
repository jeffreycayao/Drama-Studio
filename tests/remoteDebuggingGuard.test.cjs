'use strict'
// Extract the remote-debugging guard from electron/main.js and run it against
// a fake app object. No Electron app starts.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8')
const start = main.indexOf('const REFUSED_DEBUG_SWITCHES')
const end = main.indexOf('\n}\n', start) + 3

function runGuard({ isPackaged, switches = [], env = {} }) {
  const exits = []
  const errors = []
  vm.runInNewContext(main.slice(start, end), {
    app: {
      isPackaged,
      commandLine: { hasSwitch: (name) => switches.includes(name) },
      exit: (code) => exits.push(code),
    },
    process: { env },
    console: { error: (line) => errors.push(line) },
  })
  return { exits, errors }
}

test('the guard runs before the app sets paths, loads modules or opens windows', () => {
  assert.ok(start > 0 && end > start)
  for (const marker of ["app.setPath('userData'", "require('./mcpServer')", 'new BrowserWindow(', 'app.whenReady(']) {
    const at = main.indexOf(marker)
    assert.ok(at > end, `${marker} must come after the remote-debugging guard`)
  }
})

test('installed builds exit on --remote-debugging-port and --remote-debugging-pipe', () => {
  for (const name of ['remote-debugging-port', 'remote-debugging-pipe']) {
    const { exits, errors } = runGuard({ isPackaged: true, switches: [name] })
    assert.deepEqual(exits, [1])
    assert.equal(errors.length, 1)
    assert.match(errors[0], new RegExp(`--${name}`))
  }
})

test('normal installed launches, dev runs and DS_ALLOW_DEVTOOLS=1 are not blocked', () => {
  assert.deepEqual(runGuard({ isPackaged: true }).exits, [])
  assert.deepEqual(runGuard({ isPackaged: false, switches: ['remote-debugging-port'] }).exits, [])
  assert.deepEqual(runGuard({ isPackaged: true, switches: ['remote-debugging-port'], env: { DS_ALLOW_DEVTOOLS: '1' } }).exits, [])
  assert.equal(runGuard({ isPackaged: true, switches: ['remote-debugging-pipe'], env: { DS_ALLOW_DEVTOOLS: 'true' } }).exits.length, 1)
})
