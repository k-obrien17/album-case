"""Tests for pipeline/ingest_musicbrainz.py and pipeline/ingest_listenbrainz.py.

Loads small deterministic fixtures under pipeline/fixtures/ into a temp
SQLite staging DB and proves: expected row counts, malformed-line
tolerance, truncate-and-reload symmetry between the two loaders, and that
the pinned column-index constants actually match the fixture shape (so a
schema drift fails loudly instead of silently misreading columns).

Run from the project root:

    python3 -m pytest pipeline/test_ingest.py -v
"""
import subprocess
import sys
from pathlib import Path

import pytest

from pipeline.db import connect
from pipeline.ingest_musicbrainz import (
    ACN_COL_ARTIST,
    ACN_COL_ARTIST_CREDIT,
    ACN_COL_NAME,
    ACN_COL_POSITION,
    ARTIST_COL_GID,
    ARTIST_COL_ID,
    ARTIST_COL_NAME,
    RG_COL_ARTIST_CREDIT,
    RG_COL_GID,
    RG_COL_NAME,
    RG_COL_TYPE,
    RGM_COL_FIRST_RELEASE_YEAR,
    RGM_COL_ID,
    load_musicbrainz_staging,
)
from pipeline.ingest_listenbrainz import load_listenbrainz_staging

FIXTURES_DIR = Path(__file__).parent / "fixtures"

MB_FIXTURE_FILENAMES = {
    "release_group": "mb_release_group.sample.tsv",
    "release_group_meta": "mb_release_group_meta.sample.tsv",
    "artist_credit_name": "mb_artist_credit_name.sample.tsv",
    "artist": "mb_artist.sample.tsv",
}


def _load_mb_fixtures(conn):
    return load_musicbrainz_staging(conn, FIXTURES_DIR, table_filenames=MB_FIXTURE_FILENAMES)


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "staging.db"


@pytest.fixture
def conn(db_path):
    c = connect(db_path)
    yield c
    c.close()


# --- MusicBrainz: Task 1 ---


def test_load_musicbrainz_staging_loads_expected_row_counts(conn):
    stats = _load_mb_fixtures(conn)

    # 3 well-formed release_group rows + 1 deliberately malformed line.
    assert stats["release_group"]["loaded"] == 3
    assert stats["release_group"]["skipped"] == 1
    assert stats["release_group_meta"]["loaded"] == 3
    assert stats["artist_credit_name"]["loaded"] == 3
    assert stats["artist"]["loaded"] == 3

    rg_count = conn.execute("SELECT COUNT(*) FROM stg_release_group").fetchone()[0]
    meta_count = conn.execute("SELECT COUNT(*) FROM stg_release_group_meta").fetchone()[0]
    acn_count = conn.execute("SELECT COUNT(*) FROM stg_artist_credit_name").fetchone()[0]
    artist_count = conn.execute("SELECT COUNT(*) FROM stg_artist").fetchone()[0]

    assert rg_count == 3
    assert meta_count == 3
    assert acn_count == 3
    assert artist_count == 3


def test_musicbrainz_malformed_release_group_line_is_skipped_and_counted_without_raising(conn):
    # Should not raise despite the malformed line in the fixture.
    stats = _load_mb_fixtures(conn)
    assert stats["release_group"]["skipped"] == 1


def test_musicbrainz_various_artists_release_group_is_loaded_not_dropped(conn):
    _load_mb_fixtures(conn)
    row = conn.execute(
        "SELECT mbid, name FROM stg_artist WHERE artist_id = 1"
    ).fetchone()
    assert row["mbid"] == "89ad4ac3-39f7-470e-963a-56509c546377"
    assert row["name"] == "Various Artists"

    va_release = conn.execute(
        "SELECT title FROM stg_release_group WHERE mbid = ?",
        ("f4a5da2f-459e-4b1b-9a49-cc4d3ba1e0a5",),
    ).fetchone()
    assert va_release["title"] == "Now That's What I Call Music"


def test_rerunning_musicbrainz_loader_truncates_before_reload(conn):
    _load_mb_fixtures(conn)
    first_count = conn.execute("SELECT COUNT(*) FROM stg_release_group").fetchone()[0]

    _load_mb_fixtures(conn)
    second_count = conn.execute("SELECT COUNT(*) FROM stg_release_group").fetchone()[0]

    assert first_count == 3
    assert second_count == 3  # unchanged, not doubled -- truncate-before-reload


def test_musicbrainz_release_group_column_pins_match_fixture_shape():
    """Pinned-index test: if release_group's column order drifts, this
    fails loudly instead of silently misreading a column."""
    line = (FIXTURES_DIR / "mb_release_group.sample.tsv").read_text().splitlines()[0]
    fields = line.split("\t")
    assert fields[RG_COL_GID] == "6ccb60c2-6d8a-4869-9e5b-ba3ba99caebe"
    assert fields[RG_COL_NAME] == "OK Computer"
    assert fields[RG_COL_ARTIST_CREDIT] == "100"
    assert fields[RG_COL_TYPE] == "1"


