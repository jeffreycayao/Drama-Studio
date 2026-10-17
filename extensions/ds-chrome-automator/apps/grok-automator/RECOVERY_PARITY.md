# Grok Automator™ recovery parity

This document maps the signed `2.6.3` extension behavior and the supplied UI
screenshots to the maintainable WXT/Vue source. The signed distribution is used
only as read-only evidence; compiled and decompiler output must never become an
active dependency or enter this repository.

## Side-panel feature map

| Area            | Recovered behavior                                                                                        | Maintainable source                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Header          | Product identity, version, guide/community actions and locale selector                                    | `src/sidepanel/components/AppHeader.vue`                                 |
| Plan            | Connected Google account, exact session-resolved plan, sign-in action and local daily prompt history      | `PlanBanner.vue`, `auth.ts`, `storage.ts`                                |
| Modes           | Text to Video, Frame to Video, Ingredients to Video, Text to Image and Image to Image                     | `ModeSelector.vue`, `prompt-builder.ts`                                  |
| Prompt input    | Blank-line prompt parsing plus TXT, CSV, XLS and XLSX import                                              | `PromptInput.vue`, `SpreadsheetImportModal.vue`, `spreadsheet-import.ts` |
| Uploaded images | Multi-file input, drag/drop, reorder, sort, remove and filename-based character matching                  | `UploadedImages.vue`, `files.ts`, `prompt-builder.ts`                    |
| Prompt options  | Per-prompt duration/image-chain mode, assigned-image preview and validation                               | `PromptOptions.vue`, `prompt-builder.ts`                                 |
| Batch controls  | Concurrency, random delay, output count, folder, automatic filename, prompt range and clear/run actions   | `PromptComposer.vue`, `settings.ts`                                      |
| Queue           | Group/prompt status, delay, retries, progress, cancellation and terminal cleanup                          | `QueuePanel.vue`, `runtime-state.ts`, `src/content/queue.ts`             |
| Settings        | Default mode/model/aspect/sequence, retries, download quality, language, download location and reset/save | `SettingsPanel.vue`, `settings.ts`, `storage.ts`                         |
| Debug           | Capped action log, auto-scroll, copy and clear                                                            | `DebugPanel.vue`, `runtime-state.ts`                                     |
| Modals          | First-use guidance, update handling, spreadsheet preview and local diagnostic report                      | `src/sidepanel/components/*Modal.vue`                                    |

The inherited publisher, store identity, pricing, email-token login and external
support routes are intentionally not restored. The owner-controlled platform is
the only account surface. Its Google-only PKCE connection is implemented and
passed a registered-extension production exchange; Stripe fulfillment, paid
entitlement lifecycle, and purchase recovery remain separate incomplete work.

## Automation flow

1. The panel parses and validates prompts, range, per-prompt options and image
   assignments before it sends anything to a page.
2. Images are prepared in bounded chunks and referenced by validated IDs.
3. The active HTTPS Grok tab immediately acknowledges a queued group. The group
   is tagged with that tab ID so cancellation cannot be redirected by switching
   tabs.
4. The content queue applies random delay, retry and concat dependencies. One
   DOM submission runs at a time while configured concurrency controls the
   number of outstanding result/download jobs.
5. Each submission records the pre-existing result articles, waits for a new
   article, assigns a local correlation token and downloads only from that
   correlated result.
6. Required uploads, generation buttons, upscale actions and downloads fail
   closed. A group is complete only after all requested results and downloads
   succeed; otherwise it becomes an error group with retry/error detail.
7. `PROMPT_GROUP_STATUS`, progress and action-log messages are the authoritative
   panel update channels. A session snapshot restores visible queue/debug state
   after the side panel closes and reopens.

## Mode and image-assignment rules

| Mode                 | Input assignment                                         | Generation sequence                                                                                                           |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Text to Video        | No uploaded image required                               | Per-prompt 6/10/15-second option; optional chain to the next selected prompt                                                  |
| Frame to Video       | Images are consumed sequentially without wrapping        | A chained successor receives the previous frame dependency and only the additional image count required by the recovered rule |
| Ingredients to Video | Images cycle or match filenames mentioned in each prompt | Chained successors use the previous generated frame and do not duplicate component uploads                                    |
| Text to Image        | No uploaded image required                               | New-image or edit-previous-image sequence; final selected prompt is forced to a non-chain option                              |
| Image to Image       | Images cycle or match filenames mentioned in each prompt | Chained successors use the previous result without a duplicate source-image upload                                            |

Prompt range selection is applied before concat dependencies and image
assignments are planned. The original one-based prompt numbers are retained in
status messages, filenames and the queue.

## Verification boundary

Automated acceptance covers strict TypeScript, schemas, assignments, imports,
queue/retry/cancellation helpers, result correlation, download failure
propagation, release scans, deterministic ZIP comparison and a disposable
Chromium side-panel smoke test.

The following remain owner-run live checks because they require an authorized
Grok account and may consume quota:

- one low-volume run for each of the five modes;
- one concat run for video and image generation;
- 480p/720p/1080p and image-download behavior allowed by the account plan;
- selector currency after Grok UI changes; and
- signed-in Free, individual-license, All Apps, revocation, and purchase-recovery
  journeys after the corresponding server entitlements are available.

Do not claim these live checks passed until they have been performed on an
owner-controlled account.
