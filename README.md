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

For API-backed features, create `web/.env.local`:

```bash
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

The deployed app also uses a private write key:

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
poc/             exploratory scripts and reports
```

## Data Notes

The app stores full album records in snapshots and discovery tables so the
ranking can survive seed changes. MusicBrainz discovery runs only when requested
from the app.
