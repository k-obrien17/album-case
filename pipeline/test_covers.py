"""Tests for pipeline/covers.py.

Proves DATA-03: every materialized album gets a per-MBID Cover Art
Archive front-cover pointer, non-album entities are untouched, the
population is idempotent, and no network I/O ever occurs.

Run from the project root:

    .venv/bin/python -m pytest pipeline/test_covers.py -v
"""
import re
from unittest.mock import patch

import pytest

from pipeline.covers import apply_cover_pointers, cover_url_for
from pipeline.db import connect, init_db, now_ms

ALBUM_MBID_1 = "6ccb60c2-6d8a-4869-9e5b-ba3ba99caebe"
ALBUM_MBID_2 = "f4a5da2f-459e-4b1b-9a49-cc4d3ba1e0a5"
SONG_MBID = "89ad4ac3-39f7-470e-963a-56509c546377"

_COVER_URL_RE = re.compile(
    r"^https://coverartarchive\.org/release-group/(?P<mbid>[^/]+)/front-500$"
)


@pytest.fixture
def conn(tmp_path):
    c = connect(tmp_path / "tastetest.db")
    init_db(c)
    yield c
    c.close()


def _insert_entity(conn, entity_type, mbid, title):
    ts = now_ms()
    conn.execute(
        "INSERT INTO entities (entity_type, mbid, title, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (entity_type, mbid, title, ts, ts),
    )
    conn.commit()


def _cover_url(conn, entity_type, mbid):
    row = conn.execute(
        "SELECT cover_url FROM entities WHERE entity_type = ? AND mbid = ?",
        (entity_type, mbid),
    ).fetchone()
    return row["cover_url"] if row else None


def test_cover_url_for_returns_exact_templated_url():
    assert (
        cover_url_for("abc-123")
        == "https://coverartarchive.org/release-group/abc-123/front-500"
    )


def test_every_album_gets_its_own_mbid_keyed_pointer(conn):
    _insert_entity(conn, "album", ALBUM_MBID_1, "OK Computer")
    _insert_entity(conn, "album", ALBUM_MBID_2, "Kid A")

    updated = apply_cover_pointers(conn)

    assert updated == 2
    for mbid in (ALBUM_MBID_1, ALBUM_MBID_2):
        url = _cover_url(conn, "album", mbid)
        assert url is not None
        match = _COVER_URL_RE.match(url)
        assert match is not None
        # Proves the pointer is keyed by *this* album's own MBID, not a
        # constant -- fails if covers.py hardcoded a single URL.
        assert match.group("mbid") == mbid


def test_non_album_entity_is_not_given_a_cover_url(conn):
    _insert_entity(conn, "album", ALBUM_MBID_1, "OK Computer")
    _insert_entity(conn, "song", SONG_MBID, "Paranoid Android")

    apply_cover_pointers(conn)

    assert _cover_url(conn, "album", ALBUM_MBID_1) is not None
    assert _cover_url(conn, "song", SONG_MBID) is None


def test_apply_cover_pointers_is_idempotent(conn):
    _insert_entity(conn, "album", ALBUM_MBID_1, "OK Computer")
    _insert_entity(conn, "album", ALBUM_MBID_2, "Kid A")

    first_count = apply_cover_pointers(conn)
    first_url_1 = _cover_url(conn, "album", ALBUM_MBID_1)
    first_url_2 = _cover_url(conn, "album", ALBUM_MBID_2)
    row_count_after_first = conn.execute(
        "SELECT COUNT(*) FROM entities WHERE entity_type = 'album'"
    ).fetchone()[0]

    second_count = apply_cover_pointers(conn)
    second_url_1 = _cover_url(conn, "album", ALBUM_MBID_1)
    second_url_2 = _cover_url(conn, "album", ALBUM_MBID_2)
    row_count_after_second = conn.execute(
        "SELECT COUNT(*) FROM entities WHERE entity_type = 'album'"
    ).fetchone()[0]

    assert first_count == second_count == 2
    assert first_url_1 == second_url_1
    assert first_url_2 == second_url_2
    assert row_count_after_first == row_count_after_second == 2


def test_apply_cover_pointers_performs_no_network_io(conn):
    _insert_entity(conn, "album", ALBUM_MBID_1, "OK Computer")

    def _raise(*args, **kwargs):
        raise AssertionError("network connection attempted")

    with patch("socket.socket", side_effect=_raise):
        updated = apply_cover_pointers(conn)

    assert updated == 1
    assert _cover_url(conn, "album", ALBUM_MBID_1) == cover_url_for(ALBUM_MBID_1)
