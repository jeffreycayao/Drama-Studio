import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFcpXml } from '../src/services/fcpxmlExporter.js'
import { buildPremiereXml } from '../src/services/premiereXmlExporter.js'

for (const [name, build] of [['FCPXML', buildFcpXml], ['Premiere XML', buildPremiereXml]]) {
  test(`${name} refuses an editable compound rather than silently omitting its footage`, () => {
    assert.throws(() => build({ timeline: { clips: [{ id: 'intro', type: 'compound', startTime: 0, duration: 4,
      compound: { version: 1, document: { clips: [{ id: 'picture', type: 'video' }] } } }] } }),
    /Editable compound clips are not supported.*Export a rendered video instead/)
  })
  test(`${name} also refuses disabled compounds and render-only virtual leaves`, () => {
    for (const clip of [{ id: 'disabled', type: 'compound', enabled: false },
      { id: 'virtual', type: 'video', compoundParentId: 'intro', playbackWindowStart: 1, playbackWindowEnd: 2 },
      { id: 'malformed', type: 'video', compound: { version: 9 } }]) {
      assert.throws(() => build({ timeline: { clips: [clip] } }), /compound clips are not supported/)
    }
  })
  test(`${name} still builds an ordinary media timeline`, () => {
    const xml = build({ timeline: { tracks: [{ id: 'video', type: 'video', visible: true }],
      clips: [{ id: 'ordinary', type: 'video', trackId: 'video', assetId: 'asset', startTime: 0, duration: 2, trimStart: 0, sourceDuration: 2 }] },
    assets: [{ id: 'asset', type: 'video', name: 'Synthetic file reference', absolutePath: '/__synthetic__/ordinary.mp4', duration: 2, settings: { fps: 24, width: 96, height: 54 } }] })
    assert.match(xml, /ordinary/)
  })
}
