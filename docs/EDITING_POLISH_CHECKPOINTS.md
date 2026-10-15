# Editing polish — local review checkpoints

Worktree: `velorn-editing-polish` (beside the main `velorn` folder). Branch: `codex/editing-workflow-polish`, starting from released v0.3.33 / main `fb7689b`.

## Working agreement

Implement one bounded checkpoint, run focused checks, and stop for the maintainer to try it. Fix feedback before starting another checkpoint. Do not push, merge, tag, or release without explicit approval. Keep the main checkout and experimental agent-budget work untouched.

## Checkpoint 1A — Multi-clip Inspector foundation

The maintainer verified the initial batch-edit engine. Following feedback, the separate panel was replaced by the regular Inspector. **Accepted by the maintainer on 2026-09-10.**

- Uses the same Inspector markup, tabs, draggable numbers, number inputs, sliders, and selectors. No separate batch panel, Apply buttons, or Set/Offset modes.
- Every supported interaction sets the **same absolute value** on compatible selected clips; dragging does not apply per-clip offsets. Draggable inputs retain their sensitivity, double-click-to-type, and existing reset gestures.
- Shared transform controls cover position/3D rotation, scale, anchor, crop, flip, corner pin, opacity, and blend mode. Audio gain and fades use their original inputs/sliders.
- Different values display Mixed. A mixed draggable field starts dragging from the first editable selected clip's value (explained in its tooltip); typing sets an explicit shared value. Clicking, focusing, or leaving a mixed field untouched does not write it. Escape discards an uncommitted draggable-number text draft.
- The existing summary header shows the selection/eligible count. Mixed visual/audio selections offer Video/Audio target switching without deselecting clips. Locked tracks and unsupported clip types are excluded visibly.
- Scale respects each clip's existing X/Y link setting. Clip timing, effects, links, and unrelated properties stay intact.
- An animated property (including a linked scale partner) blocks that whole field's batch edit. Other unanimated fields remain editable. Keyframes are not deleted or silently rewritten.
- Values that would exceed opacity/gain bounds or produce negative scale reject the entire field edit rather than clamping only some clips.
- Each continuous drag/slider gesture or numeric-field edit is one normal timeline undo step. Compound anchor/reset operations validate all fields before writing. No-op/invalid edits do not add history or mark the project dirty.
- Single-clip and linked video/audio-pair Inspectors retain their existing behavior.
- Scope remains the first checkpoint: Color, Effects, Motion, Mask, Text/Shape-specific editing, track matte, lower-layer compositing policy, and attribute copy/paste remain single-clip-only, with unavailable multi-selection controls disabled. Keyframe buttons are disabled in multi-selection. Reset acts on shared transform properties, leaving unsupported effects/animation intact.

### Review in Electron

Close the other Velorn development instance first (it owns port 5173). Dependencies are installed in this worktree; the main checkout is unchanged.

This worktree's Electron sandbox helper is now correctly configured (root-owned, mode 4755). Launch with:

```bash
cd /home/jaime/Documents/coding_projects/general/velorn-editing-polish
npm run electron:dev
```

The helper needs rechecking after a fresh `npm ci`. No sandbox-disabling flags or system-wide security changes were added. Separate source folders still use Velorn's normal app preferences/project storage, so use a disposable or duplicated project for this review.

1. Use a disposable/duplicated project, select two visual clips, and adjust the original Scale slider. Linked clips should change both axes; unlinked clips should change only X. Different link settings expose the existing X/Y sliders.
2. Give two clips different X positions. Position X should show Mixed. Drag it: both should take the same resulting value. Double-click it and type 20: both should become 20. Undo each gesture together.
3. Select two audio clips with different gains, then type −3 dB: both should become −3. Try the existing slider and fades; undo and redo the whole change.
4. Select both visual and audio clips. Use Video/Audio switching, check target counts, and verify each control affects only its own type.
5. Include a locked-track clip; verify it stays unchanged. Include a clip with animated opacity; that field should explain why it is read-only, without blocking position.
6. Change selection with a partially typed value, then return; no pending value should have been applied.
7. Confirm original single-clip editing, linked-pair Video/Audio switching, save/reopen, and preview remain correct.

### Automated checks

Verified locally on 2026-09-10:

- `npm run test:multi-clip-inspector`: 18 tests passed.
- `node --test src/services/projectDirtyTracker.test.js`: 8 passed. The existing `test:dirty-tracker` script uses `--experimental-default-type=module`, which this machine's Node 24.19.0 rejects; the same suite passes without that obsolete flag. The unrelated script was not changed.
- `npm run test:multi-clip-trim`: 8 passed.
- `npm run test:audio-preview`: 8 passed.
- `npm run test:shuttle-keyframe-zoom`: 12 passed.
- `scripts/check-multi-clip-inspector.cjs`: real Inspector/store/canvas integration checks passed (mouse number drags, double-click typing, sliders/held Up-Down arrows, absolute values, linked scaling, audio controls, locked exclusions, animation protection, stale drafts, undo/redo, serialization/load round trip, and single/linked-pair regressions). No renderer exceptions; normal-width screenshot inspected.
- `scripts/check-editor-controls.cjs`: existing shuttle/keyframe zoom browser regression passed.
- The multi-selection integration suite also passed in the installed Electron runtime using `VELORN_TEST_ELECTRON=1` (isolated hidden test host; fresh profile; no real project).
- `npm run build`: passed, with existing Vite/Browserslist/chunk-size warnings.
- `npm run runtime:verify-native`: Linux x64 native dependency gate passed.
- `git diff --check`: passed.

These are synthetic-state tests plus a production renderer build and native dependency check, **not** a packaged desktop release test. Interactive real-project review/save/reopen remain for the maintainer. No production IPC, project schema, renderer/export interpretation of transforms, or native runtime code changed.

An isolated browser fixture exercises the real Inspector and timeline store, undo/redo, project serialization, and dirty tracking without opening a user project. Run Vite on port 5184, then `node scripts/check-multi-clip-inspector.cjs` with Playwright available (`PLAYWRIGHT_MODULE_PATH`, `CHROME_PATH`, `VELORN_TEST_URL`, and optional `VELORN_TEST_SCREENSHOT` are supported).

`VELORN_TEST_ELECTRON=1` runs the same suite in an isolated hidden Electron test host with a fresh temporary profile and no preload/IPC/MCP. It never launches Velorn's main process or opens a real project. The temporary test profile is left in the OS temporary directory for normal cleanup. Although the fixture requests a sandboxed BrowserWindow, Playwright's Electron launcher adds a process-level `--no-sandbox` flag; this is test-only automation, not verification of the production sandbox. No normal app launcher or system security settings were changed.

## Checkpoint 1B — Multi-clip Color

Color is now available in the regular multi-selection Inspector. **Accepted by the maintainer.**

- The existing Global/Lift/Gamma/Gain wheels and Global/Shadows/Midtones/Highlights sliders set the same absolute values on selected editable visual clips. Different starting values show Mixed; there is no separate batch panel or offset mode.
- Wheel hue and saturation changes are atomic. One drag (or held-arrow slider gesture) is one undo step, including pointer cancellation/blur cleanup. Undo/redo uses the existing timeline history.
- Only the changed settings are written. Every clip retains its own untouched grade, LUT, Effects blur, timing, media, transforms and keyframes. Locked tracks and audio are excluded.
- Animated fields remain read-only. If either wheel dimension is animated, the disc is disabled. Group/all-color resets are disabled if any affected field is animated; unrelated groups stay editable.
- Color bypass works across the selection, with a Mixed state when flags differ. The tab's grade dot reflects any selected editable visual clip, and its bypass strike-through appears only when all are bypassed.
- Group resets and the multi-selection Color Reset affect color parameters only, preserving LUTs, Effects blur and bypass. Single-clip reset behavior is unchanged.
- LUT import/selection/intensity remain single-clip-only with an explanation in the familiar Look section. Changing selection during a LUT import no longer applies it to the stale clip selection.
- No project schema, Electron IPC, rendering/export algorithm or native dependency changes.

### Try this checkpoint

Launch from the same `velorn-editing-polish` folder using the command above, with a disposable/duplicated project.

1. Select two visual clips with different grades and open **Color**. Adjust Global brightness, then a tonal slider; both should take the new value while retaining their other settings.
2. Drag a color wheel and undo once: both clips should return to their previous grades. Try a second gesture and verify it is a separate undo step.
3. Try **Reset Global**, a tonal group reset, and the top Color Reset. Existing LUTs and blur should remain untouched. Toggle **Bypass** to compare the selection without losing settings.
4. Include a locked-track clip and an audio clip; neither should be graded. Include a keyframed color property and check its disabled control/tooltip while other fields still work.
5. Check paused preview, playback, save/reopen and normal single-clip editing.

### Verification

- 71 focused pure tests passed (35 multi-clip Inspector/Color, 8 dirty tracker, 8 multi-trim, 12 shuttle/keyframe viewport and 8 audio preview).
- Production renderer build and Linux x64 native dependency check passed. Existing Vite/Browserslist/chunk-size warnings remain.
- The existing Inspector suite passed in Chrome and the installed Electron runtime; existing shuttle/keyframe-zoom browser regression also passed.
- The new `scripts/check-multi-clip-color.cjs` suite passed in Chrome (10 groups) and installed Electron (9 core groups): mixed/sparse edits, atomic wheel changes, slider/keyboard undo, resets, bypass, animation protection, exclusions, stale-selection checks, all five visual Inspector variants, single-clip regression, and project save/load semantics.
- Browser-only interruption tests passed for wheel/range pointer cancellation, lost pointer capture and window blur; the next gesture gets its own undo step.
- Paused canvas color updates and undo passed. Synthetic full-bake freshness checks passed for edits/bypass/undo, using the same grade interpretation consumed by preview and export. **No movie export or packaged release was tested.**
- Normal-width Color screenshot was inspected; no control overflow or renderer exceptions. The adjustment-layer Commit Render action remains single-selection-only.

The Color suite uses the same isolated fixture and runtime environment variables as the foundation suite, with `VELORN_TEST_SCREENSHOT` optionally capturing the Color tab. All state is synthetic; no real project or main-checkout files were edited.

## Checkpoint 1C — Multi-clip Effects

The regular Effects tab now supports selected visual clips together. **Accepted by the maintainer.**

- Add any built-in managed effect (including the built-in GPU shader effects) to selected editable visual clips. Adds from the Effects library, including presets, use the same atomic path and one undo step.
- Shared effects use the familiar cards, sliders, toggles, presets and reset buttons. Settings are absolute; differing values show Mixed. Only touched parameters change, preserving other parameters, effect IDs, masks, unknown effects, clip timing, grades and stack order.
- Matching uses exact effect types, not display names (legacy/GPU variants can share names). Repeated copies are numbered and matched by their order within that type, **only when every editable selected clip has the same number of copies**. Missing or uneven duplicate stacks are not guessed at; select one clip to edit those effects. Adding still appends a new default instance to each selected editable clip, without replacing existing instances.
- A field is disabled if any matched instance has that field animated. Presets/reset validate every affected field before writing. Removal is disabled when any matched instance owns keyframes, including unrecognized future parameters. Enable/disable preserves animation. Reordering and keyframe editing remain single-clip-only.
- Regular Effects blur and the Effects bypass header also work across selected visual clips. Layer motion blur stays single-clip-only; non-managed effect/cache operations are not exposed as misleading primary-clip-only batch controls.
- Locked tracks, audio and unsupported targets are excluded. No-op/rejected edits create neither undo steps nor dirty changes. Store requests revalidate selection and exact matched effect IDs to reject stale edits after changes to a stack.
- Existing render-cache invalidation and per-clip full-bake signatures handle changed effects. Removing the last effect clears the cache URL/status just like ordinary single-clip removal; no cache files are deleted. Undo restores prior cache metadata. No renderer/export algorithm, Electron IPC or project schema changes.

### Try this checkpoint

Use a duplicated/disposable project in the same `velorn-editing-polish` review folder.

1. Select two or three visual clips, open **Effects**, add **Film Grain**, and adjust Amount. Undo once to restore all their previous values; try the preset and enable/disable controls too.
2. Give clips different grain values plus unrelated effects. Select them together: grain should show Mixed, and editing it should preserve the unrelated effects and values.
3. Try equal repeated effects (numbered copies), then uneven stacks. Uneven types should not appear as a falsely shared effect. Reorder is disabled during multi-selection.
4. Include audio and locked clips and confirm they remain untouched. Keyframe one effect parameter on a clip: that field, affected presets/reset and animated-effect removal should be protected, while other fields still work.
5. Check Effects blur/bypass, add a preset from the Effects library, and verify undo/redo, paused preview, playback and save/reopen.

### Verification

- 100 focused pure tests passed: 29 effects/blur/bypass plus the 71 Inspector/Color/dirty-tracker/trim/shuttle/keyframe-viewport/audio tests.
- Production build and Linux x64 native dependency gate passed (existing Vite/Browserslist/chunk warnings remain).
- Existing Inspector and Color browser regression suites passed.
- The new `scripts/check-multi-clip-effects.cjs` Chrome suite passed all 12 groups, including 100 real registry default/preset cases, unique IDs, atomic history, sparse edits, animation/stale-selection guards, repeated types, presets/reset/remove/enable, blur/bypass, Effects library multi-add, all five visual types, single/linked-pair regression, save/load, cache lifecycle and paused preview/undo.
- Installed Electron behavioral coverage passed across two runs: the Inspector checks through paused preview/undo and normal-width layout, followed by a focused Effects library/100-registry-case run (`VELORN_TEST_EFFECTS_TAIL=1`). Optional screenshot capture timed out on the hidden native window; the script now skips native screenshots and uses the inspected browser capture instead. No app behavior check failed in those native runs.
- Browser-only interrupted-gesture checks passed for pointer cancellation, lost capture and window blur. A normal-width screenshot was inspected.

Tests use synthetic state, not user media/projects; real-project review, movie export and a packaged release remain separate.

### Separate renderer issue found — not changed in 1C

Legacy Gaussian Blur on a shape does not change its canvas image in GPU compositor mode, even with the original single-clip `updateEffect` action (amount 0 → 12). The same single-clip Gaussian edit does repaint in Canvas mode; Chromatic Aberration also repaints in GPU mode. The GPU shape path in `CanvasPreviewRenderer.jsx` uses `buildManagedEffectGpuPasses` and returns before the CPU effect pass; that GPU descriptor builder in `utils/effects.js` has no Gaussian Blur branch. This predates batch editing; the renderer files are unchanged. The batch paused-preview acceptance test uses supported Chromatic Aberration instead. Investigate GPU/CPU parity as a separate checkpoint; no export behavior was tested or inferred from this observation.

## Checkpoint 1D — Selective Paste Attributes

**Accepted by the maintainer.** This checkpoint adds a separate **Paste Attributes…** command to the timeline clip context menu; normal Copy and Paste at Playhead retain their existing behavior and shortcuts.

- Copy captures independent attribute snapshots. If multiple clips were copied (including linked video/audio), the dialog requires an explicit source choice. Editing or deleting the original after copying does not change that snapshot.
- Select one or more destination clips, right-click, and choose **Paste Attributes…**. Categories start unchecked, so replacements are explicit: Transform, Color, Effects, or Audio.
- Transform transfers the supported shared transform fields, opacity and blend mode. Color transfers the grade, tonal groups, existing LUT reference/strength and Color bypass. Effects replaces the built-in managed stack, regular blur and Effects bypass. Audio transfers gain and fade durations to audio clips only.
- Timing, source media, links, text/shape content, clip masks, layer motion blur and unchosen categories are preserved. Locked tracks and incompatible clip types are excluded.
- Animation transfer is not included. A category is unavailable if affected properties on the source or any compatible destination have keyframes. Other categories remain usable; no keyframes are removed or overwritten.
- Effects is unavailable when a source or destination stack contains unknown/non-managed effects. It does not silently discard or reorder those effects. Copied effect instances receive independent IDs/settings; equivalent settings are a no-op.
- The dialog previews eligible counts and explains replacement behavior. It validates the copied source, selected IDs and timeline snapshots again on Apply. Project/timeline load or reset clears only the new attribute clipboard, leaving ordinary clip copy/paste unchanged.
- Successful changes use one existing timeline undo step. Cancel, rejected operations and no-ops do not create history or dirty changes. No new IPC, project schema, native dependency, renderer or export algorithm is required.

### Review steps

Use the same review folder and a disposable/duplicated project.

1. Copy a graded/effected clip with **Ctrl/Cmd+C**. Select destination clips, right-click, choose **Paste Attributes…**, select only Color and Effects, and Apply. Their transforms and timing should stay intact.
2. Undo once and redo once; every destination should restore together. Repeat the same paste and check there is no extra undo for unchanged settings.
3. Try Transform alone, then copy an audio clip and paste Audio onto audio destinations. Fades longer than a destination clip are blocked, not silently shortened.
4. Copy a linked video/audio pair: choose the intended source in the dialog. Try locked clips, animated settings and unknown effects and check the explanations.
5. Cancel or press Escape without changing the timeline. Space should toggle a focused checkbox, not playback; Tab stays within the dialog.
6. Confirm normal clip copy/paste, paused preview, playback and save/reopen still work.

### Verification

