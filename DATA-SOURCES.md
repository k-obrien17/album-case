# Data sources

The database map for Taste Test's data foundation. Verified July 2026. Two research passes (open-license datasets + commercial APIs) confirmed current status, licensing, and recent changes.

This doc feeds the **data-foundation** build phase (see `PRODUCT.md` "Subsystems"). It answers: what powers the app, what each source provides, what may be stored vs only rendered live, and the one architecture rule that follows from "everything I reference ends up in my database."

## Architecture principle (decided)

**Store everything. Reference only what you already own. Use pointers for copyrighted assets.**

1. **Materialize the universe from CC0 dumps before launch.** The notability-floored MBID universe is pre-loaded so every artist is a permanent, MBID-keyed row before anyone opens the app. The app's search index is *your own database*, never a vendor's live catalog.
2. **Referenceability equals being in your DB, by construction.** A user can only rank an artist that already exists as a stored row. No user action produces a transient API result that could slip away, and nothing non-CC0 can enter through the search box.
3. **Commercial APIs never introduce an entity. They decorate one you already store.** Deezer/TheAudioDB hydrate the image and preview for an artist whose MBID your dump already gave you. They do not discover artists.
4. **Copyrighted assets are stored as pointers, not files.** Artist images and audio previews are copyrighted and forbidden from storage by vendor ToS (Deezer, Spotify). The row stores the MBID plus the vendor ID; the image and preview render live at display time. You own the reference, not the file. Everything that constitutes the data asset (identity, tags, similarity, genres, attributes) is CC0 and permanently yours.
5. **New artists enter through the next dump, not at request time.** The "reference then backfill" path runs at dump-refresh cadence (bi-weekly), always MBID-keyed, never as a thin API stub that would pollute the CC0-keyed licensable asset.

Consequence for the data-foundation phase: the spec is not just "derive the universe," it is "**materialize the universe as the searchable store**, so the app queries your DB, never a vendor's."

## Stored core (open, CC0, bulk-dumpable, the data asset you own)

Everything here is freely storable and becomes your permanent, MBID-keyed asset.

| Source | Artists | Songs / recordings | Albums / releases | Role | License | Dump cadence |
|---|---|---|---|---|---|---|
| **MusicBrainz** | ~2.6M+ | tens of M | ~4M release groups | **Identity spine.** MBID is the primary key every other set joins on. Folksonomy tags, rich relationship graph | CC0 (core data) | Full Postgres dumps twice weekly; API 1 req/sec |
| **ListenBrainz** | stats layer | stats layer | stats layer | **Similarity + popularity.** `similar-artist-selector` (seed + mode); listen-count and listener-count endpoints, all MBID-keyed. The only maintained open similarity source | Open (MetaBrainz) | Full dumps twice monthly (1st, 15th); daily incrementals |
| **Discogs** | millions | yes | ~16M+ releases | **Genres + styles** (granular controlled vocabulary), labels, credits, pressings | CC0 (text/metadata only) | Monthly XML dumps; API 60 req/min auth |
| **Wikidata** | broad, uneven | partial | partial | **Crosswalks + attribute lanes.** Best bulk join of MBID <-> Spotify ID <-> Discogs ID; properties drive "bands with X in their name" lanes | CC0 | Full RDF/JSON dumps + live SPARQL |

**Store-side gotchas**
- **Discogs images are never in the dumps.** Text is CC0; image files are API-only and not CC0. Get art from Deezer or TheAudioDB.
- **Wikidata beats MusicBrainz for ID crosswalks.** MB's Spotify links are sparse and inconsistent; Wikidata's are dense (P434 MBID, P1902 Spotify, P1953 Discogs).
- **ListenBrainz popularity skews to its own user base** (scrobbler-heavy, open-source-aware), not global streaming reality. Good relative signal, not an absolute chart.
- **MusicBrainz has no similarity, popularity, or audio features natively.** Those come from ListenBrainz (similarity/popularity) or nowhere (audio features, see below).

## Live edges (commercial, display-only, rendered not stored)

Used live to decorate rows you already own. None may be stored as a database per their ToS.