def test_musicbrainz_release_group_meta_column_pins_match_fixture_shape():
    line = (FIXTURES_DIR / "mb_release_group_meta.sample.tsv").read_text().splitlines()[0]
    fields = line.split("\t")
    assert fields[RGM_COL_ID] == "5000"
    assert fields[RGM_COL_FIRST_RELEASE_YEAR] == "1997"


def test_musicbrainz_artist_credit_name_column_pins_match_fixture_shape():
    line = (FIXTURES_DIR / "mb_artist_credit_name.sample.tsv").read_text().splitlines()[0]
    fields = line.split("\t")
    assert fields[ACN_COL_ARTIST_CREDIT] == "100"
    assert fields[ACN_COL_POSITION] == "0"
    assert fields[ACN_COL_ARTIST] == "1000"
    assert fields[ACN_COL_NAME] == "Radiohead"


def test_musicbrainz_artist_column_pins_match_fixture_shape():
    line = (FIXTURES_DIR / "mb_artist.sample.tsv").read_text().splitlines()[1]  # Radiohead row
    fields = line.split("\t")
    assert fields[ARTIST_COL_ID] == "1000"
    assert fields[ARTIST_COL_GID] == "a74b1b7f-71a5-4011-9441-d0b5e4122711"
    assert fields[ARTIST_COL_NAME] == "Radiohead"


def test_musicbrainz_cli_help_shows_required_flags():
    result = subprocess.run(
        [sys.executable, "pipeline/ingest_musicbrainz.py", "--help"],
        capture_output=True,
        text=True,
        cwd=Path(__file__).parent.parent,
    )
    assert result.returncode == 0
    assert "--mbdump-dir" in result.stdout
    assert "--db" in result.stdout


# --- ListenBrainz: Task 2 ---

LB_FIXTURE_PATH = FIXTURES_DIR / "lb_popularity.sample.jsonl"

# MBIDs shared with the MusicBrainz fixtures so a downstream join (Plan 03)
# finds popularity for the sample albums.
OK_COMPUTER_MBID = "6ccb60c2-6d8a-4869-9e5b-ba3ba99caebe"
VA_COMPILATION_MBID = "f4a5da2f-459e-4b1b-9a49-cc4d3ba1e0a5"
ABBEY_ROAD_MBID = "6c771d78-c30a-4681-93a5-45c88f815685"


def test_load_listenbrainz_staging_fills_one_row_per_unique_mbid(conn):
    stats = load_listenbrainz_staging(conn, LB_FIXTURE_PATH)

    assert stats["loaded"] == 3
    assert stats["skipped"] == 1  # the one malformed JSON line

    count = conn.execute("SELECT COUNT(*) FROM stg_popularity").fetchone()[0]
    assert count == 3

    mbids = {
        row["release_group_mbid"]
        for row in conn.execute("SELECT release_group_mbid FROM stg_popularity")
    }
    assert mbids == {OK_COMPUTER_MBID, VA_COMPILATION_MBID, ABBEY_ROAD_MBID}


def test_listenbrainz_record_missing_listener_count_defaults_without_crashing(conn):
    load_listenbrainz_staging(conn, LB_FIXTURE_PATH)

    row = conn.execute(
        "SELECT listen_count, listener_count FROM stg_popularity WHERE release_group_mbid = ?",
        (ABBEY_ROAD_MBID,),
    ).fetchone()
    assert row["listen_count"] == 50000
    assert row["listener_count"] in (0, None)


def test_listenbrainz_malformed_json_line_is_skipped_and_counted(conn):
    stats = load_listenbrainz_staging(conn, LB_FIXTURE_PATH)
    assert stats["skipped"] == 1


def test_rerunning_listenbrainz_loader_truncates_and_reloads_not_duplicates(conn):
    load_listenbrainz_staging(conn, LB_FIXTURE_PATH)
    first_count = conn.execute("SELECT COUNT(*) FROM stg_popularity").fetchone()[0]

    load_listenbrainz_staging(conn, LB_FIXTURE_PATH)
    second_count = conn.execute("SELECT COUNT(*) FROM stg_popularity").fetchone()[0]

    assert first_count == 3
    assert second_count == 3  # unchanged, not doubled -- truncate-before-reload


def test_listenbrainz_fixture_mbids_match_musicbrainz_fixture_mbids(conn):
    """Proves the LB fixture joins to the MB fixture albums for Plan 03."""
    _load_mb_fixtures(conn)
    load_listenbrainz_staging(conn, LB_FIXTURE_PATH)

    joined = conn.execute(
        """
        SELECT rg.title, pop.listen_count
        FROM stg_release_group rg
        JOIN stg_popularity pop ON pop.release_group_mbid = rg.mbid
        ORDER BY rg.title
        """
    ).fetchall()
    titles = {row["title"] for row in joined}
    assert titles == {"OK Computer", "Now That's What I Call Music", "Abbey Road"}


def test_listenbrainz_cli_help_shows_required_flags():
    result = subprocess.run(
        [sys.executable, "pipeline/ingest_listenbrainz.py", "--help"],
        capture_output=True,
        text=True,
        cwd=Path(__file__).parent.parent,
    )
    assert result.returncode == 0
    assert "--popularity" in result.stdout
    assert "--db" in result.stdout