- 144 focused pure tests passed: 34 new Paste Attributes tests plus 110 existing Inspector/Color/Effects, dirty-tracking, trim, shuttle/keyframe viewport, audio, dialog-focus and shortcut tests.
- Final production renderer build and Linux x64 native dependency gate passed. Existing Vite/Browserslist/chunk-size warnings remain.
- Existing Inspector, Color and Effects browser suites passed; the Effects suite includes 100 real registry default/preset cases.
- New `scripts/check-paste-attributes.cjs` browser suite passed all 11 groups, including 100 real effect default/preset pastes to two destinations with unique IDs, one undo and a clean second-paste no-op. It covers real timeline context-menu entry, explicit source selection, immutable Copy snapshots, category replacements, preservation/exclusions, animation/unknown-stack guards, stale dialog/store requests, normal Ctrl+C/V, clipboard serialization omission and paused shader preview/undo.
- The installed Electron runtime passed the complete 11 core groups, including paused preview/undo and all 100 registry cases, in the isolated hidden host described above. An initial run was interrupted by source-edit hot reload; the stable-source rerun completed with exit code 0. Native screenshots are intentionally skipped; the browser capture covers layout.
- Space/JKL/arrows/delete/copy/paste/undo stay inside the dialog; Tab loops and Escape cancels. A supplemental browser check confirmed Enter on Apply submits without playback and ArrowRight works again after close. Final-wording dialog screenshot was visually inspected with no overflow.

All integration checks use the isolated synthetic fixture with the real Timeline, Inspector, TransportControls and canvas. No real project, movie export or packaged desktop release was tested. No user app process or port 5173 server was launched or stopped.

## Checkpoint 2A — Live trim-edge feedback

**Accepted by the maintainer.** Drag a clip's head or tail to see a small temporary source monitor above the initial grab point. This is feedback for the existing trim gesture, not a new trim tool.

- The inset shows the first retained frame for a head trim or the last retained frame for a tail trim. Cut and Duration use timeline timecode; the signed frame count explicitly says added or removed. The tail cut time is the exclusive boundary, while its image is the final frame still inside the clip.
- The actual timeline playhead is not sought or moved by this feature. Numerical trim behavior, common multi-clip bounds, snapping and the existing one-gesture undo path remain unchanged. Readouts use the actual frame-quantized store result, not a predicted pointer position.
- Source start/end, unknown media extent, neighboring clips, minimum one-frame duration and timeline start get distinct limit messages. When another selected editable clip imposes the shared limit, the inset names it. Multi-trim shows the grabbed clip and the editable selected count; locked clips remain excluded.
- Video uses an independent muted decoder and private canvas, with coalesced seeks and presented-frame confirmation. It does not seek shared preview elements or mutate caches. Valid RIFE cache selection and cache-local time mapping share the same validity/handle contract. Otherwise it uses an enabled valid proxy, usable playback cache, or original source. Speed/reverse/ramp mapping follows existing playback timing.
- This first pass is explicitly **source-only**: effects, grading, transforms, masks and compositing are not shown. Images show their source; audio, text, shapes, captions and adjustment layers get clearly labeled timing-only feedback. Frame Blend is not synthesized in this inset. Missing/failed media gets an unavailable message, never an old image labeled as the new frame.
- Mouse release, Escape, window blur, pointer cancellation, tool change, selection/lock changes, another history action, timeline load, clip removal and Timeline unmount end the gesture and discard the preview. Escape/blur retain the last applied trim; normal Undo restores the whole gesture. The inset captures no pointer input, creates no project data and is not serialized.
- Two-up rolling-cut/slip feedback, different trim math/tools, insert/overwrite, renderer parity fixes and export changes are not part of 2A. No Electron IPC, native dependency or project schema change.

### Try this checkpoint

Use the same `velorn-editing-polish` review folder and a disposable/duplicated project.

1. Leave the playhead away from a cut. Drag a video clip's head, then its tail. Check the source image, Cut/Duration timecodes and added/removed frame count while the playhead stays put.
2. Trim to the end of available footage, into a neighbor, and down to one frame. Check that the message describes the actual constraint.
3. Select several clips on separate tracks and trim one edge. Verify they still move together, the inset previews the grabbed clip, and a shorter clip's source limit is identified. Undo once to restore all of them.
4. Try a reversed/slowed clip, a clip with a valid RIFE cache, an image and an audio clip. Source-only and timing-only labels should make the scope clear.
5. Try rapid back-and-forth trimming, then release or press Escape. The inset should disappear immediately. Change selection or leave the window during a gesture and confirm there is no stuck drag when you return.

### Verification

- 203 focused pure tests passed, including 22 trim-feedback cases, 11 source-resolution cases and existing Inspector/Color/Effects/Paste Attributes, trim, dirty-tracking, shortcuts, audio, playback timing, frame sampling and precise video seeking regressions.
- A comparison of 1,000 generated trim sessions and 5,000 resolutions against the original helper confirmed unchanged existing session fields and numerical outputs. New limit ownership is metadata only, including the source-end floor at 24fps (`.53` seconds available, `.5` seconds legal extension).
- Existing Paste Attributes browser integration passed all 11 groups, including 100 registry cases, modal input isolation and paused shader preview/undo.
- Existing multi-clip Inspector browser integration passed, covering shared controls, undo, paused preview, linked-pair/single-clip regressions and layout.
- The new browser trim-preview suite passed all 10 groups: decoded head/tail pixels and timecodes, fixed playhead, shared/neighbor/source limits, locked exclusions, snapping, speed/reverse/RIFE, image/audio/error behavior, rapid seek/media-session safety, cancellation/stale-session cleanup, unmount and dirty/history invariants. Its source-monitor screenshot was inspected.
- The same complete 10 groups passed in the installed Electron runtime using the isolated hidden host, with no renderer exceptions. No native screenshot capture was attempted.
- A final layout-only correction measures the inset's real height instead of estimating it, keeping wrapped long clip names on-screen. After that correction, the full 10-group browser suite and production build passed again. `scripts/check-trim-preview-layout.cjs` passed 36 browser cases across six window sizes, long spaced/unbroken names, both corner anchors and live resizing.
- The supplemental layout-only Electron attempt is **not verified**: the hidden host stalled animation-frame callbacks, then did not deliver the size observer after wrapped text changed. A bounded rerun exposed stale inset positioning in that hidden automation setup. No production-app failure was established; use Chrome for this supplemental layout script and check window resizing interactively in the real app. The complete native behavioral suite above passed before the final layout-only correction.
- The production renderer build and Linux x64 native dependency gate passed. Existing Vite/Browserslist/chunk-size warnings remain; `git diff --check` passed.

Integration uses `scripts/check-trim-preview.cjs` with the existing isolated fixture and runtime environment variables above. The test generates tiny uniquely colored frame sequences in a temporary directory, checks actual canvas pixels against decoded frames, then removes those generated files. A synthetic encoded cache tests RIFE URL/time selection without running an interpolation model. No user media/project is opened and no real cache is generated. Native automation has the same test-only sandbox caveat noted above; this is not a movie export or packaged-release test.

## Checkpoint 2B — Explicit source Insert and Overwrite

**Accepted by the maintainer.** The existing source viewer now distinguishes **Insert at Playhead**, **Overwrite at Playhead**, and **Add to End**. In/Out marks, source audition, Match Frame and normal drag-and-drop remain in place; no second source-player panel or new keyboard bindings are introduced.

- Insert opens a gap of the chosen source duration across the sequence. Clips crossing the insertion point are split when their timing can be preserved; downstream clips on every track (including muted/hidden tracks) and markers at/after the point move together. Timeline playhead and timeline In/Out marks stay at their current absolute positions.
- Overwrite replaces only the covered interval on the displayed video/audio destination tracks. Surviving footage keeps its original timeline position and source mapping; unrelated tracks, downstream material and markers do not move.
- Destinations are shown before editing. An active compatible unlocked track is preferred; fallback uses a compatible unlocked track, excluding the dedicated captions track. Embedded source audio uses the first visible unlocked audio track and stays linked to its video. Missing audio destinations block a paired edit instead of silently discarding the sound.
- Add to End uses the later end of the displayed video/audio destinations, so appending a paired source cannot overwrite existing audio. This is deliberately safer than the old single-destination append calculation.
- Source range duration rounds down to whole timeline frames without exceeding the selected range or available media. Source seconds remain real-time when source/timeline frame rates differ; video/audio share exact trim bounds and duration. Unknown source duration and ranges shorter than one timeline frame are blocked rather than guessed.
- Source duration belongs to the current asset. While switching videos, the viewer ignores the previous source's shared duration and only trusts matching decoded metadata or the current asset's own duration. Unknown-length sources wait for matching metadata; decoder errors/emptied events invalidate that measurement.
- Preflight is read-only. A displayed preview token binds the request to its timeline snapshot; source/range/target/timeline/history changes invalidate it. Applying commits picture, audio, existing edits, markers/transitions and one normal undo checkpoint together. Rejected/disabled previews and stale/replayed tokens do not write project state, dirty the project or create history. Tokens are transient and never serialized.
- Unchanged or equally moved transition relationships retain their metadata, including translated absolute times. Edits which cut a transition relationship are refused with an explanation rather than silently dropping or reconstructing it.
- This first pass declines partial cuts that cannot be represented faithfully by existing clip properties: animated/speed-ramped clips, live captions, certain temporal effects or asset-backed masks, cuts inside audio fades, mismatched linked groups and sub-frame remnants. Whole downstream moves remain supported. Locked/sync-locked affected material blocks the entire edit, and song-synchronized source assets retain their dedicated placement workflow. Nothing is silently unlocked, unlinked or partially edited.
- Surviving simple constant-speed/reversed segments retain source timing, static appearance and outer audio fades. New split portions get unique clip/link IDs; changed trim caches are invalidated without deleting media or disk cache files. Ordinary `addClip`, drag/drop and existing overlap behavior are not replaced.
- Undo/redo uses existing history semantics. As with ordinary clip placement, the timeline viewport's padded duration can stay extended after Undo; clip/track/transition/marker content is restored. No new project schema, Electron IPC, native dependency, renderer or export algorithm.

### Try this checkpoint

Use the same `velorn-editing-polish` folder with a disposable/duplicated project.

1. Preview a source asset, mark In and Out, and park the timeline playhead inside a simple clip. Check the displayed video/audio destinations, then **Insert at Playhead**. The source should fill a new gap while later layers and markers move together. Undo once.
2. Choose **Overwrite at Playhead** with the same range. Only the destination tracks' covered portions should change; later clip positions and other tracks should stay put. Undo/redo once.
3. Try a source with embedded audio and verify both new clips have the same range and stay linked. Make the destination audio track longer than the video track, then use **Add to End**; both new clips should start after the longer destination.
4. Lock affected material, try a transition/animated-clip crossing and try a mismatched linked group. Check the visible explanation and confirm no partial edit appears. Move the playhead outside the protected relationship and retry.
5. Change the active track and confirm the destination label updates. Test source marks, Clear, Match Frame, normal drag/drop, save/reopen and a narrow source-viewer layout.

### Verification

- 246 focused pure tests passed: 43 new source-edit cases plus the 203 existing Inspector/Color/Effects/Paste Attributes, trim feedback/source resolution, dirty-tracking, shortcuts, audio, playback timing, frame sampling and seeking tests. An additional overlapping 55-test run covers the source planner alongside audio split, clip playback timing and transition-move helpers.
- New `scripts/check-source-edit.cjs` passed all 14 integration groups in both Chrome and the installed Electron runtime, plus 350/600px source-panel layout checks, with no renderer exceptions. Coverage includes real controls and In/Out shortcuts, global crossing Insert, isolated Overwrite, paired Add to End, mixed source/timeline FPS, locks/sync/transitions/ramp refusals, destination routing, Match Frame, atomic undo/redo, JSON save/load, stale/replayed tokens, request/history changes, receipt mutation isolation and source-duration switching/decoder events.
- Independent read-only comparison against the existing playback-time helper passed 432 Insert/Overwrite plans and 6,912 retained-piece source-time comparisons, covering forward/reverse, six speeds, explicit time scales and FPS fallback. Raw source times and unclamped samples agree within `1e-9`; this does not test rendered appearance at decoder boundaries.
- The final browser source-panel screenshot was visually inspected; native screenshots are intentionally skipped. Electron uses the existing isolated hidden host and a fresh temporary profile, not production main/preload/IPC or a user project. Playwright launch behavior has the same test-only sandbox caveat noted above; this is not production sandbox verification.
- Existing Paste Attributes browser integration passed all 11 groups, including 100 registry cases, modal input isolation and paused shader preview/undo.
- Existing trim-preview browser integration passed all 10 groups, including decoded head/tail pixels and exact 10-fps timecode assertions. A rerun initially exposed a test-only duplicate project-store module: a bare runtime import seeded 10 fps while Vite's timestamped rendered module defaulted to 24 fps. The fixture now exposes its statically imported store and the runner seeds that exact instance; assertions and application trimming behavior were not changed.
- Final production renderer build and Linux x64 native dependency gate passed. Existing Vite/Browserslist/chunk-size warnings remain.

The new source-edit fixture uses synthetic source timing and controlled media events: it verifies edit/control behavior, not decoded video pixels. Real-project review, full media playback, movie export and packaged-release verification remain separate. No main checkout, real project or user app process was changed by these tests.

## Checkpoint 2C — Two-up rolling-edit feedback

**Accepted by the maintainer.** With the existing Trim tool, drag the cut between two touching clips. A temporary two-up source viewer shows the outgoing shot's last retained frame and the incoming shot's first frame, with the actual cut timecode and signed frame shift.

- Feedback reads the actual normalized clips after both existing rolling-trim updates. It never derives a displayed frame from an uncommitted mouse position or displays the excluded outgoing end boundary. Both outer edit boundaries must remain stable, and the pair must meet on timeline frames, before it is described as one cut.
- Each pane has its own muted source decoder. The source-viewer code is shared with the accepted single-clip trim preview, retaining source/proxy/playback-cache/RIFE selection and strict stale/presented-frame checks. Same-URL clips still have independent source positions. Still images display their source; unsupported visual types and audio have explicit timing-only feedback. Grading, effects, transforms, masks, compositing and synthesized Frame Blend are not displayed.
- A reversed head frame exposed Chromium rounding a seek just below the source out-point onto the excluded next frame. Private trim decoders now seek inside the requested frame's interval while retaining the original requested source time and strict presented-frame validation. Cold frame-zero reuse and partial final-frame bounds are guarded; the main timeline renderer and source timing model are unchanged.
- The popup is pointer-transparent, anchored above the grabbed cut, constrained to the window, and stacked on narrow windows. Limit messages identify the existing outgoing/incoming source or one-frame constraint. It never moves the playhead, creates project fields or changes the export pipeline.
- Roll start now checks clip/track lock variants and makes the pointer gesture exclusive. Release, Escape, blur, pointer cancellation, tool changes, changed selection/locks/history/transitions, project/timeline load and unmount stop the gesture and its viewers. Escape/blur keep the last applied trim; normal Undo restores the gesture, matching the existing single-clip trim convention.
- Existing rolling source/duration constraints and the two per-clip store writes are retained. One narrowly scoped rounding fix resolves a shared timeline-frame delta before those writes: previously an exact half-frame drag could round the opposing durations independently and extend the sequence by one frame. Legal frame bounds round inward so the pair stays within its handles. This is not a new trim engine, slip preview, four-up viewer or linked-track roll feature. Gaps/overlaps, off-grid or malformed pairs do not get a fabricated two-up cut; their existing handling remains unchanged.

### Verification

- 450 focused tests passed across all accepted editing checkpoints, including 16 rolling-feedback/shared-rounding tests and 5 private-decoder seek tests. Real-store normalization tests cover four integer/fractional FPS values, three speeds, half-frame ties, and repeated identical pointer positions; the pair stays adjacent with unchanged outer bounds. Private-seek tests cover 2,880 fractional/RIFE frame combinations.
- The Chrome renderer passed all 8 new rolling-preview groups: actual decoded outgoing/incoming pixels, positive/negative and exact-half-frame movement, fixed playhead/outer boundaries/Undo, same-URL independent clocks, rapid-seek stale-pixel protection, speed/reverse, RIFE with a nonzero cache origin, source/minimum-duration constraints, missing media, still/audio modes, lock variants, interruption cleanup and narrow layout. Wide and 350px screenshots were inspected.
- Installed Electron passed the 7 core groups plus a separate focused native window-resize check. The initial CDP viewport-emulation check changed `innerWidth` without delivering the normal native resize event, leaving the popup's previous anchor clamp in place. Using real `BrowserWindow.setContentSize` delivered resize events and passed unchanged bounds assertions: at 600px width the popup spans x32–592; at 350px it spans x8–342 with both source panes visible. The runner now uses real native resizing for Electron. No app layout workaround or weakened geometry/frame assertion was added.
- The original single-clip trim-preview suite passed all 10 groups in both Chrome and installed Electron after the decoder precision fix. Its 36-case Chrome layout suite also passed after the component extraction; layout markup is unchanged by the subsequent seek-only fix.
- Production build (13.46 seconds), Linux/x64 native dependency gate, script syntax and `git diff --check` passed. Existing Vite/Browserslist/chunk-size/import warnings remain.
- These are isolated synthetic-state/decoded-media tests, not production project edits or a packaged release/export test. Private viewers do not modify the preview compositor, native IPC, export paths or project schema. Main and user projects are untouched; nothing was committed, pushed or merged.

