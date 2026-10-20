# Drama Studio work tracker

The one list of what is still to do. Update it in the same commit as the work:
tick the box, add the version, move it to **Done**. Sources: `docs/FEATURE_AUDIT_2026-10-17.md`
(audit), `docs/PLAN_CLOUD_ALTERNATIVES.md` (cloud plan), `ROADMAP.md`, `docs/BACKLOG.md`.

Effort: **S** = days, **M** = 1–2 weeks, **L** = a month or more. Last updated 2026-10-17.

## In progress

- [ ] **Free local voices and voice cloning (Qwen3 TTS)** — shipped in 0.1.20; still needs a run against a live ComfyUI. *(audit #2)*
- [ ] **Drama Studio Companion** — `extensions/companion` 0.1.0: both extensions merged and rebranded, account gate removed, batches stop on CAPTCHA/limit/moderation/sign-in, links ask before filling, Grok site adapter with health check, desktop-link client stub. Needs a live low-volume check of the stop signals on an owner account. *(extensions plan §3)*

## Next up (suggested order)

1. [ ] **One-click dubbing wizard** — M. Translate captions (done) → speak each line (local voices or ElevenLabs) → fit to the original timing → lip-sync → mix over the original background. *(audit #1)*
2. [ ] **Your own API keys for cloud providers** — M per provider. fal.ai, Replicate, Gemini API (Veo, Nano Banana), OpenAI, xAI (Grok), Higgsfield, BytePlus (Seedance); prices shown before spending. *(cloud plan §2)*
3. [x] ~~**Automatic app updates**~~ — done 2026-10-20 (0.6.7): the Windows installer and AppImage update themselves from published GitHub releases; portable, .deb and Mac get a notice. Still open: once Windows signing is set up, signed builds will refuse unsigned updates (good); Mac auto-update needs a zip target and `latest-mac.yml`. *(audit #17)*
4. [ ] **Line up separate audio / cameras by sound** — M. *(audit #4)*
5. [ ] **AI sound effects that match the video (foley)** — M. *(audit #5)*

## AI and generation

- [ ] Prompt library inside Short Film / Director shot prompts — S *(pack shot lists, scripts and prompts in Short Film: merged 2026-10-17; **Open in…** an AI site: done)*
- [ ] **Long Shot builder** (long videos from chained shots, cost estimate up front) — M *(cloud plan §5)*
- [ ] Object removal / video inpainting — M *(audit #14)*
- [ ] Workflow grouping by goal ("product ad", "talking head", "music video shot") — S–M *(roadmap phase 3)*
- [ ] Music Video: separate the vocals once per song, not on every shot — S *(backlog)*
- [ ] Music Video: dedicated storyboard pass from each shot's reference prompt — S *(backlog)*
- [ ] Music Video: lyric-to-shot timing from the vocal track — M *(backlog)*
- [ ] Agent tool: storyboard planner (brief → prompts → results → review cut) — M *(backlog)*

## Motion Studio (AI does the edit)

Plan: `docs/PLAN_MOTION_STUDIO.md`. Built natively: the Assistant plans; plain code applies the plan to an editable timeline.

- [x] Edit plan → timeline applier (cuts, title track, voice, music + ducking, SFX, captions, transitions) on a new timeline after a checkpoint; golden tests — M *(built; switch overlays to the new text layers when the timeline layering redesign lands)*
- [x] Motion Studio workspace: Elements → Brief → Plan → Edit → Review with approval gates; recipes Talking head, Documentary montage, Music video, Social short; Quick assemble without AI — M–L *(built)*
- [x] Review checks (no shots, slideshow risk, long stills, length, music too short, no hook, captions) + Make it tighter / calmer — M *(built)*
- [ ] Review checks that need the rendered cut: dead air, loudness, black frames — M
- [ ] Storyboard view with thumbnails per scene; edit a scene's shots by hand — M
- [ ] More recipes (explainer, cinematic teaser, podcast to clips, product ad); recipes in packs — M
- [ ] MCP tools for agents (motion_start, motion_get_state, motion_approve, motion_apply_edit) — S
- [ ] **Owner decisions:** optional Motion engine add-on (separate AGPL program); first recipes; free or Pro *(plan, open decisions)*

## Browser extensions (Drama Studio Companion)

Plan: `docs/PLAN_BROWSER_EXTENSIONS.md`. Code: `extensions/companion`.

- [ ] **Owner decisions:** ~~rights to the Companion code~~ settled 2026-10-20 (the owner wrote and owns it); store publisher account and fixed extension ID; ship batch mode or not *(plan §7)*
- [x] ~~Keep or drop the old sign-in, Stripe and dashboard~~ — dropped 2026-10-17
- [x] ~~If the old account API is kept: fix the v1 downgrade and global rate-limit lockout~~ — not needed, API deleted
- [x] Merge both into one **Drama Studio Companion** (WXT + Vue), rebranded
- [x] Automator: stop the whole queue on a CAPTCHA, usage-limit, moderation or sign-in page (no retry; retries only for timeouts/network)
- [ ] Live check of the stop signals and Grok selectors on an owner-controlled account — S
- [x] Long Prompt Helper: CloudFront/WAF wording gone, asks before filling from a plain link, remote bookmarklet removed, ported to WXT with tests
- [x] Desktop link: native messaging host, pairing with your OK, Settings › Browser, prompt library **Open in…** (text hand-off, Windows) — merged 2026-10-17
- [ ] **Your browser** route (plan `docs/PLAN_AI_BROWSER_WORKSPACE.md`): ~~protocol v2 jobs + reference images + Capture import — M~~ (step 1 built 2026-10-17: jobs, reference reads, capture into AI Sites, Companion 0.2.0 with Send to Drama Studio); ~~Grok recipe steps + Capture — M~~ (built 2026-10-18: after the prompt and references, Grok's shape menu is set from the job and checked; Send to Drama Studio button on Grok results; Companion 0.5.0; **needs a live check** on the owner's signed-in Grok); ~~Generate cards + Browser jobs panel — M; Flow adapter — M~~ (built 2026-10-18: Generate › AI Sites dialog for 12 sites — Google Flow, Grok Imagine, Kling, Runway, Hailuo, Luma, Pika, ChatGPT, Gemini, Midjourney, Ideogram, Leonardo — with reference upload, Send to Drama Studio on each, Companion 0.3.0; **needs a live check per site** on the owner's signed-in Chrome); ~~Suno~~ (built 2026-10-18: simple and custom mode — style, lyrics, title, instrumental — songs back as audio, Music popover › Make it on Suno instead, Companion 0.4.2; **checked end to end 2026-10-18** on the owner's signed-in Suno: Drama Studio 0.1.30 › AI Sites › Suno › Custom filled style, multi-line lyrics and title, Create left to the owner); Short Film assisted batch — M (owner's batch decision); recipes in packs — S; Assistant/MCP tools — S
- [ ] **Capture** ("Send to Drama Studio") on Grok and Flow — M (Grok context menu built in step 1; capture button on results and Flow still to do)
- [ ] **Assisted batch** on Grok and Flow — M each
- [ ] Site adapters: Google Flow, ChatGPT images, Higgsfield, InVideo — S each
- [ ] CI job: `npm ci && npm run ci` in `extensions/companion` — S
- [x] Chrome Web Store listing: approved 19 Oct 2026, ID `inkjhigflcgkaganbiepogcpcfgndfog` (https://chromewebstore.google.com/detail/inkjhigflcgkaganbiepogcpcfgndfog); Store ID built into Drama Studio, install prompt in AI Sites and Open in…; Help Center updated
- [x] Companion version = app version (0.6.0), kept by `scripts/bump-version.cjs`, checked by `scripts/check-version-sync.cjs` in the release workflow
- [ ] Edge Add-ons listing; publish `extensions/companion/PRIVACY.md` on jepoy.dev

## Editing

- [ ] Edit by deleting words from the transcript — L *(audit #7)*
- [ ] Auto-reframe that follows the subject (today: center crop) — M *(audit #6)*
- [ ] Filler-word ("um", "uh") and silence removal (today: close pauses) — S–M *(audit #8)*
- [ ] One-click voice clean-up: noise, echo — S–M *(audit #9)*
- [ ] Stabilization — M *(audit #10)*
- [ ] Green screen (chroma key) — S *(audit #11)*
- [ ] Multicam editing — L, needs "line up by sound" *(audit #12)*
- [ ] Shot detection on imported footage — S *(audit #13)*
- [ ] Color match between shots — M *(audit #15)*
- [ ] Pacing assistant / cut on beats in the editor — M *(roadmap phase 4)*
- [ ] Rough cut from a script for footage you shot — L *(roadmap phase 5)*
- [ ] EDL / OpenTimelineIO export — S *(audit #16)*
- [ ] Timeline layering follow-ups: paste and keyboard nudges still overwrite; drop preview does not yet show the layer a clip will land on; command-palette entries for Add text / Add shape — S *(TIMELINE_LAYERING_PLAN)*

## Projects, product and release

- [ ] **Microsoft Store release, free** — 0.1.24 submitted for certification on 2026-10-17 (Store ID 9NL24VSTBRVQ, Desktop only, publish held until "Publish now"; rated Microsoft 12+ / ESRB Teen). Next: answer any certification report; replace the test-project screenshots; the public release should be a CI-built package (smooth motion). *(release plan, status)*
- [ ] **macOS and Linux releases with a one-time price** — plan in `docs/PLAN_MAC_LINUX_AND_PAYMENTS.md`: Microsoft Store only on Windows; direct sales on macOS and Linux through Stripe with signed license keys (Cloudflare Worker); 14-day trial then read-only, auto-update for direct builds, CI secrets and uploads, real-hardware pass. Paid comes later; free for now (2026-10-17). *(release plan)*
- [ ] Project templates (save as template, new from template) — M *(roadmap phase 5)*
- [ ] Project backup / sync between PCs — M–L *(audit #18)*
- [ ] Archive a project into one folder / zip — S *(audit #19)*
- [x] ~~Help Center content in Japanese — S *(audit #21)*~~ (done: merged from main, PR #2, 2026-10-20)
- [ ] **Hidden workspaces: Agent, Flow AI, MoGraph** — owner decision. They are built but switched off in the top bar. Options: MoGraph feeds Motion Studio title cards; Flow AI merges into Motion Studio or is removed; Agent stays retired (the Assistant panel replaces it). *(UX map 2026-10-19)*
- [ ] Review links with client comments — L, needs a cloud service *(audit #22)*
- [ ] Own Azure code-signing account — S, owner task. The upstream names are gone (2026-10-20); set the `AZURE_*` secrets and the `AZURE_CODE_SIGNING_ACCOUNT` / `AZURE_CERTIFICATE_PROFILE` variables (`docs/CI_SECRETS.md`) and releases sign themselves
- [ ] **Open-source release blockers** (`docs/OPEN_SOURCE_AUDIT.md`), owner tasks before the repo goes public:
  - [x] ~~Companion code rights~~ — settled 2026-10-20: the owner wrote and owns it; no outside credit needed
  - [ ] Branch protection on `main` (PR + 1 approval + Code Owners + status checks) and private vulnerability reporting, right after going public — S
  - [ ] Review internal docs before publishing (payments plan, MSIX notes, AI handoffs with local paths, `PLAN_BROWSER_EXTENSIONS.md`) — S
  - [ ] Label or make configurable the Learn AI partner link; decide CLA vs the contribution-rights checkbox — S
- [x] Merge `drama-studio-rebrand-agent-setup` into `main` and cut a tagged release — S *(done 2026-10-18: v0.1.31, GitHub draft release; Windows unsigned and macOS skipped until signing secrets exist — see `docs/CI_SECRETS.md`)*
- [ ] Dependency majors from the audit triage (`docs/OPEN_SOURCE_AUDIT.md` §7): Vite 5 → 8, Tailwind 3 → 4, icon-gen 2.1; build-time only, none ship in the app — M
- [ ] Signing secrets for GitHub releases: Azure Trusted Signing (Windows) and Apple Developer ID + notarization (macOS) — S, owner task
- [ ] **In-app feedback service** — S. Send Feedback now points to Discord (0.6.1). Deploy the feedback worker (set its endpoint in `src/services/feedback.js`) or set `SUPPORT_EMAIL` in `src/config/projectInfo.js` to turn the form back on. Owner: needs a support address or a worker.

## Bugs and checks

- [ ] Split `src/components/GenerateWorkspace.jsx` (20,500 lines) by job, like the creators in `src/components/generate/`; one flow at a time, each with a test first (audit 2026-10-21, finding 7) — L
- [ ] Model downloads ignore Comfy Desktop's shared models folder — S *(audit #20)*
- [ ] Muted clips still appear in timeline captions — listed in BACKLOG, not re-checked
- [ ] ComfyUI launcher port mismatch repair (agent tool) — S *(backlog)*
- [ ] Live checks never run: caption translation with a real model; MiniMax Music 3; sync.so lip-sync; Qwen3 TTS voices
- [ ] `test:sfx-library` failed once during a full test run and passed on three reruns: find the flaky test

## Done

- [x] Ponytail audit fixes (2026-10-21): save before close, edits during a save kept, # and % in media file names, uploads to ComfyUI from disk (no 2 GB limit), save tests, hidden Flow AI / MoGraph / Agent workspaces removed (about 7,000 lines).
- [x] Report a bug from the app (2026-10-20): top bar, welcome screen, Ctrl+Shift+P and Settings › Send Feedback open a form that fills in a GitHub issue the user submits. A fully automatic relay (no GitHub account needed) would need `infra/feedback-worker` deployed with an issues token; not done.
- [x] Help Center (F1), What's new, guided-tour step — 0.1.13
- [x] Visual polish, bundled brand fonts — 0.1.13–0.1.14
- [x] Subtitle files (SRT / WebVTT) and caption translation — 0.1.15–0.1.16
- [x] Action search (Ctrl+Shift+P), Inspector quick actions, app-menu items — 0.1.17
- [x] Start without ComfyUI (cloud only) — 0.1.18–0.1.19
- [x] AI agents follow Drama Studio's rules, answer from the Help Center — 0.1.20
- [x] Workflow-pack importer (.zip / .dspack) with safety review — 0.1.21
- [x] Prompt library (starter set, pack prompts, my prompts, blanks, Assistant tools) — 0.1.22
- [x] Assistant on your subscription: Claude Code and Codex CLIs as text-tool backends (no API key, tools off, previews kept); backend switcher in the Assistant header — 0.6.4
- [x] Idea Pad Story Board: sections × plotlines grid with drag and drop, cast row and who-is-in-it, Unsorted tray for older pads, templates as boards; the canvas stays as the Relationship map — 0.6.3
- [x] Controls redesign: timeline toolbar in Tools / Add / Edit groups with a More menu; top-bar status group, quiet Learn AI, ComfyUI as Advanced; delete asks about the file instead of a permanent switch; wider track headers with icon buttons and tooltips; Idea Pad starter templates; Discover moved into Help as Watch — 0.6.2
- [x] Findability pass: AI tools button on the selected clip; AI and Edit rows plus label colours in Inspector quick actions (also for linked video/audio pairs); Prompts in the top bar; Check my setup / guided tour on the welcome screen and in Help; Import pack in Assets; Assistant folds echoed tool output; Send Feedback no longer pretends to send — 0.6.1
- [x] Timeline layering like a modern editor: text, shapes and drops take their own layer and never cut clips; drag onto a clip makes a layer (Ctrl/Cmd overwrites); empty auto layers removed; Split cuts the selected clip only; optional magnetic main track — 0.1.26 (plan: `docs/TIMELINE_LAYERING_PLAN.md`)
