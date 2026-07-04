"""Populate `entities.cover_url` for album rows with a Cover Art Archive
front-cover pointer, constructed by template from each album's own MBID.

DATA-03 + DATA-SOURCES.md architecture rule ("copyrighted assets are stored
as pointers, not files"): the store holds only the constructed URL string.
No HTTP request is issued to verify the URL resolves, and no image bytes
are ever fetched or copied. `cover_url_for` is pure string interpolation;
`apply_cover_pointers` issues one parameterized UPDATE per album row scoped
to `entity_type = 'album'`.

This module performs zero network I/O by construction: it opens no
outbound connection of any kind. A test in test_covers.py proves the
store still succeeds with the network layer disabled at the transport
level.

Usage:
    python3 pipeline/covers.py --db data/tastetest.db
"""
import argparse
import sys
from pathlib import Path

# Allow `python3 pipeline/covers.py` direct invocation (Python puts the
# script's own directory on sys.path[0], not the project root) as well as
# `python3 -m pipeline.covers` / package import.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.db import DEFAULT_DB_PATH, connect, now_ms  # noqa: E402

_COVER_URL_TEMPLATE = "https://coverartarchive.org/release-group/{mbid}/front-500"

_UPDATE_SQL = """
    UPDATE entities
    SET cover_url = ?, updated_at = ?
    WHERE entity_type = 'album' AND mbid = ?
"""


def cover_url_for(mbid):
    """Return the Cover Art Archive front-cover pointer URL for `mbid`.

    Pure string construction -- no network I/O, no verification that the
    URL resolves.
    """
    return _COVER_URL_TEMPLATE.format(mbid=mbid)


def apply_cover_pointers(conn):
    """Set `cover_url` on every `entities` row with `entity_type = 'album'`
    to its per-MBID Cover Art Archive pointer.

    Idempotent: recomputes and re-sets the same deterministic pointer on
    every call, never inserting rows or raising. Non-album entity rows are
    untouched (the UPDATE is scoped by `entity_type = 'album'`).

    Returns the number of album rows updated.
    """
    rows = conn.execute(
        "SELECT mbid FROM entities WHERE entity_type = 'album'"
    ).fetchall()

    now = now_ms()
    updated = 0
    with conn:
        for row in rows:
            mbid = row["mbid"]
            conn.execute(_UPDATE_SQL, (cover_url_for(mbid), now, mbid))
            updated += 1

    return updated


def main():
    parser = argparse.ArgumentParser(
        description="Populate entities.cover_url with Cover Art Archive pointers."
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB_PATH,
        help=f"Path to the SQLite store (default: {DEFAULT_DB_PATH}).",
    )
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        updated = apply_cover_pointers(conn)
        print(f"cover pointers set: {updated}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