### Existing roll limitations observed — not changed here

The prior rolling code uses constant forward-style source bounds, even for reverse/speed-ramped media; an unbounded outgoing duration is captured as `null` and the move handler then treats `Number(null)` as zero. It also permits near gaps and some overlaps. These were separate roll-engine follow-ups, not new behavior introduced by the source preview. The maintainer approved addressing them in checkpoint 2D below.

### Try this checkpoint

1. Use a duplicated project in the same review folder. Select the Trim tool and drag the shared cut between two touching video shots. Check outgoing last/incoming first images and the cut timecode/frame shift while the playhead stays put.
2. Make several mouse moves in one gesture, release, and Undo once. The original cut should return, with the sequence's outer timing unchanged.
3. Try two shots from different positions in the same file, then a safe constant-speed shot and one with a valid RIFE cache. Check source-only status and both frame updates.
4. Try source-handle limits, Escape, changing tools, and a narrow window. Confirm the preview disappears on release and no old drag remains active. Also verify normal single-clip trimming still feels the same.

## Checkpoint 2D — Rolling-trim reliability

**Accepted by the maintainer.** This is a reliability pass on the existing Trim tool and accepted two-up source viewer, not another editing panel.

- A shared-cut gesture is preflighted before it can change the timeline. Both clip trims and the first Undo checkpoint are published together, with one frame-quantized delta and unchanged outer sequence boundaries. Clicking, repeating the same position, and refused requests do not create edits.
- Still images, titles, shapes and adjustment layers have no physical source-handle limit. Their synthetic trim values stay nonnegative and survive JSON save/reopen, including the `Infinity` to `null` round trip.
- Constant-speed reverse footage uses the opposite source handle: the outgoing tail preserves its source Out; the incoming head preserves its source In. The ordinary exclusive-source-Out rule for the first reverse frame remains unchanged. Speeds, effects, masks and clip-local keyframe conventions are not redesigned.
- Incoming audio volume envelopes retain their original timeline coordinate as the head changes; repeated pointer movement is always evaluated from the original gesture rather than accumulating offsets.
- Speed ramps and unsupported source clocks are refused with a short explanation instead of changing playback accidentally. This pass does not introduce rolling edits across linked tracks or transitions, or turn a gap/overlap into a shared cut.
- Video with missing source-duration metadata or a legacy non-unit source timebase is refused with reload/check-timing guidance: the existing loader cannot guarantee an unchanged round trip for those records. Ordinary modern video supports matching or differing source/timeline FPS and constant speeds. Known audio source limits remain conservative when only its nominal Out is available.
- Full-render bakes become stale through existing content signatures; source interpolation caches remain usable only when the existing coverage checks pass. No cache files are deleted, no models are run, and no project schema, native IPC or export renderer changes are needed.

### Verification

- 476 focused Node tests passed across this and the accepted editing checkpoints. `npm run test:roll-edit` passes 58 targeted cases, including pure planning, real store actions, persistence, feedback and source decoding helpers. Tests assert one subscriber publication for both sides plus history, repeated-position no-ops, stale/reentrant-write rejection, exact origin/Redo restoration, lock/link/transition/compound guards and source bounds.
- Persistence checks cover 96 integer/fractional timeline-FPS, constant-speed, forward/reverse and matching/60-FPS-source combinations, plus 32 unlimited-generator extension cases. They verify raw source clocks before/after JSON reload, unchanged attributes, Undo/Redo, envelope coordinates and full-bake/RIFE cache validity without reading or deleting a real cache file. Existing reverse-audio silence and the exclusive-Out reverse first-frame convention remain unchanged.
- The Chrome and installed-Electron isolated hosts passed all 12 rolling-reliability/preview integration groups: actual decoded outgoing/incoming pixels, both roll directions, still/title extension, reverse/mixed-speed clocks, half-frame quantization, source/minimum-length limits, atomic publication, no-op/rejection/dirty-state checks, interruption cleanup and window layout. Electron uses real `BrowserWindow` resizing. Wide, 350px and refusal screenshots were inspected.
- After a final minimum-bound label correction, a fresh focused Chrome/Electron check verified the fractional source limit: a -0.22-second pointer move rounds to -0.2 with no premature limit label; attempting -0.4 against a -0.26 limit retains the same accepted cut and decoded frames, shows the source-start limit, and creates no extra history. The correction only makes inward-rounded minimum/maximum labels symmetric; it does not alter trim or decoder timing.
- The original single-clip trim suite passed all 10 groups in both Chrome and installed Electron. Its runner now blocks only the dedicated test server's HMR websocket, matching the roll runner, so source edits during development cannot interrupt a fixture. An initial native missing-popup case during ongoing source edits did not reproduce in the final frozen-source run. No assertion or timeout was relaxed and no production decoder behavior was changed.
- Final production renderer build (14.63 seconds), Linux/x64 native dependency gate, test-script syntax checks and `git diff --check` passed. Existing build warnings remain. Tests use synthetic timelines and generated diagnostic media, not user projects; a real-project save/reopen and movie export remain manual review steps, not claimed verification.
- Main remains clean. All accepted work and this checkpoint remain together locally in `codex/editing-workflow-polish`; nothing was committed, pushed, merged or released.
- All isolated test hosts and the owned port-5184 server were closed after verification. The user's app, port 5173 and projects were not modified by these tests.

### Try this checkpoint

Use a duplicate/disposable project in `velorn-editing-polish`.

1. In the Trim tool, roll the shared cut between two touching clips in both directions. The outside edges must stay put. Release and Undo once.
2. Repeat with a still or title on either side, including extending a title earlier than its original start. It should stop at the other clip's one-frame/source limit, not a fictitious zero-length source.
3. Reverse either or both video clips, then roll again. Check the two-up source frames and playback. Try constant slow/fast footage too.
4. Try a speed-ramped clip and check that the explanation appears without changing either clip. Normal single-edge trimming remains a separate tool path.
5. Save/reopen the duplicate and check the cut and audio envelope, then report feedback before another checkpoint starts.

## Checkpoint 2E — Slip source preview and reliability

**Accepted by the maintainer.** Select the existing Slip tool and drag a clip's body to change the source passage without moving either cut. A temporary two-up source viewer shows the first and last retained frames from that same clip.

- The signed offset is in timeline frames. Positive drags choose later source In/Out points for both forward and reversed footage, preserving the existing Slip direction. Constant speeds are respected; one timeline frame at 2x advances two source-frame intervals when source/timeline FPS match.
- Each pane uses its own muted decoder and the accepted source/proxy/playback-cache/RIFE resolution checks. Grading, effects, transforms, masks, compositing and synthesized Frame Blend are not shown. Audio has explicit timing-only feedback. The popup is pointer-transparent, window-bounded, and stacked on narrow windows.
- A single inward-bounded, frame-quantized delta changes only source In/Out. Clip placement, duration, neighbors, playhead, ordinary clip-local keyframes and audio-envelope coordinates remain unchanged. Source-start/end messages appear when the pointer reaches the physical limit, including fractional-frame handles.
- Begin/click/repeated positions are read-only. The first effective move publishes the changed clip and one normal Undo checkpoint atomically. Moves remain cumulative from the original clip. Returning exactly to the original range restores the pre-gesture history, including an existing Redo branch.
- Release, Escape, blur, pointer cancellation, tool changes, changed selection/locks/history and project/timeline load or unmount end the gesture. Escape/blur keep the last applied Slip, like existing trimming; Undo restores it. Stale/reentrant writes cannot redirect the edit. Switching the independent source-viewer mode is not an authored timeline change.
- Unsupported Slip targets no longer fall through into ordinary movement or Alt-drag duplication. Stills, titles, captions, compound parents, locked clips/tracks, active render jobs, speed ramps, linked mates and attached transitions receive an explanation. Unknown source duration, mismatched source spans and legacy non-unit video timebases are refused rather than guessed. Ordinary media inside an open compound remains eligible.
- Full bakes become stale via existing signatures. Source interpolation caches are retained and reused only with valid source coverage. No caches/media are deleted, no models are run, and no project schema, native IPC, renderer or export timing algorithm changes are introduced.

### Verification

- 501 focused Node tests passed across this and all accepted editing checkpoints. `npm run test:slip-edit` passes 41 focused planner/store/persistence/source-decoding-helper tests. These cover atomic first edits, no-op/repeated movement, stale/reentrant writes, return-to-origin history/Redo restoration and conservative source/type/lock/link/transition guards.
- Persistence tests check every retained sample across 96 forward/reverse, slow/fast, integer/fractional timeline-FPS and matching/60-FPS-source combinations, plus 18 audio speed/timebase/reverse combinations. Placement, neighbors, attributes, animation and clip-local envelope timing survive Undo/Redo and JSON save/load. Full-bake signatures and RIFE coverage are checked without real cache writes/deletes; existing reverse-audio silence remains unchanged.
- `scripts/check-slip-edit-preview.cjs` passed all 11 Chrome integration groups using independently FFmpeg-decoded diagnostic media. Coverage includes actual source pixels in both independent panes, forward/reverse/.5x/2x, nonzero-origin RIFE cache mapping and source fallback, fractional source limits, history/dirty neutrality, save/reload, locked/unsupported real pointer drags, media failures, independent source-viewer mode, cancellation/stale cleanup and responsive layout. Wide, 350px and refusal screenshots were inspected.
- The same complete 11 Slip groups passed in the installed Electron runtime, with no renderer exceptions, including actual `BrowserWindow` resizing to 600/350px. Existing single-edge Trim (10 groups) passed in Chrome and Electron; rolling edit (12 groups) passed in Chrome. No production decoder changes or relaxed decoded-frame assertions were needed.
- The production renderer build (14.30 seconds), Linux/x64 native runtime gate, test-script syntax and `git diff --check` passed. Existing Vite/Browserslist/chunk-size/import warnings remain.
- The port-5184 fixture uses fresh isolated profiles and generated in-memory media, not user projects or normal app processes. Native test-only sandbox caveats above still apply; this is not a packaged release or final movie export test. Main remains unchanged and all checkpoints remain together locally, without commits, pushes, merges or releases.
- All isolated browser/Electron hosts and the verified owned port-5184 server were closed after verification. The user's app/port 5173 was not stopped or restarted.

### Try this checkpoint

Use a duplicate/disposable project in `velorn-editing-polish`.

1. Trim a video so it has unused footage at both ends. Select **Slip**, then drag its body left/right. Compare the first/last source images and frame offset; both cuts and the playhead should remain fixed.
2. Drag to each source limit. Release and Undo once; the original source range should return. Clicking without moving should not add an Undo step.
3. Try reversed or constant slow/fast footage, then an audio clip with an existing volume envelope. Source content should change while the clip-local animation/envelope timing stays put.
4. Try a still or linked clip and check the explanation instead of a moved clip. Try Escape, changing tools and a narrow window; no stale gesture should remain.
5. Save/reopen the duplicate and compare playback, then report feedback before another checkpoint starts.

## Checkpoint 2F — Ripple edge trimming

**Accepted by the maintainer.** Turn on the existing **Ripple Edit** toggle and drag a clip's head or tail with an edge-capable tool. The clip's duration changes and following clips shift by exactly that amount. Existing gaps retain their size; unrelated tracks are not automatically shifted.

- The grabbed clip, aligned selected clips and their complete linked companions are the trim targets. They must have the same timeline start/duration on separate tracks. Head trims keep that start fixed while changing the source In (source Out in reverse); tail trims keep the source head. Constant speed is respected, and all affected targets share one frame-quantized delta constrained by the shortest source handle or one-frame minimum.
- Later clips on the target tracks move by the duration change. Complete linked companions of those followers move too, even on another track, preserving offsets such as J-cuts. This does not enroll every other clip on that foreign track. Static neighbors constrain the common move so it cannot overwrite, reorder or go before timeline zero. The popup names participating tracks and following-clip count; other music/overlay tracks, timeline markers, In/Out marks and playhead remain at their original positions.
- The live source preview uses the existing single-edge decoder and actual edited first/last retained frame. Duration change and limits remain visible. A temporary guide follows the original, uncollapsed trim edge; on a head ripple this differs intentionally from the fixed final clip start. Effects/grade/compositing are not shown in the source preview.
- In Ripple mode, narrow edge handles remain reachable at a shared cut instead of invoking Roll. Turning Ripple off restores the accepted normal edge/rolling behavior. Slip and Razor remain separate tools. Narrow protected-edge hit areas can explain locked/sync-locked refusals without enabling the locked clip's body controls.
- All changes and the first Undo checkpoint publish atomically. Begin, no movement, repeated clamped movement and refusal do not create history or dirty the document. Returning to the original range restores original history/Redo. Release, Escape, blur, pointer cancellation, tool/mode/snap changes, changed selection/locks/history/playhead/range, project load or unmount end the gesture; Escape/blur keep the last applied edit for normal Undo.
- Head trimming advances each target's audio-envelope origin once from its original snapshot; follower moves and tail trims do not alter envelope coordinates. Effects, masks, EQ, clip-local keyframes, links and other metadata retain existing trim/move conventions. Fades keep their authored edge-relative values; existing playback/load code clamps effective fade duration to the clip length. This does not redesign animation phase or reverse-audio playback.
- Wholly moved downstream transitions preserve their settings/source metadata and translate their absolute timeline coordinates. Transitions attached to trimmed targets or crossing between moving and stationary clips are refused. Affected locks, active cache jobs, compounds/captions, malformed timing, preexisting overlaps and unsupported target speed ramps/timebases are refused before an edit. Ordinary layers inside an opened compound remain eligible. Stills, titles, shapes and adjustment layers can extend without artificial media limits.
- Target full-render bakes become stale through existing content signatures; moving followers retain valid bakes. Source interpolation caches keep their descriptors and existing coverage checks. No media/cache deletion, project-schema change, native IPC or export-algorithm change. Timeline viewport duration extends when needed but is not forcibly shortened over unrelated long music or layers.

### Verification

- 530 focused Node tests passed across this and all accepted checkpoints. `npm run test:ripple-trim` passes 45 tests: 15 planner cases, nine real-store/history cases, five persistence groups and the shared source-resolution/seeking helpers. Atomic publication, stale/reentrant writes, no-op neutrality, public receipt tampering, source/collision limits, transition validity, safe frame-index bounds and exact origin/history/Redo/viewport restoration are covered.
- Persistence checks cover 96 head/tail, forward/reverse, constant-speed, integer/fractional timeline-FPS and matching/60-FPS-source combinations. They compare retained raw source samples, exact bounded samples (including the existing reverse-head exclusive-Out safety retreat), unchanged metadata/gaps, Undo/Redo and JSON reload. Additional cases cover linked picture/dialogue with downstream J-cut sound, separate music, head-envelope origins, unlimited generators, bake/RIFE cache validity, and actual store-created downstream transitions through ripple, reload and transition removal.
- `scripts/check-ripple-trim.cjs` passed all 12 Chrome groups with independently FFmpeg-decoded diagnostic media: source frames/guide times, head/tail directions, shared-cut edge access, linked targets and foreign-mate collision bounds, speed/reverse/RIFE, atomic Undo, transition translation, envelopes/reload, refusal, static-only snapping, cleanup and narrow layout. Wide, head, 350px and refusal screenshots were inspected. An initial snapping case correctly snapped to an unrelated stationary audio clip; the final fixture moves that competing static point away to isolate moving-clip exclusion. No app workaround or relaxed assertion was used.
- Existing Chrome normal Trim (10 groups), Roll (12 groups) and Slip (11 groups) regressions passed. Normal Trim also passed all 10 groups in installed Electron after the optional preview change. The production renderer build (14.54 seconds), Linux/x64 native runtime gate, script syntax and `git diff --check` passed. Existing Vite/Browserslist/chunk-size/import warnings remain.
- Full installed-Electron ripple verification passed all 12 groups, with no renderer exceptions in either host. Isolated tests use generated/in-memory media, no user project and no production main/preload/IPC. The test-only Playwright sandbox caveat above applies; this is not a packaged release, production sandbox test or final movie export. All owned test hosts and the isolated Vite server on port 5184 are closed. The user's app on port 5173 and projects were untouched. Main remains unchanged; all work is local and uncommitted.

### Try this checkpoint

Use a disposable/duplicated project in `velorn-editing-polish`.

1. Put three clips in a row, turn **Ripple Edit** on, and shorten the first clip's tail. Both later clips should move earlier without changing their source content. Extend it again, release, and Undo once.
2. Trim the first clip's head. Its timeline start stays put, the source first frame changes, and following shots move with the new duration. Check the live source frame and duration readout.
3. Try a linked picture/sound pair and leave music on another track. The pair should stay aligned and unrelated music should stay fixed. Check the named tracks in the popup.
4. Try a source limit, a locked follower, a transition on the target and a nonaligned selection. Confirm the limit/explanation and no partial move.
5. Turn Ripple off and verify normal trimming/Roll/Slip, then save/reopen the duplicate and review playback. Stop for feedback before another checkpoint.

## Checkpoint 2G — Zoom to Selection

