# Roadmap: Taste Test

> Historical note, 2026-07-07: this roadmap belongs to the older public Taste
> Test direction. The current implemented product is the personal single-owner
> Album Case app described in `.planning/PROJECT.md`, `README.md`, and
> `CLAUDE.md`. Keep this file as archived context unless Keith explicitly
> reopens the public aggregate roadmap.

## Overview

Taste Test's albums ranking MVP is delivered in two phases. First, the data foundation: materialize a notability-floored, MBID-keyed album universe from CC0 bulk dumps into a queryable local store, with covers resolved as Cover Art Archive pointers, sitting on a polymorphic `(entity_type, mbid)` entity table and a generic pairwise atom table. That infrastructure is the prerequisite for everything. Second, the ranking MVP: the anonymous, phone-usable drag-to-place loop that builds a transitive personal ranked list and persists each placement's implied pairwise signal as atoms. Expansion (songs, artists, more mechanisms, crowd charts, accounts, sharing) is explicitly v2 and out of this roadmap.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [~] **Phase 1: Album Data Foundation** - Materialize the album universe from CC0 dumps into a polymorphic, queryable store with cover pointers and a generic atom table (logic complete + tested + proven end-to-end on fixtures; NOT complete until the operator ingests the real ~7GB dump and `materialize.py --verify` confirms tens of thousands of albums)
- [x] **Phase 2: This-or-That Ranking MVP** - Anonymous, phone-usable drag-to-place loop that builds a transitive personal list and logs each placement's pairwise signal as atoms

## Phase Details

### Phase 1: Album Data Foundation
**Goal**: A notability-floored, MBID-keyed album universe is materialized from CC0 bulk dumps into a queryable local store, keyed polymorphically as `(entity_type, mbid)`, with covers resolved as Cover Art Archive pointers and a generic pairwise atom table ready to receive picks.
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, SCHEMA-01, SCHEMA-02, SCHEMA-03
**Success Criteria** (what must be TRUE):
  1. Querying the local store returns tens of thousands of albums (not millions), every row carrying MBID, title, primary artist name + MBID, and release year, with everything below the notability floor excluded.
  2. Any stored album resolves to a Cover Art Archive cover URL held as a pointer, with no copyrighted image files copied into the store.
  3. Every album is stored polymorphically as `(entity_type = 'album', mbid)`, so a `song` or `artist` row can be added later with no schema rebuild.
  4. A generic pairwise atom table accepts `(entity_a, entity_b, winner, mechanism, session_id, created_at)` records with `mechanism = 'drag_to_place'`, agnostic to entity type, and a session id can group an anonymous player's placements with no account.
  5. Re-running ingestion against a refreshed bulk dump adds new albums without duplicating existing ones.
**Plans**: 4 plans

### Phase 2: This-or-That Ranking MVP
**Goal**: An anonymous, zero-setup, phone-usable drag-to-place loop presents one candidate album, records where the player places it, keeps the personal ranked list transitive and self-consistent, and persists each placement's implied pairwise signal as atoms.
**Depends on**: Phase 1
**Requirements**: RANK-01, RANK-02, RANK-03, RANK-04, RANK-05, PLAY-01, PLAY-02, PLAY-03, PLAY-04
**Success Criteria** (what must be TRUE):
  1. On first visit, with zero setup and no account, the player instantly sees a candidate album and a ranked-list target.
  2. Each placement inserts the album into a transitive, self-consistent personal ranked list, so the player can never make a self-contradicting pick.
  3. The player can view and reorder their current ranked list at any time.
  4. Every placement is persisted as a pairwise atom signal (per SCHEMA-02) in addition to updating the personal list, and both the list and the session survive a page refresh.
  5. The interface is usable on a phone (>=44px tap targets, no horizontal scroll at 360px), and the ranking interaction is text-first so media loading never blocks play.
**Plans**: 4 plans
- [x] 02-01-PLAN.md — Scaffold the web/ Vite+TS app, adopt the te design system, and build the curated seed album dataset
- [x] 02-02-PLAN.md — Binary-insertion ranking algorithm as a pure, DOM-free, unit-tested module (transitivity + insertion-driven pairing)
- [x] 02-03-PLAN.md — Drag-to-place ranked-list UI, set-aside lists, and localStorage persistence of list + anonymous session
- [x] 02-04-PLAN.md — Thin Turso atom-mailbox endpoint + fire-and-forget client poster with retry buffer
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Album Data Foundation | 4/4 | Executed (data-pending) | - |
| 2. This-or-That Ranking MVP | 4/4 | Complete | 2026-07-04 |
</content>
