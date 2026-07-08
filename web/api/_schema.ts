export const CREATE_ATOMS_TABLE = `
CREATE TABLE IF NOT EXISTS atoms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_a TEXT NOT NULL,
    entity_b TEXT NOT NULL,
    winner TEXT NOT NULL,
    mechanism TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
`;

export const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER
);
`;

export const CREATE_ATOMS_SESSION_INDEX = `
CREATE INDEX IF NOT EXISTS idx_atoms_session ON atoms(session_id);
`;

export const CREATE_ATOMS_MECHANISM_INDEX = `
CREATE INDEX IF NOT EXISTS idx_atoms_mechanism ON atoms(mechanism);
`;

export const CREATE_RANKING_SNAPSHOTS_TABLE = `
CREATE TABLE IF NOT EXISTS ranking_snapshots (
    session_id TEXT PRIMARY KEY,
    ranking_json TEXT NOT NULL,
    lists_json TEXT NOT NULL,
    artist_locks_json TEXT,
    updated_at INTEGER NOT NULL
);
`;

// Full album records discovered via live MusicBrainz lookup (see
// web/api/discover-artist.ts), keyed like the rest of this schema by
// session_id. Stored in full for the same reason as ranking_snapshots: the app
// must be able to render/rank these without depending on the static seed file.
export const CREATE_DISCOVERED_ALBUMS_TABLE = `
CREATE TABLE IF NOT EXISTS discovered_albums (
    session_id TEXT NOT NULL,
    mbid TEXT NOT NULL,
    title TEXT NOT NULL,
    primary_artist_name TEXT NOT NULL,
    primary_artist_mbid TEXT,
    release_year INTEGER,
    cover_url TEXT NOT NULL,
    discovered_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, mbid)
);
`;

export const SCHEMA_STATEMENTS = [
  CREATE_ATOMS_TABLE,
  CREATE_SESSIONS_TABLE,
  CREATE_ATOMS_SESSION_INDEX,
  CREATE_ATOMS_MECHANISM_INDEX,
  CREATE_RANKING_SNAPSHOTS_TABLE,
  CREATE_DISCOVERED_ALBUMS_TABLE,
];
