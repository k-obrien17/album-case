import type { Client } from '@libsql/client';

export type Db = Pick<Client, 'execute' | 'batch'>;

/**
 * A schema change. `id` is a millisecond timestamp, unique and strictly
 * ascending across the list. `up` and `down` return the SQL statements to run;
 * they may inspect the database first (for example to skip a column that a
 * legacy database already has) but must not write. The runner applies the
 * statements and records the migration in one atomic batch.
 */
export type Migration = {
  id: number;
  name: string;
  up: (db: Db) => Promise<string[]> | string[];
  down: (db: Db) => Promise<string[]> | string[];
};

const CREATE_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
);
`;

export function validateMigrations(migrations: Migration[]): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.id) || migration.id <= previous) {
      throw new Error(`migration_order: ${migration.name} (${migration.id}) must have a unique id greater than ${previous}`);
    }
    previous = migration.id;
  }
}

async function appliedIds(db: Db): Promise<Set<number>> {
  const rows = await db.execute('SELECT id FROM schema_migrations');
  return new Set(rows.rows.map((row) => Number(row.id)));
}

async function isRecorded(db: Db, id: number): Promise<boolean> {
  const rows = await db.execute({ sql: 'SELECT 1 FROM schema_migrations WHERE id = ?', args: [id] });
  return rows.rows.length > 0;
}

/** Applies every unapplied migration in id order. Safe to call from several
 *  cold instances at once: if another instance records a migration first, this
 *  one's atomic batch fails and the migration is treated as already applied. */
export async function runMigrations(db: Db, migrations: Migration[]): Promise<void> {
  validateMigrations(migrations);
  await db.execute(CREATE_HISTORY_TABLE);
  const applied = await appliedIds(db);
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const statements = await migration.up(db);
    try {
      await db.batch(
        [
          ...statements.map((sql) => ({ sql, args: [] as never[] })),
          {
            sql: 'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
            args: [migration.id, migration.name, Date.now()],
          },
        ],
        'write',
      );
    } catch (err) {
      if (!(await isRecorded(db, migration.id))) throw err;
    }
  }
}

/** Reverts the most recently applied migration. Returns its name, or null if
 *  nothing is applied. Down steps can destroy data: take a Turso backup first. */
export async function rollbackLast(db: Db, migrations: Migration[]): Promise<string | null> {
  validateMigrations(migrations);
  await db.execute(CREATE_HISTORY_TABLE);
  const applied = await appliedIds(db);
  const last = [...migrations].reverse().find((migration) => applied.has(migration.id));
  if (!last) return null;
  const statements = await last.down(db);
  await db.batch(
    [...statements.map((sql) => ({ sql, args: [] as never[] })), { sql: 'DELETE FROM schema_migrations WHERE id = ?', args: [last.id] }],
    'write',
  );
  return last.name;
}