**Accepted by the maintainer.** Focus the timeline on selected clips and return to the prior view, without introducing another panel.

- **Z** is the default configurable shortcut. Right-click a selected clip for **Zoom to Selection** / **Restore Previous View**. Existing Frame All and zoom shortcuts keep their bindings; a previously customized Z binding is not stolen.
- The selected time range fits with balanced margins where timeline zero and existing zoom/scroll limits allow it. Selected tracks are brought into view when possible. Locked clips remain eligible because this is navigation, not editing.
- Repeat the command for the same selection to restore the previous zoom and horizontal/vertical scroll. Changing selection refits the new clips while retaining the original baseline. An empty selection can still restore an active baseline; otherwise an empty or missing selection does nothing. Manual panning/zooming retains the return point. Frame All discards it.
- Typing, dialogs, held-key repeats and active pointer/edit gestures cannot accidentally toggle the view. Project/timeline load, compound Open/Back and unmount discard stale return points and queued viewport work. Playback is not paused or retimed; its existing follow-playhead behavior remains in effect.
- Temporary focus/return zoom is view-only: clips, selection, playhead, Undo/Redo and authored project data remain unchanged. A transient store receipt preserves the original saved zoom during focus, including inside compounds, so navigation alone does not create a parent edit or invalidate its cache. Ordinary zoom controls retain their existing saved-view behavior. No project schema, media path, export algorithm or native IPC changes.

### Verification

- **551 focused regression tests passed** across this and accepted checkpoints. `npm run test:timeline-selection-zoom` passes 36 tests: 11 pure viewport cases, six real-store cases, nine shortcut cases and 10 dirty-tracker cases. Coverage includes zoom bounds, stale/invalid timing, symmetric margins, root serialization, exact compound Back, existing dirty state, actual child edits, and load/clear lifecycle.
- `scripts/check-timeline-selection-viewport.cjs` passed all **12 integration groups in both Chrome and installed Electron**, with no renderer exceptions: real keyboard/context commands, fit geometry, horizontal/vertical restoration, selection changes, empty/short/locked selections, typing/repeat/modifier protection, configurable shortcut and authoring Undo/Redo, Frame All, load/queued-layout/unmount cleanup, compounds, narrow layout, modal/held-trim protection and unchanged transport flags. The narrow browser screenshot was inspected.
- The existing shuttle/keyframe-zoom browser regression and all 12 Ripple Trim browser groups passed with no renderer exceptions. Production renderer build passed in 16.23 seconds, the Linux/x64 native runtime gate passed, and `git diff --check` passed. Existing build warnings remain.
- Tests use an isolated synthetic timeline and fresh test profiles, not user media/projects or production main/preload/IPC. Electron's existing test-only Playwright sandbox qualification above applies. This is not packaged-app, production security, movie export or subjective real-project verification. Test setup was corrected to await shortcut-state rendering, explicitly checkpoint its authored test edit, and select Trim before testing a trim pointer; no application workaround or relaxed assertion was used.
- Main and user projects remain untouched. All owned browser/Electron test hosts and the isolated Vite server on port 5184 are closed; the user's port 5173 was left alone. All work stays local and uncommitted in the review worktree.

### Try this checkpoint

1. Select a few nearby shots and press **Z**. Their range should fill the timeline comfortably.
2. Pan around, then press **Z** again. Your previous zoom and scroll position should return.
3. Focus one selection, select different shots, and press **Z** to frame those. Press again to return to the original view.
4. Try the right-click command and **Frame All**. Check Settings → keyboard shortcuts if Z is already customized.
5. Try inside a compound and return to the parent. Zooming alone should not create an edit or Undo step. Stop for feedback before another checkpoint.

## Checkpoint 2H — Slide editing

**Accepted by the maintainer.** Reposition one shot between two touching neighbors, keeping its source footage and duration unchanged while trimming the neighbors to compensate.

- A dedicated **Slide** tool uses **U**, alongside the existing Move/Trim/Slip tools. An existing customized plain-U command takes precedence; the Slide toolbar button remains available. A Slide body drag never falls back to ordinary overwrite movement or Alt-drag duplication.
- One selected middle clip and its two immediate neighbors must form an unambiguous, gap-free run on the same normal track. Sliding right lengthens the preceding tail and shortens the following head; sliding left does the opposite. The middle clip's source, duration and clip-local metadata stay unchanged. The run's outer start/end, unrelated clips/tracks, markers, range and playhead stay fixed.
- All three clips update together with one frame-quantized delta constrained by the neighbors' remaining source handles and one-frame minimum durations. Constant speeds and reverse source clocks are respected. Ordinary still/title/shape/adjustment generators do not gain artificial source limits.
- Live source-only previews show the preceding clip's last retained frame and following clip's first retained frame, with the accepted frame delta, middle clip's name and source/duration-unchanged explanation. Existing private preview decoders are reused; effects/grade/compositing are not shown in this trim viewer.
- Existing magnet snapping applies to the middle clip's head/tail, excluding all three moving boundaries from snap targets. A constrained move does not show a snap guide for a position it could not reach. Unsnapped half-frame pointer movements retain the common frame-rounding convention.
- Active linked companions, locks/sync locks, attached transitions, render jobs, compounds/captions, gaps/overlaps, ambiguous participants and unsupported speed ramps or malformed source clocks refuse before authoring. No links are broken automatically. Open a compound to edit its eligible ordinary child clips. Multi-selected middles are outside this first version.
- The three-clip edit uses one atomic Undo checkpoint. Click/no movement, repeated clamped movement and refusal are history-neutral. Returning to the original position restores the original history/Redo. Gesture interruption/stale timeline state stops further writes; Escape/blur retains the last applied edit for normal Undo.
- The following clip's head-envelope offset advances once from the original snapshot. Middle and preceding envelopes remain clip-local; effects, grade, keyframes, masks, EQ and authored fades retain existing trim/move conventions. Moving the middle clip keeps its full-render bake valid; changed neighbor bakes become stale through existing signatures. Source-cache descriptors retain existing coverage checks. No media/cache deletion, project schema, native IPC or export-algorithm change.

### Verification

- **579 focused regression tests passed** across this and accepted checkpoints. `npm run test:slide-edit` passes 44 tests: 12 planner, 11 real-store, five persistence and 16 shared source-preview/seeking tests. Persistence covers 192 source-clock combinations, mixed per-clip speeds/reverse, audio-envelope offsets, unlimited generators, Undo/Redo/reopen and full-bake/RIFE coverage. Atomic subscriber observations, stale/reentrant mutations, origin/Redo restoration and compound-child persistence are covered.
- `scripts/check-slide-edit-preview.cjs` passed all **11 integration groups in both Chrome and installed Electron**, with no renderer exceptions. Coverage includes actual two-cut decoded frames, positive/negative and half-frame movement, reverse/speed/RIFE sampling, source/duration limits, magnet exclusion and accepted guides, history neutrality/Undo, metadata/reload, explicit refusals and preserved multi-selection, unavailable/timing-only media, gesture/navigation cleanup and 600/350-pixel layouts (actual native window resizing). The wide, refusal and 350-pixel screenshots were inspected.
- Existing Chrome **Zoom to Selection (12 groups)** and **Slip (11 groups)** regressions passed with no renderer exceptions. Production renderer build passed in 15.37 seconds, the Linux/x64 native runtime gate passed, and `git diff --check` passed. Existing build warnings remain.
- Tests use synthetic fixtures and isolated test profiles, not user media/projects or production main/preload/IPC. The existing test-only Playwright sandbox qualification above applies. This does not claim packaged-app, production-security, movie-export or subjective real-project verification. The live checks found and fixed half-frame pointer cancellation and rejected multi-selection click collapse; assertions were retained.
- Main remains untouched. All earlier accepted checkpoints stay together in this local, uncommitted review worktree. All owned browser/Electron test hosts and the verified isolated Vite server on port 5184 are closed; the user's port 5173 was left alone.

### Try this checkpoint

1. In a duplicated project, put three unlinked clips together on one track. Leave extra source footage beyond the preceding tail and before the following head.
2. Choose **Slide** (U) and drag the middle clip left/right. Its footage and duration should stay the same while both surrounding cuts move.
3. Check the two live cut previews, release and Undo once. Try returning to the original position before release.
4. Try a source limit, a linked/locked neighbor, a gap or attached transition. Confirm the limit/explanation without a partial move.
5. Save/reopen the duplicate, verify playback and report feedback before another checkpoint.

## Checkpoint 2I — Responsive timeline scrubbing

**Accepted by the maintainer after the real-footage follow-up.** Reduce redundant pointer/layout/store work while dragging the timeline ruler or playhead, without changing the editing workflow. The first input-only pass did not fix the maintainer's real-media freeze; see the follow-up below. The maintainer subsequently confirmed that both scrubbing and playback feel substantially better, then requested transition playback testing.

- This checkpoint is shared renderer JavaScript for **Linux, Windows and macOS**. No OS detection, platform-specific decoder, Electron flags, native IPC, dependency, project schema or export changes. Linux can be exercised here; Windows/macOS runtime and packaged-app verification remain separate release checks, not claims made from Linux tests. Discuss any later OS-specific optimization before implementing it.
- One latest-pointer animation-frame scheduler combines pointer movement and edge scrolling. Ordinary repeated requests for the same snapped timeline frame are skipped locally. Initial ruler clicks remain immediate; a playhead-handle grab does not jump the playhead.
- A valid paused mouse release flushes its final coordinate through the existing exact-frame-step intent before the scrub-end notification, including when the timeline position is already the same but the decoded picture needs confirmation. Deliberate frame-step requests are not globally deduplicated. Cancellation/stale sessions must discard pending input rather than seek into a different document.
- No Inspector subscription overhaul, decoder rewrite, automatic proxy generation or background cache expansion is included. Those remain possible later checkpoints after feedback.

### Verification

- Before baseline, unchanged production Timeline with an isolated real Timeline/Canvas fixture: **240 alternating mousemoves in one task produced 240 playhead seek-revision publications and 720 viewport rectangle reads**. The identical after burst produced **one publication and one rectangle read**, preserving the final target of 4.25 seconds. The count excludes the initial press in both versions and includes the burst/release. This measures publication/layout work, not a guaranteed FPS increase or real-project latency.
- **598 focused regression tests passed** across this and accepted checkpoints. `npm run test:timeline-scrubbing` passes 33 tests: 14 scheduler/geometry, five real-store navigation, six precise-seek and eight shuttle cases. Coverage includes latest-target coalescing, live transport changes, exact release, reentrant/pre-start/late-callback cancellation, fractional FPS/CSS geometry, document/history/Redo/cache/selection neutrality, repeated explicit same-frame intent, compound Back and existing dirty-state preservation.
- `scripts/check-timeline-scrubbing.cjs` passed **nine integration groups in both Chrome and installed Linux Electron**, with no renderer exceptions. These cover identical-burst metrics, same-task ruler/upper-handle/lower-handle presses and releases, exact different mouseup coordinates, same-frame dedupe and paced bursts, actual decoded reverse/0.5×/2×/RIFE frames, cuts and expanded compounds, cancellation/stale/load/external navigation/unmount, edge and external scrolling, playing/view-shortcut guards, and 600/350-pixel viewports (actual native window resizing). The narrow screenshot was inspected for timeline geometry; the fixture's surrounding layout is not a new product layout.
- Existing Chrome editor controls (three groups) and Zoom to Selection (12 groups) passed, with no renderer exceptions. Production renderer build passed in 15.89 seconds; the Linux/x64 native runtime gate passed and `git diff --check` passed. Existing build warnings remain.
- Native test qualification: the initially hidden Electron fixture could stop animation-frame callbacks even while `visibilityState` was visible and the video reported the exact decoded PTS. Showing that isolated window with `showInactive()` passed all nine strict pixel checks unchanged. The final native run passed without diagnostic wrappers. The new runner therefore shows its native test window; the shared test host and production app/decoder/security settings are unchanged. The existing test-only Playwright sandbox qualification above applies. This is Linux installed-Electron coverage, not a Windows/macOS, production preload/IPC, packaged-app or security claim.
- The tests sample actual committed Canvas pixels without invoking the capture bridge, which would seek on behalf of the test. Synthetic original/cache streams use their declared 24/48 FPS. Initial fixture corrections supplied required Optical Flow head coverage and kept narrow-window press coordinates inside the viewport; no pixel assertion or timeout was relaxed.
- All earlier accepted checkpoints stay together in this local review worktree. Main and user projects are untouched; nothing is committed or pushed. All owned browser/native test hosts and the verified Vite server on port 5184 are closed; the user's port 5173 was left alone.

### Real-footage follow-up — decoder picture handoff

The fresh **Night in Motion - Fresh Scrub Test** project exposed a different bottleneck: the old renderer repeatedly retargeted a decoder before its finished picture reached the visible canvas. Four-second sustained drags over the original long-GOP H.264 footage produced decoded callbacks but **zero visible picture updates**, in Chrome and the installed Linux Electron runtime. The earlier tiny all-I-frame fixtures verified input and final landing, not real-media liveness.

- A shared presentation controller now lets each owned seek complete, holds every visible picture/matte until the whole composite can paint, and only then requests the newest scrub target. Long decodes are not restarted at a 400 ms timeout. Late callbacks cannot remove a newer request; source/FPS/session changes, playback, exact release and unmount cancel old ownership. A completed-but-unpainted picture retains ownership past the scrub idle timer.
- Lookahead still loads media, but does not park decoder timestamps during a scrub; delayed metadata callbacks check the current source, document and active window. The visible canvas is left intact until the staged composite succeeds.
- Physical seeks land inside the intended encoded frame, avoiding microsecond truncation into the preceding frame at fractional boundaries such as 19/24. A separate, same-frame physical readback tolerance handles decoder time-base conversion (4.020833333 can read back as 4.020832). Logical timeline targets and exact presented-frame validation are unchanged. Exact frame-zero reuse and precise picture/matte rasterization avoid redundant reseeks. Iterable exact-seek records are pruned when decoder elements leave the video cache.
- This is still shared renderer JavaScript, with no native/OS-specific changes. Source/import playback-cache policy is deliberately unchanged: the MCP-created test project continues using its original files. Long-GOP originals remain slower to seek than optimized playback copies; this is a freeze correction, not a promise to show every pointer event or a guaranteed frame rate.

Follow-up verification:

- `npm run test:timeline-scrubbing`: **55 passed**, including 19 presentation-controller tests for paint-before-retarget, all-layer barriers, delayed decodes, callback ownership, source/FPS changes, cancellation, same-frame reuse, idle ownership and single/double timestamp truncation. Exact logical/frame comparisons remain separately tested.
- The original nine-group Timeline/Canvas integration suite passes again in **Chrome and installed Linux Electron**, including an added cold frame-zero/repeated release check. Reverse, 0.5×/2×, 48 FPS RIFE, compound expansion, cuts, navigation neutrality, cancellation, native window resizing and exact release pixels remain covered. Configured-port HMR is blocked in test hosts so source reloads cannot invalidate a run.
- New `scripts/check-scrub-presentation.cjs`: **five groups pass in each host** with 1280×720 long-GOP/B-frame media, actual asset playback-cache routing to a short-GOP copy, touching cuts, two independently changing video layers, and a quiet held pointer/resumed drag. It samples committed canvas pixels during 120 real mouse moves before release; no capture bridge seeks on the test's behalf. Final output must match independent reference pixels, exact timeline position/intent and the latest observed frame PTS of each drawable source. A passive per-element presentation observer never seeks or draws. Correct frame reuse does not require an unnecessary new callback after mouseup.
- In the final generated-media native run, the long-GOP case changed picture **40 times over 4.4 seconds**, with a longest unchanged interval of 231 ms; the playback-cache case changed 103 times. These are diagnostic observations on this machine, not promised FPS or portable performance benchmarks. The earlier failing generated-media baseline changed only once and then froze for the rest of its four-second drag.
- Production build passed in 15.04 seconds; script syntax and `git diff --check` pass. Existing build/test-environment warnings remain. No native dependency or IPC changed; these isolated hosts do not verify production sandboxing or packaged Windows/macOS builds.

- The original user footage was exercised read-only through `VELORN_SCRUB_SOURCE`. All five groups passed in Chrome, and all five passed in the final installed-Electron run. The native single-original case changed picture **13 times over 4,022 ms**, versus **zero over 4,010 ms** in the earlier failing baseline. Its longest unchanged interval was 673 ms: the freeze is corrected, but these originals are still decoder-limited. The optimized-cache, cuts, both-layer and quiet-held cases changed 94, 51, 13 and 15 times respectively; exact final PTS/pixels and document neutrality passed throughout. This is not equivalent to frame-for-every-pointer-event scrubbing.
- All owned test hosts and the isolated Vite server on port 5191 are closed after verification. The user's app on 5173, project and original media remain untouched. Main remains clean; no commits, pushes, merges or releases were performed. Stop here for the maintainer's hands-on check before discussing cache/import policy or further playback work.

### Try this checkpoint

1. In the review-folder app, reopen **Night in Motion - Fresh Scrub Test** if necessary. Scrub slowly within a clip, then sweep quickly back and forth across cuts. Release on a specific frame and compare with single-frame stepping.
2. Drag the ruler and both playhead handles; test zoomed-in and zoomed-out views, timeline edge scrolling, reverse footage and available Optical Flow media.
3. Try inside a compound and return to its parent. Scrubbing must not create an edit or Undo entry.
4. Check that normal playback, J/K/L and Shift slow playback still behave the same. Stop for feedback before another checkpoint.

