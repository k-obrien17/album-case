"""Tests for pipeline/materialize.py.

Loads the Plan 02 fixtures (pipeline/fixtures/) into a temp staging DB via
the real loaders, then exercises materialize_albums()/verify_universe()
against them. Fixture shape recap (see 01-02-SUMMARY.md):

    OK Computer (Radiohead)       listener_count 3000  -> above default floor (50)
    Now That's What I Call Music  listener_count  200  -> above default floor (VA)
    Abbey Road (The Beatles)      listener_count    0  -> below default floor
                                   (fixture omits total_listener_count;
                                    ingest_listenbrainz.py defaults it to 0)

Abbey Road's naturally-below-floor listener_count gives the floor-exclusion
test a real fixture row instead of a synthetic one. Primary-type exclusion
and the refresh-adds-one case need shapes the Plan 02 fixtures don't
carry, so those tests insert directly into staging via SQL -- still
against the same schema/join the loaders populate, just without needing a
new fixture file for a single edge-case row.

Run from the project root:

    .venv/bin/python -m pytest pipeline/test_materialize.py -v
"""
from pathlib import Path
from unittest.mock import patch

import pytest

from pipeline.db import connect
from pipeline.ingest_listenbrainz import load_listenbrainz_staging
from pipeline.ingest_musicbrainz import load_musicbrainz_staging
from pipeline.materialize import materialize_albums, verify_universe

FIXTURES_DIR = Path(__file__).parent / "fixtures"

MB_FIXTURE_FILENAMES = {
    "release_group": "mb_release_group.sample.tsv",
    "release_group_meta": "mb_release_group_meta.sample.tsv",
    "artist_credit_name": "mb_artist_credit_name.sample.tsv",
    "artist": "mb_artist.sample.tsv",
}
LB_FIXTURE_PATH = FIXTURES_DIR / "lb_popularity.sample.jsonl"

OK_COMPUTER_MBID = "6ccb60c2-6d8a-4869-9e5b-ba3ba99caebe"
VA_COMPILATION_MBID = "f4a5da2f-459e-4b1b-9a49-cc4d3ba1e0a5"
ABBEY_ROAD_MBID = "6c771d78-c30a-4681-93a5-45c88f815685"
VA_ARTIST_MBID = "89ad4ac3-39f7-470e-963a-56509c546377"


@pytest.fixture
def conn(tmp_path):
    c = connect(tmp_path / "staging.db")
    load_musicbrainz_staging(c, FIXTURES_DIR, table_filenames=MB_FIXTURE_FILENAMES)
    load_listenbrainz_staging(c, LB_FIXTURE_PATH)
    yield c
    c.close()


def _album_row(conn, mbid):
    return conn.execute(
        "SELECT * FROM entities WHERE entity_type = 'album' AND mbid = ?", (mbid,)
    ).fetchone()


def _album_count(conn):
    return conn.execute(
        "SELECT COUNT(*) FROM entities WHERE entity_type = 'album'"
    ).fetchone()[0]


# --- Task 1: floor, required columns, Various Artists, idempotency, refresh ---


def test_below_floor_album_is_excluded(conn):
    with patch("pipeline.materialize.now_ms", return_value=1_000):
        materialize_albums(conn)

    assert _album_row(conn, ABBEY_ROAD_MBID) is None  # listener_count 0 < floor 50
    assert _album_row(conn, OK_COMPUTER_MBID) is not None
    assert _album_row(conn, VA_COMPILATION_MBID) is not None
    assert _album_count(conn) == 2


def test_materialized_rows_have_required_columns_populated(conn):
    with patch("pipeline.materialize.now_ms", return_value=1_000):
        materialize_albums(conn)

    for mbid in (OK_COMPUTER_MBID, VA_COMPILATION_MBID):
        row = _album_row(conn, mbid)
        assert row["mbid"] is not None
        assert row["title"] is not None
        assert row["primary_artist_name"] is not None
        assert row["primary_artist_mbid"] is not None
        assert row["release_year"] is None or isinstance(row["release_year"], int)


