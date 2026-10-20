## Summary

<!-- Describe the user-facing problem first, then the change. Link the issue: "Fixes #123". -->

## How it was tested

<!-- Commands you ran and what you checked by hand. -->

- [ ] I ran the tests for the areas I changed (list them below)
- [ ] `DS_SKIP_VERSION_BUMP=1 npm run build` succeeds
- [ ] I tried the change in the running app (`npm run electron:dev`), or it cannot be seen there
- [ ] Companion changes: `npm run check` passes in `extensions/companion`
- [ ] I added a note under `## [Unreleased]` in `CHANGELOG.md` if users will notice the change
- [ ] I updated docs if behaviour, setup or onboarding changed

Tests run:

## AI assistance

<!-- Required. Pick one and fill in the details. -->

- [ ] No AI tools wrote or changed code, tests or docs in this pull request.
- [ ] AI tools helped. Tool(s) used and which parts they wrote:

## Contribution rights

- [ ] I have the right to submit this work under the project's license (GPL-3.0-only). It contains no code copied from closed-source products, other extensions or sites, and any third-party code keeps its license notice.

## Notes for reviewers

<!-- Known limitations, risky areas, follow-up work. -->

---

<!-- Maintainers: fill in before merging. Every pull request needs a human maintainer's approval. -->

### Maintainer review

- [ ] Logic/correctness review done (does what it says, edge cases, no regressions, tests cover the change)
- [ ] Security review done (no secrets; input validated; no new remote code or endpoints; IPC/preload/MCP stay narrow; paths stay inside allowed folders)
- [ ] CI is green
