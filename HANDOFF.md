# Handoff

## Current task
Brainstorming a new feature: rank one artist's albums against each other in an isolated view, then lock that relative order as a hard constraint the global ranked list must respect from then on. Using the `superpowers:brainstorming` skill — currently at the design-review step, not yet approved, no code written.

## Status
The write-key saga from the prior session is fully resolved and closed out (key rotated, all pending edits saved and verified live server-side — no follow-up needed there, don't reopen it).

This session pivoted straight into a new feature request. Five clarifying questions were asked and answered (see "Proposed design" below), a full design was presented to Keith in chat, and he ran `/handoff` before responding to "does this match what you had in mind?" So: **design proposed, not yet approved.** Per the brainstorming skill, nothing gets implemented until Keith approves it and it's written to a spec doc.

## Next concrete step
Re-present the "Proposed design" section below to Keith (or just ask if it still matches) and get explicit approval or corrections. Once approved, follow the brainstorming skill's remaining steps: write the design to `docs/superpowers/specs/YYYY-MM-DD-artist-lock-design.md`, self-review it, have Keith review the written spec, then invoke `writing-plans` — do NOT skip straight to implementation.

## Proposed design (awaiting approval)
Answers already collected from Keith:
- **Album scope in a batch session:** ALL of the artist's albums, including ones not yet in the global ranked list (pulled from Want to Listen / Haven't Heard / undiscovered).
- **Placing not-yet-ranked albums:** reuse the existing "#/Place" rank-number input already in the candidate panel — no new insertion wizard, no waiting for the normal candidate loop.
- **Artist-internal sub-ranking mechanic:** drag-to-place, scoped to just that artist's albums (same mechanic as the main list, just filtered).
- **Entry point:** a new icon on each ranked row, next to the existing ▶ (discover) and ⇅ (reorder) icons.
- **Enforcement UX:** block live during the drag — invalid drop zones are simply unavailable, no error-after-the-fact.
- **Editability:** Unlock → re-batch → re-lock only. No live editing of a locked order in place.

My proposed technical design (presented, not yet confirmed):
1. **Lock scope (my judgment call, flag if wrong):** a lock only covers the artist's albums that are in the global ranked list *at the moment Lock is pressed*. Albums still unplaced are unconstrained until placed and the artist is re-locked. Keeps the model to "the order these specific albums currently sit in," not a prediction about albums that don't exist in the list yet.
2. **Data model:** new `artistLocks` field (artist MBID → ordered album MBID list) added to the same ranking snapshot as `ranked`/`lists` — reuses the exact save/retry/conflict machinery built this session, no new sync path. One new DB column (`artist_locks_json`), added via the same idempotent `ALTER TABLE` pattern `discover-artist.ts` already uses for `primary_artist_mbid`.
3. **Enforcement:** one pure function checks whether a given global order respects every lock. Used two ways: live during drag (disable invalid drop zones), and on submit for the rank-number input (reject out-of-range numbers with an inline message).
4. **UI flow:** new row icon opens a scoped view for that artist — already-ranked albums are draggable among themselves (this *is* the real global list, filtered, so dragging here live-updates real positions); not-yet-ranked albums each get the "#/Place" control to slot into the global list. "Lock in order" freezes the current relative order; "Unlock" (once locked) removes the constraint.

## Open questions
- Does the proposed design (above) match what Keith actually wants? He hadn't responded when the session paused.
- Specifically confirm/correct the "lock scope" judgment call in point 1 — it's the one place I made a decision rather than asking directly.

## Don't forget
- `ALLOW_PUBLIC_WRITES` still exists as a Vercel env var (Preview + Production) — a leftover from the old fork's boolean write-kill-switch, deliberately never ported into code. Still unused; dead config, low-priority cleanup.
- Vercel MCP tools (`list_deployments`, `get_runtime_errors`, etc.) return 403 for this project's scope — the CLI (`vercel` command) works fine and is what actually got used all last session.
- `web/.env.local` has a local-only dev `ALBUM_CASE_WRITE_KEY` (gitignored placeholder for `vercel dev` testing, not a real secret) — separate from the real rotated production key, which lives only in Vercel now.

## Git state
- Branch: `main`.
- Last commit: `73ff6b9 chore: update handoff (session paused)`.
- Uncommitted changes: no (working tree clean).
- Stashed: no.
- Ahead of `origin/main`: no.

## Reason for handoff
Session paused.

## Updated
2026-07-08T00:17:55Z
