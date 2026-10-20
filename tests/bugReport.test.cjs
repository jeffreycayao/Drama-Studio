'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { MAX_URL_LENGTH, NEW_ISSUE_URL, buildNewIssueUrl, registerBugReportIpc } = require('../electron/bugReport.cjs')

const loadUtils = () => import('../src/utils/bugReport.mjs')

test('the report has the three sections and an optional system table', async () => {
  const { buildBugReportBody, buildBugReportTitle } = await loadUtils()
  assert.equal(buildBugReportTitle({ summary: '  Export stops\nat 90%  ' }), '[Bug] Export stops at 90%')
  assert.equal(buildBugReportTitle({ summary: '   ' }), '')
  const body = buildBugReportBody({
    whatHappened: 'It froze.',
    steps: '',
    expected: 'A file',
    diagnostics: { appVersion: '0.6.7', platform: 'win32', os: 'Windows NT 10.0', gpu: 'RTX | 4090', comfyConnected: false, screen: '' },
  })
  assert.match(body, /### What happened\n\nIt froze\./)
  assert.match(body, /### Steps to reproduce\n\n_Not given\._/)
  assert.match(body, /\| Drama Studio version \| 0\.6\.7 \|/)
  assert.match(body, /\| Graphics card \| RTX \/ 4090 \|/, 'pipes cannot break the table')
  assert.match(body, /\| ComfyUI connected \| no \|/)
  assert.match(body, /\| Screen \| unknown \|/)
  assert.doesNotMatch(buildBugReportBody({ whatHappened: 'x' }), /### System/, 'no system table when the box is unticked')
})

test('control characters are removed and long text is cut', async () => {
  const { cleanReportText, BUG_REPORT_LIMITS } = await loadUtils()
  assert.equal(cleanReportText('a\u0000b\u001bc\r\nd\te'), 'abc\nd\te')
  const long = cleanReportText('x'.repeat(5000), BUG_REPORT_LIMITS.field)
  assert.equal(long.length, BUG_REPORT_LIMITS.field)
  assert.ok(long.endsWith('…'))
})

test('a report needs a title and a description', async () => {
  const { bugReportReady } = await loadUtils()
  assert.equal(bugReportReady({ summary: 'Crash', whatHappened: 'It closed itself.' }), true)
  assert.equal(bugReportReady({ summary: 'Hi', whatHappened: 'It closed itself.' }), false)
  assert.equal(bugReportReady({ summary: 'Crash', whatHappened: 'oops' }), false)
})

test('the link always goes to this repository\'s new-issue page with the bug label', () => {
  const { url, truncated } = buildNewIssueUrl({ title: '[Bug] Crash\non export', body: 'Body & more ?=#' })
  const parsed = new URL(url)
  assert.equal(`${parsed.origin}${parsed.pathname}`, NEW_ISSUE_URL)
  assert.equal(parsed.searchParams.get('labels'), 'bug')
  assert.equal(parsed.searchParams.get('title'), '[Bug] Crash on export')
  assert.equal(parsed.searchParams.get('body'), 'Body & more ?=#')
  assert.equal(truncated, false)
})

test('very long reports are cut to fit in a link, with a note', () => {
  const { url, truncated } = buildNewIssueUrl({ title: '[Bug] Long', body: 'é'.repeat(20000) })
  assert.ok(url.length <= MAX_URL_LENGTH, `url is ${url.length}`)
  assert.equal(truncated, true)
  assert.match(new URL(url).searchParams.get('body'), /did not fit in the link/)
})

test('the IPC handler opens only the built link and refuses an empty title', async () => {
  const handlers = new Map()
  const opened = []
  registerBugReportIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, { openExternal: async (url) => { opened.push(url) } })
  const open = handlers.get('bugReport:open')
  assert.deepEqual(await open({}, { title: '', body: 'x' }), { success: false, error: 'Add a short title first.' })
  assert.deepEqual(await open({}, { title: 'https://evil.example', body: 'x', url: 'https://evil.example' }), { success: true, truncated: false })
  assert.equal(opened.length, 1)
  assert.ok(opened[0].startsWith(`${NEW_ISSUE_URL}?`), 'a url field from the renderer is ignored')
  const failing = new Map()
  registerBugReportIpc({ handle: (channel, fn) => failing.set(channel, fn) }, { openExternal: async () => { throw new Error('no browser') } })
  assert.deepEqual(await failing.get('bugReport:open')({}, { title: 'Crash on start', body: '' }), { success: false, error: 'no browser' })
})