## Checkpoint 2J — Transition playback ownership

**Accepted by the maintainer.** Investigated live transitions and compared a flattened section before adding any automatic background rendering. The existing Cache nearby / Render In→Out feature is separate from this live-playback fix.

- The incoming side of a between-clip transition can be visible before its nominal start (and the outgoing side after its nominal end). The preloader previously classified that visible footage as merely upcoming and periodically parked its decoder at the nominal trim boundary. The transition readiness gate immediately sought it back, interrupting continuous decoding.
- The shared preload planner now accounts for valid transition intervals, authored split/alignment, playback direction, compound visibility bounds and video track visibility. Active picture decoders belong to the compositor, not the preloader. Upcoming decoders prepare the actual transition entry using existing source-handle, speed/reverse/ramp and Optical Flow timing rules. Missing handles retain their existing edge-frame clamp.
- A delayed metadata callback recomputes the plan and source target using the current document and direction. It rejects stale source/session/compound contexts, unmount, current exact-step intent and scrub presentation ownership. The precise-frame gate and paint-before-retarget scrub controller remain intact.
- No transition parameters, authored clip timing, UI controls, project schema, native IPC, dependencies or OS-specific behavior were changed. This is shared renderer code for Linux, Windows and macOS; runtime verification here is Linux only. Automatic selective cache scheduling, cache invalidation/handoff redesign and older full-clip-bake source-tier limitations are not included in this checkpoint.

### Verification

- Before the change, an isolated real Timeline/Canvas fixture reproduced the conflict with 1280×720 long-GOP/B-frame H.264 sources. During a 0.75-second dissolve, Chrome assigned decoder time three times and installed Electron twice, including an incorrect incoming nominal-trim park. During a two-second stress dissolve, each host assigned it seven times, including three park/correct pairs. An ordinary continuous clip had zero in-window seek assignments. These are observed seek counts, not portable FPS measurements.
- The strengthened Chrome run passes ordinary playback and both dissolve durations with **zero in-transition seek assignments and zero incorrect parks**. The two-second stress case presents 24 distinct incoming pre-cut frames and 24 distinct outgoing post-cut frames; changing blend opacity alone is not accepted as source-picture progress. Exact paused midpoint source PTS and independently composed pixels also pass.
- The strengthened installed-Linux-Electron run passes the same three cases with **zero in-transition seeks/parks** (versus two/seven total seeks in the earlier 0.75/two-second baselines). The two-second case presents 16 distinct incoming pre-cut frames and 19 distinct outgoing post-cut frames. Ordinary motion and exact paused source-frame pixels also pass; these measurements do not establish perfect 24 FPS playback.
- `scripts/check-transition-playback.cjs` finishes **10/10 integration cases**: three generated-media cases per host, then the actual project's 8.5-second live dissolve and its flattened 7.5–9.5-second movie in each host. Original inputs are read-only and required to be 24 FPS. Actual live and flattened playback both advance, have zero in-window seeks, and pass independent exact paused PTS/pixel checks. No renderer exceptions or authored-document/dirty-state changes occur.
- Harness qualification: the real Timeline/Canvas uses an elapsed-time RAF clock, not PreviewPanel's full transport/cached-video controller. It composites at 960×540; actual originals decode at 1856×1024 and the flattened movie at 1920×1080. Native actual windows produced 23 live picture changes versus 18 flattened changes, but live blend opacity can change between decoded source frames: these counts must **not** be ranked as live-versus-cached FPS. This verifies decoder ownership/liveness, not an app-wide performance guarantee or cache handoff.
- `npm run test:transition-playback`: **51 passed**, including 13 planner cases covering handles, reverse entry (including its exact half-open endpoint), split/alignment, visibility, compound bounds, disjoint windows, retiming, fractional-FPS RIFE handle mapping and insufficient-cache-coverage fallback. Existing source timing, precise seeking and scrub presentation tests are included.
- `npm run test:timeline-scrubbing`: **55 passed**. The prior nine-group Timeline/Canvas integration suite also passes again in both Chrome and installed Linux Electron, including exact release pixels, reverse/slow/RIFE source clocks, compound/cut behavior, navigation neutrality, cancellation and narrow layout.
- Rendered the actual test project's 7.5–9.5-second dissolve section through the production hidden export worker. The separate diagnostic file is `cache/transition-playback-study-dissolve-20260913.mp4`: verified H.264, 1920×1080, 24 FPS, 48 frames, 2.000 seconds, no audio. It does not replace clips or register a timeline cache. Delivery export uses different seek/GOP defaults from Render In→Out, so this is a flattened-playback comparison, **not** verification of PreviewPanel's live/cache handoff.
- A high-detail, no-transition control exposed a separate export-reference sampling discrepancy: the fixture's HTML-video export path presented PTS 5.0 then 5.041667 while rendering source target 5.0, yielding mean pixel difference 6.28 against the exact paused preview. No tolerance was relaxed and no export code was changed. The playback regression instead uses independent private decoders, verified encoded-frame PTS and known midpoint composition at matching resolution. Export/cache exact-frame parity remains a follow-up requirement before automatic caching; a diagnostic flatten is not proof of parity.
- Production build passed in 14.43 seconds; script syntax and `git diff --check` pass. Existing Vite/Browserslist/bundle warnings remain. Test hosts use an isolated profile without production preload/IPC; they do not verify packaged Windows/macOS or production sandboxing. The short diagnostic movie separately exercises the existing production export worker.
- Final original-footage `check-scrub-presentation.cjs` regression: **5/5 passed in installed Linux Electron**, including long-GOP/B-frame media, optimized playback-copy routing, touching cuts, simultaneous source layers and quiet-held/resumed scrubbing. Exact release pixels/PTS and document neutrality pass. The single original changed picture 15 times over 4,028 ms, longest unchanged interval 563 ms; this preserves the accepted freeze fix without claiming a frame for every pointer movement.
- All owned browser/Electron test hosts and the isolated server on 5192 are closed. The user's review app on 5173 remains running; its project still contains 12 clips and four transitions. The only new project-owned file is the diagnostic movie noted above. Main remains clean; no commits, merges, pushes, tags or releases were performed. Stop here for the maintainer's hands-on check.

### Try this checkpoint

Use **Night in Motion - Fresh Scrub Test** in the review-folder app. Play through the dissolve near 8.5 seconds, the wipe near 13 seconds, the blur near 28.58 seconds and the final fade. Scrub both ways and release/step around their edges. Check whether the actual motion feels smoother, not only the FPS display. Stop for feedback before automatic background rendering.

## Checkpoint 2K — Jumping while playback continues

**Accepted by the maintainer.** Clicking elsewhere on a playing timeline now requests a frozen destination, instead of letting the playback clock repeatedly move the decoder's seek target. Automatic background caching is still deferred.

- The timeline clock holds at the clicked position until the complete destination picture has been decoded and painted. The previous picture stays visible during the handoff. Multiple quick clicks replace the pending destination; old callbacks cannot resume an earlier one. Ordinary transport ticks and cuts remain continuous; loop wraps use an explicit handoff.
- Video readiness checks the requested encoded frame's presentation timestamp and the owned seek. Visible layers and video track mattes prepare together before the composite is acknowledged. Existing trim/transition handle timing, RIFE source mapping, exact paused frame stepping and paint-before-retarget scrubbing retain their own behavior.
- Audio pauses synchronously during the handoff, prepares the latest source position without overlapping seeks, and resumes from the held timeline clock. Pending readiness/play callbacks cannot restart it after another click, Pause or project/compound navigation. Volume envelopes restart from the current audio clock instead of consuming the wait interval.
- PreviewPanel's existing rendered chunks use the same destination/deadline contract. A held-picture canvas spans live/cached source switches; the hook is the sole playback clock. Loading feedback appears only after 200 ms. A failed source or five-second deadline pauses with an explanation; Play/J/L can retry with a fresh request, or the user can choose another position.
- Request tokens, errors and decoder state are session-only. They are excluded from project files, Undo/history, dirty tracking and persisted preferences. No authored clip/transition data, native IPC, dependencies or platform-specific settings are changed. This is shared Linux/Windows/macOS renderer code; installed-runtime verification here is Linux only.

### Verification

- `npm run test:playback-jumps`: **36 passed**, covering store ownership/invalidation, the production hook with a controlled clock, newest-request watchdog/retry behavior, decoder presentation/cancellation and audio-envelope holds. Cold initial `emptied` and stale queued error events must not be mistaken for a replacement source; genuine replacement/failed media still pauses safely.
- Existing focused regressions: timeline scrubbing **55 passed**, transition playback **51 passed**, audio scheduling **8 passed**; an additional **15 passed** across compound projection/store and audio-envelope scheduling.
- `scripts/check-playback-jumps.cjs` uses the actual transport hook, Timeline mouse clicks and Canvas/Audio renderers in an isolated fixture. Its first ten groups pass in Chrome and installed Linux Electron with generated 1280×720 long-GOP/B-frame sources, and in installed Electron with read-only 1856×1024 original project footage. Six playing-jump cases check backward/forward within and across clips, repeated clicks and a dissolve. Other groups cover paused zero/cut navigation, missing media, and delayed-source Pause/project-replacement cancellation.
- On the original-footage baseline those six playing cases assigned video seek time **19/7/7/23/29/8** times and observed **13/44/44/12/40/22** black samples. The fixed run assigned seek time **1/1/1/2/5/2** times and observed **zero black samples in every case**. Exact landing PTS, independently decoded/composed pixels, held timeline position, audio hold/alignment and authored-document neutrality pass. The baseline samples 1,100 ms after a click; verification samples the entire hold plus 650 ms of resumed playback. These are diagnostic counts, not equal-duration speed comparisons or FPS/latency guarantees.
- An additional warmed, same-encoded-frame playing jump passes in both Chrome and installed Electron, with exact PTS/pixels and no watchdog timeout. The runner now includes it as group 11. Across the three ten-group runs and two focused same-frame runs, **32/32 jump integration groups pass**; no tolerance or presentation barrier was relaxed.
- Final production build passed in **14.72 seconds** after the timeout-copy cleanup; the 36 focused jump tests pass again. The Linux/x64 native runtime package gate passed. JSX/script syntax and `git diff --check` pass. Existing Vite CJS, Browserslist and large-bundle/import warnings remain.
- Existing runtime regressions pass **29/29 groups**: timeline scrubbing nine each in Chrome/installed Electron, generated transitions three each in both hosts, and original-footage scrub presentation five in installed Electron. No renderer exceptions or relaxed assertions. Independent probes confirm the existing generators encode their declared 24 FPS (48 FPS for the RIFE test copy), as do both new jump-runner sources.
- The separate `check-playback-jump-panel.cjs` fixture mounts actual PreviewPanel, Timeline and TransportControls with one real transport clock. **Eight groups pass** (four per host): live→cold cache, cache→live, cache→another cache, and delayed unavailable cache with loading/error UI, five-second watchdog, fresh Play retry and cancellation. All six successful handoffs have independently verified target PTS and zero mean pixel difference against a branch-matched private decoder reference; the held cover contains the previous picture and is removed only after acknowledgment.
- Cache tests use synthetic pre-existing chunks registered through the real **Render In→Out** reuse UI and an in-memory filesystem bridge. They refuse export/filesystem writes. This verifies the actual cached-player handoff, not export/cache generation parity, automatic cache scheduling or FPS. An initial fixture output unexpectedly muxed 25 FPS; explicit output `-r 24` plus mandatory encoded-stream probes corrected it before the final eight-group runs. Existing jump/scrub/transition generators were separately verified and did not require changes.
- Loading and final timeout-alert screenshots were inspected in both hosts. Failure pauses with readable recovery text; it does not continue playback through black. Native test profiles are isolated and omit production preload/IPC; packaged Windows/macOS and production sandboxing were not exercised. All owned test hosts and the server on 5193 are closed. The user's review app on 5173 remains running. No user project or media was modified, and main remains clean. No commit, merge, push, tag or release was performed.

### Try this checkpoint

In **Night in Motion - Fresh Scrub Test**, start playback and click backward into another shot, then forward again. Try several quick clicks, including into/away from the dissolve and wipe. Picture should land and continue with sound in sync; a brief held picture is preferable to black or flicker. Pause during a jump, scrub, then step individual frames to check the existing behavior too. No new project or render is required.

## Checkpoint 2L — Clear cut edges and deliberate transition creation

**Accepted by the maintainer.** The floating transition plus and its invisible full-height hitbox are removed. On compact tracks, the outgoing tail and incoming head are ordinary trim targets again. The Trim tool retains its shared-cut roll handle.

- Right-click directly at a touching video cut and choose **Add transition**. No prior two-clip selection is needed; only that cut receives the default dissolve/duration. Opening or dismissing the menu preserves clip selection, the document and Undo history. Inspector type/duration controls remain unchanged after creation.
- Native transition drag-and-drop is handled by the track lane, not a permanent overlay. A pointer-inert cut highlight appears only during a transition drag. Browser-protected dragover reads MIME types only; the payload is validated at drop. Other asset/effect payloads retain their existing handlers.
- The new direct-cut paths require consecutive supported visual clips on an unlocked video track, an actual butt cut and sufficient duration. Gaps, overlaps, ambiguous cuts, caption tracks and compound contexts are not new transition targets. Sync-locked clip timing is not altered: adding a transition remains metadata-only.
- The context menu is viewport-clamped and dismisses on Escape, outside pointer-down, focus loss or a stale target. Source replacement, clip edits, track locking and project/FPS/context changes invalidate the captured pair before Apply. Pure playhead ticks do not rescan cuts or dismiss the menu. Drop resolves live targets again.
- Trim, roll and clip-body edit starters now require the primary mouse button. Right-clicks at unavailable cuts fall through to the ordinary context menu without starting a drag/Razor edit or creating the former empty trim-history checkpoint.
- Existing selected-clip **Shift+T**, Effects panel click-to-apply, transition drag-and-drop, applied-transition selection/removal and Inspector controls are retained. One normal Undo reverses creation. No playback/cache behavior, project schema, native IPC, platform-specific code or dependencies change.

### Verification

- The old interaction was reproduced with actual mouse input in isolated Chrome and installed Linux Electron: on a compact 32px lane, both head and tail trim coordinates hit the plus SVG; dragging changed neither clip. The new dedicated runner uses generated in-memory media, actual Timeline/Inspector/Effects components and a separate test server/profile. It never opens or writes a user project.
- **241 focused tests passed**, including 21 new pure target/snapshot/native-drag tests and existing trim, multi-clip trim, ripple, roll, shortcuts, transition playback/movement, scrub presentation, playback-jump and dirty-tracking regressions. The existing dirty-tracker npm alias uses a removed experimental flag under this installed Node version; its equivalent direct `node --test` run passes all ten cases. No unrelated script behavior was changed.
- `scripts/check-transition-affordances.cjs`: **16/16 runtime groups passed**, eight in Chrome and eight in visible installed Linux Electron with sandboxing enabled. Tests use real mouse trims/Ripple/roll, unselected/scoped cut menus, right-button safety, stale source/session/track-lock dismissal, Shift+T, transition edge/Inspector controls, true native Effects-panel drag create/replace/cancel, one-step Undo, invalid targets, non-transition payload routing and a 900px-wide layout. Trusted native dragover protects payload data; only drop exposes it. No renderer errors or relaxed assertions.
- Existing Chrome regression runners passed **24/24 groups**: 12 rolling-edit reliability/source-preview groups and 12 Ripple groups, including exact decoded frames, source bounds, linked tracks, downstream transitions, cancellation and history/save behavior.
- Inspected idle compact-cut, context-menu and active-only drop-highlight screenshots, plus the installed Electron cut menu. The menu remains visible above the viewport edge; idle cuts have no transition button or invisible seam target. Final production build passed in **14.38 seconds**; script/module syntax and `git diff --check` pass. Existing Vite CJS/Browserslist/bundle warnings remain.
- Shared renderer changes apply to Linux, Windows and macOS; runtime testing here is Linux only. Isolated Electron does not load production IPC or a user project, so this is not packaged Windows/macOS or export testing. All owned test hosts and the 5193 server are closed. User app on 5173 remains running, main is clean, and no user project/media, commits, merges, pushes, tags or releases were changed.

### Try this checkpoint

In the existing `velorn-editing-polish` review app, set tracks to Compact. Drag either side of an untransitioned cut, then Undo. Right-click that cut without selecting clips and choose **Add transition**. Try Undo, Shift+T on selected touching clips, dragging a transition from Effects and a Trim-tool roll. Stop here for feedback; no commit, merge, push or release is authorized by this checkpoint.

## Checkpoint 2M — Play Around

**Accepted by the maintainer.** Preview a short edit without setting a range or losing your place. **Shift+K**, the small circular-arrow transport button, or **Play around cut** in the cut context menu plays two seconds before and after the target once, forward at normal speed. The range clamps at timeline boundaries. Natural completion pauses and returns to the original exact playhead position.

