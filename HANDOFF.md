# Handoff

## Current task
Build a "novel way to get Keith to listen to Want to listen albums" (his
framing). Brainstormed to a two-part design: inline rating on saved lists
(so listening leads straight to a ranked placement) plus a plain reminder
in his `/today` command. Executed via Subagent-Driven Development.

## Status
Done, reviewed, and deployed to production.

**Part A -- inline rating replaces "Mark as heard" (all three saved lists):**
`web/src/ui/savedList.ts` rows now show a `0-10` rate form (reusing the
candidate card's `buildDirectRate` pattern) instead of "Mark as heard".
Rating calls the existing `addSearchedAlbum` (no new mutation logic),
placing the album straight into the ranked list. "Remove" (shipped
earlier this session) is unchanged.

**Part B -- `/today` reminder:** new `web/scripts/want-to-listen-pick.mjs`
(Turso-direct, matches the `web/scripts/*.mjs` convention) prints 3 random
Want to listen picks as JSON. `~/.claude/commands/today.md` (a separate
git repo from album-case) got a new step 6 that runs it and renders a
plain, non-interactive "Want to listen" section -- omitted entirely when
the pile is empty. No reply-to-act interaction; rating always happens
later, in-app, via Part A.

Design doc: `docs/superpowers/specs/2026-08-26-want-to-listen-nudge-design.md`
Plan: `docs/superpowers/plans/2026-08-26-want-to-listen-nudge.md`

**Execution:** subagent-driven-development, continuing directly on `main`
(Keith's explicit choice -- matches how this whole session ran). 3 tasks,
each with a fresh implementer + independent task reviewer, then one
whole-branch final review on the most capable model.

**Notable finding during execution:** Task 1's manual-verification step
(a 360px mobile viewport check) took 4 fix rounds to genuinely verify --
the first 3 rounds' "browser observations" turned out to be CSS source
values restated as if measured, and one implementer's claimed
`mcp__claude-in-chrome__resize_window` call was independently reproduced by
a re-reviewer and proven to silently no-op in this environment (doesn't
actually shrink Keith's real desktop Chrome window). Round 4 switched to
Playwright's independent browser instance, which genuinely resizes, and a
second reviewer independently reproduced the same numbers. Worth
remembering for any future browser-verification task in this environment:
prefer Playwright MCP tools over `mcp__claude-in-chrome__resize_window`
for viewport-size-dependent checks.

**Final whole-branch review caught 1 Critical + 2 Important, all three
traced to the PLAN TEXT itself, not implementer drift** (all task-scoped
reviews had passed because the implementers faithfully transcribed a
flawed plan):
1. (Critical) The plan's literal `--env-file=~/...` command in `today.md`
   never tilde-expands inside a `--flag=value` shell word (verified
   empirically in zsh/bash) -- the whole `/today` half of this feature was
   inert until fixed. Now uses `$HOME`.
2. (Important) The plan asserted `.saved-mark` CSS was "dead, nothing
   renders it" -- false. Two unrelated buttons (Blocked-artists "Restore",
   skipped-curated "Unskip") still used that class and lost their 44px tap
   target when the CSS was deleted. Now grouped with `.saved-remove`'s
   identical rule.
3. (Important) The plan's Task 1 code omitted the 2-decimal rounding every
   other rating entry point applies (`buildDirectRate` et al). Now rounds.

All three fixed in one follow-up commit per repo, independently
re-reviewed (including an independent re-run of the literal shell command
for finding 1), verified clean.

Typecheck clean, build clean, 312/312 tests passing throughout (no new
tests -- matches this project's existing zero-test convention for
`web/src/ui/*` and `web/scripts/*.mjs`).

Deployed via `vercel deploy --prod --yes` from `web/`; production bundle
hash (`assets/index-KiqEEdZB.js`) confirmed to match the local build via
`curl -s https://album-case.vercel.app/`. Note: the Vercel CLI session had
lost auth mid-deploy attempt (`vercel whoami` -> "Not authorized") -- Keith
re-ran `vercel login resume` himself to fix it before the deploy succeeded.
A peer session running concurrently on this same repo also independently
ran a deploy around the same time after noticing the same undeployed
commits on its own resume -- both deploys are harmless/idempotent (same
source, same resulting bundle hash), no conflict, nothing to reconcile.

## Next concrete step
Nothing queued from this feature. Still open from prior sessions (see
`~/.claude/ship-check-reports/2026-08-25-1245-album-case.md`): confirm/undo
on the ranked-row "×" remove button, primary comparison card buried below
nav chrome, unvirtualized 769-row ranked list, and the `main.ts`/`rankList.ts`
god-file refactor (needs its own plan-mode session).

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
- Prefer Playwright MCP tools over `mcp__claude-in-chrome__resize_window`
  for any future viewport-size-dependent browser check in this
  environment -- see the 4-round finding above.
- Multiple interactive sessions have been active on this repo concurrently
  (this session plus at least one peer). Both worked directly on `main` in
  the same checkout -- fine for this personal single-owner project so far,
  but re-read HANDOFF.md fresh before writing to it (it changed mid-session
  here) and expect git state to occasionally have moved since you last
  checked.
- 22 commits ahead of `origin/main`, not pushed (explicitly declined this
  session -- matches the pattern throughout this project's history; no
  auto-deploy from git regardless, and production IS current via the
  explicit `vercel deploy --prod --yes` step above).
- `~/.claude` (a separate repo from album-case) also has 1 unpushed commit
  on `main` from this session (`2dc695e`) -- it has no remote configured at
  all, so "push" doesn't apply there; it's genuinely local-only.
- The tenex-labs `daily-brief` skill (`~/.claude/skills/daily-brief/`) was
  explicitly considered and ruled out for this feature -- never configured
  for Keith (no `PROFILE.md`/delivery/scheduling), standing it up is its
  own separate project, not something to fold into future Album Case work
  without Keith explicitly asking for it.

## Files touched this session
- `web/src/ui/savedList.ts` -- `renderSavedList`'s second callback changed
  from `onMarkHeard: (album) => void` to `onRate: (album, rating) => void`;
  renders an inline rate form (reusing `candidate-place*` CSS) instead of
  "Mark as heard"; rating rounds to 2dp before calling `onRate`.
- `web/src/main.ts` -- new `rateFromSavedList` (calls `addSearchedAlbum`,
  mirrors `onRateSearchResult`); `markAsHeard` deleted; stale comment
  reference fixed.
- `web/src/style.css` -- `.saved-item` gained `flex-wrap: wrap`; new
  `.saved-actions`/`.saved-rate-status`; `.saved-mark` grouped with
  `.saved-remove` (both needed -- see finding 2 above).
- `web/scripts/want-to-listen-pick.mjs` -- new, Turso-direct, prints 3
  random Want to listen picks as JSON, always exits 0.
- `~/.claude/commands/today.md` (separate repo) -- new step 6, new "Want
  to listen" output section, `$HOME`-based path (not `~`, see finding 1
  above).
- `docs/superpowers/specs/2026-08-26-want-to-listen-nudge-design.md`,
  `docs/superpowers/plans/2026-08-26-want-to-listen-nudge.md` -- new.

## Git state
- Branch: main (both repos -- no feature branch, per Keith's explicit
  choice to continue directly on main for this session)
- Last commit (album-case): `a9929ae` fix(web): restore saved-mark
  styling, round inline saved-list ratings
- Last commit (~/.claude): `2dc695e` fix(today): fix broken tilde
  expansion in want-to-listen command
- Uncommitted changes: no (both repos clean except pre-existing untracked
  scratch files)
- Untracked (album-case): pre-existing scratch files from an earlier
  session's ship-check visual audit (`.playwright-mcp/`, `ac-*.png`), left
  alone -- not part of this session
- Pushed to origin: no (album-case, 22 ahead, declined this session);
  ~/.claude has no remote at all
- Deployed to production: yes, this session, bundle hash verified
  (`assets/index-KiqEEdZB.js` local == production)
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-27T15:10:00Z
