# Taste Test

## What This Is

Taste Test is a public, data-first music-ranking web app for music enthusiasts. Players rank artists inside auto-generated and curated "lanes" (vibe clusters, similarity groups, and playful attribute lanes like "bands with foods in their name"), and every interaction is captured as a clean, MBID-keyed preference atom. The aggregate becomes the product: publishable culture insights and charts (most polarizing artists of the 2000s, love-to-hate, cluster power rankings), with a licensable dataset as a parked secondary door.

It began as a private calibration tool that triaged ~996 artists into tiers for a personal "Best of Years" Spotify pipeline. That tool is demoted to a seed and test fixture; the public product is the project now.

## Core Value

Capturing crowd taste as a clean, openly-keyed dataset that produces honest, shareable culture insights. If everything else fails, the aggregate preference data must be trustworthy and well-structured.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Zero-dependency tier-rating game over a fixed artist pool — legacy calibration tool (demoted to seed/fixture)
- ✓ Scoring module with locked tier weights + passing tests — `scoring/` (staged for the Best-of-Years pipeline)
- ✓ Clustering approach validated — POC recovered genre pockets from ListenBrainz CC0 similarity + Louvain

### Active

<!-- Current scope. Building toward these. -->

- [ ] Data foundation: notability-floored, MBID-keyed artist universe materialized from CC0 bulk dumps as the searchable store
- [ ] Cluster builder: hand-curated marquee lanes + auto-derived similarity long tail + generated attribute lanes
- [ ] Public ranking app: lane-default ranking experience, shareable ranked card, optional light accounts
- [ ] Aggregation / insights: interactions captured as artist-keyed, lane-type-tagged preference atoms; publishable charts

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Storing Spotify/Deezer/Apple data in the DB — vendor ToS forbids it; only open CC0 data is stored, copyrighted images/previews are live-rendered pointers
- Tiering (S/A/B/C absolute tiers) — parked; the absolute-vs-relative conflict makes it premature, build against real usage later as an absolute-only act
- Head-to-head mode — parked; needs a "both meh" escape first
- Pure-random ranking mode — cut from v1; generated lanes already supply infinite variety and random is the noisiest data source
- Monetization — deferred; free passion project, data-licensing door kept open via clean schema only
- Audio features (BPM/key/mood) — no open source exists anymore (AcousticBrainz frozen, Spotify endpoint killed); compute in-house only if ever needed
- Lyrics, setlists, live events — encumbered sources; not in v1

## Context

- **Origin:** Private calibration tool (`index.html` + `app.js` + `artists.js`, 996 artists) feeding a personal `spotify-best-of-years` pipeline (never built). Pivoted to a public product 2026-05-31.
- **Data architecture (decided, see `DATA-SOURCES.md`):** Store everything from CC0 dumps; reference only what you already own; use pointers for copyrighted assets. The app's search index is the project's own materialized universe, never a vendor's live catalog. Commercial APIs decorate rows the dumps already gave you; they never introduce an entity.
- **Stored core:** MusicBrainz (MBID identity spine, CC0), ListenBrainz (similarity + popularity, open), Discogs (genres/styles, CC0 text), Wikidata (ID crosswalks + attribute lanes, CC0).
- **Live edges (display-only):** Deezer (search/images/previews, no key, no backend), TheAudioDB (cacheable images/bios). Spotify dropped entirely after its Feb 2026 dev-access lockdown.
- **Validated by POC:** ListenBrainz CC0 similarity + Louvain recovered all 7 planted genre pockets with only correct crossovers; "butt rock" emerged from pure similarity. POC is throwaway (used live APIs); production uses bulk dumps.
- **Hard-won ranking principles:** Relative ranking is not absolute sentiment. Tier is an absolute call that can never be derived from comparisons. Ranking is only valid within a tier.
- **Flywheel:** Bootstrap clusters from ListenBrainz; over time "artists people rank/prefer together" becomes a proprietary similarity signal the project owns, sharpening clusters and forming the data asset.

## Constraints

- **Data license**: Stored asset stays CC0 (MusicBrainz + ListenBrainz + Discogs text + Wikidata) — keeps the aggregate publishable and licensable, and legally clean.
- **Data ingestion**: Use bulk dumps, not APIs, for anything stored — dumps refresh bi-weekly; new artists enter through the next dump, never as thin API stubs.
- **Assets**: Copyrighted images/previews are never stored, only referenced by ID and rendered live — vendor ToS plus storage/liability.
- **Schema**: Preference atoms are artist-keyed AND lane-type-tagged from day one — expensive to retrofit; enables high-signal vs gimmick-lane weighting for charts and licensing.
- **Accounts**: Anonymous by default (zero-setup first play) + optional email/OAuth save — pulls auth, privacy, and consent into scope (app-with-accounts class, see `SHIP-STANDARD.md`).
- **Universe scale**: Tens of thousands of notability-floored artists, not millions of noise nor a curated few hundred — pairing/lane intelligence is therefore mandatory (no chance coverage at scale).

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Store only CC0 data from bulk dumps; APIs live at edges | Keeps aggregate publishable/licensable and legally clean | ✓ Good |
| Materialize the universe as the searchable store | "Everything referenced ends up in my database" by construction; no non-CC0 entity can enter via search | ✓ Good |
| Drop Spotify entirely | Feb 2026 dev-mode lockdown (Premium required, 1 client/5 users, no batch, no-DB ToS); Deezer covers the edge with no key | ✓ Good |
| Notability-floored universe (tens of thousands) | Public discovery needs breadth; the 996 pool baked in one person's blind spots | ✓ Good |
| Artist-keyed + lane-type-tagged atoms | Aggregate per artist across lanes; weight high-signal lanes for charts/licensing | ✓ Good |
| Random ranking mode cut from v1 | Generated lanes supply variety; random is noisiest data | ✓ Good |
| Core loop: 5-up lanes vs ongoing Elo | Unresolved fork (see HANDOFF.md); does NOT block the data foundation | — Pending |

## Open Questions

- **THE FORK (decide before any ranking UI):** core loop = 5-up lanes (current `PRODUCT.md`) vs ongoing Elo / head-to-head living ranking (2-up, never-finished, year-end top-N becomes the annual playlist). Tap-through demos at repo root: `elo-demo.html`, `pairwise-demo.html`. The data foundation is needed either way, so Phase 1 proceeds regardless.
- Name/domain/handle availability for "Taste Test" before committing (consider a distinguishing TLD).

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
*Last updated: 2026-07-03 after initialization (from existing PRODUCT.md, DATA-SOURCES.md, SHIP-STANDARD.md)*
