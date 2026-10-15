# Velorn v0.3.37 — Timeline and audio-analysis fixes

This maintenance release addresses three editing issues reported by the community.

## Close gaps without losing audio sync

Deleting an empty timeline gap now moves later clips across all tracks together,
including independent audio tracks. If another clip occupies that same interval,
or affected media is protected or locked, Velorn explains why it cannot close the
gap and leaves the edit unchanged. A successful gap close can be undone in one step.

This changes selected-gap deletion only; existing clip-deletion and ripple-trim
behavior is unchanged.

## Split repeatedly without switching tracks

The active-track Split button now updates as the playhead moves. After splitting
a clip, move the playhead inside either resulting piece and split again without
having to select a different track first. The button and keyboard shortcut honor
cut boundaries, gaps and locks.

## Prevent the black-window crash during audio analysis

**Detect Beats → Markers** and agent-requested audio analysis now decode audio
with bundled FFmpeg and analyze it outside the display process. This avoids the
Electron audio-decoder path that could crash the editor. Failed or unsupported
analysis returns an error instead of falling back to that decoder.

Trimmed and constant-speed clips retain their beat-marker timing and one-step
Undo. Results are discarded if the project, timeline, clip timing or media source
changes while analysis is running.

### Audio-analysis notes

- Analysis is limited to 10 minutes of source audio per request. Use a shorter
  clip or range for longer material.
- Beat detection is unchanged: it estimates tempo and alignment from the audio,
  then places a regular beat grid. It does not follow tempo changes or suppress
  markers during every musical break. Reverse and speed-ramped beat-marker
  mapping remain unsupported.
- These editing features do not need ComfyUI, cloud credits or an API key.

No project-format, generation-workflow or export-quality changes are included.
