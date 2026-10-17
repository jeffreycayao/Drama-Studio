# Plan: Motion Studio, where AI does the edit (2026-10-17)

Internal planning document. Not user-facing. Source studied:
`F:\.DEVELOPMENT\03. AI VIDEO\01.2 AI POWERED MAKER`. That is OpenMontage,
AGPL-3.0: an agent-driven video production system with 13 pipelines, 100+
Python tools, YAML pipeline manifests, Markdown "director" skills, JSON
artifact schemas, style playbooks, a Remotion composer, and the "Backlot"
live storyboard.

## Verdict

- **Motion Studio** becomes a Drama Studio workspace. You give it your
  elements (footage, images, voice-over, music, script or brief). The AI
  plans the edit, shows it as a storyboard with approval gates, and then
  **builds an editable timeline**, not a flat render. Everything stays
  undoable, and the user can keep cutting by hand.
- **Borrow the method, not the program.** OpenMontage's lasting value is its
  production method:
  - stages: brief → script → scene plan → assets → edit → review
  - its artifact contracts, especially `edit_decisions`
  - style playbooks
  - quality gates: "slideshow risk", the pre-render check, the post-render
    self-review
  - the Backlot storyboard with approvals

  Drama Studio already has the agent (the Assistant + 140 MCP tools) and a
  real timeline. So Motion Studio runs that method **natively**: the Assistant
  is the orchestrator, and the timeline is the compose target.
- **Optional engine add-on, later:** some capabilities Drama Studio lacks
  could come from the OpenMontage Python tools, installed as a separate,
  user-installed add-on, like ComfyUI. Examples: live web research, Remotion
  motion graphics and kinetic type, CLIP-ranked stock montage, clip-factory
  ranking. That keeps the AGPL program a separate program (see Licence).

## What the user sees

| Step | Screen | What happens |
| --- | --- | --- |
| 1. Start | **Motion Studio** tab › New production | Pick a recipe: Talking head, Documentary montage, Explainer, Cinematic teaser, Podcast to clips, Product ad, Music video. Add elements: drop footage, voice, music, a script, or a reference video "make it like this" |
| 2. Brief | Brief card | The AI asks 3–5 plain questions (length, platform 16:9 or 9:16, tone, must-include). Answers are saved as the **brief** |
| 3. Plan | Script and scene plan, as a screenplay-style page | The AI writes or adapts the script and splits it into scenes. Each scene shows its intended shots. **Gate: Approve script** |
| 4. Assets | Storyboard contact sheet, one row per scene | Takes from the project (ranked), missing shots marked, "Generate" buttons that use the normal Generate routes (local, cloud, your browser). **Gate: Approve storyboard** |
| 5. Edit | Timeline preview, side by side with the plan | The AI writes `edit_decisions`: main cuts, overlays and titles on their own layers, narration, music with ducking, SFX, captions in the chosen style, transitions, pacing to beats. Shown as a **preview diff**; **Apply** creates a new timeline "Motion cut 1" (one undo step, checkpoint first) |
| 6. Review | Review card | Automatic checks: slideshow risk, dead air, caption overflow, loudness, black frames, missing assets. Fixes are offered, and the user can say "tighter", "more energetic", "swap scene 3" |
| 7. Deliver | Export | Normal export presets, plus subtitle files and, later, versions for each platform |

Motion Studio keeps each production's board (stages, gates, decisions, cost)
in the project, `.dramastudio/motion/<production-id>/`, so it reopens where it
stopped. It also has a **Replay** of how the cut was made.

## How it works inside

```
Motion Studio UI (stage board, gates, storyboard)
      │  production state (brief, script, scene_plan, asset_manifest, edit_decisions, review)
      ▼
Motion orchestrator (renderer service)
  - runs a recipe = ordered stages, each with a director prompt and a JSON contract
  - asks the Assistant model for each stage's artifact, validates it against the schema,
    retries with the validation errors, never applies unvalidated output
  - uses existing MCP tools to inspect media (find_timeline_items, inspect_clip,
    analyze_timeline, transcripts, beat detection, inspect_timeline_range)
      ▼
edit_decisions → timeline applier (deterministic code, no AI)
  - cuts → main track; overlays/titles → overlay layers (uses the new layer placement rules)
  - narration/music/SFX → audio tracks, ducking via auto_duck_music, fades via keyframes
  - subtitles → captions clip with style; transitions → native transitions
  - builds ONE run_mcp_action_plan, previewOnly first, then applied as one checkpointed undo step
```

