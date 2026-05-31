# Taste Test (working name) — Product Definition (draft)

Formerly "Random Music Rankings." Renamed because nothing is random anymore: it is curated/generated vibe-clusters plus crowd data. Repo/dir still use the old slug.

Status: design draft, 2026-05-21. Living doc. Captures decisions from the pivot conversation; open questions are marked and not yet answered.

This supersedes the original framing (a private, single-user calibration tool feeding a personal Best-of-Years pipeline). The current code in this repo is the prototype of the ranking *interaction*, not the product described here.

## Vision

A public product that:
- **(a)** helps people rank their favorite artists in a fun way, and
- **(b)** generates interesting aggregate data that becomes the foundation for more work.

The two reinforce each other: the fun loop produces the data; the data eventually makes the loop smarter.

## Core loop (decided)

- **Default:** a themed cluster of ~5 artists, ranked/rated against each other. Themes can be vibe-based ("butt rock" = Creed, 3 Doors Down, Live, Silverchair, Sublime) or attribute-based ("bands with foods in their name"). Grouped artists are more fun to compare and produce cleaner, apples-to-apples data than five random unrelated bands.
- **Generated stream:** an endless supply of attribute lanes generated from the data spine (Wikidata properties + lexicon matching), the headline replayability feature.
- Themes are fuzzy *vibes* or playful *attributes*, not strict genres. (Pure random mode is cut from v1, see Q5.)

## Modes (decided direction)

- **Core:** rank your own favorites (search + add) and rate/compare curated/generated clusters.
- **Optional quick-fire:** head-to-head ("this or that"), only if it doesn't corrupt the data. Parked for now (needs a "both meh" escape so it can't manufacture a preference between two artists you both dislike).

## Data architecture (decided)

The data is the asset, so **licensing decides the stack, not data quality.** Spotify and Last.fm are out of anything stored (Spotify deprecated the useful endpoints for new apps in Nov 2024 and its ToS forbids stored derived datasets; Last.fm caps stored data at 100 MB and is non-commercial by default).

Stored asset stays **CC0**:

| Layer | Source |
|---|---|
| Canonical identity (dedupe, resolve typed names) | MusicBrainz MBIDs (bulk dumps) |
| Artist similarity (auto-derive long-tail clusters) | ListenBrainz CC0 similarity dataset |
| Vibe / genre tags | MusicBrainz folksonomy + Discogs styles (CC0 dumps) |
| Attributes / cross-walk / labels (enables "bands with foods in their name") | Wikidata |

- **Spotify only at the edges** (live artist search, autocomplete, images for UI), never in the stored asset. Map Spotify IDs to MBIDs so nothing Spotify-origin lands in what we keep.
- Use **dumps, not APIs**, for anything stored.

**Clustering:** hybrid. Hand-curate the marquee vibe lanes (where the fun lives; "butt rock" only exists by curation, no source has it as a tag), auto-derive the long tail from ListenBrainz similarity + community detection (Leiden/Louvain), and generate attribute lanes from Wikidata properties. Labeled by genre tags.

**Flywheel:** bootstrap clusters from ListenBrainz; over time, "artists people rank together / prefer together" becomes a proprietary similarity signal we own, which sharpens the clusters and *is* the data asset (goal b).

## Hard-won principles (decided)

- **Relative ranking is not absolute sentiment.** Ordering five artists tells you A > B > C, never how much you like any of them. The #1 of a cluster you hate is just the least-hated.
- **Tier is an absolute call.** A tier (how much you like an artist on its own) can never be derived from comparisons; comparison-insertion just collapses to "global ranking sliced into tiers," which loses sentiment.
- **Ranking is only valid *within* a tier** (everyone in S is already loved, so ordering them is pure preference). Never blend ranking and tiering in one action.

## Subsystems (decomposition)

1. **Data foundation** — MBID spine + ListenBrainz similarity + tags + Wikidata attributes.
2. **Cluster builder** — hand-curated marquee lanes + auto-derived long tail + generated attribute lanes.
3. **Public ranking app** — cluster-default experience, modes, random wildcard, shareable result, optional light accounts.
4. **Aggregation / insights** — capture interactions as preference atoms, the data asset.

First de-risk before any of this: a **clustering POC** (does CC0 similarity + genres + attributes produce fun lanes?). API recon done (MusicBrainz + ListenBrainz verified). Parked pending the planning below.

## v1 scope

The spine without tiers: the clustered ranking/rating game (default clusters + maybe random wildcard), public, with interactions captured as clean CC0-keyed data, plus optional light accounts to save results. Exact cut depends on the open questions below.

