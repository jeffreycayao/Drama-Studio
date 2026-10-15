import test from 'node:test'
import assert from 'node:assert/strict'
import { planTightenTrackGaps, resolveTimelineTrack } from './tightenTrackGaps.mjs'

const tracks = [
  { id: 'video-1', name: 'Video 1', type: 'video' },
  { id: 'audio-1', name: 'Audio 1', type: 'audio' },
  { id: 'audio-2', name: 'Music', type: 'audio' },
]
const clip = (id, trackId, startTime, duration, patch = {}) => ({ id, name: id, trackId, startTime, duration, ...patch })
const starts = plan => Object.fromEntries(plan.clips.map(item => [item.id, item.startTime]))

test('tightens long pauses on one track, keeps a breath, and leaves other tracks alone', () => {
  const clips = [
    clip('line1', 'audio-1', 0, 2),
    clip('line2', 'audio-1', 3, 2), // 1s pause
    clip('line3', 'audio-1', 5.125, 1), // 0.125s pause (kept)
    clip('line4', 'audio-1', 8, 1), // 1.875s pause
    clip('music', 'audio-2', 0, 20),
  ]
  const plan = planTightenTrackGaps({ clips, tracks, trackId: 'audio-1', fps: 24, keepGapSeconds: 0.25 })
  assert.equal(plan.ok, true)
  assert.equal(plan.changed, true)
  assert.equal(plan.gaps.length, 2)
  assert.deepEqual(starts(plan), { line1: 0, line2: 2.25, line3: 4.375, line4: 5.625, music: 0 })
  assert.equal(plan.removedSeconds, 2.375)
  assert.equal(clips[1].startTime, 3, 'planning must not mutate input')
})

test('linked picture moves with its dialogue; collisions and locks refuse the whole edit', () => {
  const clips = [
    clip('a1', 'audio-1', 0, 2, { linkGroupId: 'g1' }),
    clip('v1', 'video-1', 0, 2, { linkGroupId: 'g1' }),
    clip('a2', 'audio-1', 4, 2, { linkGroupId: 'g2' }),
    clip('v2', 'video-1', 4, 2, { linkGroupId: 'g2' }),
  ]
  const plan = planTightenTrackGaps({ clips, tracks, trackId: 'audio-1', fps: 24, keepGapSeconds: 0 })
  assert.equal(plan.ok, true)
  assert.deepEqual(starts(plan), { a1: 0, v1: 0, a2: 2, v2: 2 })

  const blocked = planTightenTrackGaps({ clips: [...clips, clip('broll', 'video-1', 2.5, 1)], tracks, trackId: 'audio-1', fps: 24, keepGapSeconds: 0 })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'linked-collision')

  const locked = planTightenTrackGaps({ clips, tracks: tracks.map(t => t.id === 'video-1' ? { ...t, locked: true } : t), trackId: 'audio-1', fps: 24 })
  assert.equal(locked.ok, false)
  assert.equal(locked.code, 'locked-participant')
})

test('no long pauses is a no-op and transitions shift with their clips', () => {
  const clips = [clip('a', 'video-1', 0, 2), clip('b', 'video-1', 2, 2), clip('c', 'video-1', 6, 2)]
  const transitions = [{ id: 't', kind: 'edge', edge: 'in', clipId: 'c', duration: 0.5, startTime: 6 }]
  const plan = planTightenTrackGaps({ clips, tracks, transitions, trackId: 'video-1', fps: 24, keepGapSeconds: 0.5 })
  assert.equal(plan.transitions[0].startTime, 4.5)
  const none = planTightenTrackGaps({ clips: clips.slice(0, 2), tracks, trackId: 'video-1', fps: 24 })
  assert.equal(none.ok, true)
  assert.equal(none.changed, false)
})

test('track references resolve by id, name or number and report ambiguity', () => {
  assert.equal(resolveTimelineTrack(tracks, 'audio-1').track.id, 'audio-1')
  assert.equal(resolveTimelineTrack(tracks, 'music').track.id, 'audio-2')
  const ambiguous = resolveTimelineTrack(tracks, 'Track 1')
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.reason, /ambiguous/)
  assert.equal(resolveTimelineTrack([{ id: 'x', name: 'Dialogue 1', type: 'audio' }], 'Track 1').track.id, 'x')
})
