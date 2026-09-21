"""SQLite connection + schema initialization for the Album Case serving store.

The store is a single SQLite file (see .planning/PROJECT.md store decision).
`connect()` opens a connection with sane pragmas; `init_db()` applies the DDL
in `schema.sql` idempotently.
"""
import sqlite3
import time
from pathlib import Path

DEFAULT_DB_PATH = "data/tastetest.db"

_SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def now_ms():
    """Current time as integer milliseconds since epoch."""
    return int(time.time() * 1000)


def connect(path=DEFAULT_DB_PATH):
    """Open a sqlite3.Connection to `path` with foreign keys on and rows
    accessible by column name."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn):
    """Apply schema.sql to `conn`. Idempotent: safe to call more than once."""
    conn.executescript(_SCHEMA_PATH.read_text())
    conn.commit()


def iter_lines(path):
    """Stream non-empty, newline-stripped lines from `path` one at a time.

    Shared by ingest_musicbrainz.py and ingest_listenbrainz.py (previously
    duplicated byte-for-byte in each module).

    Opened with `errors="replace"` rather than strict UTF-8: a single
    malformed byte anywhere in a multi-GB dump file must not raise
    UnicodeDecodeError and abort the whole table's load. The replacement
    character (U+FFFD) then makes that line highly likely to fail the
    caller's own field-count/int-parsing validation downstream, so it
    gets skipped-and-counted like any other malformed line rather than
    crashing the loader -- no new counting logic needed here.
    """
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for raw_line in f:
            line = raw_line.rstrip("\n")
            if line:
                yield line
