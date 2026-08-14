# Handoff

## Current task
Ran the proactive artist+title cross-check across the 3 existing curated lists (1960s, 1990s, 2000s), the prerequisite the prior handoff flagged before adding any more Pitchfork decade lists.

## Status
Cross-check (`web/scripts/cross-check-curated-titles.mjs`, new) flagged 3 same-artist/similar-title candidates; all 3 reviewed and dismissed as false positives (e.g. Aphex Twin's *Selected Ambient Works Volume II* vs *85–92* — genuinely different albums, not a transcription error). The 3 existing lists are clean. No code changes beyond the new script and exporting `normalize` from `curatedListMatch.ts` for it to reuse.

## Next concrete step
Keith asked "are we clean?" and was asked in turn whether to push the 2 pending commits (`eca58b7` handoff update, `03f3dff` cross-check script) — no answer yet before this handoff. Confirm with Keith, then he runs `git push origin main` himself (footgun-guard blocks Claude from pushing to main directly, `!git push origin main` needed).

## Open questions
- Which of the remaining 6 Pitchfork decade lists (1970s, 1980s, 2010s, 2020s-so-far, 2000-04, 2010-14) to add next, if any, and how to source it. Pasting directly (like the 1990s list) worked better than scraping — no transcription-mismatch risk, and that one happened to also have a MusicBrainz curated series backing it for exact mbids.
- Whether Keith rated more Vampire Weekend albums beyond the two already found (Vampire Weekend, Modern Vampires of the City) on some other device/browser. Not resolvable remotely.

## Don't forget
- Standing repo gotchas: artist locks paused (`web/src/ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, `vercel dev`'s Development env shares production Turso credentials (use an isolated scratch DB for manual write-path testing).
- Re-run `cross-check-curated-titles.mjs` again after adding any new curated list.
- Mid-session this session, the Bash tool briefly lost all filesystem access under `~/Desktop/` (macOS TCC permission), while `/tmp` and the `Read` tool still worked. A session restart fixed it. Worth knowing if it recurs.

## Files touched this session
- web/src/curatedListMatch.ts — exported `normalize` (was private) for reuse by the new cross-check script
- web/scripts/cross-check-curated-titles.mjs — new: read-only, dice-bigram same-artist title-similarity check against the owner's ranked list

## Git state
- Branch: main
- Last commit: 03f3dff chore: add proactive title cross-check for curated lists
- Uncommitted changes: no (only pre-existing untracked `.playwright-mcp/`, not session work)
- Pushed to origin: no — 2 commits ahead of `origin/main` (`eca58b7`, `03f3dff`)
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-14T13:09:13Z
