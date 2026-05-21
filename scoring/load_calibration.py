"""Load and apply calibration ratings from the calibration game.

The calibration game produces a JSON export listing Keith's rating for each
artist in a curated 996-artist pool. This module reads the latest export and
exposes helper functions to weight song candidates accordingly.

Spec: integration/CALIBRATION_INTEGRATION.md
"""

import json
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# Score boost per "yes" tier
TIER_WEIGHTS = {
    "S": 0.30,
    "A": 0.20,
    "B": 0.10,
    "C": 0.00,
}

EXPECTED_SCHEMA = "kob-calibration-v1"


def load_latest_calibration(calibration_dir: Path) -> dict:
    """Load the most recent calibration export.

    Returns the ratings dict (artist name to rating entry).
    Returns empty dict if no exports found.

    Args:
        calibration_dir: Path to data/calibration/ directory

    Returns:
        dict mapping artist name to {"verdict": str, "tier": Optional[str], "ts": int}
    """
    files = sorted(calibration_dir.glob("kob-calibration-*.json"))
    if not files:
        log.warning(
            "No calibration ratings found in %s. "
            "All artists will be treated as neutral. "
            "Run the calibration game and export to enable personal preference weighting.",
            calibration_dir,
        )
        return {}

    latest = files[-1]
    log.info("Loaded calibration from %s", latest.name)

    with open(latest) as f:
        data = json.load(f)

    schema = data.get("schema")
    if schema != EXPECTED_SCHEMA:
        log.warning(
            "Calibration file %s has schema %r, expected %r. Attempting to load anyway.",
            latest.name, schema, EXPECTED_SCHEMA,
        )

    return _normalize_legacy_verdicts(data.get("ratings", {}))


def _normalize_legacy_verdicts(ratings: dict) -> dict:
    """Map the retired "never" verdict to "no".

    Older exports treated "never heard" as a neutral verdict. The calibration
    game now folds it into "no" (hard exclude), so normalize any legacy entries
    on load to keep behavior consistent.
    """
    converted = 0
    for entry in ratings.values():
        if entry.get("verdict") == "never":
            entry["verdict"] = "no"
            entry.pop("tier", None)
            converted += 1
    if converted:
        log.info("Normalized %d legacy 'never' verdicts to 'no'", converted)
    return ratings


def calibration_weight(artist_name: str, ratings: dict) -> float:
    """Return the score adjustment for an artist based on calibration.

    Returns:
        -inf if artist verdict is "no" (hard exclude; also covers artists I
            have never heard, which the game now records as "no")
        0.0 if artist is not rated or tier is C
        0.10 / 0.20 / 0.30 for tiers B / A / S respectively
    """
    rating = ratings.get(artist_name)
    if not rating:
        return 0.0

    verdict = rating.get("verdict")

    if verdict == "no":
        return float("-inf")

    if verdict == "yes":
        tier = rating.get("tier", "C")
        return TIER_WEIGHTS.get(tier, 0.0)

    # Unknown verdict
    log.warning("Unknown verdict %r for artist %r", verdict, artist_name)
    return 0.0


def is_excluded(artist_name: str, ratings: dict) -> bool:
    """Should this artist be filtered out before scoring?"""
    return calibration_weight(artist_name, ratings) == float("-inf")


def filter_candidates(candidates: list, ratings: dict, artist_attr: str = "artist") -> list:
    """Remove candidates whose artist is hard-excluded by calibration.

    Args:
        candidates: list of candidate songs (any object with an artist attribute)
        ratings: ratings dict from load_latest_calibration
        artist_attr: attribute name to access the artist on each candidate

    Returns:
        Filtered list with excluded artists removed.
    """
    if not ratings:
        return candidates

    filtered = [
        c for c in candidates
        if not is_excluded(getattr(c, artist_attr), ratings)
    ]

    removed = len(candidates) - len(filtered)
    if removed:
        log.info("Calibration excluded %d candidate songs", removed)

    return filtered


def get_discovery_artists(ratings: dict, included_songs: list, artist_attr: str = "artist") -> list:
    """Return artists from included songs that I have not rated at all.

    Used to build the discovery report after the pipeline runs. The retired
    "never heard" verdict is gone, so unrated artists are the discovery surface.
    """
    discovery = set()
    for song in included_songs:
        artist = getattr(song, artist_attr)
        if not ratings.get(artist):
            discovery.add(artist)
    return sorted(discovery)


# ----------------------------------------------------------------------
# Tests should live in tests/test_calibration.py per spec
# ----------------------------------------------------------------------

if __name__ == "__main__":
    # Smoke test
    import sys
    logging.basicConfig(level=logging.INFO)

    calibration_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/calibration")
    ratings = load_latest_calibration(calibration_dir)

    print(f"Loaded {len(ratings)} artist ratings")

    if ratings:
        sample = list(ratings.items())[:5]
        for artist, rating in sample:
            weight = calibration_weight(artist, ratings)
            print(f"  {artist}: {rating['verdict']} -> weight {weight}")
