"""Materialize the notability-floored album universe into `entities`.

Joins the staging tables (pipeline/staging.sql, populated by
ingest_musicbrainz.py + ingest_listenbrainz.py) into `entities` rows
keyed `(entity_type='album', mbid)`:

    stg_release_group      -- release-group identity + primary_type
      JOIN stg_popularity      ON release-group mbid  (popularity/floor)
      JOIN stg_artist_credit_name (position = 0)  -- primary artist credit
      JOIN stg_artist          ON artist_id           (primary artist identity)
      LEFT JOIN stg_release_group_meta ON rg_id        (first release year)

Only primary-type Album or EP release-groups with no secondary type
(release_group_primary_type ids pinned below) that clear
NOTABILITY_MIN_LISTENERS survive the join. Each row records release_type
('Album' or 'EP').

The whole join is one parameterized, set-based
`INSERT ... SELECT ... ON CONFLICT(entity_type, mbid) DO UPDATE` statement
(T-01-07: no interpolated SQL, min_listeners is a bound parameter). Because
`created_at` is excluded from the UPDATE SET list, re-running this over a
refreshed dump upserts in place: existing albums update, new albums
insert, and created_at is preserved across refreshes (DATA-05).

Usage:
    python3 pipeline/materialize.py --db data/tastetest.db
    python3 pipeline/materialize.py --db data/tastetest.db --min-listeners 100
    python3 pipeline/materialize.py --db data/tastetest.db --verify
"""
import argparse
import json
import logging
import sys
from pathlib import Path

# Allow `python3 pipeline/materialize.py` direct invocation (Python puts
# the script's own directory on sys.path[0], not the project root) as
# well as `python3 -m pipeline.materialize` / package import.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.config import NOTABILITY_MIN_LISTENERS  # noqa: E402
from pipeline.db import DEFAULT_DB_PATH, connect, init_db, now_ms  # noqa: E402

logger = logging.getLogger(__name__)

# release_group_primary_type id 1 = 'Album', per musicbrainz-server's
# admin/sql/InsertDefaultRows.sql (confirmed live in Plan 02, see
# ingest_musicbrainz.py's module docstring). Pinned here as a named
# constant rather than a bare literal in the query below.
ALBUM_PRIMARY_TYPE_ID = 1

# release_group_primary_type id 3 = 'EP'. Not in InsertDefaultRows.sql, so
# it's confirmed against the real dump's release_group_primary_type table
# before each production build (plan 2026-09-24-album-catalog, Task 7).
EP_PRIMARY_TYPE_ID = 3

# A release group with ANY secondary type (Live, Compilation, Soundtrack,
# Remix, ...) is excluded, matching web/api/_lp.ts's isAlbumOrEpReleaseGroup.
_NO_SECONDARY_TYPE_SQL = """
    NOT EXISTS (
        SELECT 1 FROM stg_release_group_secondary_type st
        WHERE st.rg_id = rg.rg_id
    )
"""

# Dedup subquery for the primary (position=0) artist-credit-name row.
# stg_artist_credit_name has no uniqueness constraint on (artist_credit,
# position), so a duplicate position=0 row for the same artist_credit
# would otherwise fan out the join below -- silently mis-attributing an
# album to whichever duplicate SQLite's row order happens to process last,
# and inflating _CANDIDATE_COUNT_SQL's row count past the true number of
# distinct release-groups. Grouping by artist_credit and taking
# MIN(artist_id) collapses any duplicate to exactly one deterministic
# winner before it ever reaches the identity join.
_PRIMARY_ARTIST_CREDIT_SQL = """
    SELECT artist_credit, MIN(artist_id) AS artist_id
    FROM stg_artist_credit_name
    WHERE position = 0
    GROUP BY artist_credit
"""

_CANDIDATE_COUNT_SQL = f"""
    SELECT COUNT(DISTINCT rg.mbid)
    FROM stg_release_group rg
    JOIN stg_popularity pop ON pop.release_group_mbid = rg.mbid
    JOIN ({_PRIMARY_ARTIST_CREDIT_SQL}) acn
        ON acn.artist_credit = rg.artist_credit
    JOIN stg_artist a ON a.artist_id = acn.artist_id
    WHERE rg.primary_type IN (?, ?)
      AND {_NO_SECONDARY_TYPE_SQL}
      AND pop.listener_count >= ?
"""
# COUNT(DISTINCT rg.mbid) rather than COUNT(*): even with the dedup join
# above, this keeps the reported total tied to the true number of
# candidate release-groups rather than the raw join row count, so any
# future fan-out (e.g. from a different join added later) shows up as a
# visible discrepancy instead of silently inflating the stats.

