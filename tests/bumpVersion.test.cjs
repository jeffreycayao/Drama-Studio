const test = require('node:test')
const assert = require('node:assert/strict')
const { nextVersion, replaceVersionField } = require('../scripts/bump-version.cjs')

test('patch, minor and major follow major.minor.patch rules', () => {
  assert.equal(nextVersion('0.1.1', 'patch'), '0.1.2')
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0')
  assert.equal(nextVersion('0.9.3', 'major'), '1.0.0')
  assert.equal(nextVersion('0.1.4', 'set', '0.1.1'), '0.1.1')
  assert.throws(() => nextVersion('0.1.1', 'set', 'v2'))
  assert.throws(() => nextVersion('0.1', 'patch'))
  assert.throws(() => nextVersion('0.1.1', 'huge'))
})

test('only the top-level package.json version field is rewritten', () => {
  const pkg = '{\n  "name": "drama-studio",\n  "version": "0.1.1",\n  "dependencies": { "x": { "version": "9.9.9" } }\n}\n'
  const next = replaceVersionField(pkg, '0.1.2')
  assert.match(next, /"version": "0\.1\.2"/)
  assert.match(next, /"version": "9\.9\.9"/)
})
