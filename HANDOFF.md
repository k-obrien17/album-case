# Handoff

## Current task
Fixed a stale-production-deploy bug (1990s curated list missing on the live site); picking the next Pitchfork decade list to add is still the open work item.

## Status
Root cause: this project deploys via manual `vercel deploy --prod --yes` (`README.md:68`), not git-integration auto-deploy. Commit `b4e702f` (added the 1990s list) landed on GitHub but nobody redeployed afterward, so production kept serving a pre-1990s-list bundle. Confirmed by diffing the live JS bundle before/after. Fixed by running the manual deploy from `web/`; verified the new bundle (`index-l5ak1Axf.js`) contains the 1990s list and the Curated Lists tab on `https://album-case.vercel.app` now shows all 3 lists. No repo changes were needed, this was deploy-only.

## Next concrete step
Decide which of the remaining 6 Pitchfork decade lists to add next (1970s, 1980s, 2010s, 2020s-so-far, 2000-04, 2010-14) and get the source text. Recommendation carried over: 1980s or 1970s, to keep the decade series contiguous. Pasting the list text directly (like the 1990s list) beat scraping, since it avoids transcription-mismatch risk. **After adding it, redeploy manually** (`cd web && vercel deploy --prod --yes`) since this project has no auto-deploy, that's exactly what caused this session's bug.

## Open questions
- Which decade list to add next, and whether Keith has paste-source text ready.
- Whether Keith rated more Vampire Weekend albums beyond the two already found (Vampire Weekend, Modern Vampires of the City) on another device/browser. Not resolvable remotely.

## Don't forget
- **No auto-deploy on this project.** Every commit that should reach production needs a manual `vercel deploy --prod --yes` from `web/` afterward. Check `curl -s https://album-case.vercel.app/ | grep -o 'assets/index-[^"]*\.js'` against the local build hash if in doubt.
- Standing repo gotchas: artist locks paused (`web/src/ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, `vercel dev`'s Development env shares production Turso credentials (use an isolated scratch DB for manual write-path testing).
- Re-run `web/scripts/cross-check-curated-titles.mjs` after adding any new curated list.
- Vercel CLI is currently logged into `keith-obriens-projects` (album-case's account), re-logged-in mid-session to run the fix deploy. Keith will need to switch it back for his other Vercel project.

## Git state
- Branch: main
- Last commit: 13c6f4c chore: update handoff
- Uncommitted changes: no (only pre-existing untracked `.playwright-mcp/`, not session work)
- Pushed to origin: yes, up to date with origin/main
- Stashed: no

## Reason for handoff
session paused, deploy bug found and fixed

## Updated
2026-08-16T20:20:06Z
