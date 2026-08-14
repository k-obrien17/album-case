# Handoff

## Current task
Curated-list cross-check finished and pushed; picking the next Pitchfork decade list to add.

## Status
Cross-check script confirmed the 3 existing curated lists (1960s, 1990s, 2000s) are clean. All pending work pushed to `origin/main` (now at `c6b4669`, matches local). No open code changes.

## Next concrete step
Decide which of the remaining 6 Pitchfork decade lists to add next (1970s, 1980s, 2010s, 2020s-so-far, 2000-04, 2010-14) and get the source text. Recommendation from last session: 1980s or 1970s, to keep the decade series contiguous. Pasting the list text directly (like the 1990s list) beat scraping, since it avoids transcription-mismatch risk.

## Open questions
- Which decade list to add next, and whether Keith has paste-source text ready.
- Whether Keith rated more Vampire Weekend albums beyond the two already found (Vampire Weekend, Modern Vampires of the City) on another device/browser. Not resolvable remotely.

## Don't forget
- Standing repo gotchas: artist locks paused (`web/src/ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, `vercel dev`'s Development env shares production Turso credentials (use an isolated scratch DB for manual write-path testing).
- Re-run `web/scripts/cross-check-curated-titles.mjs` after adding any new curated list.
- Vercel CLI was logged out at the end of this session (Keith needed the CLI free for another Vercel project) — log back in if a deploy/CLI task on this project comes up next session.

## Git state
- Branch: main
- Last commit: c6b4669 chore: update handoff
- Uncommitted changes: no (only pre-existing untracked `.playwright-mcp/`, not session work)
- Pushed to origin: yes, up to date with origin/main
- Stashed: no

## Reason for handoff
session paused, work complete and pushed

## Updated
2026-08-14T14:13:07Z
