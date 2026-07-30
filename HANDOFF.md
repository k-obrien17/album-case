# Handoff

## Current task
Ran `/audit-claude` against this repo's CLAUDE.md, then used `/resume` to pick up the session, which surfaced repo-hygiene drift to clean up. No product code (ranking, voice rating) was touched.

## Status
CLAUDE.md audit fixes are committed: house-style em-dashes removed, `pipeline/` named as a third codebase, Schema and File structure sections added, stack versions added, two code-evidenced Don't entries added (append-then-sort tie bug, paused artist locks), SECURITY.md/HANDOFF.md added to the Reference table, and `SHIP-STANDARD.md` flagged as describing an obsolete app-with-accounts class rather than pointed to as current acceptance criteria. Separately, `/resume` found a stray `web/web/scripts/backups/` directory (16 real pre-mutation ranking snapshots from 2026-07-26, misplaced by a since-vanished script's relative-path bug when run with the wrong cwd); those were moved into the correct `web/scripts/backups/` and the empty `web/web/` tree removed. `web/scripts/export-all.mjs` (pre-existing, uncommitted) had the same latent cwd bug, fixed and committed. Working tree is clean, all committed, even with `origin/main`.

## Next concrete step
Run `/ship-standard` to regenerate `SHIP-STANDARD.md` for the personal, single-owner class (it currently still describes the app-with-accounts/Taste Test direction CLAUDE.md's Positioning section explicitly rules out).

## Open questions
- Whether the voice-rating feature (`97590a6`, local Parakeet STT sidecar, artist batch view only) should extend to the main candidate-placement flow, or stay batch-view-only by design.
- Kylie "Can't Get You Out of My Head": strict album rule says 2001 (Fever, Oct 2001); Keith may keep 2002 as a US-release judgment call. (Spotify tangent, see below.)

## Don't forget
- Spotify "Best of YYYY" playlist tangent (lives entirely outside this repo, at `~/Desktop/Claude/spotify-export/`, not a git repo, so this is the only place it's tracked): two edits still open: cut "Primitive Painters" (Felt) from the 1984 playlist (keep 1985), and the Kylie year decision above. Then re-export + `node analyze-years.mjs "exports/Best of"` for a clean pass.
- "KOB Best of 2021 Longer" is ~90% 2022 music, likely mislabeled; compare against "KOB Best of 2022 Longer" someday.
- 2021 short list still needs 2 more picks beyond Snail Mail "Valentine" and Tyler "LUMBERJACK".
- 33 followed-but-not-owned Spotify playlists can't be exported (2026 policy: contents only for owner-created playlists).
- Standing gotchas from earlier sessions still apply: similarity-scores-skew-popular, artist locks paused (`ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort (now also in CLAUDE.md's Don't list), `CONFIRM_CANON_IMPORT` danger, RESTORE-POINT backup location, `keithrobrien`'s pre-existing `te-tokens.css` edit.

## Files touched this session
- CLAUDE.md: 8 audit fixes (em-dashes, pipeline/ codebase, Schema, File structure, stack versions, 2 Don't entries, Reference rows, SHIP-STANDARD.md staleness flag)
- web/scripts/export-all.mjs: fixed OUT_DIR to resolve from script location instead of `process.cwd()`; committed for the first time

## Git state
- Branch: main
- Last commit: cacc946 feat(scripts): add export-all.mjs, full owner-data export over Turso
- Uncommitted changes: no
- Stashed: no
- Even with `origin/main`.

## Reason for handoff
session paused

## Updated
2026-07-30T17:00:41Z
