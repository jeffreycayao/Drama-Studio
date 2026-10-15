// Supplemental layout-only check using an isolated fixture and synthetic clip
// data. No media generation, project opening, or production Electron process.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')

async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  let browser
  try {
    browser = native
      ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
      : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
    const page = native ? await browser.firstWindow() : await browser.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/multi-clip-inspector.html')
    await page.waitForFunction(() => Boolean(window.multiClipInspectorTest), null, { polling: 100 })
    await page.evaluate(async () => {
      const [reactModule, domModule, component] = await Promise.all([
        import('/node_modules/.vite/deps/react.js'),
        import('/node_modules/.vite/deps/react-dom_client.js'),
        import('/src/components/TrimEdgePreview.jsx'),
      ])
      const React = reactModule.default || reactModule
      const DOM = domModule.default || domModule
      const mount = document.createElement('div')
      document.body.appendChild(mount)
      const root = DOM.createRoot(mount)
      window.trimLayoutTest = {
        render(name, anchor) {
          window.multiClipInspectorTest.timeline.setState({ clips: [{ id: 'constraint', name }] })
          root.render(React.createElement(component.default, {
            feedback: {
              clipId: 'layout', clip: { id: 'layout', type: 'audio', name: 'Synthetic audio trim' },
              edge: 'right', edgeTime: 3, timelineTime: 2.9, duration: 3,
              deltaFrames: 0, durationDeltaFrames: 0, affectedCount: 2,
              limit: { kind: 'source', label: 'Source end reached', clipId: 'constraint' },
            }, anchor, fps: 24,
          }))
        },
        dispose() { root.unmount(); mount.remove() },
      }
    })

    let cases = 0
    for (const size of [
      { width: 1280, height: 768 }, { width: 1440, height: 1000 },
      { width: 640, height: 360 }, { width: 320, height: 480 },
      { width: 180, height: 250 }, { width: 520, height: 220 },
    ]) {
      if (native) {
        await browser.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0].setContentSize(next.width, next.height), size)
      } else await page.setViewportSize(size)
      await page.waitForFunction(next => innerWidth === next.width && innerHeight === next.height, size, { polling: 100 })
      for (const name of ['Short name', 'Long descriptive camera angle and project note '.repeat(6), 'long_media_source_'.repeat(20)]) {
        for (const anchor of [{ x: size.width - 2, y: size.height - 2 }, { x: 2, y: 2 }]) {
          const bounds = await page.evaluate(async ({ name, anchor }) => {
            window.trimLayoutTest.render(name, anchor)
            // Hidden Electron windows can suppress RAF; measuring below
            // forces layout without depending on an animation callback.
            await new Promise(resolve => setTimeout(resolve, 120))
            const element = document.querySelector('[data-testid="trim-edge-preview"]')
            const rect = element.getBoundingClientRect()
            const limit = element.querySelector('[data-testid="trim-edge-limit"]')
            return {
              top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom,
              height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
              wordBreak: getComputedStyle(limit).overflowWrap,
            }
          }, { name, anchor })
          const label = JSON.stringify({ size, nameLength: name.length, anchor, bounds })
          assert.ok(bounds.top >= 7.9 && bounds.left >= 7.9, label)
          assert.ok(bounds.bottom <= size.height - 7.9 && bounds.right <= size.width - 7.9, label)
          assert.equal(bounds.wordBreak, 'break-word', label)
          cases++
        }
      }
    }
    await page.evaluate(() => window.trimLayoutTest.dispose())
    assert.deepEqual(errors, [], 'no renderer errors')
    console.log(`PASS: ${cases} ${native ? 'Electron' : 'Chrome'} trim preview layouts stay inside viewport, including long names and live window resizing`)
  } finally {
    if (browser) await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
