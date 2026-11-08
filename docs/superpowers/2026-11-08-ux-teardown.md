# UX Teardown: Album Case (production, 2026-11-08)

## Verdict

The app's dominant strength is honest, well-labeled interaction: every row editor has a real aria-label, focus outlines are visible, removals have undo, nothing overflows at 360px, and the new browse chips finally give the 826-album list a shape. The dominant failure is that the ranked list is still one monolithic 100,000-pixel page: the chrome you need (search, browse chips) scrolls away immediately, a sticky "Which do you prefer?" placement panel you may not have asked for rides along on 23% of the phone screen, and the new slice discovery strip sits five screens below the fold where nobody will meet it. The highest-leverage change is a persistent compact header on the ranked view (search + chips + a collapsed one-line candidate pill) plus a "3 unranked picks" jump link at the top of each slice.

## Evidence and limitations

- Surfaces inspected: landing (Find albums: Artist gaps, Suggest one), My list (flat ranked list, placement panel), Browse (Year, Genre), slice view (1994, art rock), Want to listen, More menu. All on production.
- Viewports: 360x740 and 1280x800, real Playwright viewports.
- Not inspected: Voice speed round, Curated lists, Blocked artists, Export backup, search-result flows, artist batch view interactions, dark mode (none exists), real touch gestures (drag-to-place), screen-reader output. Contrast figures computed from sampled colors, not a full audit.

## Priority findings

### High: The ranked list loses its own chrome after one scroll
- Evidence: Observed and code-supported
- Surface: My list, List mode
- User impact: The page is 100,232px tall at 360w (826 rows, all in the DOM). Search and the browse chips are not sticky, so the core correction loop (find an album, fix its rating) requires scrolling back to the top from wherever you are. This is the golden workflow and it has no shortcut.
- Root cause: One static render of the whole list with no persistent header; nothing is virtualized.
- Recommendation: Make a compact sticky header on the ranked view: search field + the List/Artist/Year/Decade/Genre chips. Virtualization is optional after that; sticky search removes most of the pain because search filters the list in place.
- Verification: At 360w, scrolled to row 400, search is one tap away; typing filters without scrolling.

### High: The placement panel stalks the whole list on mobile
- Evidence: Observed
- Surface: My list, List mode, sticky `.candidate-col`
- User impact: A pairwise "Which do you prefer? Step 1 of ~10" card for a queued candidate is pinned to the top of the viewport and consumes about 23% of the screen for the entire scroll, even when the visit is browse-only. It also competes with finding 1: together the panel and the lost chrome mean the top of a phone screen is spent on the wrong tool.
- Root cause: The placement affordance is always expanded whenever any candidate exists, and it is the only sticky element.
- Recommendation: Collapse it to a one-line pill ("1 album waiting to place: LONG.LIVE.A$AP") that expands on tap. Sticky is right; expanded-by-default is not.
- Verification: With a queued candidate, the ranked list occupies >90% of the viewport until the pill is tapped.

### High: Slice discovery is invisible
- Evidence: Observed
- Surface: Slice views (measured on 1994: strip begins at 4,110px of a 5,697px page; art rock would be worse at 52 rows)
- User impact: The feature's core promise, "browse a slice, rate what you've missed," is buried below every ranked row. A phone user who opens 1994 never learns the strip exists.
- Root cause: Strip is appended after the full ranked column in `sliceView`.
- Recommendation: A "3 unranked picks for 1994 ↓" link next to the slice heading that scrolls to the strip (or render the strip first when the slice has 15+ rows). Matches the Codex review's finding; this is the first code change worth making.
- Verification: Open any large slice at 360w; the path to the candidates is visible without scrolling.

### Medium: Year and Decade browse are in no legible order
- Evidence: Observed
- Surface: Browse, Year (2001, 1997, 1994, 1976, 2009, 1995, 1966, 2000, 1998, 1979...) and Decade
- User impact: Years are the one dimension with a universally expected order. Best-album ordering is a clever ranking signal but reads as random, and nothing on screen explains it, so the view feels broken rather than smart.
- Root cause: Deliberate insertion-order-by-best-album design choice, unlabeled.
- Recommendation: Either sort Year/Decade chronologically (keep best-album order for Artist, where it reads naturally), or keep the order and caption it: "Ordered by your highest-ranked album." Chronological is the safer default.
- Verification: A first-time viewer can say out loud what the order is.

