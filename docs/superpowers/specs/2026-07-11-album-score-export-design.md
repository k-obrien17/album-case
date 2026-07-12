# Derived album scores + keithrobrien.com albums page

> **Correction (post-approval):** the original version of this spec assumed `content/collect/music.json` was an existing, wired-up stub waiting for this data. Verified false: nothing in the `keithrobrien` repo reads that file. The real `/collect/music` page reads unrelated hand-curated *songs-of-the-year* data (`content/collect/year/<year>.json`, Spotify links, tracks) — a different, pre-existing feature that has nothing to do with albums. The proven, actually-wired-up pattern is `/collect/watching`, which genuinely does `import data from "@/content/collect/watching.json"`. This version targets a new `content/collect/albums.json` and a new `/collect/albums` page, modeled on `/collect/watching`, instead of the (non-existent) music.json integration point.

## Problem

There's a proven pattern for movies: `media-library/scripts/export-collect-watching.mjs` reads that app's own database read-only and writes a static `watching.json` into the `keithrobrien` repo; `app/collect/watching/page.tsx` renders it at build time with no runtime coupling. Album Case has no equivalent, and needs both a new export script and a new page — there's no existing stub to slot into. Unlike movies, where a score is a number someone typed in per film, Album Case's ranked list already carries more precise information than a score: an exact ordinal position, earned through real pairwise comparisons.

## Scope

In scope:
1. A score formula computed only at export time.
2. A new script in Album Case, `web/scripts/export-collect-albums.mjs`, that reads the owner's ranking snapshot from Turso and writes `content/collect/albums.json` into the `keithrobrien` repo.
3. A new page in `keithrobrien`, `/collect/albums`, modeled directly on `/collect/watching`, reading that JSON.

Out of scope: any change to Album Case's own schema, data model, or UI (no score is ever stored or displayed inside the app itself); a per-year/per-decade cut or a "recently ranked" cut (`/collect/watching` has both; this v1 has neither — see Non-goals); the already-approved bulk-album-list-import spec (`2026-07-11-bulk-album-list-import-design.md`) — unaffected, since imported albums flow through the same ranked-list mechanism as everything else and pick up a derived score automatically once genuinely placed.

## Why derived, not stored (the core decision)

Media-library's `score` is a genuinely independent number a person typed in — appropriate there, since that product has no ordinal ranking model at all. Album Case's own core rule, from `web/src/ranking/insertion.ts`'s doc comment, is the opposite: *"transitive by construction... NOT Elo. There are no ratings, scores, or probabilistic outcomes here, only ordinal position."* Storing a score field on albums would be exactly the class of model that rule exists to rule out.

Resolution: score is computed only at export time, from rank position, in the export script — never persisted in Turso, never added to any API response, never shown anywhere in the app's own UI. Album Case's core stays completely untouched; the score only exists as a number printed into a JSON file for a different website to read.

## Score formula

```
raw(rank, total) = 1 + 9 * (total - rank) / (total - 1)
score(rank, total) = Math.round(raw(rank, total) * 100) / 100   // 2 decimal places
```

- Rank 1 (best) → `10.00`; rank `total` (worst) → `1.00`.
- **Two decimal places, not one.** Verified empirically before locking this in: at 1 decimal (matching movies), 244 ranked albums collapse to 91 distinct values, worst case 3 albums sharing one number — including a tie between rank #1 and rank #2. At 2 decimals: 244 distinct values, zero ties. Movies use 1 decimal because it's a hand-typed human number; Album Case's score is formula-derived from an exact position, so the extra precision is honest, not fake.
- Score is a strictly monotonic function of rank, so "top N by score" and "top N by rank" are the same set of albums — the formula only supplies the display number, never the selection.

## Export script (lives in Album Case)

`web/scripts/export-collect-albums.mjs`, modeled directly on `media-library/scripts/export-collect-watching.mjs`:

