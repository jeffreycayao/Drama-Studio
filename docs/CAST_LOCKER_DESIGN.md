# Cast & Wardrobe Consistency Locker — Phase 0 cross-check

Status: v1 implemented (JavaScript + JSDoc, both binding modes). Written 2026-10-16 against the current
checkout (Drama Studio, Electron 44, React renderer in plain JavaScript).

## 1. What already exists (and why it drifts)

- **Short Film characters** (`GenerateWorkspace.jsx`, `ShortFilmEasyMode.jsx`,
  `shortFilmConfig.js`) are per-film records with `name`, `slug`,
  `visualNotes` and a **single** `referenceAssetId`. Keyframes are built by
  editing from that one image (Qwen Image Edit) or by attaching it as a
  reference (cloud edit models). `visualNotes` mixes face and clothing in one
  text field.
  - One image, one angle: profile and three-quarter shots extrapolate the face,
    which is where identity drift comes from.
  - The reference is usually a full-body or costume shot, so reference-edit
    models copy the clothing too. That is the "frozen wardrobe" problem.
- **Generation jobs** are executed by `runJob` in `GenerateWorkspace.jsx`. It
  uploads `inputAssetId`, `referenceAssetId1/2` and `assetFieldIds` with
  `comfyui.uploadFile`, calls the matching `modify*Workflow()` from
  `src/services/comfyui.js`, then `comfyui.queuePrompt()`.
- **Identity-capable workflows bundled today** (43 in `public/workflows`):
  - Keyframes by reference edit: Qwen Image Edit 2509 (local), Seedream 5 Lite
    edit, Nano Banana 2 / Pro, GPT Image 2 edit (cloud partner nodes).
  - Video by reference: Seedance 2.0 R2V and MiniMax Hailuo H3 reference
    (cloud), and the LTX 2.3 ID-LoRA image-to-video workflow (local).
  - **None** contain PuLID, InstantID or IP-Adapter FaceID nodes.

## 2. Cross-check against the spec

| Spec item | Finding | Decision |
| --- | --- | --- |
| `src/types/cast.ts`, `*.ts`, `*.tsx` | The renderer is JavaScript/JSX with no TypeScript toolchain. Adding TS for three files means new build config, a type-check step and mixed-language imports. | Match the codebase: `src/types/cast.js` with JSDoc typedefs (editor type hints, zero build change). Revisit if the project adopts TS wholesale. |
| Inject faces into PuLID / InstantID / IP-Adapter FaceID | These are **image-model** identity adapters (SDXL / FLUX). They do not plug into video diffusion graphs (Wan 2.2, LTX 2.3, Seedance). No bundled workflow contains them. | Two binding modes (§3): **reference-slot binding** for every bundled identity-capable workflow, and **adapter-node binding** when a custom or imported graph contains a supported adapter node. Video consistency comes from an identity-locked keyframe feeding image-to-video, or reference-to-video for cloud. |
| Intercept at `queuePrompt()` (`:8188`) | `queuePrompt` is shared by captions, music, Topaz, FlowAI and the MCP bridge, and has no job, shot or cast context. A global interceptor would rewrite workflows it does not understand. | Bind inside `runJob`, after `modify*Workflow()` and before `queuePrompt()`, only for jobs that carry a `cast` binding. `comfyCastBinder` is a pure function over (workflow, binding, uploaded filenames). |
| Multi-angle anchors | Correct and necessary. The binder picks the anchor closest to the shot's camera angle (front / three-quarter / profile), falling back to front. | Keep. |
| Decouple wardrobe from face | Adapter nodes embed only the detected face, so they ignore clothing by construction. Reference-edit models copy everything visible. | Anchors must be **head-and-shoulders crops**; wardrobe references should show the outfit (headless or flat-lay). Reference slots are role-labelled in the prompt ("image 1 = identity only, image 2 = outfit only"). The drawer enforces a square crop for anchors. |
| Shot-by-shot tagging | Timeline clips and generation jobs are separate today. Clip edits must go through `timelineStore` actions to keep undo, dirty tracking and MCP snapshots correct. | Tags live on clips (`clip.cast = [{ castId, wardrobeId }]`) via a new `timelineStore` action. Short-film shots map `characterSlug` → cast member. "Regenerate shot" reads the clip's tags. |

## 3. Binding modes

**A. Reference-slot binding (works with what ships today).** For Qwen Image
Edit, Seedream edit, Nano Banana 2 / Pro, GPT Image 2 edit, Seedance R2V and
MiniMax H3:

1. Pick the anchor for the shot angle and the active wardrobe profile.
2. Slot 1 = face anchor, slot 2 = wardrobe reference (if any). Location
   references move to the next free slot, or are dropped with a visible note
   when the model has only two slots.