### Medium: Muted text misses AA contrast
- Evidence: Observed, computed from sampled colors
- Surface: Ranked rows everywhere; likely all muted text sharing the token
- User impact: Rank numbers rgb(130,128,110) on white are about 4.0:1 at 14px; row metadata rgb(122,120,110) is about 4.4:1 at 12.8px. Both are below the 4.5:1 AA threshold for small text. On a phone outdoors this is the difference between scannable and not.
- Root cause: One muted-ink token sitting just on the wrong side of the line.
- Recommendation: Darken the muted token to roughly #65635A (about 5.3:1) in `te-bridge.css` (not `te-tokens.css`, which is generated). One token, whole app.
- Verification: Recompute the two sampled pairs at or above 4.5:1.

### Medium: Desktop wastes the canvas
- Evidence: Observed
- Surface: Want to listen and ranked list at 1280w
- User impact: Content hugs a single narrow left-ish column; at 1280px, more than half the screen is empty. Not harmful, just undercooked, and Want to listen's single column makes 56 saved albums into a long tunnel.
- Root cause: Mobile-first styles with no wide-breakpoint layout.
- Recommendation: Center a max-width column for the ranked list; let Want to listen cards form a 2-3 column grid above 900px.
- Verification: At 1280w, no more than 25% of the viewport is empty margin on the list views.

### Medium: Want to listen is a flat, unordered pile
- Evidence: Observed
- Surface: Want to listen (56 items)
- User impact: No sort, filter, or priority. Choosing tonight's listen means scanning 56 cards; the queue gets less useful as it succeeds.
- Root cause: The shelf predates the browse work and never got organizing tools.
- Recommendation: Newest-first by default plus the genre/decade chips you already built, reused as filters. A "pick one for me" button would fit the app's suggestion muscle.
- Verification: Finding a jazz album saved last month takes two taps, not a scan.

### Low: Ranked rows say the same rank twice
- Evidence: Observed
- Surface: Every ranked row ("1" index plus "Overall 1/826", plus Band 1/14, Year 1/24, rating)
- User impact: Five numeric facts per row slows scanning; the left index and "Overall n/826" are the same fact styled twice.
- Recommendation: Keep the index; move "Overall n/826" into the editor that opens on tap. Row becomes title, artist-year, rating, actions.

### Low: First-run lands on discovery, not the list
- Evidence: Observed; impact is Hypothesis
- Surface: Landing defaults to "Find albums I've missed"
- User impact: Fine for you; a first-time friend with zero ranked albums would land on a scan of artists they haven't rated. Worth revisiting when accounts ship, not before.

### Low: Polish items
- Evidence: Observed
- favicon.ico 404s on every load (console noise, generic tab icon).
- One unlabeled 20x20 control near search (the icon decoration); confirm it is aria-hidden.
- "More +" is a junk drawer (Blocked artists, Voice speed round, Curated lists, Fill in more albums, Export backup). Acceptable for a personal app; documented exception.

## Synthesis: three root causes, not ten problems

1. **The ranked list is one monolithic surface.** No persistent chrome, no collapsed states, placement panel bolted on top. Produces the two High navigation findings and the row-density issue.
2. **The new browse layer shipped without wayfinding.** The strip is buried and the year order is unexplained. Two findings, one cause: the features work but don't announce themselves.
3. **Token-level polish debt.** Contrast, desktop width, favicon. Small, mechanical, all fixable in the bridge stylesheet.

## Redesign direction

Keep the existing visual language (mono-ish type, hairline bordered cards, warm paper background, orange accent). It is distinctive and consistent; nothing here argues for a reskin. The changes are structural: a sticky compact header on the ranked view, a collapsed candidate pill, a strip jump link, chronological years, one darker ink token, and a desktop max-width. No new components; every change reuses existing patterns.

## Implementation sequence

1. Sticky ranked-view header (search + chips) and collapse the candidate panel to a pill. One slice; biggest workflow win.
2. "N unranked picks" jump link in slice headers.
3. Year/Decade chronological ordering (pure change in `groups.ts` ordering, plus a test swap).
4. Muted ink token darkened in `te-bridge.css`.
5. Desktop max-width and Want to listen grid.
6. Want to listen sort + reuse of filter chips.

Items 1-4 are each an afternoon or less; 5-6 are small but benefit from a design pass.

## Success criteria

- [ ] At 360w, from any scroll depth in the ranked list, search is reachable in one tap
- [ ] With a queued candidate, the collapsed pill takes one line until tapped
- [ ] Opening a 30+ album slice shows a visible route to its unranked picks without scrolling
- [ ] A new viewer can state the Year view's ordering unprompted
- [ ] Sampled muted text pairs compute at 4.5:1 or better
- [ ] At 1280w, list views use at least 75% of the viewport width productively
