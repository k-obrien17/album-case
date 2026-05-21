# Calibration Integration: Pipeline Wiring

How the ratings JSON from the calibration game feeds into the Best of Years scoring algorithm.

## Where the file lands

After I play the game and click Export:

```
spotify-best-of-years/
  data/
    calibration/
      kob-calibration-2026-05-20.json
      kob-calibration-2026-06-12.json   ← if I re-export later
```

The pipeline always uses the most recent file (lexicographic max). Older exports are kept for history.

## What the pipeline does with it

The scoring step assigns a score to each candidate song for each year. The formula combines:

1. **Critical consensus score** (Pitchfork rank, Acclaimed Music position, Christgau grade)
2. **Personal listening score** (play count, hearted in library, in my existing playlist)
3. **Calibration weight** (from this game)
4. **Diversity penalty** (max 3 per artist per year, max 2 per album)

The calibration weight comes from this game. Specifically:

```python
def calibration_weight(artist_name: str, ratings: dict) -> float:
    rating = ratings.get(artist_name)
    if not rating:
        return 0.0  # unknown artist, neutral
    verdict = rating["verdict"]
    if verdict == "no":
        return float("-inf")  # hard exclude (also covers artists never heard)
    if verdict == "yes":
        tier = rating.get("tier", "C")
        return {"S": 0.30, "A": 0.20, "B": 0.10, "C": 0.00}[tier]
    return 0.0
```

There is no "never" verdict. Artists I've never heard are recorded as "no" by the
game and hard-excluded. Any legacy export still carrying "never" is normalized to
"no" on load.

The weight gets added to the base score. So an S-tier artist's song gets +0.30 boost, putting it ahead of similarly-ranked songs from B or C tier artists.

## Three behaviors the calibration drives

### 1. Hard exclusion (verdict = "no")

If I've rated an artist "No", their songs never appear in any year's playlist. Filter applied before scoring even runs:

```python
candidates = [c for c in candidates if calibration_weight(c.artist, ratings) != float("-inf")]
```

### 2. Personal preference boost (verdict = "yes")

Yes-tiered artists get a score boost during ranking. This kicks in mainly when:

- A year has more critically-acclaimed songs than the 50-slot budget allows
- The pipeline needs to break ties between similarly-ranked candidates
- Multiple critics agree on several songs and the pipeline has to pick

S-tier artists almost always make the cut when they're eligible. C-tier artists only make it if the year is thin.

### 3. Discovery flagging (unrated artists)

Artists I haven't rated at all get a neutral weight, so the pipeline judges them on critical consensus alone. If the pipeline includes one of their songs based on critics, I'll see it in the final playlist and can react then.

The pipeline also writes a "discovery report" listing all included songs from artists where I have no rating. That report becomes my listening list for follow-up.

Note: there is no longer a "never heard" verdict. In the game I now mark artists I don't know as "No," which hard-excludes them. The discovery surface is therefore only the artists I haven't rated yet.

## Loading the file

`src/scoring/load_calibration.py` should expose this interface:

```python
from pathlib import Path

def load_latest_calibration(calibration_dir: Path) -> dict:
    """Load the most recent calibration export.

    Returns the ratings dict (artist name -> rating entry).
    Returns empty dict if no exports found, with a logged warning.
    """
    files = sorted(calibration_dir.glob("kob-calibration-*.json"))
    if not files:
        log.warning("No calibration ratings found, all artists treated as neutral")
        return {}
    latest = files[-1]
    log.info(f"Loaded calibration from {latest.name}")
    with open(latest) as f:
        data = json.load(f)
    assert data.get("schema") == "kob-calibration-v1", f"Unexpected schema in {latest}"
    # Legacy exports may carry the retired "never" verdict; normalize it to "no".
    return _normalize_legacy_verdicts(data["ratings"])


def calibration_weight(artist_name: str, ratings: dict) -> float:
    """Return the score adjustment for an artist based on calibration.

    -inf = exclude (verdict "no", which also covers artists never heard)
    0.0 = neutral (no rating)
    0.10 to 0.30 = tier boost for "yes" ratings
    """
    rating = ratings.get(artist_name)
    if not rating:
        return 0.0
    if rating["verdict"] == "no":
        return float("-inf")
    if rating["verdict"] == "yes":
        return {"S": 0.30, "A": 0.20, "B": 0.10, "C": 0.00}.get(rating.get("tier", "C"), 0.0)
    return 0.0


def is_excluded(artist_name: str, ratings: dict) -> bool:
    """Convenience function: should this artist be filtered out entirely?"""
    return calibration_weight(artist_name, ratings) == float("-inf")
```

## Name matching

Calibration ratings use the display name from the artist pool ("Radiohead", "Wu-Tang Clan", "Tropicália / Caetano Veloso"). Spotify uses canonical artist names which sometimes differ.

For now, do exact string match. If a candidate song's artist isn't in the ratings, treat as neutral (weight 0.0). Don't try to fuzzy-match. We can add a manual aliases file later if it becomes a problem:

```
data/calibration/aliases.json
{
  "The Beatles": ["Beatles"],
  "Wu-Tang Clan": ["Wu-Tang"],
  "Tropicália / Caetano Veloso": ["Caetano Veloso", "Tropicalia"]
}
```

## Recalibration

I can play the game again at any time (e.g., add new artists to `artists.json`, or change my mind about ratings). Each export is a full snapshot, not a diff. The pipeline always uses the latest export and replaces the previous weights entirely.

## Tests to write

In `tests/test_calibration.py`:

1. `test_load_latest_picks_most_recent_file` - multiple files in dir, latest wins
2. `test_load_empty_dir_returns_empty_with_warning` - no crash, returns `{}`
3. `test_weight_for_no_is_negative_infinity` - confirms hard exclusion
4. `test_legacy_never_loads_as_no` - a legacy "never" entry normalizes to "no" (excluded) on load
5. `test_weight_for_yes_tiers` - S=0.30, A=0.20, B=0.10, C=0.00
6. `test_weight_for_unknown_artist_is_zero` - artist not in ratings is neutral
7. `test_weight_for_yes_missing_tier_defaults_to_c` - graceful handling

Use a fixture JSON in `tests/fixtures/sample_calibration.json` with about 5 artists across the yes-tier and no verdicts.
