# Handoff

## Current task
Deploy-gap catch-up: a separate session shipped a "want-to-listen nudge"
feature (6 commits, `eb5ced1`..`a9929ae`) after the last ship-check-mediums
handoff was written, but never ran `vercel deploy --prod --yes`. This
session found the gap on resume (bundle hash mismatch), redeployed, and
re-verified.

## Status
Deployed. `vercel deploy --prod --yes` run from `web/`; local build hash
(`assets/index-KiqEEdZB.js`) confirmed matching production via
`curl -s https://album-case.vercel.app/`. No code changes this session,
deploy-only.

Feature that's now actually live (was merged but undeployed since
2026-08-26): "Mark as heard" on saved lists (Want to listen / Haven't heard
/ Don't care) replaced with inline rating, rating directly into the ranked
list instead of re-queuing to the candidate pool. Plus a new
`web/scripts/want-to-listen-pick.mjs` for a `/today` reminder integration.
See `f63cb3b`/`3a49f0c`/`a9929ae` for details.

---

## Prior task (2026-08-26, still relevant)
Triage and close mediums from the 2026-08-25 ship-check backlog's 10-item
Medium list.

### Status
Done for a first batch of 5, committed, and deployed to production (at the
time, before the gap above opened). Triaged all 10 mediums into a table
first (fix now / defer / accept-as-is), user approved the recommended batch.

Fixed this session:
- **`ensureSchema()` empty `catch{}`** — narrowed to only swallow
  "duplicate column name" errors instead of any ALTER TABLE failure. New
  shared `alterTableAddColumnIfMissing()` helper in `web/api/_schema.ts`,
  used by `web/api/ranking.ts` and `web/api/discover-artist.ts`.
- **No progress indicator during assisted this-or-that placement** — added
  a "Step N of ~M" line above the two choice buttons in
  `web/src/ui/rankList.ts` (new `assistStep`/`assistTotal` closure state,
  reset on new candidate and in `teardown()`), styled via new
  `.assist-progress` in `style.css`. Confirmed live: ranked 8 albums to
  trigger assist mode, watched the counter advance from "Step 1 of ~4" to
  "Step 2 of ~4" after answering.
- **Tap-to-edit rank/rating weak signal** — added a dotted underline
  (was solid) plus a small pencil glyph (`\270E`) via `::after` on
  `button.rank-overall`/`button.rank-rating` in `style.css`.
- **No `:active`/`:focus-visible` states on any button** — added global
  `button:focus-visible` (accent outline) and `button:active` (scale)
  rules near the top of `style.css`, covering all 13+ separately-declared
  button classes at once rather than retrofitting each one. Confirmed live
  via keyboard Tab: accent-colored focus ring renders correctly.
- **Icon-only buttons with no text fallback** — investigated, found already
  fixed: every icon-only glyph button (×, ▶, ⚷, ⇅, mic) already has an
  `aria-label`. No code change needed for this one.

Typecheck clean, build clean, 312/312 tests passing (no new tests needed,
these were CSS/markup/error-handling fixes, not new logic branches).

Committed as `1a56e65`. Deployed via `vercel deploy --prod --yes` from
`web/`; production bundle hash (`assets/index-BGMknyir.js`) confirmed to
match the local build via `curl -s https://album-case.vercel.app/`.

Deferred (with reasoning, see full triage table in conversation transcript):
- `Album`/`RankedAlbum` types hand-duplicated client/server — real but not
  urgent, bundle with a future schema touch.
- No migrations tool, schema idempotent-inline across 3 files — report
  itself called this "functionally safe today."
- `main.ts`/`rankList.ts` god-files (25+ closure vars, over the project's
  own 300-line cap) — large refactor, needs its own plan-mode session per
  this project's conventions (3+ file refactors require plan mode), doesn't
  belong riding along with a medium-cleanup batch.
- Artist-lock system (~220 lines, zero live call sites) — accepted as-is;
  CLAUDE.md already documents this as intentionally paused, not accidental
  dead code.

## Next concrete step
Still open from the original 5 Highs (explicitly deferred across sessions,
not part of any Medium-batch work): confirm/undo on the ranked-row "×"
remove button, primary comparison card buried below nav chrome, unvirtualized
769-row ranked list. The god-file refactor (main.ts/rankList.ts) also still
needs its own plan-mode session whenever picked up.

Also worth doing next resume: re-check the bundle-hash-match step as a
matter of course, since this project has now hit the stale-production gap
twice (once documented as the original past incident, once again this
session) despite the standing rule already being written down. Consider
whether it belongs as an explicit first step in `/regression-smoke` rather
than something each session has to remember to check.

Full original report: `~/.claude/ship-check-reports/2026-08-25-1245-album-case.md`.

## Don't forget
- This project's standing check going forward is `/regression-smoke`, not a
  full `/ship-check`.
- Write-key enforcement (`ALBUM_CASE_WRITE_KEY`) stays dropped. One-function
  revert if that changes: `requireWriteKey()` in `web/api/_writeKey.ts`.
- Past incident (an earlier session): an audit subagent wrote a real test
  rating to production data without authorization; self-reported, reverted,
  independently verified clean. Scope any future audit subagents to
  read-only explicitly, and be cautious about live-testing against
  production Turso data.
- 14 commits ahead of `origin/main`, not pushed (not asked to this session --
  this repo doesn't auto-deploy from git anyway; `vercel deploy --prod --yes`
  from `web/` is the actual deploy step and WAS run this session, so
  production is current with `main` regardless of the push status).

## Files touched this session (2026-08-26, ship-check mediums batch)
- `web/api/_schema.ts` -- new exported `alterTableAddColumnIfMissing()` helper.
- `web/api/ranking.ts` -- 3-column ALTER loop now uses the shared helper.
- `web/api/discover-artist.ts` -- single-column ALTER now uses the shared helper.
- `web/src/ui/rankList.ts` -- new `assistStep`/`assistTotal` closure state;
  `buildAssisted()` renders a new `.assist-progress` element; `answerAssist()`
  increments the step counter; `teardown()` resets both.
- `web/src/style.css` -- new global `button:focus-visible`/`button:active`;
  `.assist-progress`; pencil-glyph `::after` + dotted underline on
  `button.rank-overall`/`button.rank-rating`.

## Files touched this session (2026-08-27, deploy-gap catch-up)
None. Deploy-only session: `vercel deploy --prod --yes` from `web/`, then
re-verified the bundle hash. No source edits.

## Git state
- Branch: main
- Last commit: a9929ae fix(web): restore saved-mark styling, round inline saved-list ratings
- Uncommitted changes: no
- Untracked: pre-existing scratch files from an earlier session's ship-check
  visual audit (`.playwright-mcp/`, `ac-*.png`), left alone -- not part of
  this session
- Pushed to origin: no, 15+ commits ahead of origin/main
- Deployed to production: yes, this session, bundle hash verified
  (`assets/index-KiqEEdZB.js` local == production)
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-27T15:06:55Z
