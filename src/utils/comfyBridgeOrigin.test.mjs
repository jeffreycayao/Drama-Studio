import assert from 'node:assert/strict'
import test from 'node:test'
import { isTrustedComfyBridgeOrigin } from './comfyBridgeOrigin.mjs'

test('only the local ComfyUI origin on the configured port is trusted', () => {
  const base = 'http://127.0.0.1:8188'
  assert.equal(isTrustedComfyBridgeOrigin('http://127.0.0.1:8188', base), true)
  assert.equal(isTrustedComfyBridgeOrigin('http://localhost:8188', base), true)
  assert.equal(isTrustedComfyBridgeOrigin('http://127.0.0.1:8189', base), false)
  assert.equal(isTrustedComfyBridgeOrigin('https://127.0.0.1:8188', base), false)
  assert.equal(isTrustedComfyBridgeOrigin('http://evil.example:8188', base), false)
  assert.equal(isTrustedComfyBridgeOrigin('null', base), false)
  assert.equal(isTrustedComfyBridgeOrigin('file://', base), false)
  assert.equal(isTrustedComfyBridgeOrigin(undefined, base), false)
  assert.equal(isTrustedComfyBridgeOrigin('http://127.0.0.1', 'http://127.0.0.1:80'), true)
})
