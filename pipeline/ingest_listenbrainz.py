"""Streaming loader for the ListenBrainz release-group popularity dump into
the SQLite `stg_popularity` staging table.

Reads a JSON-lines file line-by-line (never a whole-file `.read()`), so
memory stays bounded regardless of dump size. Malformed/empty JSON lines
are skipped and counted rather than aborting the whole load. Per
01-02-PLAN.md's dump_sources: if the source dump ships as parquet, convert
it to JSONL first (e.g. via `pandas.read_parquet(...).to_json(path,
orient="records", lines=True)` or `pyarrow`) -- this parser is JSONL-only
by design, keeping the ingest path stdlib-only.

Key names are pinned as named constants below, with tolerance for
alternate key names that may appear in the actual dump (the primary names
match 01-02-PLAN.md's dump_sources record shape: release_group_mbid,
total_listen_count, total_listener_count).

ListenBrainz popularity dataset: https://datasets.listenbrainz.org/
Open (MetaBrainz) license.

Truncate-and-reload: `stg_popularity` is deleted before the reload, and
the delete + reinsert share one transaction, so a failed load never
leaves the table empty (symmetric with ingest_musicbrainz.py).

Usage:
    python3 pipeline/ingest_listenbrainz.py --popularity /path/to/popularity.jsonl --db data/tastetest.db
"""
import argparse
import json
import logging
import sys
from pathlib import Path

# Allow `python3 pipeline/ingest_listenbrainz.py` direct invocation (Python
# puts the script's own directory on sys.path[0], not the project root)
# as well as `python3 -m pipeline.ingest_listenbrainz` / package import.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.db import DEFAULT_DB_PATH, connect  # noqa: E402

logger = logging.getLogger(__name__)

_STAGING_SQL_PATH = Path(__file__).parent / "staging.sql"

BATCH_SIZE = 10_000

# Pinned key names, primary first, with tolerated alternates.
MBID_KEYS = ("release_group_mbid", "release_group_gid")
LISTEN_COUNT_KEYS = ("total_listen_count", "listen_count")
LISTENER_COUNT_KEYS = ("total_listener_count", "listener_count")


def _first_present(record, keys):
    for key in keys:
        if key in record:
            return record[key]
    return None


def _iter_lines(path):
    """Stream non-empty, newline-stripped lines from `path` one at a time."""
    with open(path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.rstrip("\n")
            if line:
                yield line


def load_listenbrainz_staging(conn, popularity_path):
    """Stream `popularity_path` (JSONL) into `stg_popularity`, truncating
    the table first. Returns {"loaded": int, "skipped": int}.
    """
    conn.executescript(_STAGING_SQL_PATH.read_text())

    insert_sql = (
        "INSERT OR REPLACE INTO stg_popularity "
        "(release_group_mbid, listen_count, listener_count) VALUES (?, ?, ?)"
    )
    loaded = skipped = 0
    batch = []
    with conn:
        conn.execute("DELETE FROM stg_popularity")
        for line in _iter_lines(popularity_path):
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            if not isinstance(record, dict):
                skipped += 1
                continue
            mbid = _first_present(record, MBID_KEYS)
            if not mbid:
                skipped += 1
                continue
            listen_count = _first_present(record, LISTEN_COUNT_KEYS)
            listener_count = _first_present(record, LISTENER_COUNT_KEYS)
            if listener_count is None:
                listener_count = 0
            if listen_count is None:
                listen_count = 0
            batch.append((mbid, listen_count, listener_count))
            loaded += 1
            if len(batch) >= BATCH_SIZE:
                conn.executemany(insert_sql, batch)
                batch.clear()
        if batch:
            conn.executemany(insert_sql, batch)
    if skipped:
        logger.warning("popularity: skipped %d malformed line(s)", skipped)
    return {"loaded": loaded, "skipped": skipped}


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(
        description="Stream the ListenBrainz release-group popularity dump into SQLite staging."
    )
    parser.add_argument(
        "--popularity",
        required=True,
        help="Path to the popularity JSONL file (convert from parquet first if needed).",
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB_PATH,
        help=f"Path to the SQLite store (default: {DEFAULT_DB_PATH}).",
    )
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        stats = load_listenbrainz_staging(conn, args.popularity)
        logger.info(
            "popularity: loaded %d row(s), skipped %d malformed line(s)",
            stats["loaded"],
            stats["skipped"],
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
