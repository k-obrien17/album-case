"""Create a review-first priority album plan with provenance fields.

Reads the current `web/public/seed/priority-albums.json` and enriches each
album row with a review status, score, source tags, and a plain-English reason.
The output is meant for human line-by-line editing before replacing or copying
accepted rows back into `priority-albums.json`.

Usage:
    python3 build-priority-review.py
"""
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PRIORITY_PATH = ROOT / "web" / "public" / "seed" / "priority-albums.json"
PREFERRED_PATH = ROOT / "web" / "public" / "seed" / "preferred-artists.json"
ALBUM_LIST_PATH = ROOT / "web" / "public" / "seed" / "album-list.json"
OUT_PATH = ROOT / "scratchpad" / "priority-albums-review.json"


def _artist_key(name):
    return "".join(ch.lower() if ch.isalnum() else " " for ch in name).split()


def normalize_artist(name):
    return " ".join(_artist_key(name))


def load_preferred_artists():
    data = json.loads(PREFERRED_PATH.read_text())
    return {
        normalize_artist(entry["artist"]): entry
        for entry in data.get("by_plays", [])
        if isinstance(entry.get("artist"), str)
    }


def load_album_list_pairs():
    rows = json.loads(ALBUM_LIST_PATH.read_text())
    return {
        (normalize_artist(row["artist"]), row["album"].strip().lower())
        for row in rows
        if isinstance(row.get("artist"), str) and isinstance(row.get("album"), str)
    }


def reason_for(row, preferred, already_seeded):
    artist = row["artist"]
    title = row["title"]
    artist_key = normalize_artist(artist)
    album_key = title.strip().lower()
    sources = []
    score = 50
    reason_bits = []

    plays = preferred.get(artist_key)
    if plays:
        sources.append("spotify-recent-artist")
        score += 30
        reason_bits.append(
            f"{artist} is #{plays['rank']} in recent Spotify plays ({plays['plays']} plays, {plays['hours']} hours)"
        )

    if (artist_key, album_key) in already_seeded:
        sources.append("existing-seed")
        score += 10
        reason_bits.append("already appears in the curated seed input")
    else:
        sources.append("priority-plan")
        reason_bits.append("included in the manual priority backfill plan")

    return {
        "artist": artist,
        "title": title,
        "review_status": row.get("review_status", "accept"),
        "confidence": min(score, 95),
        "source": sources,
        "reason": "; ".join(reason_bits),
    }


def main():
    priority = json.loads(PRIORITY_PATH.read_text())
    preferred = load_preferred_artists()
    already_seeded = load_album_list_pairs()
    rows = [
        reason_for(row, preferred, already_seeded)
        for row in priority.get("albums", [])
        if isinstance(row.get("artist"), str) and isinstance(row.get("title"), str)
    ]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(
            {
                "version": f"{priority.get('version', 'unknown')}-review",
                "review_status_values": ["accept", "reject", "defer", "want_to_listen", "not_heard"],
                "albums": rows,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"Wrote {OUT_PATH.relative_to(ROOT)} ({len(rows)} albums)")


if __name__ == "__main__":
    main()