- Read-only against the same Turso database the app already uses (`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`), queried directly via `@libsql/client` (already a dependency) — no HTTP round-trip through the deployed API.
- Fetches the owner's current ranking snapshot: `SELECT ranking_json FROM ranking_snapshots WHERE session_id = ?` (same table `/api/ranking` already reads), parses `ranking_json` as `Album[]` (already in exact rank order, index 0 = best).
- Takes the top N (default 10, matching movies' `top_movies` cut; overridable via a `TOP_N` env var).
- Maps each album to:
  ```json
  { "title": "...", "artist": "...", "year": 2000, "score": 10.0, "type": "album", "mb_url": "https://musicbrainz.org/release-group/<mbid>" }
  ```
  `artist` = `primary_artist_name`, `year` = `release_year`, `mb_url` plays the same role `tmdb_url` does for movies (a canonical external link, built from the album's existing `mbid`).
- Output path defaults to the sibling `../../keithrobrien/content/collect/albums.json`, overridable via `COLLECT_OUT` — same convention as the movies script.
- Full payload:
  ```json
  {
    "generated_at": "2026-07-11",
    "source": "album-case",
    "note": "Generated by album-case/web/scripts/export-collect-albums.mjs. Do not hand-edit.",
    "top_albums": [ /* ... */ ]
  }
  ```
- Env loading: no dotenv dependency added. Invoked as `node --env-file=web/.env.local web/scripts/export-collect-albums.mjs` (Node 20.6+'s built-in flag; this machine runs Node 24), matching the "no new dependencies" constraint.

## Page (lives in keithrobrien)

`app/collect/albums/page.tsx`, modeled directly on `app/collect/watching/page.tsx`:

- Imports `content/collect/albums.json` directly (build-time static import, no fetch).
- One section, "Top 10 albums" (or whatever `TOP_N` produced), reusing the existing `Container`/`Section` components and the same row layout as `/collect/watching`'s `top_movies` list: rank number, linked title (year in parens), score right-aligned via the same `Meta`/`toFixed` display pattern.
- Title link goes to `mb_url` (MusicBrainz release-group page) when present, plain text otherwise — same conditional-link pattern as `/collect/watching`'s `TitleCell`.
- No per-year section, no "recently ranked" section, no TV-equivalent — this page has exactly one section in v1 (see Non-goals).
- Needs its own metadata block (title "Albums", description, canonical `/collect/albums`, OG/Twitter tags) matching the existing pages' pattern, and a nav entry wherever `/collect/watching` is currently linked from (the collect index page) so it's actually reachable.

## Running it

Manual, on-demand — same as the movies script: no cron, no CI hook, no git commit hook. Keith runs the export script in Album Case after a ranking session, reviews the diff in the `keithrobrien` repo, and commits it there himself. The page itself is built once and doesn't need re-touching after that — only the JSON changes on subsequent runs.

## Error handling

- Fewer than N albums ranked: export whatever exists, no error. (No `min_pool` gate like `watching-annual.json`'s per-year cuts — that gate exists there because a thin per-year bucket looks broken; a single all-time top-N list doesn't have that failure mode.)
- Missing Turso env vars: fail loudly to stderr with a non-zero exit, matching the existing pipeline scripts' convention — never silently write an empty or stale file over a real one.
- `keithrobrien` repo not present at the expected sibling path: fail with a clear message pointing at `COLLECT_OUT`, same guard the movies script already has.
- Page renders zero albums (e.g. `albums.json` was never generated yet): show the same `ComingSoon` component the other collect pages already use for an empty state, rather than a blank section.

## Testing

Media-library's own `export-collect-watching.mjs` has no test file — this class of script isn't part of that project's test surface, and Album Case's own convention (`CLAUDE.md`: tests only when asked) matches. The score formula was validated by hand before being locked in (see the tie-count comparison above); no colocated test is planned unless requested. The `keithrobrien` page follows that repo's own existing conventions for its collect pages — no test framework is in use there for pages either.

## Non-goals

- Per-year/per-decade cuts, or a "recently ranked" cut — deferred until a flat top-N list feels too thin to be interesting.
- Any score field, column, or UI surface inside Album Case itself.
- Automatic/scheduled regeneration — stays a manual, reviewed step, same as movies.
- Any change to the bulk-album-list-import spec.
- Touching `content/collect/music.json` or the songs-of-the-year feature in any way — fully separate, untouched.
