# Phase 2: This-or-That Ranking MVP - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Source:** Direct decision (Keith) + PROJECT.md

<domain>
## Phase Boundary

An anonymous, zero-setup, phone-first this-or-that loop: show two albums, pick one, build a transitive self-consistent personal ranked list by binary insertion, drive the next pair from that insertion, and persist every pick as a pairwise atom. Covers RANK-01..05 and PLAY-01..04. This is the first player-facing surface.
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Architecture: Hybrid (client loop + durable atoms) — Keith's decision 2026-07-04
The "play fast on the phone, mail every pick to the central notebook" model.
- **Client runs the loop.** The pick UI, the binary-insertion placement, and the personal ranked list all run in the browser for instant, phone-first, offline-tolerant play. The personal list and the anonymous session persist in `localStorage` (survives refresh, zero setup, no account).
- **Every pick is ALSO mailed home.** Each pick POSTs a pairwise atom to a thin backend endpoint that writes it into the central store, so picks are durably in Keith's database from day one (satisfies "everything I reference ends up in my database" and the data-first goal). A failed POST must NOT break the loop — buffer locally and retry; the player never waits on the network to pick.
- **Rejected:** client-only (atoms stranded in the browser, central notebook stays empty) and full-backend-now (Turso-hosts-everything + full-universe migration — too heavy for the MVP).

### Central atom store
- Atoms land in a hosted libSQL store (Turso) using the SAME schema Phase 1 already defined in `pipeline/schema.sql` (the generic `atoms` table: `entity_a, entity_b, winner, mechanism, session_id, created_at`; `mechanism = 'this_or_that'`; anonymous `session_id`). Do not invent a new atom shape.
- The backend "mailbox" is a thin serverless endpoint (Vercel function in Keith's stack) whose only job is: validate a pick, insert one atom row. Keep it minimal.

### Album source for the loop (the MVP seed)
- Phase 1's full universe is data-pending (the ~7GB dump is an operator step, store is currently empty), so the loop CANNOT depend on the full store yet.
- Ship a **curated seed subset** of well-known albums as a static JSON asset to the client (each: MBID, title, primary artist, year, Cover Art Archive cover URL — same fields as the `entities` album row). A few hundred albums is enough to make the loop fun and testable now.
- The seed is a temporary bootstrap. Once the real dump is loaded, the seed becomes a subset export of the real materialized universe (a later concern, out of scope here). Note this explicitly so the seed is not mistaken for the permanent catalog.

### Ranking algorithm
- **Binary-insertion placement**, per PROJECT.md. Each new album is inserted into the player's existing sorted list; each pick is the comparison that narrows its position. The list is transitive by construction — the player can never make a self-contradicting pick. NOT Elo.
- The next pair shown is the insertion comparison the algorithm needs next, not a random pairing (RANK-03).

### Design system
- Use the Total Emphasis design system already in the repo: `te-tokens.css`, `te-fonts.css`, `te-bridge.css`. Minimal, text-first where it counts, IBM Plex Mono, terracotta `#b9512a`, white background, square corners, no entrance animations. The album covers are the visual centerpiece.
- Phone-first: >=44px tap targets, no horizontal scroll at 360px, covers load live from the pointer URL without blocking the pick (PLAY-02, PLAY-04).

### Stack
- Keith's ecosystem: TypeScript acceptable, Vercel for deploy, Turso/libSQL (`@libsql/client`) for the hosted atom store. The frontend can be a minimal vanilla/TS single-page app. The legacy `file://`/zero-dependency rule is legacy-tool-only and does NOT bind this app (see CLAUDE.md).
- The planner picks concrete libraries; keep the frontend lean and the backend a single thin endpoint.
</decisions>

<canonical_refs>
## Canonical References

Downstream agents MUST read these before planning or implementing.

- `.planning/PROJECT.md` — product definition, the hybrid/data-first goals, parked items
- `.planning/REQUIREMENTS.md` — RANK-01..05, PLAY-01..04 exact wording
- `pipeline/schema.sql` — the `atoms` table shape the backend must reuse (do not redefine)
- `pipeline/db.py` — existing connection/init helpers + the `sessions`/`atoms` model
- `DATA-SOURCES.md` — Cover Art Archive pointers; copyrighted assets are referenced, never copied
- `te-tokens.css`, `te-fonts.css`, `te-bridge.css` — the design system to adopt
- `CLAUDE.md` — product vs legacy split; new product code is NOT bound by the file:// rule
</canonical_refs>

<specifics>
## Specific Ideas

- localStorage keys should be namespaced (e.g. `tastetest-*`), distinct from the legacy tool's `kob-calibration-v1`.
- The "view your current ranked list at any time" (RANK-04) is a simple ordered list of album covers/titles.
- Atom POST should be fire-and-forget with a local retry buffer so a dropped network never blocks or loses a pick.
</specifics>

<deferred>
## Deferred Ideas

- The crowd aggregate / insight charts (reads the atoms) — Phase 3+, out of scope.
- Optional light accounts (email/OAuth) — out of scope; anonymous only for this MVP.
- Songs/artists as units, other mechanisms — out of scope (v2).
- Serving the full universe (vs the seed subset) and its Turso migration — deferred; the seed subset is the MVP source.
</deferred>

---

*Phase: 02-this-or-that-ranking-mvp*
*Context captured: 2026-07-04 via direct decision*