3. Prepend a role-labelled block to the prompt: identity from image 1 (face,
   hair, age, skin tone; ignore clothing), outfit from image 2 or wardrobe
   keywords (ignore face). Wardrobe keywords replace, not append to, any
   costume text in the shot prompt.

**B. Adapter-node binding (custom / imported graphs).** When the graph contains
a supported node class, the binder finds the `LoadImage` that feeds the
adapter's face input and points it at the uploaded anchor. Supported classes
are a whitelist (`ApplyPulid`, `ApplyPulidFlux`, `ApplyInstantID`,
`IPAdapterFaceID`, plus their known aliases), matched by `class_type`, never by
node id. A graph with an adapter but no reachable `LoadImage` is left untouched
and the job reports why. Wardrobe goes to the text prompt, plus an
`IPAdapterAdvanced` style image if the graph has one.

## 4. Data flow

```
Cast drawer (renderer)
  └─ projectStore get/setCastData ── saved in project.comfystudio as `cast`
       members[]: { id, name, anchors{front,threeQuarter,profile}: assetId,
                    identityNotes, wardrobes[]: { id, name, keywords, referenceAssetId },
                    defaultWardrobeId }
Timeline clip ── clip.cast[] = { castId, wardrobeId }   (timelineStore action → undo)
Generate / Short Film / Regenerate shot
  └─ createQueuedJob({ …, cast: { castId, wardrobeId, angle, scene } })
  ├─ resolveCastBinding → anchor + wardrobe asset ids          ← pure, unit-tested
  ├─ applyCastToJob (mode A): route ids into the workflow's slots, label roles
  └─ snapshot anchors as sourceAssets.castFace / castWardrobe
runJob
  ├─ existing uploads (input, references, asset fields) — unchanged
  ├─ modify*Workflow(...)
  ├─ mode B, only if the graph has adapter nodes: upload anchor, bindCastToWorkflow
  └─ comfyui.queuePrompt → ComfyUI (local :8188 or cloud partner nodes)
Output asset ── tagged with { castId, wardrobeId, anchorAngle } for provenance
  └─ timeline clip → FFmpeg export (unchanged: export never needs the cast)
```

Asset references are project asset ids, so they stay project-relative and
portable. Legacy projects without `cast` normalize to an empty registry.

## 5. Risks and mitigations

- **VRAM.** PuLID-FLUX typically needs 16–24 GB and InstantID-SDXL roughly
  10–12 GB. On the maintainer's 8 GB RTX 3060 the Setup Doctor already
  recommends cloud for video. Binding mode A covers the cloud path; mode B
  cannot be verified locally without those custom nodes and models.
- **Disk and upload churn.** Mode A reuses the job's existing upload path, so a
  cast-bound job uploads the same number of images as an unbound one. Mode B
  uploads the anchor only when the graph contains an adapter. A per-session
  upload cache is a possible follow-up for large batches, not needed for v1.
- **UI thread.** Cropping anchors uses an offscreen canvas on a downscaled
  image. Binding is pure JSON work (no heavy loops), so it stays off the
  critical path.
- **Multiple characters per shot.** Current reference workflows have two slots,
  and regional identity (one face per masked region) needs extra nodes. v1 binds
  identity for the **primary** tagged character; others are prompt-only, and the
  UI says so.
- **Timeline state.** Tags go through a single new `timelineStore` action, so
  undo, autosave, dirty tracking and MCP snapshots stay consistent. Nothing in
  playback or export reads `clip.cast`.
- **Consent and privacy.** Face anchors of real people are sent to whichever
  provider runs the job. The drawer states this and only accepts images the user
  adds explicitly.

## 6. Files (v1)

- `src/types/cast.js`: JSDoc typedefs, normalizers, angle constants.
- `src/services/comfyCastBinder.js`: `resolveCastBinding`, `bindCastToWorkflow`
  (modes A and B), `buildCastPromptBlock`. Pure, with unit tests.
- `projectStore` `getCastData` / `setCastData` (registry, saved with the
  project, same pattern as FlowAI) and `src/stores/castLockerStore.js`
  (drawer open state and the session-only generation lock).
- `src/components/cast/CastLockerDrawer.jsx`: members, three anchor slots with
  square crop, wardrobe presets, per-scene default, primary-character picker.
- Integration edits: `projectStore` (hydrate/save `cast`), `timelineStore`
  (`setClipCast` action), `GenerateWorkspace` (`runJob` binding, Short Film
  slug mapping, regenerate-from-clip), inspector tag control, i18n strings
  (English and Japanese).
