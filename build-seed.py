"""Resolve the curated `web/public/seed/album-list.json` "artist / album" pairs
to real MusicBrainz release-group MBIDs, and emit the Album Case seed dataset.

TEMPORARY BOOTSTRAP (see web/public/seed/README.md): this is the MVP's
static album source while Phase 1's real universe dump is data-pending. It
is explicitly NOT the permanent catalog.

For each `{artist, album}` entry, queries the MusicBrainz release-group
search API (CC0, no key, ~1 req/sec — see DATA-SOURCES.md) for the best
primary-type "Album" release-group match, and records:
    {mbid, title, primary_artist_name, release_year, cover_url}

`cover_url` reuses the Cover Art Archive pointer template verbatim from
`pipeline/covers.py` (`cover_url_for`) — pure string construction, no image
bytes fetched or stored, matching the DATA-SOURCES.md pointer-not-file rule.

Entries that fail to resolve (no match, network error, ambiguous response)
are skipped and logged to stderr; no partial record is ever emitted.

Usage:
    python3 build-seed.py
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Allow direct invocation from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline.covers import cover_url_for  # noqa: E402

ROOT = Path(__file__).resolve().parent
ALBUM_LIST_PATH = ROOT / "web" / "public" / "seed" / "album-list.json"
ALBUMS_OUT_PATH = ROOT / "web" / "public" / "seed" / "albums.json"
ALLOWLIST_OUT_PATH = ROOT / "web" / "api" / "_allowlist.json"

MB_SEARCH_URL = "https://musicbrainz.org/ws/2/release-group/"
USER_AGENT = "AlbumCase/0.1 (keith@totalemphasis.com)"
REQUEST_INTERVAL_SECONDS = 1.1  # MusicBrainz etiquette: max ~1 req/sec


def _escape_lucene(value):
    """Escape MusicBrainz/Lucene special characters in a search term."""
    special = '+-&&||!(){}[]^"~*?:\\/'
    out = []
    for ch in value:
        if ch in special:
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


def _build_query(artist, album):
    return 'releasegroup:"{album}" AND artist:"{artist}" AND primarytype:Album'.format(
        album=_escape_lucene(album),
        artist=_escape_lucene(artist),
    )


def _fetch_release_group(artist, album):
    """Query MusicBrainz for the best release-group match for `artist`/`album`.

    Returns the raw release-group dict on success, or None if no usable
    match was found. Raises on network/HTTP failure so the caller can log
    and skip.
    """
    query = _build_query(artist, album)
    params = urllib.parse.urlencode({"query": query, "fmt": "json", "limit": "5"})
    url = f"{MB_SEARCH_URL}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    groups = data.get("release-groups") or []
    album_groups = [g for g in groups if g.get("primary-type") == "Album" and g.get("id")]

    # Prefer the highest-scoring plain studio album (no secondary type, e.g.
    # not a "Remix"/"Compilation"/"Live" variant); results already arrive
    # sorted by score descending, so the first match in each pass wins.
    for group in album_groups:
        if not group.get("secondary-types"):
            return group
    return album_groups[0] if album_groups else None


def _release_year(group):
    date = group.get("first-release-date") or ""
    year_str = date.split("-", 1)[0]
    if year_str.isdigit():
        return int(year_str)
    return None


def _primary_artist_name(group, fallback):
    credits = group.get("artist-credit") or []
    if credits and credits[0].get("name"):
        return credits[0]["name"]
    return fallback


def resolve_albums(entries):
    """Resolve each `{artist, album}` entry to a seed record.

    Returns (records, skipped) where `records` is the list of successfully
    resolved seed dicts and `skipped` is the list of (artist, album, reason)
    tuples for entries that could not be resolved.
    """
    records = []
    skipped = []

    for i, entry in enumerate(entries):
        artist = entry["artist"]
        album = entry["album"]

        try:
            group = _fetch_release_group(artist, album)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            print(f"[skip] {artist} / {album}: request failed ({exc})", file=sys.stderr)
            skipped.append((artist, album, str(exc)))
            group = None
        except Exception as exc:  # noqa: BLE001 — log and continue, never crash the run
            print(f"[skip] {artist} / {album}: unexpected error ({exc})", file=sys.stderr)
            skipped.append((artist, album, str(exc)))
            group = None

        if group is None:
            if not skipped or skipped[-1][:2] != (artist, album):
                print(f"[skip] {artist} / {album}: no primary-type Album match", file=sys.stderr)
                skipped.append((artist, album, "no match"))
        else:
            mbid = group["id"]
            records.append(
                {
                    "mbid": mbid,
                    "title": group.get("title") or album,
                    "primary_artist_name": _primary_artist_name(group, artist),
                    "release_year": _release_year(group),
                    "cover_url": cover_url_for(mbid),
                }
            )

        # Rate-limit politely regardless of outcome, except after the last entry.
        if i < len(entries) - 1:
            time.sleep(REQUEST_INTERVAL_SECONDS)

    return records, skipped


def main():
    entries = json.loads(ALBUM_LIST_PATH.read_text())
    print(f"Resolving {len(entries)} curated album entries via MusicBrainz...")

    records, skipped = resolve_albums(entries)

    # De-duplicate by mbid in case two entries resolve to the same release group.
    seen = set()
    deduped = []
    for record in records:
        if record["mbid"] in seen:
            continue
        seen.add(record["mbid"])
        deduped.append(record)

    ALBUMS_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ALBUMS_OUT_PATH.write_text(json.dumps(deduped, indent=2) + "\n")

    ALLOWLIST_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    allowlist = [record["mbid"] for record in deduped]
    ALLOWLIST_OUT_PATH.write_text(json.dumps(allowlist, indent=2) + "\n")

    print(f"Resolved: {len(deduped)}  Skipped: {len(skipped)}  Total input: {len(entries)}")
    print(f"Wrote {ALBUMS_OUT_PATH.relative_to(ROOT)}")
    print(f"Wrote {ALLOWLIST_OUT_PATH.relative_to(ROOT)}")

    if len(deduped) < 200:
        print(
            f"WARNING: only {len(deduped)} albums resolved, below the 200 minimum.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
