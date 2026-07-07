# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Positioning

**Album Case** is currently a personal, single-owner album-ranking app. The
starting experience: show one candidate album, drag it into the exact position
in the ranked list, and repeat until the owner has a true, self-consistent album
order. The canonical list is the fixed owner snapshot in Turso; localStorage is
only a fast/offline cache. Mutations are guarded by `ALBUM_CASE_WRITE_KEY`;
public reads are an accepted tradeoff for now.

The older public "Taste Test" / crowd-aggregate direction is historical
planning context, not the implemented product surface. Do not re-expand toward
accounts, public anonymous sessions, licensable datasets, or crowd charts unless
Keith explicitly reopens that product direction.

The rankable unit is the **album** (MusicBrainz release-group), built to expand to songs and artists and to richer mechanisms without a rebuild.

This repo also contains a **legacy private calibration tool** (artist-tier rater) that seeded the project. It is demoted to a seed pool and test fixture. Do not confuse it with the product (see "Two codebases" below).

## Current state

- The deployable app lives under `web/` and is a Vite + TypeScript app with
  Vercel serverless functions and Turso/libSQL persistence.
- The app uses one fixed owner id (`web/src/owner.ts`) across browsers/devices.
- Ranking snapshots store full album records and use versioned writes to avoid
  stale tab/browser overwrites.
- Discovery is owner-triggered: the client sends `primary_artist_mbid` to
  `/api/discover-artist`, which browses MusicBrainz release-groups for that
  artist and stores studio LP records in `discovered_albums`.
- Planning in `.planning/` may still contain older Taste Test framing. Treat it
  as historical unless it has been updated to match this section.
- **Legacy (stable, demoted):** the calibration game (`index.html` + `app.js` + `style.css` + generated `artists.js`) and the Python `scoring/` module with passing pytest tests.
- **Open fork:** the v1 player mechanism has pivoted from two-card pairwise picks to drag-to-place ranking. Lanes/tiers/Elo are parked or out of scope (see `PROJECT.md`).

## Two codebases in this repo

1. **The product (Album Case), being built** — the personal drag-to-place album ranking web app in `web/`, plus API-backed Turso persistence and MusicBrainz discovery. This is where new work happens.
2. **The legacy calibration tool, at the repo root** — `index.html`, `app.js`, `style.css`, `artists.js`, `build-artists.py`, `scoring/`, `reference/`. Zero-dependency, runs from `file://`. Kept as seed pool + fixture. The old constraints below apply ONLY to it.

## Architecture (the product)

- Rankable unit is the MusicBrainz release-group album.
- Album records carry `mbid`, `title`, `primary_artist_name`,
  `primary_artist_mbid`, `release_year`, and a Cover Art Archive pointer URL.
- The personal list is transitive by construction. Do not replace it with Elo.
- Pairwise atoms are still recorded for placements/comparisons, but the primary
  product state is the owner ranking snapshot.
- The static seed is a temporary bootstrap. Live discovery is allowed for this
  personal app and should use MusicBrainz artist MBIDs, not name search.

## Commands (legacy tool)

```bash
open index.html                                   # run the legacy calibration tool, works from file://
python3 -m http.server 8000 --bind 0.0.0.0        # serve to phone on LAN
python3 build-artists.py                          # regenerate artists.js after editing artists.json
python3 -m pytest scoring/test_calibration.py -v  # run the scoring tests
```

Product-side commands:

```bash
cd web
npm install
npm run dev
npm run test
npm run build
```

## Conventions

- Prefer README, SECURITY.md, HANDOFF.md, and this file over stale `.planning/`
  sections when they conflict.
- Render with safe DOM construction, not `innerHTML`.
- Mobile is the primary device: tap targets >= 44px, usable at 360px, no horizontal scroll.
- Match the project's package manager and language once the product stack is chosen (see the phase plan / `DATA-SOURCES.md`); don't assume.

## Don't

**Product (Album Case):**
- **Don't put `ALBUM_CASE_WRITE_KEY` in source, screenshots, logs, or `VITE_*`
  env vars.**
- **Don't use artist-name search for discovery when an artist MBID is
  available.**
- **Don't use Elo or any model that allows self-contradicting picks** for the
  personal list. It is transitive-by-construction.
- **Don't confuse the older public Taste Test aggregate roadmap with the
  current personal Album Case app.**

**Legacy tool only:**
- **Don't hand-edit `artists.js`.** It is generated from `artists.json` by `build-artists.py`.
- **Don't add a build step / runtime deps to the legacy tool.** It is zero-dependency and must keep running from `file://`. (This constraint does NOT apply to the product, which has a real pipeline and store.)
- **Don't confuse `reference/` or the root `index.html` with the product.**

## Ship standard

`SHIP-STANDARD.md` is the bar (regenerated for the app-with-accounts class). When planning a phase or any non-trivial change, treat its relevant must-pass commitments as acceptance criteria.

## Reference

| Path | What |
|---|---|
| `.planning/PROJECT.md` | Historical/partially updated product planning; verify against README/HANDOFF |
| `.planning/ROADMAP.md` | Phase structure |
| `DATA-SOURCES.md` | Data source matrix + the store-everything architecture rule |
| `SHIP-STANDARD.md` | The bar this project builds to |
| `PRODUCT.md` | Older product definition (historical; see `PROJECT.md` for current) |
| `CALIBRATION_GAME.md` | Legacy calibration-tool spec |
| `scoring/CALIBRATION_INTEGRATION.md` | How the legacy export plugs into the parked Best-of-Years pipeline |
| `README.md` | Legacy run/play/export instructions |
