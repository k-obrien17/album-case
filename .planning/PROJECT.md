# Album Case

## What This Is

Album Case is currently a personal, single-owner album-ranking app. It shows
one candidate album, lets Keith place it into the exact position in one ordered
list, and persists the canonical owner ranking snapshot to Turso. The list is
transitive by construction; localStorage is only a fast/offline cache.

It began as a private artist-tier calibration tool and briefly carried a public
"Taste Test" aggregate-product roadmap. That public/crowd-data direction is now
parked historical context. The implemented product is the personal Album Case
tool under `web/`.

## Core Value

Turning the simplest possible placement ("where this album belongs in my list")
into a durable, trustworthy personal album library. If everything else fails,
the owner ranking snapshot must not be lost or corrupted.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Zero-dependency ranking game over a fixed pool — legacy calibration tool (demoted to seed/fixture)
- ✓ Scoring module with locked tier weights + passing tests — `scoring/` (staged for the parked Best-of-Years pipeline)
- ✓ Clustering approach validated — POC recovered genre pockets from ListenBrainz CC0 similarity + Louvain

### Active

<!-- Current scope. Building toward these. -->

**v1 (personal Album Case):**
- [x] Drag-to-place ranked list: show one candidate album and let the owner place it directly into a transitive, self-consistent personal ranked list
- [x] Turso-backed owner ranking snapshot with full album records
- [x] Write-key-gated mutations via `ALBUM_CASE_WRITE_KEY`
- [x] Versioned snapshot writes to prevent stale tab/browser overwrites
- [x] MusicBrainz artist-MBID discovery for more studio LPs by an artist
- [ ] Live smoke test with local Turso envs and `vercel dev`
- [ ] Decide whether the older public/crowd aggregate direction should stay parked or be deleted from planning entirely

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Storing Spotify/Deezer/Apple data — vendor ToS forbids it; only CC0 data is stored, copyrighted assets are live-rendered pointers (album covers come from the CC-licensed Cover Art Archive)
- Songs and artists as rankable units — deferred to expansion; the polymorphic schema makes this data-loading, not a rebuild
- Additional mechanisms (lane/cluster ranking, tier buckets, discography ranking, quick-pick, two-card this-or-that) — deferred; all consume the same pairwise atom table
- Crowd aggregate insight charts — deferred to a later phase; the atom schema is built clean so this door stays open
- Accounts, public anonymous sessions, crowd aggregate charts, shareable cards — parked unless Keith explicitly reopens the public Taste Test direction
- Elo living ranking — not the chosen model; the personal list is transitive-by-construction (no self-contradiction), which Elo does not guarantee. Reconsider only if a never-finished global ranking is wanted
- Monetization — deferred; free passion project
- Audio features (BPM/key/mood), lyrics, setlists, live events — no open source and/or encumbered; not in scope

## Context

- **Origin:** Private artist-tier calibration tool feeding a personal `spotify-best-of-years` pipeline (never built). Pivoted to a public product 2026-05-31, narrowed to an album ranking MVP 2026-07-03, then changed the player mechanism from two-card binary insertion to drag-to-place on 2026-07-04 to reduce clicks and repetition.
- **The pivot to albums + drag-to-place (2026-07-04):** the rankable unit is the **album**, not the artist. The player sees one candidate album and places it into an already ordered list. Artists and songs become additional entity types later. This supersedes the artist-keyed framing in the older `PRODUCT.md` and the earlier two-card pick loop in this planning set.
- **Data architecture (decided, see `DATA-SOURCES.md`):** Store everything from CC0 dumps; reference only what you already own; use pointers for copyrighted assets. The search index is the project's own materialized universe, never a vendor's live catalog. Now album-scoped: MusicBrainz release-groups are the identity spine; the Cover Art Archive (CC-licensed, MBID-keyed) supplies covers.
- **Stored core:** MusicBrainz (release-group + artist identity, CC0), Cover Art Archive (covers), ListenBrainz (popularity floor + future similarity), Discogs (genres/styles, CC0 text), Wikidata (crosswalks + attributes). Deezer/TheAudioDB are live-edge only. Spotify dropped (Feb 2026 lockdown).
- **Two expansion guarantees baked into v1:** (1) polymorphic `(entity_type, mbid)` so songs/artists slot in; (2) generic pairwise atom table so every mechanism shares one substrate. Both are cheap now, expensive to retrofit.
- **Hard-won ranking principle:** the drag-to-place list builds a transitive personal list by construction, so a user can never make self-contradicting picks. This preserves the no-Elo principle without forcing repeated two-card comparisons.

## Constraints

- **Data license**: Stored asset stays CC0 (MusicBrainz + Cover Art Archive + ListenBrainz + Discogs text + Wikidata) — keeps the aggregate publishable/licensable and legally clean.
- **Discovery ingestion**: For the current personal app, owner-triggered
  MusicBrainz discovery may store release-group records in Turso. Discovery must
  use `primary_artist_mbid`, not ambiguous artist-name search.
- **Assets**: Copyrighted images/previews never stored, only referenced by ID and rendered live; album covers use the CC-licensed Cover Art Archive.
- **Schema (expansion insurance)**: Rankable items are polymorphic `(entity_type, mbid)` and picks are generic pairwise atoms tagged by mechanism — both from day one.
- **Universe scale**: Tens of thousands of notability-floored albums, not millions of noise. Candidate selection must not walk editorial seed order; use randomized eligible candidates so the first session is not era-skewed.
- **First-play friction**: Anonymous, zero-setup, works on a phone. The drag-to-place loop must be instant.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Current product = personal Album Case | Reconciled with implemented app, README, and security model | ✓ Good |
| Rankable unit = album (release-group) | Keith's direction 2026-07-03; supersedes artist-keyed framing | ✓ Good |
| Start with albums drag-to-place only | Fewer actions per album than two-card insertion while keeping an exact personal order | ✓ Good |
| Polymorphic `(entity_type, mbid)` entities | Songs/artists become data-loading, not a rebuild | ✓ Good |
| Generic pairwise atom table, mechanism-tagged | Every future mechanism shares one substrate | ✓ Good |
| Drag-to-place transitive personal list | Delivers "true list, no self-contradiction" in one gesture per album; Elo can't guarantee transitivity | ✓ Good |
| Owner-triggered MusicBrainz discovery may store album records | Personal app correctness matters more than the old bulk-only aggregate roadmap | ✓ Good |
| Use artist MBIDs for discovery | Avoids ambiguous artist-name search results | ✓ Good |
| Drop Spotify entirely | Feb 2026 dev lockdown; Deezer/Cover Art Archive cover the edges | ✓ Good |

## Open Questions

- Whether the old public Taste Test aggregate roadmap should be deleted or kept
  as archived context.
- Whether read endpoints should remain public or be gated if the ranking should
  become private later.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-07 after reconciling planning with the personal Album Case implementation*
