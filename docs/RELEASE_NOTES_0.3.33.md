# Velorn v0.3.33

Velorn v0.3.33 makes it easier to inspect motion and work with densely packed keyframes, with slower timeline playback and dedicated keyframe zoom controls.

## New

- **Slow forward and reverse playback.** Hold Shift and tap L to play the timeline forward at 1/2×, 1/4×, then 1/8× speed. Shift+J does the same in reverse. Tap K to pause. These controls slow the preview only; they do not change clip timing or export speed.
- **Independent keyframe zoom.** The Dope Sheet now has its own zoom buttons, slider, percentage display, and Fit clip control. Spread closely spaced keyframes apart without changing the main timeline zoom, in either the keyframe lanes or curve view.
- **Pointer-centered zoom and panning.** Use Ctrl/Command+mouse wheel to zoom around the pointer, and scroll horizontally to pan. Toolbar zoom follows the visible playhead, or the center of the view when the playhead is offscreen.

## Improved

- **Predictable playback shortcuts.** Standard J/L playback still steps through 1×, 2×, 4×, and 8×. K+J/L retains half-speed playback. Switching direction or between fast and slow playback starts at the first speed of the selected mode.
- **Safer keyboard handling.** Holding down a shuttle key no longer races through speed steps. Typing in text fields and Ctrl/Command/Alt shortcuts do not trigger timeline shuttle playback, including Ctrl+Shift+L for unlinking clips.
- **More comfortable keyframe navigation.** Fit clip adapts to panel resizing, switching clips starts with the whole clip visible, and the final keyframe remains accessible at the clip edge. Zooming does not alter keyframes or add undo steps.

## Notes

- These editing features work without ComfyUI and do not change the project file format.
- At 100% keyframe zoom, the entire selected clip fits in the available panel width.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for Apple Silicon Macs
- `Mac (Intel)`: for Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.
