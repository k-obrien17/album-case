"""Streaming loader for MusicBrainz release-group-related table dumps into
SQLite staging tables.

Reads mbdump TSV table files line-by-line (never a whole-file `.read()`),
so memory stays bounded regardless of dump size (the real dump's
`release_group` table alone is millions of rows). Malformed lines (wrong
field count, non-integer where an integer is expected) are skipped and
counted rather than aborting the whole load.

Only the release-group-scoped tables needed to build an album row are
loaded: `release_group`, `release_group_meta`, `artist_credit_name`,
`artist`. This deliberately does NOT load `release`, edit history, or
cover-art tables (see 01-02-PLAN.md dump_sources).

Column indices below are pinned as named constants, derived from the
current musicbrainz-server schema (admin/sql/CreateTables.sql and
admin/sql/InsertDefaultRows.sql, fetched from
github.com/metabrainz/musicbrainz-server on 2026-07-04). MusicBrainz has
changed table column order across schema versions before -- re-verify
these constants against the schema file shipped alongside the actual
mbdump export before a production load (01-03's operator step); a schema
drift should fail loudly via the pinned-index test in test_ingest.py.

`release_group_primary_type` id 1 = 'Album' per InsertDefaultRows.sql;
Various Artists is real MB artist gid
89ad4ac3-39f7-470e-963a-56509c546377 and is handled, not filtered.

CC0 core data license: https://musicbrainz.org/doc/About/Data_License

Truncate-and-reload: each table's staging rows are deleted before the
reload, and the delete + reinsert for a table share one transaction, so a
failed load never leaves that staging table empty (symmetric with
ingest_listenbrainz.py's truncate-and-reload).

Usage:
    python3 pipeline/ingest_musicbrainz.py --mbdump-dir /path/to/mbdump --db data/tastetest.db
"""
import argparse
import logging
import sys
from pathlib import Path

# Allow `python3 pipeline/ingest_musicbrainz.py` direct invocation (Python
# puts the script's own directory on sys.path[0], not the project root)
# as well as `python3 -m pipeline.ingest_musicbrainz` / package import.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.db import DEFAULT_DB_PATH, connect  # noqa: E402

logger = logging.getLogger(__name__)

_STAGING_SQL_PATH = Path(__file__).parent / "staging.sql"

NULL_MARKER = "\\N"
BATCH_SIZE = 10_000

# --- release_group ---
# id, gid, name, artist_credit, type, comment, edits_pending, last_updated
RG_COL_ID = 0
RG_COL_GID = 1
RG_COL_NAME = 2
RG_COL_ARTIST_CREDIT = 3
RG_COL_TYPE = 4
RG_EXPECTED_COLS = 8

# --- release_group_meta ---
# id, release_count, first_release_date_year, first_release_date_month,
# first_release_date_day, rating, rating_count
RGM_COL_ID = 0
RGM_COL_FIRST_RELEASE_YEAR = 2
RGM_EXPECTED_COLS = 7

# --- artist_credit_name ---
# artist_credit, position, artist, name, join_phrase
ACN_COL_ARTIST_CREDIT = 0
ACN_COL_POSITION = 1
ACN_COL_ARTIST = 2
ACN_COL_NAME = 3
ACN_EXPECTED_COLS = 5

# --- artist ---
# id, gid, name, sort_name, begin_date_year, begin_date_month,
# begin_date_day, end_date_year, end_date_month, end_date_day, type, area,
# gender, comment, edits_pending, last_updated, ended, begin_area, end_area
ARTIST_COL_ID = 0
ARTIST_COL_GID = 1
ARTIST_COL_NAME = 2
ARTIST_EXPECTED_COLS = 19

# Real mbdump table files carry no extension and are named exactly like
# the Postgres table (e.g. `mbdump/release_group`). The test suite passes
# its own `table_filenames` override to point at the `mb_*.sample.tsv`
# fixtures instead.
DEFAULT_TABLE_FILENAMES = {
    "release_group": "release_group",
    "release_group_meta": "release_group_meta",
    "artist_credit_name": "artist_credit_name",
    "artist": "artist",
}


def _parse_null(value):
    return None if value == NULL_MARKER else value


def _parse_int(value):
    value = _parse_null(value)
    if value is None:
        return None
    return int(value)