| Source | Provides | Auth / backend | Storable? | Notes |
|---|---|---|---|---|
| **Deezer** | Search, autocomplete, artist **images**, 30s **previews**, genres | None. Works from `file://`, CORS-friendly | Live only | ~50 req / 5s per IP. Best zero-setup edge for search + art + preview. Images may not be stored |
| **TheAudioDB** | Artist **images**, **bios** | Free key (public test key for prototyping) | **Yes, cacheable** | Free 30 req/min. Thinner/less-current coverage; friendliest storage terms |
| **Last.fm** | Similar artists, tags, listener counts | Free key | Gray | Requires attribution + link-back; commercial use needs written permission (partners@last.fm) |
| **Spotify** | Search, metadata, images, popularity | OAuth + backend | **No** | See below. Dropped from the design |
| **Musixmatch** | Lyrics (plain + synced) | Paid contract | Paid only | Free tier is 30% preview, non-commercial. Full lyrics require a licensed agreement |
| **Setlist.fm** | Setlists, tours | Free key | Non-commercial only | Commercial use requires contacting them |
| **Bandsintown / Songkick** | Live events | Partner approval | Gated | Not self-serve; defer unless a partner key lands |

## Decisions and changes from the prior plan

- **Spotify is dropped entirely.** `PRODUCT.md` had "Spotify only at the edges." As of Feb 11, 2026, new dev-mode apps require a Premium account, are capped at one client ID / 5 users, lost all batch endpoints, and the ToS forbids "aggregating metadata/artwork to create databases." It can't be stored, now needs a backend to search, and under the architecture rule above it has no discovery role. No role remains. **Deezer replaces it** for search, autocomplete, images, and previews, with no key and no backend.
- **AcousticBrainz is dead.** Frozen June 2022, disavowed by its own team, site offline. Do not build on it.
- **Audio features (BPM, key, mood) have no open source anymore.** AcousticBrainz is frozen and Spotify killed its audio-features endpoint (Nov 27, 2024). If a future functionality needs audio features, they must be computed in-house or bought. Out of scope for the current design.

## Coverage by functionality

What each functionality needs, and whether the source is stored or live.

| Functionality | Stored (CC0, yours) | Live edge (pointer) |
|---|---|---|
| Artist identity / dedupe | MusicBrainz MBID | — |
| Similarity lanes (auto long tail) | ListenBrainz | — |
| Genre / style tags | MusicBrainz + Discogs | — |
| Attribute lanes ("X in their name") | Wikidata + own label strings | — |
| Popularity / notability floor | ListenBrainz listen counts | — |
| Artist images | pointer only (MBID + vendor ID) | Deezer or TheAudioDB (cacheable) |
| Audio previews (30s) | pointer only | Deezer |
| Bios | (optional cache) | TheAudioDB |
| Lyrics | none (licensed) | Musixmatch (paid) |
| Setlists / tours | none (non-commercial) | Setlist.fm |
| Audio features | none available | none (compute in-house) |

## Sources

Open datasets: [MusicBrainz data license](https://musicbrainz.org/doc/About/Data_License), [Postgres dumps](https://metabrainz.org/datasets/postgres-dumps), [ListenBrainz dumps](https://listenbrainz.readthedocs.io/en/latest/users/listenbrainz-dumps.html), [ListenBrainz datasets](https://datasets.listenbrainz.org/), [Discogs Data](https://data.discogs.com/), [Discogs API terms](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use), [Wikidata WikiProject Music](https://www.wikidata.org/wiki/Wikidata:WikiProject_Music), [AcousticBrainz shutdown](https://blog.metabrainz.org/2022/02/16/acousticbrainz-making-a-hard-decision-to-end-the-project/).

Commercial APIs: [Spotify Nov 2024 changes](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api), [Spotify Feb 2026 dev access update](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security), [Spotify Extended Access criteria](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access), [Deezer API](https://developers.deezer.com/api), [Last.fm API ToS](https://www.last.fm/api/tos), [TheAudioDB API](https://www.theaudiodb.com/free_music_api), [Musixmatch plans](https://plans.apis.io/plans/musixmatch/musixmatch-plans-pricing/), [Setlist.fm API](https://api.setlist.fm/).