- The shortcut/button targets the playhead; the cut menu targets that cut without moving the saved return position or changing selection. Existing transitions are included. Repeating the command restarts the preview with a fresh token while retaining the original return position. The keyboard command appears as **Play around edit** in shortcut settings. Existing custom key assignments retain priority, including a previous owner of Shift+K.
- In/Out marks, looping preferences, previous shuttle rate/mode, clip/transition selection, project JSON, Undo history and dirty state are preserved. The audition is transient transport state, never a new authored range or saved project field. Previous rate/shuttle settings are restored when it ends or is explicitly paused; playback stays paused.
- Space/Pause, K or Escape stops at the current position. Explicit navigation/scrubbing, leaving timeline preview, project/compound/source changes, editing the audition's clips/tracks/transitions, changing its range/FPS, window blur or unmounting the preview retires its token without a later return. Explicit J/L or rate changes take transport ownership. Hiding only the Timeline panel does not stop its still-mounted preview clock.
- Entry uses the existing decoded-frame playback-jump barrier: time and audio wait for the start picture, and decoder wait time does not count toward the audition. Decode failure pauses with the existing error while preserving prior audition transport preferences, never returning on a stale callback. Completion uses the existing precise paused frame-seek path. Existing live/cache renderer paths remain responsible for picture/sound; no new cache, export/IPC, dependencies or OS-specific transport code is added.
- Shortcuts are inactive in text inputs/dialogs or during active timeline editing/scrub/pan gestures. Critical media preparation blocks both the transport and cut-menu entry points. Cut menus are revalidated against the exact live clips/transition before starting.

### Verification

- **189 focused tests passed**, including new range/token/store/shortcut cases and actual playback-hook tests. They cover the five loop modes, pending decoder holds, exact return, retrigger, cancellation, stale callbacks, negative-rate restoration on decoder failure, source/context replacement, JSON/dirty/history preservation, and existing scrub/transition/audio scheduling behavior.
- `npm run test:play-around` passes all **40** focused range/store/clock/shortcut cases. Independent review caught and corrected asynchronous shortcut loading and a cut-menu media-preparation bypass; failed decoder starts also restore the prior shuttle preferences without a return seek.
- New `scripts/check-play-around.cjs` passed **54/54 runtime groups**: 26 Chrome cases plus a focused applied-transition case, and all 27 in installed Linux Electron with sandboxing enabled. The isolated fixture uses the actual PreviewPanel-owned clock, Timeline, transport, decoded 24 fps H.264/B-frame sources and HTML audio. It checks Shift+K/button/plain-cut/applied-dissolve entry, all loop preferences, boundaries, retrigger, configured shortcuts, typing/modal/preparation/source guards, cancellation, context replacement, PreviewPanel unmount versus Timeline hiding, late readiness and the real five-second watchdog. No renderer exceptions or forbidden fixture writes occurred.
- Live and cached completion pictures are compared with independently decoded frames of the corresponding source/cache bytes. The initial source reference conversion and fixture-ready sampling were corrected rather than changing production rendering: the scoped actual-review trace passes a strict no-black-picture assertion. Existing in-memory chunks are entered through the real reuse controls, and the audition crosses live coverage plus two chunks before returning. Audio elements participate and are paused on completion; this is not a listening test, export parity test or performance benchmark.
- Inspected active-button, plain-cut menu, existing-transition menu and 900px screenshots in Chrome plus the installed Electron cut menu. The control remains visible without a new overlay on clip trim edges. Final production renderer build passed in **17.17 seconds**, Linux/x64 native dependency gate passes, and script/module syntax and `git diff --check` pass. Existing Vite CJS, Browserslist and bundle/import warnings remain.
- Earlier transition-affordance regression checks passed **16/16 groups** across Chrome and installed Electron, including compact trim/Ripple/roll, Shift+T, native transition drag-and-drop, removal/Inspector, invalid/stale cuts and Undo. Existing PreviewPanel playback-jump checks passed **8/8 groups** across both hosts: live/cache/different-cache exact landings, held-picture release, bounded unavailable-source failure and retry/cancel. That older runner's two broad `Play` button selectors were made precise so they do not also match the new Play Around button; its actual assertions remain unchanged.
- All production changes use the shared renderer/store and are intended for Linux, Windows and macOS. Actual runtime checks here are Linux only, with synthetic media and in-memory cache/IPC stand-ins—not packaged-app, production IPC or Windows/macOS verification. All isolated hosts and the owned 5193 server are closed; the user's review app on 5173 remains running. Main and user projects remain untouched; no commit, merge, push, tag or release.

### Try this checkpoint

In the existing `velorn-editing-polish` app, place the playhead near an edit and press **Shift+K**. It should play the nearby four seconds and return. Right-click another cut and choose **Play around cut**; the return location should still be where you started. Try an applied transition, the beginning/end of the timeline, retrigger, and Escape or a timeline click to cancel. Keep any existing In/Out/loop settings and check that they remain unchanged. Stop here for feedback; no commit, merge, push or release.

## Checkpoint 3A — Manual audio volume envelopes

**Accepted by the maintainer.** Shape one audio clip's volume over time, without cutting the clip into pieces. Existing Clip Gain and fade controls remain unchanged.

- The Audio Inspector enables **Edit points on timeline** for a single audio clip or a linked picture/audio pair. A thin line follows the audio waveform; double-click it to add points, drag points in time/level, or select a point and edit its precise time in clip seconds and dB level. Delete point and Clear envelope are explicit controls. Add point at playhead is available only inside the clip. Ordinary clip dragging and fade/trim handles remain available outside point hit targets.
- Point drags are visual drafts until release, then commit as one normal Undo. Escape, blur, pointer cancellation, selection/tool changes and stale clip replacement discard an unfinished draft. Merely selecting a point, an unchanged drag, an invalid value and a locked-target edit do not create history or dirty changes.
- Point levels run from -60 to +12 dB, relative to the existing Clip Gain. The curve interpolates linearly in dB, holds its first/last value outside the point range and defaults to 0 dB when empty. Edge fades, track/master faders and inserts remain separate. -60 dB is heavy attenuation, not a hard mute. There is no automatic limiter added by this feature.
- `volumeEnvelope` is optional JSON-only clip data with version, clip-local coordinate offset and up to 128 uniquely identified points. Head trims advance the offset; splitting retains the correct portion on both sides. Tail trims hide points without deleting them; extending the clip restores them. Clip moves and slips keep the envelope local to the clip; changing speed does not stretch point times. Ordinary duplicate/copy/paste, source Insert/Overwrite, history and save/load preserve it. Audio Paste Attributes still transfers only its existing static gain/fades, not volume animation.
- Preview uses a separate Web Audio GainNode with audio-clock exponential amplitude ramps, matching linear dB interpolation. Transport jumps, loops, pause, rate/trim changes and envelope edits replace the schedule. The no-Web-Audio fallback evaluates the same curve on the HTML audio element, but retains that path's existing tick-based updates and unity-volume ceiling.
- The shared export payload carries the envelope into native audio/video export and per-track stems. Native mixing evaluates the curve per sample after source trimming/time stretching and before track delay. Offline Web Audio uses the same scheduled envelope; its source playback rate is now applied so retimed range exports align. Timeline In/Out preview uses live audio beside muted video chunks; legacy mixed proxy signatures include envelope data to prevent stale sound reuse.
- Caption transcription mixes also receive the curve in native and browser paths. This does not redesign that subsystem's existing gain/fade/bus processing. Premiere/FCP XML interchange automation, reverse-audio playback, automatic ducking, EQ and track-level automation are outside this checkpoint.
- A shared pure envelope module is explicitly included in packaged app files for the native mixer's dynamic import. No new IPC method, external model, media path or paid dependency is introduced.

### Verification

- Focused regression suite: **278 tests passed**, including **27 new envelope tests** covering data validation, trim/split offsets, audio-clock scheduling and real FFmpeg sample comparisons. The actual native export mix handler was exercised with synthetic media, including a partial range and static clip/track gain. This is not a complete movie-export test.
- Frozen Chrome and isolated Electron UI runs: **all 12 groups passed**, plus 300/350px Inspector containment. Coverage includes point editing, no-op/cancel/history behavior, stale and locked targets, linked selection, endpoint accessibility, save/load, trim/split/copy/overwrite preservation, proxy invalidation and real OfflineAudioContext sample parity at 0.5x/1x/2x. Live playback produced nonzero signal through the real media-element/Web Audio graph while the monitor output remained muted. No renderer exceptions were reported.
- Native test limitation: the isolated Electron host uses an explicit synthetic waveform IPC stand-in. Its existing renderer-side `AudioContext.decodeAudioData` path crashes even in a bare Electron page on valid PCM WAVs at 8/24/44.1kHz, independently of Velorn and the new playback code. Production normally uses native waveform extraction; that IPC was not exercised by this fixture. Chrome tested real waveform decoding, and both hosts tested real playback and envelope scheduling. No runtime/security workaround was added to the application. This is not production preload, packaged-app or sandbox verification.
- Source Insert/Overwrite (14 groups), Paste Attributes (11 groups) and trim-preview (10 groups) browser regressions passed. Production build, `runtime:verify-native`, Electron/module syntax checks and `git diff --check` passed; existing build warnings remain.
- No user projects were modified. Main remains clean; this and the preceding accepted checkpoints remain local and uncommitted in the review worktree.

### Try this checkpoint

Use the same review folder and a disposable/duplicated project.

1. Select an audio clip, open its Inspector and enable **Edit points on timeline**. Add several points and lower the middle ones to create a dip beneath dialogue.
2. Drag a point, release, then Undo/redo. Try precise dB/time entry and Delete point. Escape during a drag should discard that draft.
3. Check that Clip Gain still adjusts the whole clip and the existing edge fades still multiply the curve. Turn point editing off and try normal clip dragging/trimming.
4. Trim the head, split, move, copy/paste and extend the clip again. The audible retained section and hidden points should stay intact. Save/reopen the duplicated project.
5. Listen in playback and export a short audio/video range spanning the dip; compare it, including a range starting midway through the clip. Watch existing meters when boosting gain.

## Checkpoint 3B — Simple clip EQ

**Accepted by the maintainer.** A focused Equalizer section in the existing Audio Inspector, for one audio clip or its linked picture/audio pair.

- Bass (120 Hz shelf), Mid (1 kHz peak) and Treble (5 kHz shelf), each from −12 to +12 dB with sliders and exact numeric entry. An optional **Reduce rumble** toggle applies an 80 Hz high-pass filter. Frequencies and bandwidth are fixed in this first version.
- **Bypass** keeps settings for comparison; **Reset** returns to flat and re-enables EQ. Existing Clip Gain, fades and volume-envelope controls are unchanged. Boosts can clip: use Clip Gain to leave headroom; no automatic limiter is added.
- Slider gestures audition through a transient, exact-clip-identity-guarded preview value. The project, export and history keep committed values until release; one completed gesture is one Undo. Escape, window blur, selection/context changes and stale/locked targets cancel drafts. Typing commits on Enter/field blur; unchanged or invalid values do not create history.
- Optional `audioEq` version-1 JSON data contains enabled/low-cut flags and three gain values. Older or malformed data reads flat. Clip duplication, ordinary copy/paste, trim/split, source Insert/Overwrite and save/load retain EQ. Audio Paste Attributes still transfers only its existing static gain/fades; EQ and volume animation are deliberately excluded.
- Preview and browser offline export use the same reusable Web Audio filter graph. Live parameter changes are smoothed without rebuilding nodes. Native export uses matching RBJ biquad coefficients at the explicit mix sample rate, after source retiming and before clip gain/fades/volume envelope. The native/shared export payload also covers stems and captions mixes. Low output sample rates cap band centres below Nyquist.
- Legacy mixed preview cache signatures include committed EQ. Audition drafts never enter a cache key, export or project file. No EQ processing is available in the old no-Web-Audio playback fallback; its UI explains this limitation.
- This checkpoint does not add EQ automation, multi-clip/track EQ controls, movable frequency bands, presets, a spectrum display or XML interchange automation. Caption mixing's pre-existing gain/fade/bus differences and browser retime/pitch limitations are not redesigned.

### Verification

- **312 focused regression tests passed**, including **34 EQ tests** (14 pure data/DSP/preservation, 13 real-store, 3 graph lifecycle and 4 native/payload tests). Real FFmpeg mono/stereo output agrees sample-by-sample with the shared biquad reference at 8/44.1/48 kHz. The actual native export mix handler passed a partial-range test combining EQ, static clip/track gain and volume automation.
- Chrome and isolated Electron: **all 10 integration groups passed**, plus 300/350px Inspector layout checks and zero renderer exceptions. Coverage includes one-Undo live slider drafts, cancellation, bypass/reset, numeric focus recovery, input-only accessibility changes, stale/locked/batch/linked targets, save/load, trims/splits/copy, and cache invalidation.
- Real OfflineAudioContext renders matched the coefficient reference across 15 mono/stereo/sample-rate cases; an existing graph could update to bypass without rebuilding. Real media-element playback measured a transient −12 dB mid-band cut, restoration after cancel, and rejection of stale preview data, with speakers muted at the monitor output.
- Native fixture qualification is the same as checkpoint 3A: waveform extraction alone uses an explicit IPC stand-in for the independently reproduced test-host `decodeAudioData` crash. Actual live/offline audio remains enabled. This does not test production waveform IPC, preload, application startup, packaged platforms or sandboxing; no application security workaround was added.
- The existing 12-group volume-envelope browser regression passed. Final production renderer build, Linux x64 native dependency gate, Electron/module syntax checks and `git diff --check` passed. Existing build warnings remain. A full movie export and subjective listening on a real project remain for maintainer review.
- Main remains clean. No user project, commit, push, merge or release was made. All accepted earlier checkpoints and this EQ checkpoint remain together in the local review worktree.

### Try this checkpoint

Use the same review folder and a disposable/duplicated project.

1. Select an audio clip (or switch a linked picture/audio pair to Audio) and find **Equalizer**, between Volume envelope and Fades.
2. Play speech or music. Drag Bass, Mid and Treble, then toggle Bypass to compare. Try Reduce rumble on a recording with low-frequency noise.
3. Drag and release, then Undo once. Try dragging and pressing Escape; the previous sound and value should return. Type an exact dB value and test Reset.
4. Confirm the clip's gain, fades and volume points still work. Split/copy the clip, save/reopen the duplicated project and check EQ survives.
5. Export a short range with audible EQ, then compare with playback. Lower Clip Gain if boosts overload the meters.

## Checkpoint 4A — Smart Replace

**Accepted by the maintainer.** Right-click one timeline clip and choose **Smart Replace…**, then select another asset from the current project. Import or generate the replacement beforehand; this dialog does not add another file-import workflow.

- Replaces one source binding, not every occurrence of that asset. Video replaces video, image replaces image, and audio replaces audio (including legacy video-backed clips on audio tracks). Linked picture/sound selection is supported, but only the context-clicked clip changes; its companion keeps its original source, with a visible warning.
- Keeps the clip label, timeline position/duration, transforms, grade, effects, masks, keyframes, speed/reverse/ramp settings, audio gain/fades/EQ/envelope, links and other authored metadata. Masks and tracking are retained, with a reminder to check alignment on different footage. It does not automatically retrack or regenerate masks.
- Source In defaults to the existing trim, suitable for a regraded copy. Enter another source In or choose **Start at beginning** for another take. The full nominal trim span and transition handles must fit; insufficient media is refused, never stretched or used to shorten the timeline edit. Existing intentional ramp/freeze behavior remains intact.
- Replacement metadata prefers measured top-level duration/FPS over requested generation settings, with settings as a fallback. Existing effective source time scale is retained across FPS changes. Source bounds follow the same timing helper as playback/export, including reverse and ramps. A source-In change involving legacy transitions with saved original trims is refused until that transition is removed/recreated.
- Locked/sync-locked clips or tracks, caption sources, unsupported/unknown source metadata, ambiguous targets and active clip-render/Optical Flow jobs are blocked. The first version does not batch-replace multiple independent clips or automatically replace both halves of a linked pair.
- Preview is read-only. Apply checks an opaque token against the displayed asset and exact timeline/selection/history snapshot, then makes one atomic edit with one normal Undo checkpoint. Cancel, no-op, invalid and stale requests create no history or project changes. Tokens and dialog state are not saved in projects.
- Old render-bake and Optical Flow references are detached without deleting files or revoking original media URLs. Optical Flow stays selected but needs rebuilding. Delayed cache reads, disk-cache lookup, and render completions now check source/session identity so results for the old media cannot attach to the same clip ID after replacement. The disk loader also preserves full-bake kind/signature metadata.
- No project schema, new Electron IPC or native dependency is introduced. Existing MCP replacement tooling is not expanded or redirected in this checkpoint.

### Try this checkpoint

Use the same `velorn-editing-polish` review folder and a disposable/duplicated project.

1. Import a new grade or take. Right-click a trimmed, animated or graded timeline clip, choose **Smart Replace…**, and select the new media. Leave Source In at its default for a matching regrade.
2. Check the paused frame and playback: the new picture should retain the edit's timing, animation and processing. Other instances of the original asset should remain unchanged.
3. Undo once and redo once. Try choosing another Source In for a different take; try a too-short source and confirm the explanation instead of a partial edit.
4. Try a linked clip, an audio clip with EQ/envelope, an image, a transition and a clip with Optical Flow. Check the linked-media and mask/cache warnings where relevant.
5. Save/reopen the duplicate project. Confirm the replacement remains, along with its settings. Report anything unexpected before the next checkpoint.

