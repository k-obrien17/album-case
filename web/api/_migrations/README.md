# Database migrations

The schema is versioned by the ordered list in `index.ts`, applied by `../_migrate.ts` and run once per cold
instance through `../_ensureSchema.ts`. Applied migrations are recorded in the `schema_migrations` table.

Rules:

- **Id is a millisecond timestamp**, unique and strictly ascending. `validateMigrations` throws on a bad list.
- **Every migration needs a `down`.** `rollbackLast(db, MIGRATIONS)` runs it. Down steps for a destructive change
  (dropping a column or table) lose data: take a Turso backup first.
- **Never edit a migration that has been applied.** Add a new one.
- **`up` and `down` return SQL; they must not write.** The runner executes the statements and records the migration in
  one atomic batch, so a failure leaves no half-applied state. `up` may read the database first (for example
  `PRAGMA table_info`) to skip a change a legacy database already has.
- **Keep statements idempotent** (`IF NOT EXISTS`, column checks) so databases that predate migrations adopt the
  baseline with no change to their data.
- **This folder is underscore-prefixed on purpose.** Vercel publishes every non-underscore file under `api/` as a
  function route.
- The offline catalog tables (`_catalog.ts`, `CATALOG_SCHEMA_STATEMENTS`) are a separate concern and are not managed here.

Do not run migrations or rollbacks against production by hand. Production applies pending migrations on the first
request after a deploy.
