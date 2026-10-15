# Velorn v0.3.34 — A more fluid editing workflow

This update focuses on everyday editing: clearer trimming feedback, faster adjustments across clips, more flexible audio, smoother playback, and a redesigned Export workspace. These editing features work independently of ComfyUI.

## More precise timeline editing

- **Live trim previews:** see the first or last retained source frame while trimming a clip, alongside timecode, duration, added/removed frames, and source limits.
- **Two-up rolling previews:** see the outgoing and incoming frames together as you move a shared cut while keeping the surrounding sequence boundaries fixed.
- **Improved Slip editing:** change the source passage without moving the clip or changing its duration, with live first/last-frame previews.
- **Slide editing:** move a shot between two neighboring clips while preserving its footage and duration; the neighboring cuts adjust to compensate. Select the Slide tool with **U**.
- **Ripple edge trimming:** shorten or extend a clip and move following material on participating tracks, including supported linked companions.
- **Safer trim behavior:** clearer source-handle and unsupported-edit explanations, improved constant-speed/reverse handling, and more consistent one-gesture Undo.

Trim viewers display source frames before effects, grading, transforms, and compositing.

## Faster clip and sequence workflows

- **Multi-clip Inspector:** adjust supported transforms, opacity, blend mode, color, effects, audio gain, and fades using the same familiar draggable fields, sliders, and selectors. Mixed values remain visible; locked clips and animated properties are protected.
- **Selective Paste Attributes:** copy only the categories you need—Transform, Color, Effects, or Audio gain/fades—without replacing the rest of the destination edit.
- **Explicit source editing:** choose **Insert at Playhead**, **Overwrite at Playhead**, or **Add to End**, with source In/Out ranges and destination tracks shown before the edit.
- **Zoom to Selection:** press **Z** to focus on selected clips; press it again to restore the previous timeline view.
- **Smart Replace:** replace one clip's source media while keeping its timeline timing, transforms, grade, effects, masks, animation, and audio settings. Choose a new source-in point when needed.
- **Editable compound clips:** turn a supported layered section into one manageable timeline tile without rendering it flat. Open its contents to keep editing the original layers, then return to the parent timeline.
- **Uncompound:** restore a compound's visible contents as editable clips at its current timeline position, with a review step and normal Undo.

## Smoother playback and review

- Improved rapid scrubbing so completed decoder frames reach the preview instead of being continually interrupted by new seeks.
- Smoother live transitions through improved handling of incoming and outgoing video decoders.
- More reliable jumps while playback is running, reducing black frames and flickering while keeping picture and audio coordinated.
- **Play Around:** press **Shift+K**, use the transport button, or right-click a cut to review two seconds on either side. Normal completion returns to your original playhead position.
- **Clearer transition creation:** the permanent floating plus button is gone, leaving compact clip edges easier to trim. Right-click a cut and choose **Add transition**, drag a transition onto a cut, or use the existing **Shift+T** selection workflow.
- More consistent Space/Enter handling across Editor, Source, detached preview, and review controls, with better protection against accidental edits while using fields and dialogs.

These improvements do not require a new background render cache. Playback performance still depends on the media, effects, layers, and hardware.

## More control over sound

- **Editable volume envelopes:** add and drag volume points directly on an audio clip, or enter precise time and dB values. Shape levels without splitting the clip into extra pieces.
- **Simple clip EQ:** adjust Bass, Mid, and Treble, reduce low-frequency rumble, and compare changes with Bypass and Reset.
- **Local music ducking:** select a music clip, choose a separate dialogue track, and analyze its levels to propose volume dips. Compare **Listen original** and **Listen ducked** before applying editable volume points with one Undo.
- Volume envelopes and EQ are retained through supported edits and project save/reopen, and are carried into the existing export audio paths.

Ducking is level-based rather than speech recognition and works best with isolated dialogue. It needs no generation model, cloud service, or credits. Leave headroom when boosting EQ; no automatic limiter is added.

## Export, redesigned

- A new workspace puts **settings on the left, timeline review in the center, and the render queue on the right**.
- Drag the side-panel dividers to fit your workspace. Completed size adjustments are remembered locally; the queue can also be hidden.
- Review the full timeline or an In/Out range with picture, sound, frame stepping, and a read-only track overview.
- Familiar **Space, J/K/L, slow shuttle, and frame navigation** now work in Export review.
- Five delivery presets: **YouTube 1080p**, **YouTube 4K**, **H.264 Master**, **ProRes Master**, and **Review Copy**. Existing encoder presets remain under **More presets**.
- **My presets:** save, rename, and delete your own named delivery settings for reuse across projects on this device.
- **Before you export:** run optional checks for missing used media, recorded cache problems, possible picture gaps, blank endings, and audio silence. Inspect a warning without changing the edit.
- Cleaner labels and expandable advanced controls keep the workspace readable while retaining existing export options.

## A few things to know

- Batch Inspector changes set shared absolute values. Paste Attributes does not transfer animation, EQ, or volume envelopes.
- Smart Replace changes one clip instance, not every use of an asset or both sides of a linked pair. Check masks/tracking after replacement and rebuild Optical Flow when required.
- Compounds currently support one level. Projects containing them require this updated build; Premiere/FCP XML interchange does not yet support compounds. Keep a backup before editing an existing project with new features.
- Export preview shows timeline playback, not a simulation of the final encode. Queue entries retain output settings, but use the timeline and In/Out marks current when each job starts.
- Readiness checks are advisory, not a decode or render guarantee. Intentional black frames and silence remain allowed.
- Master presets are high-quality delivery choices, not a new lossless or HDR pipeline. ProRes retains the existing AAC audio and 8-bit compositor input.

## Downloads

- **Windows Installer:** standard Windows installation.
- **Windows Portable:** no-install Windows build.
- **Mac (Apple Silicon):** for Apple Silicon Macs.
- **Mac (Intel):** for Intel-based Macs.
- **Linux AppImage:** portable Linux build.
- **Linux deb:** Debian/Ubuntu package.

GitHub's automatically generated source-code archives are for building Velorn from source, not installing the app.
