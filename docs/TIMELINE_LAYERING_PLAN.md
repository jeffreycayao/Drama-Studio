# Timeline layering plan (2026-10-17)

User report: adding a text clip put it on Video 1 and cut `sas.mp4` in two.
Goal: layering, cutting and moving behave like a modern editor (CapCut-like).

## What the code did

- `timelineStore.addTextClip / addShapeClip / addAdjustmentClip` always called
  `resolveOverlaps` on the given track: the new clip trimmed or split whatever
  was under it (NLE overwrite). `addClip` did the same unless
  `options.resolveOverlaps === false`.
- Callers picked the track: Timeline toolbar and Text panel used "the active
  video track, else the first video track"; with a single track that is the
  main video, hence the split.
- Drag commit (`Timeline.jsx` mouse-up) called `moveClip/moveSelectedClips`
  with `resolveOverlaps = true`: the dropped clip cut whatever it covered.
  Asset drops (`handleDrop`) used `addClip` overwrite too.
- MCP `add_text_clip`/`add_shape_clip` took the first unlocked video track;
  `add_asset_to_timeline` defaulted to `resolveOverlaps: true`.
- Split (toolbar/hotkey) cut the active track's clip at the playhead, not the
  selected clip; Split All cut every track. Razor cut the clicked clip.
- Track order: `tracks` lists video tracks top-to-bottom, then audio. The
  bottom-most video track (not the captions track) is the base layer.

## Rules

Pure logic in `src/utils/timelineLayers.mjs` (unit tested):

- **Main video track** = bottom-most video track that is not the captions
  track. Derived, not stored, so old projects need no migration.
- **Overlay placement** (text, shapes, adjustment layers, image overlays
  added "at the playhead"): never on the main track and never on top of
  something. Find the top-most video track that has content in the range; use
  the nearest free, unlocked, visible, non-captions track above it; else
  create a new video track directly above it. With nothing in range: lowest
  free overlay track, else a new track above the main track.
- **Free placement** (a clip aimed at a specific track: drops, MCP with
  `trackId`, split halves, duplicates): use the target if the range is free;
  otherwise the adjacent track (above for video, below for audio) if free,
  else a new track inserted next to the target.
- **Overwrite** (old behaviour) stays available: hold Ctrl/Cmd while dropping
  or releasing a dragged clip; MCP `resolveOverlaps: true` / `placement:
  "overwrite"`; `addClip` keeps overwrite as its default for internal callers.
- Tracks created by layering are marked `autoLayer: true`. After a move,
  delete or ripple delete, empty `autoLayer` tracks are removed. Main video,
  captions, user-made tracks and the last track of a type are never removed.
- **Split**: selected clips under the playhead (with their linked partners)
  first; otherwise the active track's clip. Never other layers. Split All is
  unchanged. Razor unchanged (clicked clip).
- **Magnetic main track** (new per-project setting, off by default, toolbar
  toggle): after a delete or move touching the main track, its clips are
  packed from 0 in time order with linked partners shifted by the same amount.
  A drop or move onto the main track inserts instead of layering. If a linked
  partner would collide with another clip, packing is skipped.

## Old projects

No data shape change. `magneticMainTrack` defaults to false. Existing tracks
have no `autoLayer` flag, so nothing is pruned. Saved clips do not move.

## Tests

- `src/utils/timelineLayers.test.mjs`: layer picking, track insertion,
  pruning, magnetic packing.
- `src/utils/timelineLayersStore.test.mjs`: store-level add/move/split/undo.
- Packaged app over CDP: add text over a video, check the video is intact and
  the text is on a new layer; undo.
