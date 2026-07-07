"""End-to-end pipeline runner for Album Case phase 1.

This command chains the existing ingest/materialize/cover-pointer steps in
the documented order so an operator can turn the CC0 dumps into the materialized
album universe with one invocation.
"""
import argparse
import json
import logging
import sys
from pathlib import Path

# Allow `python3 pipeline/build.py` direct invocation as well as package import.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.covers import apply_cover_pointers
from pipeline.config import NOTABILITY_MIN_LISTENERS
from pipeline.db import DEFAULT_DB_PATH, connect
from pipeline.ingest_listenbrainz import load_listenbrainz_staging
from pipeline.ingest_musicbrainz import load_musicbrainz_staging
from pipeline.materialize import materialize_albums, verify_universe


def run_pipeline(
    conn,
    mbdump_dir: str,
    popularity_path: str,
    min_listeners: int,
    verify: bool = False,
) -> dict:
    """Run the phase-1 pipeline steps against an open SQLite connection."""
    mb_stats = load_musicbrainz_staging(conn, mbdump_dir)
    lb_stats = load_listenbrainz_staging(conn, popularity_path)
    materialize_stats = materialize_albums(conn, min_listeners)
    cover_count = apply_cover_pointers(conn)

    result = {
        "musicbrainz": mb_stats,
        "listenbrainz": lb_stats,
        "materialize": materialize_stats,
        "covers": {"updated": cover_count},
    }
    if verify:
        result["verify"] = verify_universe(conn, min_listeners)
    return result


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(
        description="Run the Album Case phase-1 pipeline end to end."
    )
    parser.add_argument(
        "--mbdump-dir",
        required=True,
        help="Path to the unpacked MusicBrainz mbdump directory.",
    )
    parser.add_argument(
        "--popularity",
        required=True,
        help="Path to the ListenBrainz popularity JSONL file.",
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
        help="Notability floor for materialization.",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Print a JSON universe-shape report after the pipeline runs.",
    )
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        result = run_pipeline(
            conn,
            args.mbdump_dir,
            args.popularity,
            args.min_listeners,
            verify=args.verify,
        )
        print(json.dumps(result, indent=2))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
