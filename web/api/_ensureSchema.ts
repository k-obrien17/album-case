import { runMigrations, type Db } from './_migrate.js';
import { MIGRATIONS } from './_migrations/index.js';
import { withDbTimeout } from './_dbTimeout.js';

let schemaReady: Promise<void> | null = null;

/** Runs pending migrations once per process. A failure clears the cache so the
 *  next request tries again instead of serving a half-migrated database. */
export function ensureSchema(client: Db): Promise<void> {
  schemaReady ??= withDbTimeout(runMigrations(client, MIGRATIONS)).catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}
