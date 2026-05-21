"""Tests for load_calibration per CALIBRATION_INTEGRATION.md.

Run from the project root:

    python3 -m pytest scoring/test_calibration.py -v
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from load_calibration import (  # noqa: E402
    load_latest_calibration,
    calibration_weight,
    is_excluded,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sample_calibration.json"


@pytest.fixture
def ratings():
    return json.loads(FIXTURE.read_text())["ratings"]


def _write_export(path, ratings):
    path.write_text(json.dumps({"schema": "kob-calibration-v1", "ratings": ratings}))


def test_load_latest_picks_most_recent_file(tmp_path):
    _write_export(tmp_path / "kob-calibration-2026-01-01.json",
                  {"OldArtist": {"verdict": "yes", "tier": "S"}})
    _write_export(tmp_path / "kob-calibration-2026-05-20.json",
                  {"NewArtist": {"verdict": "no"}})
    loaded = load_latest_calibration(tmp_path)
    assert "NewArtist" in loaded
    assert "OldArtist" not in loaded


def test_load_empty_dir_returns_empty_with_warning(tmp_path, caplog):
    with caplog.at_level("WARNING"):
        loaded = load_latest_calibration(tmp_path)
    assert loaded == {}
    assert "No calibration ratings" in caplog.text


def test_weight_for_no_is_negative_infinity(ratings):
    assert calibration_weight("Nickelback", ratings) == float("-inf")
    assert is_excluded("Nickelback", ratings) is True


def test_legacy_never_loads_as_no(tmp_path):
    # "never" is retired: a legacy export entry should normalize to "no" on load,
    # making the artist a hard exclude.
    _write_export(tmp_path / "kob-calibration-2026-05-21.json",
                  {"GhostArtist": {"verdict": "never"}})
    loaded = load_latest_calibration(tmp_path)
    assert calibration_weight("GhostArtist", loaded) == float("-inf")
    assert is_excluded("GhostArtist", loaded) is True


def test_weight_for_yes_tiers(ratings):
    assert calibration_weight("Radiohead", ratings) == 0.30
    assert calibration_weight("Stromae", ratings) == 0.20
    assert calibration_weight("Coldplay", ratings) == 0.10
    assert calibration_weight("Phoenix", ratings) == 0.00


def test_weight_for_unknown_artist_is_zero(ratings):
    assert calibration_weight("Not In The Pool", ratings) == 0.0


def test_weight_for_yes_missing_tier_defaults_to_c(ratings):
    assert calibration_weight("Mystery Band", ratings) == 0.00
