# Handoff

## Current task
Ran `/audit-claude` against the project's CLAUDE.md and applied all 7 proposed edits. No product code changed this session.

## Status
CLAUDE.md now documents the no-auto-deploy footgun and its fix command directly (previously only re-explained in HANDOFF.md every session), documents that `te-tokens.css` is generated and must not be hand-edited, adds `web/scripts/` to the file structure table, fixes a stale `discovered_albums` schema description, drops a Conventions line that contradicted the now-settled stack, and fixes 2 em-dashes. Committed as `3d9dcfb`. The Pitchfork 1980s decade-list task (carried over from the prior session) was raised again but Keith chose to skip it for now, no source text provided, nothing added.

## Next concrete step
When Keith is ready to resume the decade-list work: ask whether he'll paste the Pitchfork "200 Best Albums of the 1980s" (or 1970s) source text directly, or wants it fetched via web search/fetch (flagged risk: a 200-item scraped list needs a spot-check afterward since nothing auto-verifies transcription accuracy against the real source, per `cross-check-curated-titles.mjs`'s header).

## Open questions
- Which decade list to add next (1970s vs 1980s recommended to keep the series contiguous), and whether Keith has paste-source text ready.
- Whether to re-run `import-spotify-albums.mjs` later against a fresher Spotify export, or treat the current 78-album import as a one-time seed.

## Don't forget
- No-auto-deploy is now documented directly in CLAUDE.md's Commands and Don't sections, no need to keep re-explaining it here.
- Vercel CLI is logged in as `k-obrien17` (re-authed two sessions ago). Keith may need to switch it back for his other Vercel project.
- Standing repo gotchas: artist locks paused (`web/src/ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, `vercel dev`'s Development env shares production Turso credentials.

## Files touched this session
- CLAUDE.md -- 7 audit edits: deploy footgun, generated-file footgun, file structure row, schema description fix, stale Conventions line removed, 2 em-dashes fixed

## Git state
- Branch: main
- Last commit: 3d9dcfb docs: tighten CLAUDE.md per /audit-claude
- Uncommitted changes: no (only pre-existing untracked `.playwright-mcp/`, not session work)
- Pushed to origin: no, 6 commits ahead of origin/main
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-24T18:19:04Z
