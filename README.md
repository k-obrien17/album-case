# Music Library

A personal album-ranking app for building and maintaining a ranked music library.

Music Library starts from a curated seed pool, lets albums be ranked one at a
time, saves the canonical ranking to Turso, and can discover more studio LPs by
an artist through MusicBrainz.

## Live App

https://music-library-tau-three.vercel.app

## Security / Deployment Status

This app is currently intended to be **private/protected**, not publicly writable. It uses a fixed owner/session ID in client code — that ID is not a secret, so anyone who has it (or the URL) can currently call the write endpoints. There is no owner-write authentication yet.

Containment in place:
- GitHub repo is private.
- All mutating endpoints (`POST /api/ranking`, `POST /api/atom`, `POST /api/discover-artist`) are gated behind `ALLOW_PUBLIC_WRITES` (see `api/_writeGate.ts`). Unless that env var is exactly `"true"`, they return `503` before touching Turso or MusicBrainz. It's set to `false` in Vercel Production and Preview. Reads (`GET`) are unaffected.

This is temporary containment, not a fix. Permanent fix: add a real owner-write gate (signed cookie or server-side token validation) so only the actual owner can write, then remove the kill switch.

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
