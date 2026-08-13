# Handoff

## Current task
Verified deploy status (all pushed and live) and cleaned up a stale local secret file. No code changes this session.

## Status
Repo is fully in sync: `main` matches `origin/main`, and production (`album-case.vercel.app`) confirmed serving the latest commit (`b4e702f`, Pitchfork 1990s curated list). The prior handoff's "blocked on Keith" unlock-URL item is resolved, not by unlocking a browser, but because write-key enforcement was dropped entirely in a later session (commit `3deb22f`, see `SECURITY.md`), which made the whole lock/unlock flow moot. Also deleted the leftover `web/.env.vercel-temp` (gitignored, contained the real write key), dead weight now that enforcement is off.

## Next concrete step
Decide whether to build out the remaining 6 Pitchfork decade lists (1970s, 1980s, 2010s, 2020s-so-far, 2000-04, 2010-14) in `web/src/data/curatedLists.ts`, following the pattern of the 3 existing ones (1960s, 1990s, 2000s). Before adding any, re-run the artist+title cross-check script (compare curated entries against real ranked-artist titles, flag same-artist-different-title near-misses) against the 3 existing lists first: past sessions found real mismatches that way.

## Open questions
- Whether Keith rated more Vampire Weekend albums beyond the two already found (Vampire Weekend, Modern Vampires of the City) on some other device/browser never checked. Not resolvable from here.

## Don't forget
- Standing repo gotchas still apply: similarity-scores-skew-popular, artist locks paused (`web/src/ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, `vercel dev`'s Development env shares production Turso credentials (use an isolated scratch DB for manual write-path testing).

## Git state
- Branch: main
- Last commit: b4e702f feat: add Pitchfork's 150 Best Albums of the 1990s curated list
- Uncommitted changes: no (only pre-existing untracked `.playwright-mcp/`, not session work)
- Pushed to origin: yes, deployed to Vercel production
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-13T20:23:04Z
