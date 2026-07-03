# Requirements: Taste Test

**Defined:** 2026-07-03
**Core Value:** Turning the simplest choice (this album or that one) into an honest personal ranked list AND clean, openly-keyed crowd data.

## v1 Requirements

Requirements for the albums this-or-that MVP. Each maps to a roadmap phase.

### Data Foundation

- [ ] **DATA-01**: A notability-floored album universe (MusicBrainz release-groups) is materialized into a queryable local store from CC0 bulk dumps, not live APIs
- [ ] **DATA-02**: Each album row carries its MBID, title, primary artist (name + MBID), and release year
- [ ] **DATA-03**: Each album resolves to a cover image via the Cover Art Archive (stored as a pointer/URL, not a copied file)
- [ ] **DATA-04**: Albums below the notability floor are excluded, keeping the universe in the tens of thousands, not millions
- [ ] **DATA-05**: The ingestion is repeatable against a refreshed dump without duplicating existing albums

### Schema (expansion insurance)

- [ ] **SCHEMA-01**: Every rankable item is stored polymorphically as `(entity_type, mbid)` with `entity_type = 'album'`, so `song`/`artist` can be added later without a schema rebuild
- [ ] **SCHEMA-02**: Every pick is stored as a generic pairwise atom `(entity_a, entity_b, winner, mechanism, session_id, created_at)` with `mechanism = 'this_or_that'`
- [ ] **SCHEMA-03**: A session identifier groups an anonymous player's picks without requiring an account

### Ranking Loop

- [ ] **RANK-01**: The app presents two albums (cover, title, artist) and the player picks the one they prefer
- [ ] **RANK-02**: Picks build a transitive, self-consistent personal ranked list via binary-insertion placement (the player can never make a self-contradicting pick)
- [ ] **RANK-03**: The next pair shown is chosen to place the current album into the player's existing ordered list (insertion-sort driven, not random)
- [ ] **RANK-04**: The player can view their current ranked list at any time
- [ ] **RANK-05**: Every pick is persisted as a pairwise atom (per SCHEMA-02) in addition to updating the personal list

### Play Surface

- [ ] **PLAY-01**: The this-or-that loop is playable anonymously with zero setup, instantly, on first visit
- [ ] **PLAY-02**: The interface is usable on a phone (>=44px tap targets, no horizontal scroll at 360px)
- [ ] **PLAY-03**: A player's list and session survive a page refresh
- [ ] **PLAY-04**: Album covers load live from the pointer without blocking the pick interaction

## v2 Requirements

Deferred to future release. Tracked, not in the current roadmap.

### Expansion Units

- **UNIT-01**: Songs added as a rankable `entity_type`
- **UNIT-02**: Artists added as a rankable `entity_type`
- **UNIT-03**: Discography ranking (pick an artist, rank their albums)

### Additional Mechanisms

- **MECH-01**: Lane / cluster ranking (rank a small set within a curated or generated lane)
- **MECH-02**: Tier buckets (S/A/B/C absolute tiers)
- **MECH-03**: Quick-pick / low-friction favorites

### Aggregate & Accounts

- **AGG-01**: Crowd aggregate insight charts (divisiveness, love-to-hate, era splits) from pairwise atoms
- **ACCT-01**: Optional light accounts (email/OAuth) to save a list across devices
- **SHARE-01**: Shareable ranked card / image (Wrapped-style)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Storing Spotify/Deezer/Apple metadata or images | Vendor ToS forbids DB-building; only CC0 data stored, covers via Cover Art Archive |
| Elo living ranking | Personal list is transitive-by-construction; Elo can't guarantee no self-contradiction |
| Live artist/album search over a vendor catalog | The search index is the project's own materialized universe, never a vendor's live catalog |
| Audio features (BPM/key/mood) | No open source remains (AcousticBrainz frozen, Spotify endpoint killed) |
| Lyrics, setlists, live events | Encumbered sources; not core to ranking |
| Accounts/share/charts in v1 | The MVP is anonymous this-or-that; these are the expansion path |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-03 | Phase 1 | Pending |
| DATA-04 | Phase 1 | Pending |
| DATA-05 | Phase 1 | Pending |
| SCHEMA-01 | Phase 1 | Pending |
| SCHEMA-02 | Phase 1 | Pending |
| SCHEMA-03 | Phase 1 | Pending |
| RANK-01 | Phase 2 | Pending |
| RANK-02 | Phase 2 | Pending |
| RANK-03 | Phase 2 | Pending |
| RANK-04 | Phase 2 | Pending |
| RANK-05 | Phase 2 | Pending |
| PLAY-01 | Phase 2 | Pending |
| PLAY-02 | Phase 2 | Pending |
| PLAY-03 | Phase 2 | Pending |
| PLAY-04 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17 (Phase 1: 8, Phase 2: 9)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-03*
*Last updated: 2026-07-03 after roadmap creation (traceability populated)*