- **Contracts:** Drama Studio versions of `brief`, `script`, `scene_plan`,
  `asset_manifest`, `edit_decisions` and `review`. They are modelled on
  OpenMontage's schemas, rewritten for Drama Studio's timeline: asset IDs
  instead of file paths, track roles, layers. The orchestrator and the
  applier have unit tests, plus golden tests: a fixed `edit_decisions` must
  give the same timeline.
- **Recipes** live in `src/config/motionRecipes/` (and later in packs). Each
  has stages, the questions for the brief, a style default and review rules.
  A recipe is data, not code: a pack can add one, but cannot add executable
  steps.
- **Styles:** Drama Studio style presets (caption look, title font, colour,
  pace, transition family, music bed). These are the same tokens the editor
  already uses.
- **Model requirements:**
  - Stage prompts need a capable model. The Assistant's cloud models work
    well, and good local models (≥ 14B with JSON mode) can do the simpler
    recipes.
  - Motion Studio checks the selected model and says plainly when a recipe
    needs a stronger one.
  - The applier is plain code, so even a small model's plan applies
    predictably.
- **Agents:** MCP tools `motion_list_recipes`, `motion_start`,
  `motion_get_state`, `motion_approve` and `motion_apply_edit` (previewOnly
  first), so Claude Desktop or Codex can drive a production too, under the
  same agent guardrails.

## The optional engine add-on (phase 3)

- **What:** an installer in Settings › Add-ons › Motion engine. It sets up the
  OpenMontage Python tools in their own folder with a separate virtual
  environment. Drama Studio fetches it from the official source only when the
  user asks, the same way ComfyUI add-ons are installed.
- **How Drama Studio talks to it:** a small local adapter lists the engine's
  tool registry and runs single tools with JSON in and JSON out. It never runs
  the engine's own agent loop.
- **Which tools to expose first:**
  - web research for the brief
  - Remotion and HyperFrames motion-graphics clips (rendered as video assets
    that land on overlay layers)
  - the stock-corpus montage search
  - clip-factory ranking
  - scene detection
- Results come back as **assets**, so the timeline stays Drama Studio's.

## Licence

- OpenMontage is **AGPL-3.0**; Drama Studio is **GPL-3.0-only**.
- **Phases 1–2 copy no OpenMontage code or text.** The method is
  re-implemented. Schemas are rewritten for our timeline, and director prompts
  are written new, so no licence question arises. Credit OpenMontage as
  inspiration in `THIRD_PARTY_NOTICES` and the README credits.
- **Phase 3 runs the engine as a separate program**, installed by the user
  and talked to over a process boundary. It is not bundled into our build, so
  its AGPL terms apply to the engine itself and not to Drama Studio.
- **Before shipping phase 3:**
  - Owner check (or a lawyer's) of AGPL obligations if Drama Studio ever
    offers the engine over a network.
  - Keep the engine's licence and source link visible in Settings › Add-ons.
- **Naming:** user-facing text says "Motion Studio" and "Motion engine". The
  OpenMontage name appears only in credits and the add-on's licence screen.

## Order of work

1. **Contracts + applier** (`edit_decisions` → action plan → timeline):
   golden tests, preview, undo. This depends on the timeline layering
   redesign (overlay layers) that is running in its own session, and should
   land after it. **M**
2. **Motion Studio workspace (stage board, gates, storyboard) + orchestrator
   + 3 recipes:** Talking head (your footage), Documentary montage (your
   clips + stock), Music video (beats). **M–L**
3. **Review checks** (slideshow risk, dead air, caption overflow, loudness,
   black frames) and "make it tighter / more energetic" revisions. **M**
4. **More recipes:**
   - Explainer: script → voice → images or video → captions
   - Cinematic teaser
   - Podcast to clips
   - Product ad

   Packs can carry recipes. **M**
5. **MCP tools** for agents. **S**
6. **Motion engine add-on** (phase 3): installer, adapter, the first tools,
   licence screen. **L**

## Engineering process

- Build each step on its own branch.
- Merge in an integration worktree, then run the full suite and a build.
  Check in the packaged app over CDP with a fixture project, then push.
- The applier gets property tests: random valid `edit_decisions` must never
  produce overlapping clips on one track, negative times or missing assets.
- The orchestrator uses the fake LLM server from the Assistant tests to replay
  fixed stage outputs, so CI never calls a real model.
- Help Center: "Make a video with Motion Studio", in plain words with no
  internals.

## Open owner decisions

1. Phase 3 engine add-on: yes or no, and when.
2. Which recipes ship first. The proposal is Talking head, Documentary montage
   and Music video.
3. Whether Motion Studio is part of the free app or a paid "Pro" feature
   later.
