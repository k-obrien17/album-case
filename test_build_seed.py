"""Validate the emitted Album Case seed dataset.

Run after `python3 build-seed.py` has produced
`web/public/seed/albums.json` and `web/api/_allowlist.json`.
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
ALBUMS_PATH = ROOT / "web" / "public" / "seed" / "albums.json"
ALLOWLIST_PATH = ROOT / "web" / "api" / "_allowlist.json"
README_PATH = ROOT / "web" / "public" / "seed" / "README.md"

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
COVER_URL_RE = re.compile(
    r"^https://coverartarchive\.org/release-group/[0-9a-f-]{36}/front-500$"
)


@pytest.fixture(scope="module")
def albums():
    assert ALBUMS_PATH.exists(), f"missing {ALBUMS_PATH}; run build-seed.py first"
    return json.loads(ALBUMS_PATH.read_text())


@pytest.fixture(scope="module")
def allowlist():
    assert ALLOWLIST_PATH.exists(), f"missing {ALLOWLIST_PATH}; run build-seed.py first"
    return json.loads(ALLOWLIST_PATH.read_text())


def test_albums_is_array_with_min_count(albums):
    assert isinstance(albums, list)
    assert len(albums) >= 150, f"expected >=150 resolved albums, got {len(albums)}"


def test_every_record_has_required_fields(albums):
    for record in albums:
        assert record.get("mbid"), f"missing mbid: {record}"
        assert UUID_RE.match(record["mbid"]), f"mbid not a UUID: {record['mbid']}"
        assert record.get("title"), f"missing title: {record}"
        assert record.get("primary_artist_name"), f"missing primary_artist_name: {record}"
        assert record.get("primary_artist_mbid"), f"missing primary_artist_mbid: {record}"
        assert UUID_RE.match(record["primary_artist_mbid"]), (
            f"primary_artist_mbid not a UUID: {record['primary_artist_mbid']}"
        )

        year = record.get("release_year")
        assert year is None or isinstance(year, int), f"release_year not int/null: {record}"

        cover_url = record.get("cover_url")
        assert cover_url, f"missing cover_url: {record}"
        assert COVER_URL_RE.match(cover_url), f"cover_url malformed: {cover_url}"
        assert cover_url.endswith(f"{record['mbid']}/front-500")


def test_mbids_are_unique(albums):
    mbids = [record["mbid"] for record in albums]
    assert len(mbids) == len(set(mbids)), "duplicate mbid in albums.json"


def test_allowlist_matches_album_mbids(albums, allowlist):
    assert isinstance(allowlist, list)
    album_mbids = {record["mbid"] for record in albums}
    assert set(allowlist) == album_mbids
    assert len(allowlist) == len(set(allowlist)), "duplicate mbid in _allowlist.json"


def test_seed_dir_has_no_image_files():
    seed_dir = ALBUMS_PATH.parent
    for path in seed_dir.iterdir():
        if path.is_file():
            assert path.suffix in (".json", ".md"), f"unexpected file in seed dir: {path}"


def test_readme_marks_temporary_bootstrap():
    assert README_PATH.exists()
    first_line = README_PATH.read_text().splitlines()[0].lower()
    assert "temporary" in first_line
    assert "bootstrap" in first_line
