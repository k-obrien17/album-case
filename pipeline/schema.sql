-- Taste Test serving store schema.
--
-- Design notes (see .planning/PROJECT.md Key Decisions, DATA-SOURCES.md):
-- - `entities` is polymorphic: keyed by (entity_type, mbid) so 'album' rows now
--   and 'song'/'artist' rows later coexist with no DDL change.
-- - `atoms` is a generic, mechanism-tagged pairwise pick table: entity-type
--   agnostic, no foreign key to `entities`, so any future comparison
--   mechanism shares this one substrate.
-- - `sessions` is the only grouping key for an anonymous player's picks.
--   No user/account/email/password column exists anywhere in this schema.
--
-- All timestamps are integer milliseconds since epoch (CLAUDE.md Migrations).

CREATE TABLE IF NOT EXISTS entities (
    entity_type TEXT NOT NULL,
    mbid TEXT NOT NULL,
    title TEXT NOT NULL,
    primary_artist_name TEXT,
    primary_artist_mbid TEXT,
    release_year INTEGER,
    cover_url TEXT,
    notability_score INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (entity_type, mbid)
);

CREATE TABLE IF NOT EXISTS atoms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_a TEXT NOT NULL,
    entity_b TEXT NOT NULL,
    winner TEXT NOT NULL,
    mechanism TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_notability ON entities(entity_type, notability_score);
CREATE INDEX IF NOT EXISTS idx_atoms_session ON atoms(session_id);
CREATE INDEX IF NOT EXISTS idx_atoms_mechanism ON atoms(mechanism);
