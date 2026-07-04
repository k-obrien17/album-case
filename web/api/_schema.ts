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

export const SCHEMA_STATEMENTS = [
  CREATE_ATOMS_TABLE,
  CREATE_SESSIONS_TABLE,
  CREATE_ATOMS_SESSION_INDEX,
  CREATE_ATOMS_MECHANISM_INDEX,
];
