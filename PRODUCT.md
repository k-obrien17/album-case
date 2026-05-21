# Random Music Rankings — Product Definition (draft)

Status: design draft, 2026-05-21. Living doc. Captures decisions from the pivot conversation; open questions are marked and not yet answered.

This supersedes the original framing (a private, single-user calibration tool feeding a personal Best-of-Years pipeline). The current code in this repo is the prototype of the ranking *interaction*, not the product described here.

## Vision

A public product that:
- **(a)** helps people rank their favorite artists in a fun way, and
- **(b)** generates interesting aggregate data that becomes the foundation for more work.

The two reinforce each other: the fun loop produces the data; the data eventually makes the loop smarter.

## Core loop (decided)

- **Default:** a themed cluster of ~5 *similar* artists, ranked/rated against each other. Example: "butt rock" = Creed, 3 Doors Down, Live, Silverchair, Sublime. Similar artists are more fun to compare and produce cleaner, apples-to-apples data than five random unrelated bands.
- **Wildcard:** a "random mode" (today's behavior, 5 from anywhere) as the chaos option.
- Clusters are fuzzy *vibes*, not strict genres ("butt rock" is an era + radio-format feel, not a subgenre).

## Modes (decided direction)

- **Core:** rank your own favorites (search + add) and rate/compare curated clusters.
- **Optional quick-fire:** head-to-head ("this or that"), only if it doesn't corrupt the data. Parked for now (needs a "both meh" escape so it can't manufacture a preference between two artists you both dislike).

## Data architecture (decided)

The data is the asset, so **licensing decides the stack, not data quality.** Spotify and Last.fm are out of anything stored (Spotify deprecated the useful endpoints for new apps in Nov 2024 and its ToS forbids stored derived datasets; Last.fm caps stored data at 100 MB and is non-commercial by default).

Stored asset stays **CC0**:

| Layer | Source |
|---|---|
| Canonical identity (dedupe, resolve typed names) | MusicBrainz MBIDs (bulk dumps) |
| Artist similarity (auto-derive long-tail clusters) | ListenBrainz CC0 similarity dataset |
| Vibe / genre tags | MusicBrainz folksonomy + Discogs styles (CC0 dumps) |
| Cross-walk / labels | Wikidata |

- **Spotify only at the edges** (live artist search, autocomplete, images for UI), never in the stored asset. Map Spotify IDs to MBIDs so nothing Spotify-origin lands in what we keep.
- Use **dumps, not APIs**, for anything stored.

**Clustering:** hybrid. Hand-curate the marquee vibe lanes (where the fun lives; "butt rock" only exists by curation, no source has it as a tag), auto-derive the long tail from ListenBrainz similarity + community detection (Leiden/Louvain), labeled by genre tags.

**Flywheel:** bootstrap clusters from ListenBrainz; over time, "artists people rank together / prefer together" becomes a proprietary similarity signal we own, which sharpens the clusters and *is* the data asset (goal b).

## Hard-won principles (decided)

- **Relative ranking ≠ absolute sentiment.** Ordering five artists tells you A > B > C, never how much you like any of them. The #1 of a cluster you hate is just the least-hated.
- **Tier is an absolute call.** A tier (how much you like an artist on its own) can never be derived from comparisons; comparison-insertion just collapses to "global ranking sliced into tiers," which loses sentiment.
- **Ranking is only valid *within* a tier** (everyone in S is already loved, so ordering them is pure preference). Never blend ranking and tiering in one action.

## Subsystems (decomposition)

1. **Data foundation** — MBID spine + ListenBrainz similarity + tags.
2. **Cluster builder** — hand-curated marquee lanes + auto-derived long tail.
3. **Public ranking app** — cluster-default experience, modes, random wildcard, shareable result.
4. **Aggregation / insights** — capture interactions as preference atoms, the data asset.

First de-risk before any of this: a **clustering POC** (does CC0 similarity + genres produce fun lanes?). API recon done (MusicBrainz + ListenBrainz verified). Parked pending the planning below.

## v1 scope

The spine without tiers: the clustered ranking/rating game (default clusters + random wildcard), public, with interactions captured as clean CC0-keyed data. Exact cut depends on the open questions below.

## Parked (the "becomes")

- **Tiering** — capped tiers (S20 / A50 / B100 / C), forced cascade trade-offs, ranking-within-a-tier. Good idea, but the absolute-vs-relative conflict makes it premature. Build it against real usage later, as an absolute-only act (no comparison-derivation).
- **Head-to-head mode** — needs the "both meh" escape first.
- **The data payoff** — what "more work" the data unlocks (unnamed; see open questions).

## Open questions (not yet answered)

1. **Ambition (the gate):** weekend experiment, nurtured side project, or a real product/business? Everything scales off this.
2. **Launch leading goal:** consumer-fun-first or data-first?
3. **Accounts:** anonymous, light accounts, or anonymous with optional "save your result"?
4. **The shareable hook:** what does a player walk away with that makes them post it or text a friend? (The growth engine; undefined.)
5. **Day-one content:** how many curated lanes ship; is random mode in or out for v1?
6. **The payoff:** what the data becomes (recommendations, taste-matching, culture charts, feeding Best-of-Years, an API/dataset, ...).
7. **Long-term audience:** mass casual fans, music nerds/critics, or you/clients?
8. **Money, ever:** passion/free, ads, premium, data licensing, B2B, or not yet.
9. **Name:** "random music rankings" no longer fits (it is not random anymore).
10. **Project class for ship-standard:** was `static-site`; now app-with-accounts-ish, which pulls privacy/legal into scope. The existing `SHIP-STANDARD.md` is stale (private-tool era) and will be redone via `/ship-standard` after these are answered.
