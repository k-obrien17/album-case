import subprocess
import sys
from pathlib import Path

from pipeline.build import run_pipeline


def test_run_pipeline_calls_steps_in_order(monkeypatch, tmp_path):
    calls = []

    def record(name, result):
        def _fn(*args, **kwargs):
            calls.append(name)
            return result

        return _fn

    monkeypatch.setattr("pipeline.build.load_musicbrainz_staging", record("mb", {"mb": 1}))
    monkeypatch.setattr("pipeline.build.load_listenbrainz_staging", record("lb", {"lb": 2}))
    monkeypatch.setattr("pipeline.build.materialize_albums", record("mat", {"mat": 3}))
    monkeypatch.setattr("pipeline.build.apply_cover_pointers", record("covers", 4))
    monkeypatch.setattr("pipeline.build.verify_universe", record("verify", {"total_albums": 2}))

    class Conn:
        pass

    result = run_pipeline(
        Conn(),
        str(tmp_path / "mbdump"),
        str(tmp_path / "popularity.jsonl"),
        50,
        verify=True,
    )

    assert calls == ["mb", "lb", "mat", "covers", "verify"]
    assert result == {
        "musicbrainz": {"mb": 1},
        "listenbrainz": {"lb": 2},
        "materialize": {"mat": 3},
        "covers": {"updated": 4},
        "verify": {"total_albums": 2},
    }


def test_cli_rejects_nonexistent_mbdump_dir_and_popularity_before_touching_db(tmp_path):
    """Finding 3: a bad --mbdump-dir/--popularity must fail fast with a
    clear message and exit(1) BEFORE any staging table (or the --db file
    itself) is touched -- not surface a raw traceback partway through a
    multi-table load."""
    db_path = tmp_path / "x.db"
    result = subprocess.run(
        [
            sys.executable,
            "pipeline/build.py",
            "--mbdump-dir",
            str(tmp_path / "nonexistent-mbdump"),
            "--popularity",
            str(tmp_path / "nonexistent-popularity.jsonl"),
            "--db",
            str(db_path),
        ],
        capture_output=True,
        text=True,
        cwd=Path(__file__).parent.parent,
    )

    assert result.returncode != 0
    assert "Traceback" not in result.stdout
    assert "Traceback" not in result.stderr
    combined = result.stdout + result.stderr
    assert "mbdump-dir" in combined
    assert "nonexistent-mbdump" in combined
    assert not db_path.exists()