def test_various_artists_album_materializes_with_primary_artist_name(conn):
    with patch("pipeline.materialize.now_ms", return_value=1_000):
        materialize_albums(conn)

    row = _album_row(conn, VA_COMPILATION_MBID)
    assert row is not None
    assert row["primary_artist_name"] == "Various Artists"
    assert row["primary_artist_mbid"] == VA_ARTIST_MBID


def test_only_primary_type_album_release_groups_materialize(conn):
    # Insert a non-Album release-group (primary_type 2) that clears the
    # floor easily -- it must still be excluded on type alone (DATA-04).
    single_mbid = "11111111-1111-1111-1111-111111111111"
    with conn:
        conn.execute(
            "INSERT INTO stg_release_group (rg_id, mbid, title, artist_credit, primary_type) "
            "VALUES (9000, ?, 'A Single', 100, 2)",
            (single_mbid,),
        )
        conn.execute(
            "INSERT INTO stg_popularity (release_group_mbid, listen_count, listener_count) "
            "VALUES (?, 99999, 99999)",
            (single_mbid,),
        )

    with patch("pipeline.materialize.now_ms", return_value=1_000):
        materialize_albums(conn)

    assert _album_row(conn, single_mbid) is None
    assert _album_row(conn, OK_COMPUTER_MBID) is not None


def test_rerun_over_identical_staging_is_idempotent(conn):
    with patch("pipeline.materialize.now_ms", return_value=1_000):
        result_1 = materialize_albums(conn)
    count_1 = _album_count(conn)
    row_1 = _album_row(conn, OK_COMPUTER_MBID)

    with patch("pipeline.materialize.now_ms", return_value=2_000):
        result_2 = materialize_albums(conn)
    count_2 = _album_count(conn)
    row_2 = _album_row(conn, OK_COMPUTER_MBID)

    assert result_1["inserted"] == 2
    assert result_2["inserted"] == 0
    assert result_2["updated"] == 2
    assert count_1 == count_2 == 2  # no duplicates
    assert row_1["created_at"] == 1_000
    assert row_2["created_at"] == 1_000  # preserved across the re-run
    assert row_2["updated_at"] == 2_000  # advances on the re-run


def test_refresh_adds_new_album_without_touching_existing_created_at(conn):
    with patch("pipeline.materialize.now_ms", return_value=1_000):
        materialize_albums(conn)
    assert _album_count(conn) == 2
    existing_created_at = _album_row(conn, OK_COMPUTER_MBID)["created_at"]

    # Simulate a refreshed dump adding one new above-floor album.
    new_mbid = "22222222-2222-2222-2222-222222222222"
    with conn:
        conn.execute(
            "INSERT INTO stg_release_group (rg_id, mbid, title, artist_credit, primary_type) "
            "VALUES (9001, ?, 'New Album', 100, 1)",
            (new_mbid,),
        )
        conn.execute(
            "INSERT INTO stg_release_group_meta (rg_id, first_release_year) VALUES (9001, 2026)"
        )
        conn.execute(
            "INSERT INTO stg_popularity (release_group_mbid, listen_count, listener_count) "
            "VALUES (?, 5000, 500)",
            (new_mbid,),
        )

    with patch("pipeline.materialize.now_ms", return_value=2_000):
        result = materialize_albums(conn)

    assert result["inserted"] == 1
    assert _album_count(conn) == 3
    assert _album_row(conn, new_mbid) is not None
    assert _album_row(conn, OK_COMPUTER_MBID)["created_at"] == existing_created_at


# --- verify_universe ---


def test_verify_universe_reports_universe_shape(conn):
    with patch("pipeline.materialize.now_ms", return_value=1_000):
        materialize_albums(conn)

    stats = verify_universe(conn)

    assert stats["total_albums"] == 2
    assert stats["all_required_columns_populated"] == 2
    assert stats["release_year_min"] is not None
    assert stats["release_year_max"] is not None
    assert stats["below_listener_bound"] == 0
    assert stats["above_listener_bound"] == 2
