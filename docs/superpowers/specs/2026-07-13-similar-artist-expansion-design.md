# Similar-artist expansion for "Fill in more albums"

## Problem

"Fill in more albums" browses the remaining studio LPs of the owner's top-10 ranked artists. Those artists' catalogs are now fully exhausted (verified live: every top-10 artist's studio LPs are all either ranked or pooled), so the button honestly reports "Added 0 new albums" every time — it has nothing left to do. Keith's ask: it "should not just do that but find other like albums." MusicBrainz cannot answer that — it has no similarity data; that's exactly why similar-artist expansion was listed as deferred in the original bulk-discovery spec.

## Data source (verified live before this spec was written)

**ListenBrainz Labs similar-artists API.** `GET https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=<mbid>&algorithm=session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30` returns up to 100 similar artists, each with `artist_mbid`, `name`, and a `score`. Free, no key, CC0, and keyed by the same MBIDs this app stores on every album — no name-matching anywhere. Verified with Radiohead's MBID: 100 results, sane neighbors (Pixies, Smashing Pumpkins, Pink Floyd).

Known bias, accepted: session-based collaborative filtering skews popular (Coldplay/Nirvana score high for Radiohead). Mitigations below (cross-seed aggregation) help; the block-artist feature handles the rest — blocking an unwanted artist already removes their albums from the queue and future candidates.

Why not the alternatives: Last.fm requires an API key; Spotify removed its related-artists endpoint for new apps in Nov 2024.

## Behavior: one button, two tiers

"Fill in more albums" keeps its name and keeps Tier 1. Tier 2 is new and runs only when Tier 1 comes up empty:

- **Tier 1 (unchanged):** browse the top-10 ranked artists' remaining studio LPs via the existing `runBulkDiscovery`. If it adds anything, stop there — same summary as today.
- **Tier 2 (new):** if Tier 1 added 0 albums, expand to similar artists:
  1. For each of the top-10 ranked artists, fetch similar artists from ListenBrainz (via a new proxy route, below).
  2. Aggregate scores across all 10 seed lists — an artist similar to *several* of Keith's top artists outranks one similar to only one. Normalize per-seed (divide each score by that seed's max) before summing, so one seed's larger raw scale can't dominate.
  3. Exclude: artists already represented in `ranked`, in the candidate pool, or blocked (via the existing `blockedArtists`/`blockedArtistMbids` machinery).
  4. Take the top `SIMILAR_ARTISTS_PER_RUN = 5` remaining artists.
  5. For each, pull their studio LPs through the **existing** `/api/discover-artist` path (same write-key gate, same `discovered_albums` persistence, same sequential 300ms pacing as `runBulkDiscovery`), and prepend the finds to the priority queue.
- Summary reflects the tier that ran, and Tier 2 names the artists: `"Added 23 albums from 5 similar artists: Pixies, Slowdive, …"`. Discovery failures per artist are tallied and reported, never abort the batch (existing convention).

New albums land in the **candidate queue only** — surfaced one at a time to rate or place, never auto-ranked. The existing `diversifyByArtist` round-robin already interleaves multiple new artists' albums.

Each button press with an exhausted Tier 1 discovers 5 *new* artists (previous run's artists are now in the pool, so the exclusion in step 3 naturally advances to the next 5). Pressing it repeatedly walks progressively deeper into the similarity list — a feature, not a bug.

## New API route: `/api/similar-artists`

`GET /api/similar-artists?artist_mbid=<uuid>` — a thin read-only proxy to ListenBrainz Labs, one seed artist per call (the client already orchestrates sequential per-artist loops with pacing; keep that pattern).

- Mirrors `/api/search-album`'s hardening: validate the MBID against `UUID_RE` (400 otherwise), `Cache-Control: public, s-maxage=86400` (similarity data changes rarely; a day of edge caching means 10 seed calls cost ~nothing on repeat presses), 8s `AbortController` timeout, 502 on upstream failure.
- Returns `{ artists: { mbid, name, score }[] }`, capped at 50.
- No write key — read-only, and reads are already public in this app. Proxied server-side for symmetry with the other routes and to keep the User-Agent + algorithm string in one place, not shipped to the client.

The algorithm string is a constant in the route with a comment noting it's ListenBrainz's current recommended session-based model — if LB retires it, the route 502s and the button reports the failure cleanly.

## Client changes

`web/src/bulkDiscovery.ts` grows a second exported orchestration function (Tier 2), taking its dependencies as injected functions exactly like `runBulkDiscovery` does (`fetchSimilar`, `discover`, `onProgress`, `delayMs`) so it stays pure and testable. `main.ts`'s `handleBulkDiscover` chains: run Tier 1; if `foundCount === 0`, run Tier 2. The score normalization + aggregation + exclusion logic is a pure function with colocated tests (this is where the real logic lives; the fetching is trivial).

Locked writes short-circuit both tiers with the existing "Unlock writes…" message (Tier 2's discovery calls are write-gated the same as Tier 1's).

## Error handling

- ListenBrainz unreachable for a seed artist: skip that seed, continue; if *all* seeds fail, report "Couldn't reach ListenBrainz — try again."
- A similar artist with zero studio LPs on MusicBrainz (or discovery error): tally, continue — identical to Tier 1's per-artist tolerance.
- Fewer than 5 eligible similar artists (heavy exclusion overlap): proceed with what's left; only report "nothing new found" when it's genuinely zero.

## Testing

Pure, colocated: score normalization/aggregation across seeds, exclusion of ranked/pooled/blocked artists, the top-5 cut, and the Tier 1 → Tier 2 trigger condition (`foundCount === 0`). Route test at the same thin level as `search-album.test.ts` (mock fetch: happy path, invalid MBID, upstream failure).

## Non-goals

- Album-level similarity (LB Labs also has similar-*recordings*; out of scope — artist-level is the right granularity for a catalog-browsing app).
- Auto-running Tier 2 in the background or on load (stays owner-triggered).
- A separate button or any new UI beyond the existing button's status messages.
- Tunable N in the UI (constants, same convention as `TOP_ARTIST_DISCOVERY_COUNT`).
