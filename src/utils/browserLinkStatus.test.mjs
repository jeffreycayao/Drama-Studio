import test from 'node:test'
import assert from 'node:assert/strict'
import { browserLinkStatus } from './browserLinkStatus.mjs'

const base = { supported: true, listening: true, registered: false, registrationReason: null, portable: false, connectorBytes: 0 }

test('ready, with the connector size on a portable copy', () => {
  assert.deepEqual(browserLinkStatus({ ...base, registered: true }), { ready: true, text: 'Ready. Chrome and Edge can reach Drama Studio while it is open.' })
  const portable = browserLinkStatus({ ...base, registered: true, portable: true, connectorBytes: 330 * 1048576 })
  assert.equal(portable.ready, true)
  assert.match(portable.text, /portable copy keeps a browser connector \(330 MB\)/)
})

test('says plainly when the link cannot work on this build', () => {
  const failed = browserLinkStatus({ ...base, portable: true, registrationReason: 'connector-failed' })
  assert.equal(failed.ready, false)
  assert.match(failed.text, /can’t work in this portable copy/)
  assert.match(failed.text, /installer version/)
  assert.match(browserLinkStatus({ ...base, supported: false }).text, /Windows/)
  assert.match(browserLinkStatus({ ...base, portable: true, registrationReason: 'preparing' }).text, /Setting up the browser link for this portable copy/)
  assert.match(browserLinkStatus({ ...base, registrationReason: 'no-extension-ids' }).text, /extension ID/)
  assert.match(browserLinkStatus({ ...base, registrationReason: 'skipped' }).text, /set not to register/)
  assert.match(browserLinkStatus({ ...base, registrationReason: 'error' }).text, /could not register/)
  assert.match(browserLinkStatus({ ...base, listening: false, serverError: 'EADDRINUSE' }).text, /Another Drama Studio window/)
})

test('no user-facing text names internals', () => {
  const reasons = ['not-started', 'preparing', 'skipped', 'no-extension-ids', 'connector-failed', 'unsupported-platform', 'error']
  for (const registrationReason of reasons) {
    for (const portable of [true, false]) {
      const { text } = browserLinkStatus({ ...base, registrationReason, portable })
      assert.ok(!/DS_|userData|registry|HKCU|\.cmd|native messaging/i.test(text), text)
    }
  }
})
