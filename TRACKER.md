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
3. [ ] **Automatic app updates** — M. Needs our own code-signing first. *(audit #17)*
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

- [ ] **Owner decisions:** rights to ship code derived from Grok Automation 2.6.3 (Chris.dev / Paks Tools) and the Sellify helper as Drama Studio; store publisher account and fixed extension ID; ship batch mode or not *(plan §7)*
- [x] ~~Keep or drop the Paks Tools sign-in, Stripe and dashboard~~ — dropped 2026-10-17
- [x] ~~If the Paks Tools API is kept: fix the v1 downgrade and global rate-limit lockout~~ — not needed, API deleted
- [x] Merge both into one **Drama Studio Companion** (WXT + Vue), rebranded
- [x] Automator: stop the whole queue on a CAPTCHA, usage-limit, moderation or sign-in page (no retry; retries only for timeouts/network)
- [ ] Live check of the stop signals and Grok selectors on an owner-controlled account — S
- [x] Long Prompt Helper: CloudFront/WAF wording gone, asks before filling from a plain link, remote bookmarklet removed, ported to WXT with tests
- [x] Desktop link: native messaging host, pairing with your OK, Settings › Browser, prompt library **Open in…** (text hand-off, Windows) — merged 2026-10-17
- [ ] **Your browser** route (plan `docs/PLAN_AI_BROWSER_WORKSPACE.md`): protocol v2 jobs + reference images + Capture import — M; Grok recipe steps + Capture — M; Generate cards + Browser jobs panel — M; Flow adapter — M; Short Film assisted batch — M (owner's batch decision); recipes in packs — S; Assistant/MCP tools — S
- [ ] **Capture** ("Send to Drama Studio") on Grok and Flow — M
- [ ] **Assisted batch** on Grok and Flow — M each
- [ ] Site adapters: Google Flow, ChatGPT images, Higgsfield, InVideo — S each
- [ ] CI job: `npm ci && npm run ci` in `extensions/companion` — S
- [ ] Chrome Web Store and Edge listings, privacy page (draft in `extensions/companion/PRIVACY.md`), Help Center articles

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

## Projects, product and release

- [ ] **Microsoft Store release, free** — 0.1.24 submitted for certification on 2026-10-17 (Store ID 9NL24VSTBRVQ, Desktop only, publish held until "Publish now"; rated Microsoft 12+ / ESRB Teen). Next: answer any certification report; replace the test-project screenshots; the public release should be a CI-built package (smooth motion). *(release plan, status)*
- [ ] **macOS and Linux releases with a one-time price** — plan in `docs/PLAN_MAC_LINUX_AND_PAYMENTS.md`: Microsoft Store only on Windows; direct sales on macOS and Linux through Stripe with signed license keys (Cloudflare Worker); 14-day trial then read-only, auto-update for direct builds, CI secrets and uploads, real-hardware pass. Paid comes later; free for now (2026-10-17). *(release plan)*
- [ ] Project templates (save as template, new from template) — M *(roadmap phase 5)*
- [ ] Project backup / sync between PCs — M–L *(audit #18)*
- [ ] Archive a project into one folder / zip — S *(audit #19)*
- [ ] Help Center content in Japanese — S *(audit #21)*
- [ ] Review links with client comments — L, needs a cloud service *(audit #22)*
- [ ] Own Azure code-signing account (release config still names the upstream publisher's) — S, owner task
- [ ] Merge `drama-studio-rebrand-agent-setup` into `main` and cut a tagged release — S, owner decision

## Bugs and checks

- [ ] Model downloads ignore Comfy Desktop's shared models folder — S *(audit #20)*
- [ ] Muted clips still appear in timeline captions — listed in BACKLOG, not re-checked
- [ ] ComfyUI launcher port mismatch repair (agent tool) — S *(backlog)*
- [ ] Live checks never run: caption translation with a real model; MiniMax Music 3; sync.so lip-sync; Qwen3 TTS voices
- [ ] `test:sfx-library` failed once during a full test run and passed on three reruns: find the flaky test

## Done

- [x] Help Center (F1), What's new, guided-tour step — 0.1.13
- [x] Visual polish, bundled brand fonts — 0.1.13–0.1.14
- [x] Subtitle files (SRT / WebVTT) and caption translation — 0.1.15–0.1.16
- [x] Action search (Ctrl+Shift+P), Inspector quick actions, app-menu items — 0.1.17
- [x] Start without ComfyUI (cloud only) — 0.1.18–0.1.19
- [x] AI agents follow Drama Studio's rules, answer from the Help Center — 0.1.20
- [x] Workflow-pack importer (.zip / .dspack) with safety review — 0.1.21
- [x] Prompt library (starter set, pack prompts, my prompts, blanks, Assistant tools) — 0.1.22
