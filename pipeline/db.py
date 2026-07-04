"""SQLite connection + schema initialization for the Taste Test serving store.

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
