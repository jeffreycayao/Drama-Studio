# Slow shuttle and keyframe zoom

## Playback

- Tap **Shift+L** to play forward at **1/2×, 1/4×, then 1/8×**. Further taps stay at 1/8×.
- **Shift+J** does the same in reverse.
- Ordinary J/L still use 1×, 2×, 4×, 8×. Switching between fast/slow ladders or directions starts at the first speed of the requested ladder.
- K pauses. Holding K and tapping J/L retains the existing fixed half-speed behavior.
- These are timeline preview controls, not clip timewarps: project timings and exported speed do not change.
- Repeated keydown events from holding J/L do not race through the speed steps. Text fields and Ctrl/Command/Alt combinations are excluded.

## Dope Sheet

Select a clip and open **Dope Sheet**. Its independent **Keyframe zoom** toolbar provides minus/plus, a slider, and **Fit clip**. 100% means the whole clip fits in the available lane area.

Ctrl/Command+wheel zooms around the pointer; ordinary scrolling still pans. Toolbar zoom uses the visible playhead as its anchor, or the viewport center when the playhead is offscreen. Fit follows panel resizing, and switching clips starts fitted again. The main timeline zoom is unchanged.

Zoom is disabled during a keyframe drag, marquee selection or scrub. Zooming itself neither changes keyframe data nor adds undo entries. Maximum zoom spreads frames apart, with a lane-width limit for very long clips and bounded thumbnail counts.

## Verification

Run `npm run test:shuttle-keyframe-zoom`, `npm run test:editor-hotkeys`, and `npm run build`.

For the interactive regression fixture, run Vite on port 5184, then run `node scripts/check-editor-controls.cjs` with Playwright available. `PLAYWRIGHT_MODULE_PATH`, `CHROME_PATH` and `VELORN_TEST_URL` can select existing local runtimes. `VELORN_TEST_SCREENSHOT` optionally saves a screenshot. The fixture creates synthetic state in an isolated browser context; it does not open a user project.

The browser check exercises real transport events, continuous 1/8× clock advancement, reverse rates, pause, K chords, modifier/typing guards, independent zoom, wheel anchoring, keyframe dragging and undo, fitting, resizing, and selection changes.

Before release, manually review a real video clip at each slow speed and direction in Electron, plus a dense keyframe clip in both Dope Sheet and curve view. No project schema, Electron IPC, export or ComfyUI changes are required by these features.
