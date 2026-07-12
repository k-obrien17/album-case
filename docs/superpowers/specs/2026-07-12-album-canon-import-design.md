# Album canon import (wholesale rating replace)

## Problem

Keith has a 396-row spreadsheet (`album-canon-8-to-10-rated-and-interspersed.xlsx`) — a ChatGPT-generated re-rating and expansion of his existing album canon: his current 244 ranked albums appear in it at nearly the same relative order, re-rated on a 1-10 scale (2 decimals), interspersed with roughly 152 albums he hasn't ranked before. He wants this wholesale-adopted as the new baseline: existing albums get the file's rating (overwriting whatever they'd otherwise have), new albums get added with the file's rating as their starting point.

This depends entirely on `2026-07-12-rating-primary-architecture-design.md` being implemented first — there's no `rating` field to write into, and no "sort by rating" behavior to replace the ranked list with, until that ships.

## Scope

In scope: converting the source `.xlsx` to plain CSV (a one-time manual step, not part of the shipped script), a local Node script that reads that CSV, matches each row to a MusicBrainz release-group, backs up the current ranking snapshot, then wholesale-replaces it with the file's data, and reports any artist-lock conflicts the new data creates.

Out of scope: an in-app upload UI (Keith explicitly chose a local script over this); handling any spreadsheet format other than the fixed 5-column shape below; retrying ambiguous matches automatically (same review-needed-vs-confident-match split as the earlier bulk-list-import spec, `2026-07-11-bulk-album-list-import-design.md`, whose matching design this reuses).

## Input format

The real file's columns, confirmed directly from the `.xlsx` (via its embedded table definition, `AlbumCanonRanked`): `Ranking, Album, Artist, Year, Rating`. Example rows (already verified against the live production ranking — these are genuinely the correct top 3):

```
Ranking,Album,Artist,Year,Rating
1,OK Computer,Radiohead,1997,10
2,154,Wire,1979,9.99
3,Things We Lost in the Fire,Low,2001,9.98
```

The script reads `Album` → title, `Artist` → artist name, `Year` → release year, `Rating` → the rating to assign directly (no interpolation, no comparison — a real number already exists in the source data). `Ranking` is read only to preserve file order for matching/logging purposes; it plays no role in the final order, since `Rating` alone determines that (per the architecture spec, `ranked` is always sorted by rating).

## Matching

Reuses `/api/match-album` and the confidence-threshold logic from `2026-07-11-bulk-album-list-import-design.md` unchanged: MusicBrainz release-group search on `Artist`/`Album`, filtered to studio albums via the existing `isLpReleaseGroup` rule, single-candidate-at-score-≥90 auto-accepts, everything else needs review. Given this file was cross-checked against the live production ranking for its top 3 entries and matched exactly, most of the 244 overlapping rows should auto-match cleanly (they're the same albums Album Case already knows about, with known MBIDs); the ~152 new ones go through fresh MusicBrainz search like any other discovery.

Sequential, rate-limited (1000ms between calls, matching the earlier bulk-import spec's more conservative pacing for a large batch) — 396 rows means this script takes several minutes to run, expected and acceptable for a one-time operation.

Ambiguous/failed rows are written to a local report file (not an interactive review queue — this is a script, not the in-app UI) for Keith to check afterward; the script does not block on them or require interactive input mid-run.

## Backup

Before any write: fetch the current ranking snapshot (`GET /api/ranking`) and write it verbatim to a timestamped local file (`web/scripts/backups/ranking-snapshot-<ISO-timestamp>.json`). This is the rollback path if anything about the result is wrong — restoring means POSTing that file's content back through the existing `/api/ranking` write path. No automatic restore logic is built; this is a manual safety net, not a feature.

## The replace

For every row that resolved to a confident MusicBrainz match:
- If the album's `mbid` is already in the current `ranked` list: update its `rating` to the file's value (overwrite).
- If not: add it as a new album (title/artist/year/mbid/cover_url from MusicBrainz, `rating` from the file).

The full resulting list is then sorted by `rating` descending (per the architecture spec) and written back as the new ranking snapshot via `POST /api/ranking`, replacing the entire `ranked` array in one write.

Albums currently in `ranked` that do **not** appear anywhere in the 396-row file are left untouched, still present, at whatever rating they had before this import (their relative position may shift as new/updated ratings around them change, but their own rating is not touched by this script). The file only asserts rating for the rows it actually contains.

## Artist-lock conflict reporting

After computing the new sorted order (before writing it), check every existing lock in `artist_locks` (`web/src/ranking/locks.ts`'s `isValidOrder`) against the new arrangement. For any lock that would be violated, log a clear report: which artist, which albums, what the lock's required order was versus what the new data implies. Per Keith's explicit choice, locks are **not** auto-modified or dropped — they stay exactly as they are, and the report is purely informational for him to act on afterward (manually reorder via the app, or intentionally drop that lock if he agrees with the new order).

## Error handling

- Missing Turso env vars / missing write key: fail loudly before doing anything, same convention as every other script this session.
- A MusicBrainz search failure for one row: logged to the report file, that row skipped, script continues — same no-abort-on-one-failure tolerance as every other discovery path in this app.
- Backup write failure: abort before attempting any replace — never proceed without a confirmed-written backup.

## Testing

The row-parsing (CSV → `{ranking, album, artist, year, rating}`) and the "existing album gets updated vs. new album gets added" decision logic are pure and testable without touching MusicBrainz or Turso — colocated tests, same style as this session's other script-adjacent logic (`bulkImport.test.ts`-equivalent, once the companion bulk-import spec's matching code exists to share).

## Non-goals

- Any interactive review UI — mismatches are a report file, not a queue you resolve mid-run.
- Automatically resolving artist-lock conflicts.
- Repeating this specific import — this spec is scoped to this one file; a future differently-shaped file would need its own column-mapping check, not assumed to reuse this exact CSV shape unchanged.
