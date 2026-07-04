# Roadmap: Taste Test

## Overview

Taste Test's albums this-or-that MVP is delivered in two phases. First, the data foundation: materialize a notability-floored, MBID-keyed album universe from CC0 bulk dumps into a queryable local store, with covers resolved as Cover Art Archive pointers, sitting on a polymorphic `(entity_type, mbid)` entity table and a generic pairwise atom table. That infrastructure is the prerequisite for everything. Second, the ranking MVP: the anonymous, phone-usable two-album pick loop that builds a transitive personal ranked list by binary insertion and persists every pick as an atom. Expansion (songs, artists, more mechanisms, crowd charts, accounts, sharing) is explicitly v2 and out of this roadmap.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [~] **Phase 1: Album Data Foundation** - Materialize the album universe from CC0 dumps into a polymorphic, queryable store with cover pointers and a generic atom table (logic complete + tested + proven end-to-end on fixtures; NOT complete until the operator ingests the real ~7GB dump and `materialize.py --verify` confirms tens of thousands of albums)
- [ ] **Phase 2: This-or-That Ranking MVP** - Anonymous, phone-usable pick loop that builds a transitive personal list and logs every pick as an atom

## Phase Details

### Phase 1: Album Data Foundation
**Goal**: A notability-floored, MBID-keyed album universe is materialized from CC0 bulk dumps into a queryable local store, keyed polymorphically as `(entity_type, mbid)`, with covers resolved as Cover Art Archive pointers and a generic pairwise atom table ready to receive picks.
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, SCHEMA-01, SCHEMA-02, SCHEMA-03
**Success Criteria** (what must be TRUE):
  1. Querying the local store returns tens of thousands of albums (not millions), every row carrying MBID, title, primary artist name + MBID, and release year, with everything below the notability floor excluded.
  2. Any stored album resolves to a Cover Art Archive cover URL held as a pointer, with no copyrighted image files copied into the store.
  3. Every album is stored polymorphically as `(entity_type = 'album', mbid)`, so a `song` or `artist` row can be added later with no schema rebuild.
  4. A generic pairwise atom table accepts `(entity_a, entity_b, winner, mechanism, session_id, created_at)` records with `mechanism = 'this_or_that'`, agnostic to entity type, and a session id can group an anonymous player's picks with no account.
  5. Re-running ingestion against a refreshed bulk dump adds new albums without duplicating existing ones.
**Plans**: 4 plans

### Phase 2: This-or-That Ranking MVP
**Goal**: An anonymous, zero-setup, phone-usable this-or-that loop presents two albums, records the player's pick, places each album into a transitive self-consistent personal ranked list by binary insertion, drives the next pair from that insertion, and persists every pick as a pairwise atom.
**Depends on**: Phase 1
**Requirements**: RANK-01, RANK-02, RANK-03, RANK-04, RANK-05, PLAY-01, PLAY-02, PLAY-03, PLAY-04
**Success Criteria** (what must be TRUE):
  1. On first visit, with zero setup and no account, the player instantly sees two albums (cover, title, artist) and picks the one they prefer.
  2. Each pick places the album into a transitive, self-consistent personal ranked list via binary insertion, and the next pair shown is the insertion-sort comparison needed to place the current album, not a random pairing, so the player can never make a self-contradicting pick.
  3. The player can view their current ranked list at any time.
  4. Every pick is persisted as a pairwise atom (per SCHEMA-02) in addition to updating the personal list, and both the list and the session survive a page refresh.
  5. The interface is usable on a phone (>=44px tap targets, no horizontal scroll at 360px) and album covers load live from the pointer without blocking the pick interaction.
**Plans**: 4 plans
- [x] 02-01-PLAN.md — Scaffold the web/ Vite+TS app, adopt the te design system, and build the curated seed album dataset
- [x] 02-02-PLAN.md — Binary-insertion ranking algorithm as a pure, DOM-free, unit-tested module (transitivity + insertion-driven pairing)
- [ ] 02-03-PLAN.md — Two-album pick loop, ranked-list view, and localStorage persistence of list + anonymous session
- [ ] 02-04-PLAN.md — Thin Turso atom-mailbox endpoint + fire-and-forget client poster with retry buffer
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Album Data Foundation | 4/4 | Executed (data-pending) | - |
| 2. This-or-That Ranking MVP | 2/4 | In Progress|  |
</content>