_UPSERT_SQL = f"""
    INSERT INTO entities (
        entity_type, mbid, title, primary_artist_name, primary_artist_mbid,
        release_year, notability_score, created_at, updated_at, release_type
    )
    SELECT
        'album' AS entity_type,
        rg.mbid AS mbid,
        rg.title AS title,
        a.name AS primary_artist_name,
        a.mbid AS primary_artist_mbid,
        rgm.first_release_year AS release_year,
        pop.listener_count AS notability_score,
        ? AS created_at,
        ? AS updated_at
        , CASE WHEN rg.primary_type = ? THEN 'EP' ELSE 'Album' END AS release_type
    FROM stg_release_group rg
    JOIN stg_popularity pop ON pop.release_group_mbid = rg.mbid
    JOIN ({_PRIMARY_ARTIST_CREDIT_SQL}) acn
        ON acn.artist_credit = rg.artist_credit
    JOIN stg_artist a ON a.artist_id = acn.artist_id
    LEFT JOIN stg_release_group_meta rgm ON rgm.rg_id = rg.rg_id
    WHERE rg.primary_type IN (?, ?)
      AND {_NO_SECONDARY_TYPE_SQL}
      AND pop.listener_count >= ?
    ON CONFLICT(entity_type, mbid) DO UPDATE SET
        release_type = excluded.release_type,
        title = excluded.title,
        primary_artist_name = excluded.primary_artist_name,
        primary_artist_mbid = excluded.primary_artist_mbid,
        release_year = excluded.release_year,
        notability_score = excluded.notability_score,
        updated_at = excluded.updated_at
"""
# created_at is deliberately absent from the UPDATE SET list above -- it
# is set once on insert and never touched again, which is what makes a
# refreshed-dump re-run idempotent (DATA-05) instead of resetting history.


def materialize_albums(conn, min_listeners=NOTABILITY_MIN_LISTENERS):
    """Join staging tables into `entities` album rows, gated on the
    notability floor, upserting on (entity_type, mbid).

    Returns {"inserted": int, "updated": int, "total": int} where `total`
    is the number of rows the join produced this run (inserted + updated).
    """
    init_db(conn)  # idempotent; ensures `entities` exists before the join
    now = now_ms()

    before = conn.execute(
        "SELECT COUNT(*) FROM entities WHERE entity_type = 'album'"
    ).fetchone()[0]

    with conn:
        conn.execute(
            _UPSERT_SQL,
            (now, now, EP_PRIMARY_TYPE_ID, ALBUM_PRIMARY_TYPE_ID, EP_PRIMARY_TYPE_ID, min_listeners),
        )

    after = conn.execute(
        "SELECT COUNT(*) FROM entities WHERE entity_type = 'album'"
    ).fetchone()[0]

    candidate_total = conn.execute(
        _CANDIDATE_COUNT_SQL, (ALBUM_PRIMARY_TYPE_ID, EP_PRIMARY_TYPE_ID, min_listeners)
    ).fetchone()[0]

    inserted = after - before
    updated = candidate_total - inserted
    return {"inserted": inserted, "updated": updated, "total": candidate_total}


def verify_universe(conn, min_listeners=NOTABILITY_MIN_LISTENERS):
    """Report the shape of the materialized album universe so an operator
    can confirm Phase 1 success criterion 1 (tens of thousands, every row
    carrying MBID/title/primary artist name+MBID/year) with one call.
    """
    total = conn.execute(
        "SELECT COUNT(*) FROM entities WHERE entity_type = 'album'"
    ).fetchone()[0]

    all_required_columns_populated = conn.execute(
        """
        SELECT COUNT(*) FROM entities
        WHERE entity_type = 'album'
          AND mbid IS NOT NULL
          AND title IS NOT NULL
          AND primary_artist_name IS NOT NULL
          AND primary_artist_mbid IS NOT NULL
        """
    ).fetchone()[0]

    year_min, year_max = conn.execute(
        "SELECT MIN(release_year), MAX(release_year) FROM entities WHERE entity_type = 'album'"
    ).fetchone()

    below_floor = conn.execute(
        "SELECT COUNT(*) FROM entities WHERE entity_type = 'album' AND notability_score < ?",
        (min_listeners,),
    ).fetchone()[0]

    return {
        "total_albums": total,
        "all_required_columns_populated": all_required_columns_populated,
        "release_year_min": year_min,
        "release_year_max": year_max,
        "listener_bound": min_listeners,
        "below_listener_bound": below_floor,
        "above_listener_bound": total - below_floor,
    }


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(
        description="Materialize the notability-floored album universe into `entities`."
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB_PATH,
        help=f"Path to the SQLite store (default: {DEFAULT_DB_PATH}).",
    )
    parser.add_argument(
        "--min-listeners",
        type=int,
        default=NOTABILITY_MIN_LISTENERS,
        help=f"Notability floor override (default: {NOTABILITY_MIN_LISTENERS}, "
        "see pipeline/config.py NOTABILITY_MIN_LISTENERS).",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Report the universe shape (counts, column coverage, year range) "
        "instead of materializing.",
    )
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        if args.verify:
            init_db(conn)  # idempotent; entities may not exist yet on a fresh DB
            stats = verify_universe(conn, args.min_listeners)
            print(json.dumps(stats, indent=2))
        else:
            result = materialize_albums(conn, args.min_listeners)
            logger.info(
                "materialize: inserted %d, updated %d (total %d album rows this run)",
                result["inserted"],
                result["updated"],
                result["total"],
            )
            total_albums = conn.execute(
                "SELECT COUNT(*) FROM entities WHERE entity_type = 'album'"
            ).fetchone()[0]
            print(f"entities album count: {total_albums}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
