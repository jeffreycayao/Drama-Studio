import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

// Exercise the actual compositor's image callbacks and React dependency
// invalidation. The expensive draw body is replaced with a paint-request
// recorder; browser/Electron fixture tests verify the resulting pixels.
const source = readFileSync(new URL('../components/CanvasPreviewRenderer.jsx', import.meta.url), 'utf8')
const code = transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: '__jsx', jsxFragment: '__fragment' }).code

function harness() {
  const slots = [], effects = [], images = [], draws = []
  let index = 0, loadImage = null, loadMask = null, renderPending = false
  const state = { isPlaying: false, playheadPosition: 191 / 24,
    playheadSeekIntent: { type: 'frame-step', targetTime: 191 / 24, revision: 1 },
    clips: [], tracks: [], transitions: [], playbackRate: 1, timelineSessionId: 1,
    useProxyPlaybackForAssets: false, glslPreviewQuality: 'full' }
  const assets = []
  const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    memo: component => component,
    useRef: initial => { const slot = index++; return slots[slot] ||= { current: initial } },
    useState: initial => {
      const slot = index++
      if (!slots[slot]) slots[slot] = { value: initial }
      const setter = slots[slot].setter ||= value => {
        slots[slot].value = typeof value === 'function' ? value(slots[slot].value) : value
        renderPending = true
      }
      return [slots[slot].value, setter]
    },
    useCallback: (callback, dependencies) => {
      const slot = index++
      if (!slots[slot] || !same(slots[slot].dependencies, dependencies)) {
        const body = callback.toString()
        const value = body.includes('const drawStartMs') && body.includes('canvasRef.current')
          ? () => draws.push({ time: state.playheadPosition, playing: state.isPlaying })
          : callback
        slots[slot] = { value, dependencies }
      }
      if (callback.toString().includes('const cache = imageCacheRef.current')) loadImage = slots[slot].value
      if (callback.toString().includes('const cache = maskCacheRef.current')) loadMask = slots[slot].value
      return slots[slot].value
    },
    useEffect: (callback, dependencies) => {
      const slot = index++
      const changed = !slots[slot] || !same(slots[slot].dependencies, dependencies)
      slots[slot] = { dependencies }
      // Only the paused redraw effect is needed: no browser transport,
      // global subscriptions, or animation loops run in this unit harness.
      if (changed && dependencies?.length > 10 && callback.toString().includes('if (!isPlaying) drawFrame()')) effects.push(callback)
    },
  }
  const noop = () => null
  const fallback = new Proxy({}, { get: () => noop })
  const timelineStore = () => state
  timelineStore.getState = () => state
  const assetsStore = selector => selector({ assets })
  const module = { exports: {} }
  const imageConstructor = function () { images.push(this) }
  const canvas = { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }) }
  Function('require', 'module', 'exports', '__jsx', '__fragment', 'Image', 'document', code)(name => {
    if (name === 'react') return react
    if (name === '../stores/timelineStore') return timelineStore
    if (name === '../stores/assetsStore') return assetsStore
    if (name === '../utils/compoundPlayback.mjs') return { getCompoundRenderState: value => value }
    if (name === '../utils/scrubVideoPresentation.mjs') return { createScrubVideoPresentation: () => ({}) }
    return fallback
  }, module, module.exports, (type, props, ...children) => ({ type, props, children }), 'fragment', imageConstructor,
  { createElement: () => canvas })
  const render = () => {
    index = 0
    renderPending = false
    module.exports.default({ timelineWidth: 640, timelineHeight: 360, timelineFps: 24 })
    while (effects.length) effects.shift()()
  }
  render()
  assert.equal(typeof loadImage, 'function')
  assert.equal(typeof loadMask, 'function')
  assert.equal(draws.length, 1, 'the production paused redraw effect was exercised')
  return { state, images, draws, loadImage, loadMask, render, pending: () => renderPending }
}

test('a cold still finishing after a paused frame-step repaints the same target without navigation', () => {
  const h = harness()
  const seekIntent = h.state.playheadSeekIntent
  assert.equal(h.loadImage('memory://second-still'), null)
  const image = h.images[0]
  h.render()
  assert.equal(h.draws.length, 1, 'unrelated rerenders do not repaint a settled paused frame')
  image.onload()
  assert.equal(h.pending(), true)
  h.render()
  assert.equal(h.draws.length, 2, 'the decoded image invalidates the previously black picture')
  assert.equal(h.loadImage('memory://second-still'), image)
  assert.equal(h.state.playheadPosition, 191 / 24)
  assert.equal(h.state.playheadSeekIntent, seekIntent)
  h.render()
  assert.equal(h.draws.length, 2, 'the readiness revision creates no ongoing redraw loop')
})

test('cold mask readiness and image failure also invalidate a paused frame once', () => {
  for (const kind of ['mask', 'failed-image']) {
    const h = harness()
    if (kind === 'mask') {
      h.loadMask('memory://mask')
      h.images[0].naturalWidth = 1
      h.images[0].naturalHeight = 1
      h.images[0].onload()
    } else {
      h.loadImage('memory://missing')
      h.images[0].onerror()
    }
    h.render()
    assert.equal(h.draws.length, 2)
    assert.equal(h.state.isPlaying, false)
    h.render()
    assert.equal(h.draws.length, 2)
  }
})

test('image readiness leaves playing frames to the existing render loop', () => {
  const h = harness()
  h.loadImage('memory://playing-still')
  h.state.isPlaying = true
  h.render()
  h.images[0].onload()
  h.render()
  assert.equal(h.draws.length, 1, 'the paused redraw path does not create an additional playback loop')
})
