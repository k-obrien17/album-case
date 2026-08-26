# Want to listen nudge: design

## Context

Albums land in the "Want to listen" list and then sit there indefinitely.
Keith's stated problem: he forgets the pile exists, since nothing outside
Album Case ever surfaces it. Getting him to actually listen needs two
things: (1) something outside the app that reminds him the pile exists, and
(2) once he's listened, a low-friction way to place the album that doesn't
require re-entering the general candidate flow and waiting for it to
resurface at random.

This also folds in separate feedback from the same session: the existing
"Mark as heard" button on all three saved lists (Want to listen, Haven't
heard, Don't care) just returns an album to the general candidate pool,
deferring the actual rating to some future random draw. Keith wants to rate
an album immediately, in place, once he's actually heard it.

Ruled out during brainstorming: the tenex-labs `daily-brief` skill
(`~/.claude/skills/daily-brief/`). It renders a real HTML page with a
literal clickable button, but it's never been configured for Keith (no
`PROFILE.md`, no delivery, no scheduling) and standing it up is its own
project. `/today` (`~/.claude/commands/today.md`) is Keith's actual daily
habit already; extending it is far cheaper and more likely to actually get
used. Also ruled out: a reply-driven "mark heard from chat" interaction —
unnecessary once rating moved in-app, since there's nothing left for a
chat reply to do.

## Decisions

1. **Inline rating replaces "Mark as heard," on all three saved lists.**
   Not just Want to listen — the same benefit (rate immediately instead of
   waiting for a random re-draw) applies to Haven't heard and Don't care
   too, and it's the same component either way.
2. **`addSearchedAlbum` (already in `web/src/main.ts`) is the mutation
   primitive.** It already does exactly what's needed: strip the album out
   of all three saved lists and insert it into the ranked list at the
   given rating. No new ranking-mutation logic required.
3. **The reminder is a plain, non-interactive `/today` addition.** No new
   API endpoint, no CORS, no reply parsing. `/today` prints 3 random
   picks; the user rates them later, in-app, whenever they've actually
   listened.
4. **The pick script talks to Turso directly**, matching the existing
   convention in `web/scripts/*.mjs` (e.g. `import-spotify-albums.mjs`),
   not through the deployed HTTP API.

## Part A: inline rating on saved lists

`web/src/ui/savedList.ts` — `renderSavedList`'s signature changes from
`(container, albums, onMarkHeard, onRemove)` to
`(container, albums, onRate, onRemove)`, where
`onRate: (album: Album, rating: number) => void`. Each row's "Mark as
heard" button is replaced with an inline rate form: a `0-10` number input
(step 0.01) plus a "Rate" submit button, reusing the same shape and
client-side validation as the candidate card's existing "Or rate it
directly" control (`web/src/ui/rankList.ts`'s `buildDirectRate`, styled via
`web/src/style.css`'s `.candidate-place`/`.candidate-place-input`/
`.candidate-place-button`). No mic input on this row — the candidate
card's voice-rating affordance doesn't carry over; if Keith wants it later
that's a separate small addition. Invalid input shows the same inline
"Enter 0-10" message pattern already used elsewhere in this file.

`web/src/main.ts` — new `rateFromSavedList(album, which, rating)`,
mirroring the existing `onRateSearchResult` handler almost exactly:

```ts
function rateFromSavedList(album: Album, which: ListName, rating: number): void {
  const added = addSearchedAlbum(state.ranked, lists, album, rating);
  state = { ranked: added.ranked, pending: null };
  lists = added.lists;
  persistRankingState();
  persistLists();
  reselectCandidate();
  renderNav();
  renderCurrentSavedList(which);
}
```

`renderCurrentSavedList` passes `(album, rating) => rateFromSavedList(album, which, rating)`
as the new `onRate` callback. `markAsHeard` is deleted — nothing calls it
once this lands. `which` is passed through but `addSearchedAlbum` already
strips the album from all three lists regardless of which one it started
in, so this is safe even though a row only ever lives in one list at a time.

`web/src/style.css` — no new classes expected; the row reuses
`.candidate-place`/`.candidate-place-input`/`.candidate-place-button`
as-is. If the saved-list row's flex layout doesn't accommodate the form
cleanly at narrow widths (this project's mobile-first requirement: usable
at 360px, no horizontal scroll, 44px tap targets), a small layout tweak to
`.saved-item` may be needed during implementation — not pre-specified here
since it depends on how it actually renders.

## Part B: `/today` reminder

New `web/scripts/want-to-listen-pick.mjs`, following the header-comment and
CLI conventions already used by `web/scripts/import-spotify-albums.mjs`:
connects to Turso via `@libsql/client` (run as
`node --env-file=web/.env.local web/scripts/want-to-listen-pick.mjs`),
reads the owner's `ranking_snapshots.lists_json`, picks 3 random entries
from `wantToListen`, prints them as JSON (`title`, `primary_artist_name`,
`release_year`) to stdout. Empty list or unreachable Turso → empty output,
exit 0, no error — this must never block the rest of `/today`.

`~/.claude/commands/today.md` (outside this repo — Keith's global Claude
Code config) gets one new step, after the existing 5: run the script with
an absolute path to this repo, and if it returns 3 picks, render a short
"Want to listen" block in the same style as the existing sections
(Calendar, Action Queue, etc.); if it returns nothing, omit the section
entirely rather than showing an empty one. No follow-up interaction is
specified or expected — rating happens later, in-app, via Part A.

## Testing

Part A: manual browser verification only (`npm run dev`), matching this
project's existing `web/src/ui/` convention of zero automated tests for
DOM-glue code. Verify: rating from Want to listen removes it from the list
and inserts it into the ranked list at the correct position; same for
Haven't heard and Don't care; invalid input (empty, out of range) shows the
inline error and does not mutate state.

Part B: run the script directly against real data and confirm the output
shape; no automated test, matching the other one-shot `web/scripts/*.mjs`
files (none of which have `.test.ts` companions). Manually verify the
`/today` step renders correctly with a non-empty pile and is cleanly
absent with an empty one.

## Out of scope

- Setting up the tenex-labs `daily-brief` skill.
- Any reply-driven interaction from `/today` (chat reply to mark heard,
  dismiss, etc.).
- A scheduler that runs `/today` (or just the want-to-listen step)
  without Keith invoking it — noted as a possible future ask, not part of
  this design.
- Voice/mic input on the saved-list rate form.
- Any change to the "Remove" button shipped earlier this session.