### Verification

- **357 focused regression tests passed**, including 23 Smart Replace planner/metadata/timing cases, 9 real-store/token/history/serialization cases and 13 source-cache identity/deferred-I/O tests. The latter execute the actual cache hydration/render service with in-memory boundary substitutes, including delayed failure/progress/completion after replacement and project-load ordering.
- New `scripts/check-smart-replace.cjs` passed all **11 integration groups in both Chrome and the installed Electron runtime**, with no renderer exceptions. It generates tiny H.264 red/blue sources in memory, probes real decoded metadata, checks paused same-ID replacement/Undo pixels, runs the actual export compositor against in-memory source/destination bridges, and checks preserved animated-transform output. It also covers exact instance/linked behavior, source-In changes, invalid media/locks, modal keyboard/focus/cancel, stale assets/tokens, still/audio settings, JSON round trips, and the real legacy renderer's deferred disk-load hook/map. Normal-width and 350px dialog screenshots were visually inspected; 350/600px layouts have no horizontal overflow.
- Existing multi-clip Inspector browser checks and all 10 EQ integration groups passed, including normal inputs, linked selection, one-gesture history, paused preview, real live/offline audio and narrow layouts.
- Final production renderer build (13.77 seconds), Linux x64 native dependency gate and `git diff --check` passed. Existing Vite/Browserslist/chunk-size warnings remain.

Integration uses the isolated fixture host, with waveform/export/cache IPC stand-ins. Actual compositor frames are checked, but no final movie is encoded, and production IPC, production sandbox setup and packaged-platform behavior are not verified by that suite. The installed Electron host uses the same test-only sandbox caveat described above. No real project or user media was opened; the owned port 5184 server and isolated hosts were stopped after verification. Main, experimental agent-budget work, commits and GitHub remain untouched.

## Checkpoint 4B — Editable compound clips

**Accepted by the maintainer.** Select a self-contained layered section, right-click and create a named compound. It becomes one timeline tile. Double-click it or use **Open Contents**, edit the original layers with the familiar tools, then use **Back** above the timeline.

- One level of embedded content, stored inside the project. It is not a rendered replacement file or a shared sequence reference. Existing media stays in the project's asset library and uses the same portable paths.
- The parent tile supports move, head/tail trim, rename, enable/disable, delete and Open Contents. Its minimal Inspector directs processing and animation edits to the original layers. Parent effects, transforms, retiming, split, duplication and nested compounds are deliberately outside this version.
- Creating a compound is one Undo action. Inside it, Undo/Redo applies to child edits; Back commits valid child edits as one parent Undo action. Merely opening and returning should preserve the parent edit state. Saving while inside must still serialize the full parent timeline with current child contents, never substitute the child for the parent sequence.
- Trimming the outer tile sets a playback window. Original source timing, animation, masks, speed ramps, fades, EQ and volume envelopes keep their authored clocks. Trimming does not restart animations or discard hidden source handles. The parent duration stays fixed as its child contents are edited; longer child content provides more available source for a later extension.
- Live preview and movie export expand render-only, namespaced layers at the parent's stack position. Those virtual layers are never editable store clips. Full clip render bakes are ignored in that projection; valid source-frame interpolation caches can be reused after verification. Parent visibility/enablement also gates its child audio; parent master audio applies once.
- First-version eligibility is conservative: ordinary video, images, text, shapes and audio; complete linked groups; normal blending; self-contained clip processing. Nested compounds, captions, adjustment layers, transitions, track mattes, backdrop-dependent blending, interleaved unselected layers, active clip-cache jobs, solos and active child audio-bus inserts are refused with explanations. Sequence dimensions/FPS cannot change while compounds exist. Use original child clips for supported editing instead of flattening an unsupported selection.
- Back waits for active child render jobs. Existing cache-only hydration can finish without creating an authored parent Undo action. Optical Flow hydration follows embedded sources on project load and is session-guarded after Open/Back, including source relink/removal races.
- Asset/folder deletion and unstitch protect media and masks used inside compounds, including other timelines and live child edits. Unused-media accounting includes embedded references without relying on the currently visible timeline alone.
- FCPXML and Premiere XML export explicitly refuse compound-containing timelines; they must not silently omit their content. Render a movie instead. Native movie/audio export is supported through the existing rendering and mixing paths.

### Try this checkpoint

Use the same `velorn-editing-polish` review folder and a disposable/duplicated project. Do not open a compound-containing project in an older Velorn build; older builds do not support this new clip type.

1. Select a short video/title/logo section and its linked sound. Right-click, choose **Create Compound Clip…**, and name it.
2. Play it, move it, and trim its outer edges. Picture, title animation and audio should retain their alignment.
3. Double-click the compound. Adjust one original title, effect or clip; use **Back** and check the result in the parent timeline.
4. Undo/redo the parent edit, then open the compound and try child Undo/Redo. Open and Back without an edit should not add history.
5. Save/reopen the duplicate and export a short range, including one that starts partway through the compound. Compare playback and output before accepting this checkpoint.

### Verification

- **409 focused tests passed** across the existing editing checkpoints and new compound planner/store, rendering-window, cache, media-protection and XML-refusal checks. Nineteen dedicated planner/store tests cover atomic create/token/Undo behavior, root serialization while inside, no-op/cache-only Back, source extent, unsupported edits, active jobs and same-timeline switching.
- Native audio tests execute the actual Electron export-mix handler with real FFmpeg and synthetic media. Trimmed compound windows match the original source/fade/EQ/envelope clocks sample-for-sample over full and partial ranges, with silence outside the window. Hidden unavailable child handles do not create missing-media export failures.
- The new browser and installed-Electron fixture exercises actual Timeline/Inspector, decoded preview frames, the export compositor and the live audio graph. All nine groups pass: original stack preservation, parent move/head/tail trim (including negative virtual child origins), child editing/Back/save/Undo, invalid/stale requests, namespaced audio payloads, malformed-content refusal, keyboard/focus and narrow layout. Preview comparisons use the existing strict decoded-frame capture bridge; time-only canvas polling was corrected after exposing a fixture sampling race in Electron. No application rendering workaround or relaxed pixel tolerance was needed.
- Existing Smart Replace (11 groups), source Insert/Overwrite (14 groups), EQ (10 groups), and familiar multi-clip Inspector browser suites pass. Parent Inspector, child breadcrumb and narrow create-dialog screenshots were inspected.
- Production build (16.32 seconds), Linux x64 native dependency gate, Electron syntax and `git diff --check` pass. Existing build and test-environment warnings remain.

The isolated fixture uses in-memory media/export/cache destinations and a waveform IPC stand-in. It verifies real compositor frames but does not encode a final movie through production IPC, verify the production sandbox, or test packaged Windows/macOS builds. Native mixing is separately tested with real FFmpeg. Use a duplicate project for the maintainer's final playback/export check. Main and user projects remain untouched; no commits, pushes, merges or releases were performed.

## Checkpoint 4C — Uncompound

**Accepted by the maintainer.** Right-click one compound and choose **Uncompound…**, or use the same control in its Inspector. A concise review shows which visible contents will be restored; Cancel does not change anything.

- Replaces the selected compound with its latest original child clips on fresh video/audio tracks. Video layers retain their stacking position near the parent; sound retains its child track settings. Existing tracks, other clips, transitions and parent markers remain in place. Fresh clip, track, linked-group and marker IDs avoid collisions.
- Restores the current visible section at the compound's current location, not the section's position when it was first created. Fully hidden child clips are omitted with a warning. Intersecting clips are trimmed where exact representation is supported. Visible child markers return at their corresponding parent timeline positions. One normal Undo restores the complete compound, including content outside its trimmed window.
- Preserves media bindings, static processing, masks, current edits, EQ and volume envelopes. All supported keyframe times shift by the retained child's head offset, including offscreen/negative keys; this preserves existing eased curves instead of approximating new boundary keyframes. Effect IDs are retained because procedural effects may use them as seeds. Original media and cache files are never deleted.
- Full render bakes are detached because cropped/rebased animation must render live. Source-frame interpolation caches are retained through Uncompound and Undo/Redo; cross-ID runtime reuse requires the same asset and complete durable cache descriptor, a ready/non-busy cache, and compatible coverage. A stale, mismatched or unverified source result is not reused.
- Some cropped children cannot be represented exactly by an ordinary clip's existing timing model: partial speed ramps, cuts through audio fades, temporal effect phase changes, motion-blur edge sampling, frozen/noncanonical source bounds and certain source-end clamp cases. These refuse with the specific child/reason and instructions to extend the compound or adjust that child first. Whole-child restoration supports the corresponding original effects when its timing is stable. No approximation or hidden render-only window is stored on an ordinary clip.
- Locks, active cache jobs/verification, solos, unsupported parent processing, malformed content and stale reviewed state are refused before any write. Uncompound is one atomic history operation, not a loop of individual clip/track writes. It is available on the parent timeline only.

### Verification

- 429 focused tests passed across all accepted editing checkpoints, including 19 dedicated Uncompound planner/store tests. Stale/replayed previews, selection/lock changes, source timing, markers, links, masks, animation, audio and RIFE history remapping are covered.
- Native audio tests invoke the real Electron mix handler with bundled FFmpeg. A synthetic stereo source with EQ, envelope, fades, clip/track/master gain and panning produces byte-identical PCM before/after Uncompound for moved, untrimmed and safely head/tail-cropped compounds, including partial export ranges.
- Both isolated Chrome and installed Electron passed all 12 Uncompound groups; Chrome also passed all 9 original Compound regression groups. Strict decoded preview/export composition comparisons cover current child edits, preserved layer order under unrelated foreground, trims and negative animation origins, Undo/Redo, and ordinary save/load. A distinct blue cache over a red original verifies actual RIFE source selection through Uncompound/Undo/Redo. Wide and 350px dialog screenshots were inspected.
- A final focused RIFE-source check in both hosts requires a majority-blue decoded frame, excluding a false pass from the small existing blue overlay: Chrome produced 4,664/5,184 blue pixels, Electron 5,120/5,184, both with zero red. Undo/Redo retained decoded pixel parity.
- Production build, Linux/x64 native runtime package gate and `git diff --check` passed. Existing Vite CJS, Browserslist and bundle-size/import warnings remain.
- Renderer export/file/cache IPC uses isolated in-memory stand-ins; this is not a packaged-app final movie export test. Native audio is tested separately as above. No user project/media was opened or modified; main is untouched and nothing is committed or pushed.

### Try this checkpoint

1. On a duplicate project, create a compound, move it, then right-click **Uncompound…**. Check the review and confirm. The contents should appear as selected editable clips on separate tracks.
2. Undo once and redo once. Open the restored compound, change a title or grade, return and Uncompound again: the latest edit should survive.
3. Try a safely trimmed compound and compare its first/last frames and sound before/after. Try a trim through an audio fade or speed ramp and check the explanation instead of a changed result.
4. Save/reopen the duplicate and export a short range to compare. Report feedback before moving to another checkpoint.

## Checkpoint 5A — Export workspace

**Accepted by the maintainer.** Implements the approved export design in the same `velorn-editing-polish` review folder. Compact settings sit beside a real timeline preview, with a read-only track/range overview underneath and a collapsible render queue on the right. Export Now and Add to Queue remain visible along the bottom.

- Reuses the existing export settings, project-local preferences, destination dialogs, worker job correlation, progress, cancellation and output handlers. MP4, WebM, ProRes, audio-only, PNG sequence, GIF, alpha delivery, hardware encoding, optional RTX upscaling and XML handoff remain available. Advanced encoding, audio and performance controls use disclosures instead of occupying the whole workspace. Existing platform restrictions and compound XML refusal remain intact.
- The preview uses the editor's actual live/cached picture and audio rendering. It reviews **timeline settings**, not a simulated final encode: changing export resolution, codec or audio processing does not change this preview. That distinction is stated beneath the overview.
- Review transport plays the selected full or In/Out range once, stops on its last included frame, and supports frame stepping. Frame-count timecode stays consistent across the transport, overview and duration at fractional frame rates. Reversed marks normalize; valid marked empty tails remain part of the range. Reviewing does not edit clips, marks, selection, caches or Undo history.
- The overview displays actual tracks and clip spans with muted/hidden/solo state. Pointer and keyboard scrubbing reuse the existing frame-snapped seek and target-picture barrier. It is not another editing timeline: there are no trim handles, fake waveforms or draggable clip blocks.
- Hidden/busy review views unmount their preview, clock and media subscriptions. Leaving the workspace pauses review. The Export panel itself stays mounted so queue state and worker progress survive a tab switch. Decoder cleanup happens before the incoming preview acquires media resources.
- Queue entries retain their existing **settings-only** snapshot semantics: they use the current timeline and In/Out marks when each job starts, and destinations are chosen at export. The queue states this explicitly; it is not a background batch of frozen timeline versions. Active jobs cannot be removed, competing queue/export starts are blocked, and Pause finishes the current job before stopping.
- New workspace/overview text is covered in English and Japanese. The localization regression also exposed and filled the previously missing Play Around shortcut label in both dictionaries, without changing bindings.
- Final review corrected display-only edge cases: missing marks visibly use the existing full-timeline fallback without overwriting the saved range preference, coincident marks show zero-length guidance, and RTX delivery summaries show the final upscale dimensions rather than the pre-upscale render size.

### Verification

- `npm run test:export-workspace` passes **48 tests** covering bounded review clocks, fractional-rate frame labels, read-only overview navigation, cold-image readiness, worker lifecycle, portable PNG destinations and alpha delivery. Existing Play Around (**40**), playback jumps (**39**) and localization (**9**) checks pass.
- `scripts/check-export-workspace.cjs` passes **14/14 groups in Chrome and 14/14 in installed Linux Electron**. Checks cover real preview pixels and range endpoints, 1440/1024/900px layouts, three themes, presets and codec/alpha dependencies, eight output destinations, XML requests, queue pause/resume/removal, cancellation, progress across tab changes, empty/audio-only timelines, missing/coincident marks and RTX final-output summaries. No renderer exceptions or forbidden fixture writes occurred. Wide, narrow and alternate-theme screenshots were inspected.
- Runtime testing exposed a shared paused-preview bug: a still finishing its first load incremented a discarded asset revision, leaving the canvas black until another navigation. The existing paused redraw effect now observes that revision. Three focused regressions check still/mask readiness and error invalidation without introducing another playback render loop; actual decoded-pixel checks exercise a deliberately delayed still-image load in both hosts.
- Existing PreviewPanel cached/live jump checks pass **4/4 groups in Chrome and 4/4 in installed Linux Electron** after the shared preview extraction and cold-image correction. Exact live/cache/different-cache landings, held-picture release and unavailable-source retry/cancel remain covered.
- Final production renderer build passed in **14.29 seconds**, the Linux/x64 native runtime package gate passed, and module/script syntax plus `git diff --check` pass. Existing Vite CJS, Browserslist and large-bundle/import warnings remain.

The isolated UI fixture uses actual components, decoded synthetic images and an in-memory desktop/worker bridge. It validates requests, destinations and lifecycle behavior without encoding a final movie or opening/writing any user project. The installed Electron fixture has sandboxing enabled, context isolation enabled and Node integration disabled; it is not the production main/preload or a packaged-platform test. The implementation uses shared renderer code for Linux, Windows and macOS, with no native dependency or IPC changes in this checkpoint; Windows/macOS runtime verification remains outstanding. The owned port 5194 server and isolated hosts are stopped; the user's review app on 5173 was left untouched. Main is unchanged, and nothing has been committed, merged or pushed.

### Try this checkpoint

1. Open **Export** in the review app with a disposable/duplicated project. Play, frame-step and scrub the preview; compare a transition or layered shot with the Editor.
2. Set In/Out in the Editor, return to Export, choose **In/Out Range** and play it. It should stop on the final included picture without moving the marks. Collapse the queue for a larger review area.
3. Try the format/preset controls and advanced disclosures. Export a short range and check the actual movie and audio; the preview is deliberately not an encoder or audio-normalization preview.
4. Queue two different output settings. Start, pause after the current job, resume, and switch tabs during progress. Remember that queued jobs use the timeline/marks present when they start.
5. Report feedback before any merge, release or further checkpoint.

## Checkpoint 5B — Resizable export panels

**Accepted by the maintainer.** Drag the divider between export settings and the preview, or between the preview and the render queue, to change either panel's width. Dividers highlight on hover/focus; double-click or press Enter to reset that panel to its responsive default.

- Widths are local UI preferences (`velorn-export-panel-widths-v1`), not project or export settings. They survive reopening Export and hiding/showing the queue. Shrinking the window clamps the visible layout without overwriting the saved preference; widening it restores the desired sizes.
- Limits keep settings at least 220px, queue at least 180px and preview at least 320px in the three-column layout. On smaller windows the queue moves below the preview; the remaining left divider preserves a 280px review area. Fully stacked layouts hide horizontal dividers. Narrow overview rulers hide the middle label and reduce track-label width to avoid overlapping timecodes.
- Focused dividers support arrow keys (10px, or 40px with Shift), Home/End bounds, and Enter reset. Escape, window blur, pointer cancellation, tab changes, unmount and container resizing cancel an active drag and restore its initial preference. Pointer-up also checks the live container width so a resize cannot commit stale coordinates before ResizeObserver runs.
- A separate layout component coalesces drag movement to animation frames while keeping the preview subtree mounted. It does not restart review playback, change export settings, queue an output, move the playhead or create Undo/history changes. Existing editor resize controls are untouched.