def _iter_lines(path):
    """Stream non-empty, newline-stripped lines from `path` one at a time."""
    with open(path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.rstrip("\n")
            if line:
                yield line


def _flush(conn, sql, batch):
    if batch:
        conn.executemany(sql, batch)
        batch.clear()


def _load_release_group(conn, path):
    insert_sql = (
        "INSERT INTO stg_release_group (rg_id, mbid, title, artist_credit, primary_type) "
        "VALUES (?, ?, ?, ?, ?)"
    )
    loaded = skipped = 0
    batch = []
    with conn:
        conn.execute("DELETE FROM stg_release_group")
        for line in _iter_lines(path):
            fields = line.split("\t")
            if len(fields) != RG_EXPECTED_COLS:
                skipped += 1
                continue
            try:
                rg_id = _parse_int(fields[RG_COL_ID])
                artist_credit = _parse_int(fields[RG_COL_ARTIST_CREDIT])
                primary_type = _parse_int(fields[RG_COL_TYPE])
            except ValueError:
                skipped += 1
                continue
            mbid = _parse_null(fields[RG_COL_GID])
            title = _parse_null(fields[RG_COL_NAME])
            if rg_id is None or mbid is None:
                skipped += 1
                continue
            batch.append((rg_id, mbid, title, artist_credit, primary_type))
            loaded += 1
            if len(batch) >= BATCH_SIZE:
                _flush(conn, insert_sql, batch)
        _flush(conn, insert_sql, batch)
    if skipped:
        logger.warning("release_group: skipped %d malformed line(s)", skipped)
    return loaded, skipped


def _load_release_group_meta(conn, path):
    insert_sql = (
        "INSERT INTO stg_release_group_meta (rg_id, first_release_year) VALUES (?, ?)"
    )
    loaded = skipped = 0
    batch = []
    with conn:
        conn.execute("DELETE FROM stg_release_group_meta")
        for line in _iter_lines(path):
            fields = line.split("\t")
            if len(fields) != RGM_EXPECTED_COLS:
                skipped += 1
                continue
            try:
                rg_id = _parse_int(fields[RGM_COL_ID])
                first_release_year = _parse_int(fields[RGM_COL_FIRST_RELEASE_YEAR])
            except ValueError:
                skipped += 1
                continue
            if rg_id is None:
                skipped += 1
                continue
            batch.append((rg_id, first_release_year))
            loaded += 1
            if len(batch) >= BATCH_SIZE:
                _flush(conn, insert_sql, batch)
        _flush(conn, insert_sql, batch)
    if skipped:
        logger.warning("release_group_meta: skipped %d malformed line(s)", skipped)
    return loaded, skipped


def _load_artist_credit_name(conn, path):
    insert_sql = (
        "INSERT INTO stg_artist_credit_name (artist_credit, position, artist_id, credited_name) "
        "VALUES (?, ?, ?, ?)"
    )
    loaded = skipped = 0
    batch = []
    with conn:
        conn.execute("DELETE FROM stg_artist_credit_name")
        for line in _iter_lines(path):
            fields = line.split("\t")
            if len(fields) != ACN_EXPECTED_COLS:
                skipped += 1
                continue
            try:
                artist_credit = _parse_int(fields[ACN_COL_ARTIST_CREDIT])
                position = _parse_int(fields[ACN_COL_POSITION])
                artist_id = _parse_int(fields[ACN_COL_ARTIST])
            except ValueError:
                skipped += 1
                continue
            if artist_credit is None or artist_id is None:
                skipped += 1
                continue
            credited_name = _parse_null(fields[ACN_COL_NAME])
            batch.append((artist_credit, position, artist_id, credited_name))
            loaded += 1
            if len(batch) >= BATCH_SIZE:
                _flush(conn, insert_sql, batch)
        _flush(conn, insert_sql, batch)
    if skipped:
        logger.warning("artist_credit_name: skipped %d malformed line(s)", skipped)
    return loaded, skipped


def _load_artist(conn, path):
    insert_sql = "INSERT INTO stg_artist (artist_id, mbid, name) VALUES (?, ?, ?)"
    loaded = skipped = 0
    batch = []
    with conn:
        conn.execute("DELETE FROM stg_artist")
        for line in _iter_lines(path):
            fields = line.split("\t")
            if len(fields) != ARTIST_EXPECTED_COLS:
                skipped += 1
                continue
            try:
                artist_id = _parse_int(fields[ARTIST_COL_ID])
            except ValueError:
                skipped += 1
                continue
            mbid = _parse_null(fields[ARTIST_COL_GID])
            name = _parse_null(fields[ARTIST_COL_NAME])
            if artist_id is None or mbid is None:
                skipped += 1
                continue
            batch.append((artist_id, mbid, name))
            loaded += 1
            if len(batch) >= BATCH_SIZE:
                _flush(conn, insert_sql, batch)
        _flush(conn, insert_sql, batch)
    if skipped:
        logger.warning("artist: skipped %d malformed line(s)", skipped)
    return loaded, skipped


_LOADERS = {
    "release_group": _load_release_group,
    "release_group_meta": _load_release_group_meta,
    "artist_credit_name": _load_artist_credit_name,
    "artist": _load_artist,
}


def load_musicbrainz_staging(conn, mbdump_dir, table_filenames=None):
    """Stream the four release-group-scoped mbdump table files under
    `mbdump_dir` into SQLite staging tables, truncating each staging table
    first. Returns {table_name: {"loaded": int, "skipped": int}}.

    `table_filenames` optionally overrides the real mbdump file names
    (used by the test suite to point at the `mb_*.sample.tsv` fixtures).
    """
    conn.executescript(_STAGING_SQL_PATH.read_text())
    mbdump_dir = Path(mbdump_dir)
    filenames = {**DEFAULT_TABLE_FILENAMES, **(table_filenames or {})}
    stats = {}
    for table_name, filename in filenames.items():
        path = mbdump_dir / filename
        loaded, skipped = _LOADERS[table_name](conn, path)
        stats[table_name] = {"loaded": loaded, "skipped": skipped}
    return stats


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(
        description="Stream MusicBrainz release-group table dumps into SQLite staging."
    )
    parser.add_argument(
        "--mbdump-dir",
        required=True,
        help="Path to the unpacked mbdump directory containing release_group, "
        "release_group_meta, artist_credit_name, and artist table files.",
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB_PATH,
        help=f"Path to the SQLite store (default: {DEFAULT_DB_PATH}).",
    )
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        stats = load_musicbrainz_staging(conn, args.mbdump_dir)
        for table_name, counts in stats.items():
            logger.info(
                "%s: loaded %d row(s), skipped %d malformed line(s)",
                table_name,
                counts["loaded"],
                counts["skipped"],
            )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
