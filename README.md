# Album Case

A personal album-ranking app for building and maintaining a ranked album library.

Album Case starts from a curated seed pool, lets albums be ranked one at a
time, saves the canonical ranking to Turso, and can discover more studio LPs by
an artist through MusicBrainz.

## Live App

https://album-case.vercel.app

## Features

- Drag albums into a ranked list.
- Place an album directly by rank number.
- Use assisted pairwise ranking for long lists.
- Save albums to Want to listen, Haven't heard, or Don't care.
- Discover more studio LPs by an artist via MusicBrainz.
- Hide future candidates from an artist, then restore them from Blocked artists.
- Persist the canonical ranking snapshot through Turso.
- Keep local cache/fallback state for fast interaction.

## Tech Stack

- TypeScript
- Vite
- Vercel serverless functions
- Turso/libSQL
- Vitest
- MusicBrainz and Cover Art Archive

## Local Development

```bash
cd web
npm install
npm run dev
```

`npm run dev` runs plain Vite and does not execute the Vercel serverless
functions in `web/api/`. A request to `/api/ranking` (or any other API route)
gets served back as the raw source file instead of running as a handler, so
the app falls back to an empty local state, not a bug, just nothing behind
the API in this mode.

To exercise API-backed features locally, use `vercel dev` instead, and
create `web/.env.local`:

```bash
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

There is no separate dev/staging database: this project uses one fixed
owner id across every environment (see `web/src/owner.ts`), so `vercel dev`
with a real `.env.local` reads and writes the same production data as the
deployed app. Treat local API-backed testing with the same care as testing
against production.

## Public Repo Notes

This is a public personal-tool repo. The fixed owner ID is not a secret or auth. Mutating API routes require `ALBUM_CASE_WRITE_KEY`, and that key should never appear in source, screenshots, logs, or `VITE_*` public env vars. Read-only music-ranking exposure is an accepted tradeoff unless reads are gated later.

```bash
ALBUM_CASE_WRITE_KEY=
```

## Build And Test

```bash
cd web
npm run build
npm run test
```

## Deploy

```bash
cd web
vercel deploy --prod --yes
```

## Project Layout

```text
web/
  api/           Vercel serverless endpoints
  src/           client app and tests
  public/seed/   curated album seed data
pipeline/        offline data pipeline experiments
archive/         retired demos, POC scripts, and superseded product docs (not part of the product or CI)
```

## Data Notes

The app stores full album records in snapshots and discovery tables so the
ranking can survive seed changes. MusicBrainz discovery runs only when requested
from the app.
