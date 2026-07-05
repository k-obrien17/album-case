/**
 * The single, fixed owner identity for this personal, single-user app.
 *
 * Taste Test persists like a personal media library: one server-owned list,
 * no accounts, no restore codes. Every browser and device resolves to this
 * same id, so opening the app anywhere loads the one canonical ranking.
 *
 * It is UUID-shaped on purpose -- the `/api/ranking` and `/api/atom` handlers
 * validate `session_id` as a canonical UUID, and this matches that shape.
 */
export const OWNER_ID = 'c0ffee00-0000-4000-8000-000000000001';
