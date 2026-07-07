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
