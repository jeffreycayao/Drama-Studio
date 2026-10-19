import test from 'node:test'
import assert from 'node:assert/strict'
import { companionSetupState } from './companionSetup.mjs'

const linked = { supported: true, listening: true, registered: true, paired: [] }

test('asks to install the Companion until a browser is connected', () => {
  assert.equal(companionSetupState(linked), 'install')
  assert.equal(companionSetupState({ ...linked, paired: undefined }), 'install')
  assert.equal(companionSetupState({ ...linked, paired: [{ id: 'b1' }] }), 'ready')
})

test('points at Settings › Browser while the link itself is not working', () => {
  assert.equal(companionSetupState(null), 'unavailable')
  assert.equal(companionSetupState({ ...linked, supported: false }), 'unavailable')
  assert.equal(companionSetupState({ ...linked, listening: false }), 'link-not-ready')
  assert.equal(companionSetupState({ ...linked, registered: false, paired: [{ id: 'b1' }] }), 'link-not-ready')
})
