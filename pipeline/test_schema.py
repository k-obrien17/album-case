"""Tests for pipeline/db.py and pipeline/schema.sql.

Proves the polymorphic entities table, the generic pairwise atoms table,
and anonymous session grouping. Run from the project root:

    python3 -m pytest pipeline/test_schema.py -v
"""
import sqlite3

import pytest

from pipeline.db import connect, init_db, now_ms


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "tastetest.db"


@pytest.fixture
def conn(db_path):
    c = connect(db_path)
    init_db(c)
    yield c
    c.close()


def test_init_db_creates_all_tables(conn):
    names = {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert {"entities", "atoms", "sessions"} <= names


def test_album_and_song_entities_coexist_with_same_shape(conn):
    ts = now_ms()
    conn.execute(
        "INSERT INTO entities (entity_type, mbid, title, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("album", "mbid-album-1", "OK Computer", ts, ts),
    )
    conn.execute(
        "INSERT INTO entities (entity_type, mbid, title, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("song", "mbid-song-1", "Paranoid Android", ts, ts),
    )
    conn.commit()

    rows = conn.execute(
        "SELECT entity_type, mbid, title FROM entities ORDER BY entity_type"
    ).fetchall()
    assert len(rows) == 2
    assert rows[0]["entity_type"] == "album"
    assert rows[1]["entity_type"] == "song"


def test_duplicate_entity_type_and_mbid_raises_integrity_error(conn):
    ts = now_ms()
    conn.execute(
        "INSERT INTO entities (entity_type, mbid, title, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("album", "mbid-dup", "Kid A", ts, ts),
    )
    conn.commit()

    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO entities (entity_type, mbid, title, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("album", "mbid-dup", "Kid A (same title, different row attempt)", ts, ts),
        )


def test_same_title_different_entity_type_or_mbid_is_allowed(conn):
    ts = now_ms()
    conn.execute(
        "INSERT INTO entities (entity_type, mbid, title, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("album", "mbid-a", "Amnesiac", ts, ts),
    )
    conn.execute(
        "INSERT INTO entities (entity_type, mbid, title, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("album", "mbid-b", "Amnesiac", ts, ts),
    )
    conn.commit()

    rows = conn.execute(
        "SELECT mbid FROM entities WHERE title = ?", ("Amnesiac",)
    ).fetchall()
    assert len(rows) == 2


def test_atoms_row_inserts_and_reads_back_entity_type_agnostic(conn):
    ts = now_ms()
    session_id = "sess-1"
    conn.execute(
        "INSERT INTO sessions (session_id, created_at) VALUES (?, ?)",
        (session_id, ts),
    )
    conn.execute(
        "INSERT INTO atoms (entity_a, entity_b, winner, mechanism, session_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("mbid-a", "mbid-b", "mbid-a", "this_or_that", session_id, ts),
    )
    conn.commit()

    row = conn.execute("SELECT * FROM atoms WHERE session_id = ?", (session_id,)).fetchone()
    assert row["entity_a"] == "mbid-a"
    assert row["entity_b"] == "mbid-b"
    assert row["winner"] == "mbid-a"
    assert row["mechanism"] == "this_or_that"


def test_session_groups_two_atoms_without_any_account_row(conn):
    ts = now_ms()
    session_id = "sess-anon"
    conn.execute(
        "INSERT INTO sessions (session_id, created_at) VALUES (?, ?)",
        (session_id, ts),
    )
    for i in range(2):
        conn.execute(
            "INSERT INTO atoms (entity_a, entity_b, winner, mechanism, session_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (f"mbid-a{i}", f"mbid-b{i}", f"mbid-a{i}", "this_or_that", session_id, ts),
        )
    conn.commit()

    rows = conn.execute(
        "SELECT id FROM atoms WHERE session_id = ?", (session_id,)
    ).fetchall()
    assert len(rows) == 2


def test_init_db_is_idempotent(db_path):
    c = connect(db_path)
    init_db(c)
    init_db(c)  # must not raise, must not duplicate tables

    names = [
        row["name"]
        for row in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    ]
    assert sorted(names) == ["atoms", "entities", "sessions"]
    c.close()