## The payoff (decided, Q6)

- **Primary: culture insights / charts.** Aggregate, publishable artifacts from preference atoms: divisiveness ("most polarizing artists of the 2000s"), love-to-hate, era/generation splits, cluster power rankings.
- **Secondary: licensable dataset.** Keep the CC0-keyed aggregate clean and well-structured so it *could* be licensed later. Not a v1 activity (money is deferred, see Q8), but the schema is built so this door stays open.
- **Schema consequence:** capture interactions as MBID-keyed preference atoms tagged by cluster / era / genre / attribute, clean and well-keyed enough to both publish charts from and license later.

## Accounts (decided, Q3)

- **Optional light accounts.** Anonymous by default so the first play needs zero setup; optional email/OAuth to save results across devices and build a personal history. This pulls identity, auth, and privacy/legal into scope (heavier than a pure-anonymous build). Durable identity also enriches the secondary licensable dataset.

## Shareable hook (decided, Q4)

- **Ranked card / image.** The player walks away with a clean, screenshot-ready visual of their ordering (Spotify-Wrapped style), branded with the name/URL. Static and self-contained, easy to post.
- **Possible enrichment later:** layer crowd deltas onto the card ("you vs. the crowd") once the aggregate exists, turning a static card into a "do you agree?" prompt. Not required for v1.

## Day-one content (decided, Q5)

- **Hybrid: evergreen anchors + endless generated stream.** Ship ~8 evergreen anchor lanes (the marquee vibe clusters) plus a dynamic, seemingly endless stream of **generated attribute lanes** (e.g. "bands with foods in their name," built from Wikidata properties + lexicon matching on band names). The generated engine is the headline feature; the anchors guarantee a few lanes always accumulate dense crowds and clean signal so the data payoff (Q6) stays honest.
- **Atoms are artist-keyed and lane-type-tagged.** Aggregate per artist across every lane it appears in (not per-lane), and stamp each atom with its lane type (similarity / attribute / novelty). This lets charts and the licensable dataset lean on high-signal lanes and down-weight gimmick lanes without discarding any fun data. Tiny schema addition now, expensive to retrofit, so build it from the start.
- **Random mode is cut from v1.** The generated stream already supplies infinite variety, and pure-random is the noisiest data source. Drop it for launch; it slots back later as the loosest lane type if wanted.

## Audience and money (decided, Q7 + Q8)

- **Audience (Q7): music nerds / enthusiasts.** The rank-and-debate crowd who argue about taste. Design decisions break toward the enthusiast; shareable cards still spill over to casual fans.
- **Money (Q8): not yet, keep it free.** No monetization in v1; passion project. Revisit only if it grows. Data licensing stays a parked door (schema kept clean), not a v1 activity.

## Name (decided, Q9)

- **Working name: Taste Test.** Music taste + the ranking/testing act; friendly and broad. Common phrase, so verify domain/handle availability and consider a distinguishing TLD before committing.

## Parked (the "becomes")

- **Tiering** — capped tiers (S20 / A50 / B100 / C), forced cascade trade-offs, ranking-within-a-tier. Good idea, but the absolute-vs-relative conflict makes it premature. Build it against real usage later, as an absolute-only act (no comparison-derivation).
- **Head-to-head mode** — needs the "both meh" escape first.
- **Crowd-comparison on the share card** — layer onto the ranked card once aggregate data exists.

## Open questions

1. ANSWERED (Q1): ambition = **nurtured side project**.
2. ANSWERED (Q2): launch leading goal = **data-first**.
3. ANSWERED (Q3): accounts = **optional light accounts** (anonymous default + optional save).
4. ANSWERED (Q4): shareable hook = **ranked card / image** (Wrapped-style).
5. ANSWERED (Q5): **hybrid anchors + endless generated lanes; artist-keyed + lane-type-tagged atoms; random mode cut from v1** (see Day-one content section).
6. ANSWERED (Q6): primary = **culture insights/charts**; secondary = **licensable dataset**.
7. ANSWERED (Q7): audience = **music nerds / enthusiasts**.
8. ANSWERED (Q8): money = **not yet, keep it free**.
9. ANSWERED (Q9): name = **Taste Test** (working).
10. **OPEN (Q10):** project class for ship-standard. Now a **public app with optional light accounts + a server-side datastore**, so auth security, privacy policy, and consent are all in scope (heavier than the old `static-site`). Resolve via `/ship-standard` once Q5 lands.
