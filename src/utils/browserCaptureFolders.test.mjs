import test from 'node:test'
import assert from 'node:assert/strict'

import { AI_SITES_FOLDER, captureFolderPath, captureSiteLabel } from './browserCaptureFolders.mjs'

test('captures from Grok jobs and plain Grok pages share one folder', () => {
  assert.deepEqual(captureFolderPath('grok-imagine'), [AI_SITES_FOLDER, 'Grok'])
  assert.deepEqual(captureFolderPath('grok'), [AI_SITES_FOLDER, 'Grok'])
})

test('unknown sites get a readable, bounded folder name', () => {
  assert.equal(captureSiteLabel('google-flow'), 'Google Flow')
  assert.equal(captureSiteLabel(''), 'Other')
  assert.equal(captureSiteLabel('../..'), 'Other')
  assert.ok(captureSiteLabel('x'.repeat(100)).length <= 40)
})
