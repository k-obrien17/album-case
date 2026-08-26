# Handoff

## Current task
Triage and close mediums from the 2026-08-25 ship-check backlog's 10-item
Medium list.

## Status
Done for a first batch of 5, committed, and deployed to production. Triaged
all 10 mediums into a table first (fix now / defer / accept-as-is), user
approved the recommended batch.

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

## Files touched this session
- `web/api/_schema.ts` -- new exported `alterTableAddColumnIfMissing()` helper.
- `web/api/ranking.ts` -- 3-column ALTER loop now uses the shared helper.
- `web/api/discover-artist.ts` -- single-column ALTER now uses the shared helper.
- `web/src/ui/rankList.ts` -- new `assistStep`/`assistTotal` closure state;
  `buildAssisted()` renders a new `.assist-progress` element; `answerAssist()`
  increments the step counter; `teardown()` resets both.
- `web/src/style.css` -- new global `button:focus-visible`/`button:active`;
  `.assist-progress`; pencil-glyph `::after` + dotted underline on
  `button.rank-overall`/`button.rank-rating`.

## Git state
- Branch: main
- Last commit: 1a56e65 fix(web): close 5 mediums from ship-check backlog
- Uncommitted changes: no (this session's work is committed)
- Untracked: pre-existing scratch files from an earlier session's ship-check
  visual audit (`.playwright-mcp/`, `ac-*.png`), left alone -- not part of
  this session
- Pushed to origin: no, 14 commits ahead of origin/main
- Deployed to production: yes, this session, bundle hash verified
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-26T15:20:00Z
