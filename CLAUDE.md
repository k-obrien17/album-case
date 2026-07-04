# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Positioning

**Taste Test** is a public, data-first music-ranking web app for enthusiasts. The starting experience: show one candidate album, drag it into the exact position in your ranked list, and repeat until you have a true, self-consistent order. Each placement can be captured as openly-keyed pairwise neighbor atoms, so the aggregate becomes the product (publishable culture-insight charts; a licensable dataset is parked). Design priority is friction reduction: the ranking loop must be instant, anonymous, and phone-first.

The rankable unit is the **album** (MusicBrainz release-group), built to expand to songs and artists and to richer mechanisms without a rebuild.

This repo also contains a **legacy private calibration tool** (artist-tier rater) that seeded the project. It is demoted to a seed pool and test fixture. Do not confuse it with the product (see "Two codebases" below).

## Current state

- **Managed via GSD.** Planning lives in `.planning/` (`PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `config.json`). Read `PROJECT.md` for the current, authoritative product definition; it supersedes the older root `PRODUCT.md` where they differ.
- **Roadmap (2 phases, coarse, horizontal layers):**
  1. **Album Data Foundation** (not built) — materialize a notability-floored album universe from CC0 bulk dumps into a queryable store; polymorphic entity + generic atom schema.
  2. **This-or-That Ranking MVP** (in progress) — anonymous drag-to-place album ranking loop, transitive personal list, placement signals stored as atoms.
- **Legacy (stable, demoted):** the calibration game (`index.html` + `app.js` + `style.css` + generated `artists.js`) and the Python `scoring/` module with passing pytest tests.
- **Open fork:** the v1 player mechanism has pivoted from two-card pairwise picks to drag-to-place ranking. Lanes/tiers/Elo are parked or out of scope (see `PROJECT.md`).

## Two codebases in this repo

1. **The product (Taste Test), being built** — data pipeline (CC0 dump ingestion) + a queryable store + the drag-to-place ranking web app. Stack is decided per-phase at plan time; see `DATA-SOURCES.md` and `.planning/`. This is where new work happens.
2. **The legacy calibration tool, at the repo root** — `index.html`, `app.js`, `style.css`, `artists.js`, `build-artists.py`, `scoring/`, `reference/`. Zero-dependency, runs from `file://`. Kept as seed pool + fixture. The old constraints below apply ONLY to it.

## Architecture (the product)

Source of truth for data decisions: `DATA-SOURCES.md`. Core rule:

**Store everything from CC0 dumps. Reference only what you already own. Use pointers for copyrighted assets.**

- **Stored core (CC0, bulk dumps, the owned asset):** MusicBrainz (release-group + artist identity), Cover Art Archive (covers), ListenBrainz (popularity floor + future similarity), Discogs (genres/styles), Wikidata (crosswalks + attributes).
- **The search index is the project's own materialized universe, never a vendor's live catalog.** A player can only reference an album already in the store, so everything referenced is owned by construction.
- **Live edges (display-only, never stored):** Deezer / TheAudioDB for enrichment. Copyrighted images/previews are referenced by ID and rendered live. Spotify is dropped entirely (Feb 2026 dev lockdown).
- **Expansion insurance, baked in from Phase 1:**
  - Rankable items are polymorphic `(entity_type, mbid)` — `album` now, `song`/`artist` later without a rebuild.
  - Picks are generic pairwise atoms `(entity_a, entity_b, winner, mechanism, session_id, created_at)` — every future mechanism shares this one table.
- **The personal list is transitive by construction** (direct placement into one ordered list), so a player can never make a self-contradicting pick. Not Elo.

## Commands (legacy tool)

```bash
open index.html                                   # run the legacy calibration tool, works from file://
python3 -m http.server 8000 --bind 0.0.0.0        # serve to phone on LAN
python3 build-artists.py                          # regenerate artists.js after editing artists.json
python3 -m pytest scoring/test_calibration.py -v  # run the scoring tests
```

Product-side commands (ingestion, store, app) are defined per-phase during planning; none exist yet.

## Conventions

- **Read `.planning/` before product work.** `PROJECT.md` + `ROADMAP.md` + the phase's plans are the brief.
- Render with safe DOM construction, not `innerHTML`.
- Mobile is the primary device: tap targets >= 44px, usable at 360px, no horizontal scroll.
- Match the project's package manager and language once the product stack is chosen (see the phase plan / `DATA-SOURCES.md`); don't assume.

## Don't

**Product (Taste Test):**
- **Don't store vendor (Spotify/Deezer/Apple) metadata or images.** Only CC0 data is stored; covers come from the Cover Art Archive; copyrighted assets are live-rendered pointers.
- **Don't search a live vendor catalog.** The app queries the project's own materialized universe.
- **Don't break the expansion schema.** Keep entities polymorphic `(entity_type, mbid)` and picks as generic mechanism-tagged atoms, from day one.
- **Don't use Elo or any model that allows self-contradicting picks** for the personal list. It is transitive-by-construction.
- **Don't ingest stored data from live APIs.** Use bulk dumps; new albums enter via the next dump refresh.

**Legacy tool only:**
- **Don't hand-edit `artists.js`.** It is generated from `artists.json` by `build-artists.py`.
- **Don't add a build step / runtime deps to the legacy tool.** It is zero-dependency and must keep running from `file://`. (This constraint does NOT apply to the product, which has a real pipeline and store.)
- **Don't confuse `reference/` or the root `index.html` with the product.**

## Ship standard

`SHIP-STANDARD.md` is the bar (regenerated for the app-with-accounts class). When planning a phase or any non-trivial change, treat its relevant must-pass commitments as acceptance criteria.

## Reference

| Path | What |
|---|---|
| `.planning/PROJECT.md` | Authoritative product definition (supersedes root `PRODUCT.md`) |
| `.planning/ROADMAP.md` | Phase structure |
| `DATA-SOURCES.md` | Data source matrix + the store-everything architecture rule |
| `SHIP-STANDARD.md` | The bar this project builds to |
| `PRODUCT.md` | Older product definition (historical; see `PROJECT.md` for current) |
| `CALIBRATION_GAME.md` | Legacy calibration-tool spec |
| `scoring/CALIBRATION_INTEGRATION.md` | How the legacy export plugs into the parked Best-of-Years pipeline |
| `README.md` | Legacy run/play/export instructions |
