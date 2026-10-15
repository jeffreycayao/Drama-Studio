import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// Exercise the unchanged MCP handler body with read-only synthetic stores and
// a controlled service, without booting the full app or any native process.
const source = readFileSync(new URL('../src/services/mcpActions.js', import.meta.url), 'utf8')
const start = source.indexOf('async function handleGetAudioAnalysis(payload = {}) {')
const end = source.indexOf('\nasync function handleGenerateMusic(', start)
assert.ok(start >= 0 && end > start)
const createHandler = Function('useTimelineStore', 'useAssetsStore', 'useProjectStore', 'resolveMcpTimelineAsset', 'analyzeAudioSource', 'summarizeAsset',
  source.slice(start, end) + '\nreturn handleGetAudioAnalysis')
function fixture({ projectHandle = '/moved-project', response, clipPatch = {} } = {}) {
  const asset = { id: 'audio-1', type: 'audio', name: 'Synthesized audio', path: 'assets/audio.wav', absolutePath: '/old-project/assets/audio.wav', url: 'blob:stale' }
  const clip = { id: 'clip-1', assetId: asset.id, trimStart: 20, trimEnd: 32, duration: 6, startTime: 10, speed: 2, sourceTimeScale: 1, ...clipPatch }
  const calls = []
  const analysis = response || { duration: 12, bpm: 120, beats: [0.25, 0.75, 1.25], silences: [{ start: 2, end: 3, duration: 1 }], loudness: { peakDb: -1, rmsDb: -18, integratedLufsApprox: -19 } }
  const handler = createHandler({ getState: () => ({ clips: [clip] }) }, { getState: () => ({ assets: [asset] }) },
    { getState: () => ({ currentProjectHandle: projectHandle }) }, () => asset,
    async (...args) => { calls.push(args); return analysis }, value => ({ id: value.id, name: value.name, type: value.type }))
  return { handler, calls, analysis, asset, clip }
}

test('MCP passes portable path/project context and preserves range-relative analysis plus retimed timeline mapping', async () => {
  const h = fixture()
  const result = await h.handler({ clipId: 'clip-1', includeLoudnessCurve: false })
  assert.deepEqual(h.calls[0][0], { url: 'blob:stale', absolutePath: '/old-project/assets/audio.wav', path: 'assets/audio.wav', projectPath: '/moved-project' })
  assert.deepEqual(h.calls[0][1], { startSeconds: 20, endSeconds: 32, silenceThresholdDb: undefined,
    minSilenceSeconds: undefined, includeLoudnessCurve: false, maxCurvePoints: undefined })
  assert.equal(result.success, true)
  assert.equal(result.analysis, h.analysis)
  assert.equal(result.clip.timelineMapping, 'constant-speed')
  assert.deepEqual(result.clip.beatsTimeline, [10.125, 10.375, 10.625])
  assert.deepEqual(result.clip.silencesTimeline, [{ start: 11, end: 11.5 }])
})

test('whole-asset MCP analysis omits clip ranges and browser project handles do not cross IPC', async () => {
  const h = fixture({ projectHandle: { kind: 'directory', name: 'project' } })
  const result = await h.handler({ assetId: h.asset.id })
  assert.equal(h.calls[0][0].projectPath, '')
  assert.equal(h.calls[0][1].startSeconds, undefined)
  assert.equal(h.calls[0][1].endSeconds, undefined)
  assert.equal(result.clip, undefined)
  assert.equal(result.analysis, h.analysis)
})

test('MCP reverse and speed-ramped clips keep source analysis without invalid timeline mapping', async () => {
  for (const clipPatch of [{ reverse: true }, { keyframes: { speed: [{ time: 0, value: 1 }] } }]) {
    const h = fixture({ clipPatch })
    const result = await h.handler({ clipId: h.clip.id })
    assert.equal(result.success, true)
    assert.equal(result.clip.timelineMapping, 'unavailable')
    assert.equal(result.clip.beatsTimeline, undefined)
    assert.equal(result.analysis, h.analysis)
  }
})

test('MCP retains the short-range warning result contract', async () => {
  const h = fixture({ response: { duration: 0.1, error: 'Audio range is too short to analyze (under 0.25s).' } })
  const result = await h.handler({ clipId: h.clip.id })
  assert.equal(result.success, false)
  assert.equal(result.duration, 0.1)
  assert.match(result.warning, /too short/)
  assert.equal(result.analysis, undefined)
})