### Verification

- **61 export-focused tests** pass, including 13 new layout/preference cases: malformed data, minimum/maximum bounds, breakpoint defaults, proportional clamping, fixed-peer drag limits and restored preferred widths. All nine localization checks pass.
- The export UI suite passes **18/18 groups in Chrome and 18/18 in installed sandboxed Linux Electron**, retaining the previous 14 export regressions. Four new groups exercise real drags, persistence/remount, queue hide/show, keyboard/reset/bounds, 1024/900/780/500px layouts and cancellation/cleanup. Immediate container resize followed by pointer-up is covered to catch the ResizeObserver timing race. Ruler-label geometry and resized screenshots are checked for narrow layouts. Authored state and export settings remain unchanged, with no worker or destination calls from resizing.
- Final renderer build passed in **14.04 seconds**; script syntax and `git diff --check` pass. Existing build warnings remain. These are shared renderer changes; Windows/macOS runtime and packaged-app verification remain separate release checks. No production IPC or native dependencies changed.

### Try this checkpoint

In the review app's Export tab, drag both vertical dividers, hide/show the queue, and resize the window. Double-click a divider to reset it. Try Escape during a drag and confirm the previous width returns; reopen Export and check that completed adjustments are remembered. Stop here for feedback.

### Follow-up — readable export labels

The maintainer reported raw `export.workspace.*` keys in the running review app. The served English dictionary contains the correct names, but `I18nProvider` retains loaded dictionaries while live component updates add new controls. Export's new labels and resize tooltips now supply explicit readable English fallbacks, including dynamic queue statuses and range guidance. Current English/Japanese translations still take precedence; the shared language loader and user app session are not reset.

The localization fallback/precedence regression passes, along with all **10 localization tests** and **61 export tests**. The renderer build passes in **15.23 seconds**. The extended UI suite passes **20/20 groups in both Chrome and sandboxed Linux Electron**: the two new groups remove the workspace subtree from fetched English/Japanese dictionaries and check normal labels, options, tooltips, accessibility text, range guidance and all five queue statuses. Stale-dictionary screenshots were inspected. No export behavior, project data or native code is changed by this follow-up. Isolated hosts and port 5194 are stopped; the user's app on 5173 was not reloaded, and main/GitHub remain untouched.

## Checkpoint 5C — Delivery presets

**Accepted by the maintainer; transport follow-up below awaits review.** Five compact tiles at the top of Export provide delivery-oriented starting points: **YouTube 1080p**, **YouTube 4K**, **H.264 Master**, **ProRes Master** and **Review Copy**. All settings remain editable. The five previous encoder presets remain available under **More presets**; no export option is removed.

- YouTube presets use H.264 MP4, AAC stereo at 48 kHz, and an orientation-aware HD/4K size limit. They preserve the project's frame rate and aspect ratio, do not crop, and never enlarge a smaller timeline. Output dimensions round down to even pixels. The bitrate follows the actual output size and frame-rate tier, based on [YouTube's SDR upload guidance](https://support.google.com/youtube/answer/1722171?hl=en); selecting the 4K limit on an HD timeline still produces HD with an HD bitrate. This is a bitrate target, not a strict file-size or peak-bitrate guarantee.
- H.264 Master uses project size, CRF 16 and source media. ProRes Master uses project size and ProRes HQ MOV. Review Copy uses half-resolution H.264, CRF 24, faster encoding and available proxies, which is stated in its description. The new presets default to software encoding for portability; the existing advanced hardware controls remain available.
- Presets preserve the filename and export range, and do not start or queue an export. The active tile is determined by matching settings rather than a stale saved label. Manual changes to a preset's settings remove its selected state; a matching legacy preset can still be identified. Filename and range changes leave a matching preset selected.
- Existing queue semantics are unchanged: queued items retain output settings but use the current timeline and marks when they start. No project data, worker protocol, native dependency or Electron IPC is added. Picking a preset resets processing choices such as normalization, alpha and RTX upscaling to that preset's explicit defaults.
- The tile layout becomes a single column at narrow sidebar widths, with native keyboard-accessible buttons and selected-state announcements. English/Japanese labels include readable English fallbacks for already-running app sessions with older dictionaries.
- “Master” describes a high-quality output choice, not lossless archival or HDR output. ProRes uses the existing AAC audio path and existing 8-bit compositor input; this checkpoint does not add PCM audio or an end-to-end 10-bit pipeline.

### Verification

- **75 export-focused tests** pass, including 14 new preset/data/geometry cases; **13 hardware encoder-argument tests** and all **10 localization tests** pass. The production renderer build passes in **13.49 seconds** and `git diff --check` passes. Existing build warnings remain.
- The UI suite passes **23/23 groups in Chrome and 23/23 in installed sandboxed Linux Electron**, retaining all 20 previous groups. New coverage checks all five tiles and queued export payloads, portrait 60 fps settings, HD/4K caps on a larger 24 fps timeline, smaller-source no-upscale behavior, active/custom matching, preserved filename/range and legacy presets, and the 220px sidebar's single-column layout. Stale English/Japanese dictionary cases now also remove the delivery-preset labels and verify readable fallbacks. Wide, narrow, alternate-theme and stale-language screenshots were inspected.
- The fixture validates existing export requests through an in-memory bridge; it does not encode a real movie or write a user project. Windows/macOS runtime and packaged-platform checks remain release work. Independent review found no actionable preset/wiring issues. Both isolated hosts and port 5194 are stopped, and the user's app on 5173 was left untouched. Main remains clean; no commit, merge, push or release was made.

### Try this checkpoint

Open Export in the review app and click each tile. Confirm the visible format, resolution and quality controls update. Try YouTube 4K on a smaller timeline and YouTube 1080p on a portrait timeline: the delivery summary should keep the orientation without enlarging the image. Change a quality setting to check the selected tile clears, and expand **More presets** to find the previous choices. Export a short range for a subjective picture/audio check before approving this checkpoint.

### Follow-up — Export review keyboard transport

The maintainer reported that Space did not play/pause in Export. The Editor's `TransportControls` owns its window keyboard listener and is intentionally unmounted outside the Editor. Export now owns a visible/idle-only review keyboard listener, sharing the existing shuttle actions and using the same bounded seek/play paths as its review buttons. The Editor's handlers and the playback/rendering engine are unchanged.

- Space toggles once on release; holding it does not repeatedly start/stop playback. It also works after clicking a preset or transport button, without activating that button a second time. Enter toggles from the review surface; on a focused native button/link it retains its normal activation behavior.
- J/L use the usual forward/reverse 1×/2×/4×/8× ladders, Shift+J/L use 1/2×/1/4×/1/8×, K pauses, and holding K with J/L uses half speed. A compact rate indicator appears during non-1× playback. Left/Right pause and step one frame like Export's existing frame buttons; Home/End go to the selected review range's first/last included frame.
- The overview scrubber no longer swallows playback shortcuts after mouse scrubbing. Only that explicitly marked slider lets Space/Enter/JKL reach review transport; its native arrow/Home/End/Page navigation remains intact. Ordinary text/number inputs, selectors, sliders, checkboxes, resize handles, disclosures, dialogs and composition retain their own keyboard interaction.
- Pending keys are cancelled on focus/pointer interaction, blur, document hiding, range/session changes and unmount. Hidden, empty or busy Export has no active playback shortcuts. Timeline authoring shortcuts, I/O mark changes and Play Around are not introduced into this read-only review workspace.

**Verification:** all **96 export-focused tests**, **12 shuttle/keyframe tests** and **10 localization tests** pass. This includes 17 keyboard ownership/guard tests and four new component tests for bounded actions, shuttle ladders, stale/preparing/empty sessions, and a fractional-frame endpoint rounding case. The latter caught and fixed Play failing to restart when a store-snapped last-frame time was infinitesimally below the computed range endpoint. The final renderer build passes in **14.81 seconds**, and `git diff --check` passes.

The final UI suite passes **27/27 groups in Chrome and 27/27 in isolated installed Linux Electron**, retaining the previous 23 groups. Four new groups cover keyboard/native-control ownership, shuttle and bounded navigation, form/modal/composition guards, and cancellation/hidden/busy/empty lifecycle. Tests explicitly confirm that Space on a focused **Export now** button does not launch a job, and that End followed by Space restarts a range of frames 1–8 at frame 1. No renderer errors or user-project writes occurred. Both fixture hosts and port 5194 are stopped; the user's app on 5173 and main remain untouched. Nothing was committed, merged or pushed.

**Test-host qualification/correction:** earlier references above to Export's “sandboxed” Electron checks described the fixture's `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` preferences. Process inspection confirms that Playwright's Electron launcher adds `--no-sandbox`. Treat these runs as isolated installed-runtime UI coverage, **not OS-sandbox, production main/preload, native encoding or packaged-platform verification**. No application security setting was changed. Windows/macOS runtime verification remains a release check.

## Checkpoint 6 — Music ducking, saved export presets, readiness and interaction polish

The maintainer accepted Export keyboard transport, then authorized all four proposed finishing improvements together while away. The maintainer has now approved the result and authorized a **local checkpoint commit only**, in `velorn-editing-polish` on `codex/editing-workflow-polish` (0.3.33). Earlier accepted work is preserved. No merge, push or release is authorized.

### Music ducking

- Select one music audio clip (or its linked picture/sound pair with the Audio inspector selected), then **Music ducking → Duck under dialogue…**. Choose a separate dialogue audio track, reduction, fade and detection sensitivity. **Analyze dialogue** reads local audio levels and proposes a curve; it does not edit the project. Compound-projected dialogue uses the shared playback windows and audibility rules.
- **Listen original / Listen ducked** use the real program mix and PreviewPanel clock over the music clip's range. A transient, exact-clip-identity envelope override affects only audition audio. The existing Play Around ownership/decoder barrier handles bounded playback and restores the original cursor paused, without changing marks, loop mode, selection or history.
- **Apply volume points** adds attenuation to existing dB automation through the existing `updateAudioVolumeEnvelope` action, producing one Undo checkpoint. Original point IDs, trim offsets and hidden points survive; gain, fades, EQ, timing and other metadata remain unchanged. The resulting ordinary envelope is already supported by preview, save/load and export. Applying a second ducking pass adds attenuation again; Undo the previous pass before redoing it.
- Detection is level-based, **not semantic speech recognition**. Isolated dialogue is recommended; noise/music can trigger dips. Source trim, constant audio speed, clip gain/fades/envelopes and track volume are considered, but EQ/audio inserts are not analyzed. Reverse audio is excluded like playback/export. Limits: music clip up to 10 minutes, dialogue source files with known duration up to 30 minutes, at most 32 distinct sources and 128 final editable points. Exceeding a limit or finding no activity produces a readable error without replacing automation.
- Native files use the existing FFmpeg waveform IPC, sequentially, with duration-adaptive sample counts and accurate bucket timing. This avoids the old floor-bucket remainder smearing seconds of short-file audio. Blob/data browser sources use the real browser bucket timing. Windows drive/UNC paths and project-relative paths are supported. No models, cloud service, ComfyUI or credits are needed.
- Cancel, stale clip/source/project/session/selection, unmount and invalid contexts cannot apply late results. Existing waveform IPC cannot kill an in-flight decode: cancellation discards it and prevents subsequent work; concurrent retries wait for that one decode. Dialog focus/keyboard ownership prevents background editing. Blur/hidden closes only its owned audition, not a replacement transport.

### Saved custom export presets

- Configure delivery settings, then **Save as preset**. **My presets** stores named settings across projects on this device, with Rename and an explicit Delete confirmation. Five recommended cards and all legacy presets remain available.
- Versioned local storage uses a delivery-only allowlist: no filenames, ranges, destination paths, source/cache references, project data or snapshots. Up to 50 presets with 64-character names; duplicate names do not overwrite. Unsupported/corrupt storage is preserved read-only with Retry, and failed persistence never reports success. Dialogs reject stale project/settings/record contexts. Matching follows actual settings, including formats with no video/audio codec choice.

### Export readiness

- Expand **Before you export → Check this range** for optional, advisory source/cache availability and timeline coverage checks. Inspect pauses and navigates the export review without editing or starting a job. Missing used sources/mask media, unusable Optical Flow metadata/files and possible picture gaps/blank tails/audio silence are surfaced. Intentional black or silence never blocks delivery.
- Only recorded paths are resolved and checked for existence, with four concurrent checks maximum. No relinking, decoding, media repair, model downloads or user-file writes. Layer/compound/transition and audio-role/solo/mute rules are shared with playback/export; unused library assets are ignored. Checks are explicitly **not a render guarantee**; export still validates source fingerprints and cache safety. Changed range/source/session/settings invalidates the report until Refresh; late/racing/canceled checks cannot revive stale results. Refresh after external file moves.
- English/Japanese labels and stale-dictionary English fallbacks avoid showing internal localization keys.

### Interaction consistency

- Source, Editor and detached preview Space handling is release-only, with repeat/focus/blur/hidden/IME/modal protection; Enter retains native control activation rather than also toggling background transport. Existing configured shortcut priority and Space-pan behavior are preserved.
- PreviewPanel tracks Space/Ctrl passively and clears those modifiers on focus loss; actual pan/zoom pointer gestures consume them. Source Space prevents default without stopping propagation so preview modifier tracking still receives both down/up, while the background Editor respects the handled event. This avoids both an ordinary-Space playback regression and broken Source Space-pan.
- Inspector numeric dragging still supports drag/type/slider interaction. Right-click cannot start a numeric drag, and canceled/hidden/blurred/stale-selection/ineligible gestures cannot leave listeners armed or later revive. IME confirmation is not an edit commit.
- Timeline's global authoring and Space-pan handlers return early while a visible modal is open, protecting captions and ducking against background Delete/cut/Undo/Redo/tool keys. Detached preview adoption/unmount cleans up keyboard listeners and its owned child window. This is a bounded consistency pass, not a rewrite of all timeline shortcuts.

### Verification and review

- The combined 29-file focused/regression run passes **300/300 tests**: ducking, volume automation, native audio/EQ, export workspace/presets/readiness, transport, Play Around, shuttle/keyframe and localization. Ducking's 40-test script includes 27 new pure/service/native cases plus 13 actual-store ownership cases. Native tests extract the actual waveform handler and use bundled FFmpeg against temporary synthetic audio; detected speech endpoints stay within 41 ms, and rendered ducked PCM matches the envelope sample-by-sample, including partial-range offsets and the 12 dB reduction. Pre-commit review removed a nonexistent standalone lifecycle-test path from the export script; the lifecycle cases are already in `pngSequenceExport.test.mjs`.
- Isolated UI gates pass in **Chrome and installed Linux Electron**: music ducking 7 groups, custom presets 9, readiness 9, interaction consistency 11, and the previous export workspace 27. Ducking tests use actual Inspector/Timeline/PreviewPanel/AudioLayerRenderer with synthetic WAV playback and a deterministic waveform IPC stand-in, including a real Web Audio analyser A/B comparison. Additional real-dialog probes cover focus trap, keyboard isolation, Escape, blur and stale-source cleanup. Preset IME confirmation/cancellation cannot accidentally save or close its dialog. The interaction matrix includes actual PreviewPanel timeline/source Space taps, pan, Ctrl+Space zoom and modifier cleanup after keyup/blur/hiding. No real user project or output was opened or generated.
- The pre-commit production renderer build passes in **14.02 seconds**, and `git diff --check` passes. Screenshots of the proposed ducking curve, silence warning, custom presets and readiness panels were reviewed.
- Final Play Around regressions pass **27/27 groups in each host**, including the real PreviewPanel and cached transitions after the Space ownership correction. Existing source editing (14 groups plus narrow layouts) and multi-clip Inspector (8 groups) remain green. The tests caught the PreviewPanel/Source modifier-consumption conflict before handoff; both ordinary playback and pan/zoom are now covered directly.
- These hosts are isolated runtime tests, **not packaged Windows/macOS or OS-sandbox verification**. The earlier Playwright sandbox qualification still applies. Shared renderer logic and portable paths are implemented, but native Windows/macOS smoke tests remain release work. Existing Vite CJS/Browserslist/chunk warnings remain unrelated.

Start review with a short music bed and separate dialogue track: Analyze, listen to both versions, Apply, then Undo. Save and reuse an export preset in another project, then run readiness checks on a range with an intentional gap. Confirm Space/Enter and numeric drag/type behavior still feel natural. Main and the user's app on 5173 remain untouched by test hosts.

## Subsequent checkpoints — not started

Checkpoint 6 is approved; stop after the authorized local commit and await further maintainer instructions. Automatic background range rendering remains proposed; OFX hosting remains deferred. Footage logging/Favorites/Rejects is **deferred by request**: Velorn's focus is shorter edits and generated media, without asset-panel clutter. Further nesting, reusable sequence references and broader scheduling/shortcut redesign require discussion before implementation.
