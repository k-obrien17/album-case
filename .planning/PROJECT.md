# Taste Test

## What This Is

Taste Test is a public, data-first music-ranking web app for music enthusiasts. The starting experience is dead simple: show one album, drag it into the exact position in your ranked list, and repeat until you have a true, self-consistent order. Each placement can be captured as openly-keyed pairwise neighbor atoms, so the growing pile of choices becomes the product: publishable culture-insight charts and a licensable dataset (parked).

It began as a private artist-tier calibration tool. That tool is demoted to a seed and test fixture. The public product is the project now, and it starts as **albums, drag-to-place ranking**, built to expand to songs and artists and to richer ranking mechanisms without a rebuild.

## Core Value

Turning the simplest possible placement (where this album belongs in your list) into an honest personal ranked list AND clean, openly-keyed crowd data. If everything else fails, the ranking interaction and the atoms it produces must be trustworthy and well-structured.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Zero-dependency ranking game over a fixed pool — legacy calibration tool (demoted to seed/fixture)
- ✓ Scoring module with locked tier weights + passing tests — `scoring/` (staged for the parked Best-of-Years pipeline)
- ✓ Clustering approach validated — POC recovered genre pockets from ListenBrainz CC0 similarity + Louvain

### Active

<!-- Current scope. Building toward these. -->

**v1 (albums, drag-to-place ranking):**
- [ ] Data foundation: notability-floored, MBID-keyed **album** universe (MusicBrainz release-groups) materialized from CC0 bulk dumps as the searchable store, with covers from the Cover Art Archive
- [ ] Polymorphic entity schema: every rankable item is `(entity_type, mbid)` — `album` now, `song`/`artist` ready without a rebuild
- [ ] Drag-to-place ranked list: show one candidate album and let the player place it directly into a transitive, self-consistent personal ranked list
- [ ] Generic pairwise atom store: every placement logs implied neighbor comparisons as `(entity_a, entity_b, winner, mechanism, session, timestamp)`, `mechanism = 'drag_to_place'` — the shared substrate for all future mechanisms

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Storing Spotify/Deezer/Apple data — vendor ToS forbids it; only CC0 data is stored, copyrighted assets are live-rendered pointers (album covers come from the CC-licensed Cover Art Archive)
- Songs and artists as rankable units — deferred to expansion; the polymorphic schema makes this data-loading, not a rebuild
- Additional mechanisms (lane/cluster ranking, tier buckets, discography ranking, quick-pick, two-card this-or-that) — deferred; all consume the same pairwise atom table
- Crowd aggregate insight charts — deferred to a later phase; the atom schema is built clean so this door stays open
- Accounts, shareable card — deferred past the anonymous this-or-that MVP
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
- **Data ingestion**: Bulk dumps, not APIs, for anything stored — refresh bi-weekly; new albums enter via the next dump, never as thin API stubs.
- **Assets**: Copyrighted images/previews never stored, only referenced by ID and rendered live; album covers use the CC-licensed Cover Art Archive.
- **Schema (expansion insurance)**: Rankable items are polymorphic `(entity_type, mbid)` and picks are generic pairwise atoms tagged by mechanism — both from day one.
- **Universe scale**: Tens of thousands of notability-floored albums, not millions of noise. Candidate selection must not walk editorial seed order; use randomized eligible candidates so the first session is not era-skewed.
- **First-play friction**: Anonymous, zero-setup, works on a phone. The drag-to-place loop must be instant.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rankable unit = album (release-group) | Keith's direction 2026-07-03; supersedes artist-keyed framing | ✓ Good |
| Start with albums drag-to-place only | Fewer actions per album than two-card insertion while keeping an exact personal order | ✓ Good |
| Polymorphic `(entity_type, mbid)` entities | Songs/artists become data-loading, not a rebuild | ✓ Good |
| Generic pairwise atom table, mechanism-tagged | Every future mechanism shares one substrate | ✓ Good |
| Drag-to-place transitive personal list | Delivers "true list, no self-contradiction" in one gesture per album; Elo can't guarantee transitivity | ✓ Good |
| Store only CC0 data from bulk dumps; APIs live at edges | Aggregate stays publishable/licensable and legally clean | ✓ Good |
| Drop Spotify entirely | Feb 2026 dev lockdown; Deezer/Cover Art Archive cover the edges | ✓ Good |

## Open Questions

- Songs and artists as additional units: confirm timing and any unit-specific UX (e.g. discography ranking mixes album+artist).
- Whether the crowd aggregate should allow contradiction-bearing raw picks (good for divisiveness signal) alongside each user's transitive personal list. Likely yes: personal list is transitive, crowd atoms are raw. Settle when the aggregate phase is designed.
- Name/domain/handle availability for "Taste Test" before committing.

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
*Last updated: 2026-07-04 after pivoting the player mechanism to drag-to-place ranking*
