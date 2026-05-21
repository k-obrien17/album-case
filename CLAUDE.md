# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Positioning

A single-page web app that triages a pool of ~996 artists into 6-point tier ratings, then exports the result as JSON. The export feeds a parent "Best of Years" Spotify pipeline (`spotify-best-of-years`, not yet built), adding a personal-taste signal on top of listening data and critical consensus. Design priority is friction reduction: the calibration takes hours and gets done in 5-minute chunks on a phone, so the app must run anywhere with zero setup. When in doubt, favor static-first and zero dependencies over features.

## Current state

- **Stable:** the game (`index.html` + `app.js` + `style.css` + generated `artists.js`) and the Python `scoring/` module with passing pytest tests.
- **In-flight:** none. Spec is locked (`CALIBRATION_GAME.md`); build to `SHIP-STANDARD.md`.
- **Migrating:** none. `scoring/` is staged to move into `spotify-best-of-years/src/scoring/` once that project exists.

Not a git repo yet. There is no version-control rollback despite the SHIP-STANDARD note; `git init` before relying on git as the safety net.

## Commands

```bash
open index.html                                  # run the app, works from file://
python3 -m http.server 8000 --bind 0.0.0.0       # serve to phone on LAN (Tailscale works)
python3 build-artists.py                          # regenerate artists.js after editing artists.json
python3 -m pytest scoring/test_calibration.py -v  # run the scoring tests
```

No npm, no build step for the web app, no runtime dependencies. Python tooling runs in the local `.venv`.

## Architecture

### Stack

- Vanilla JS + HTML + CSS for the app. No framework, no bundler, no CDN.
- Python 3 (stdlib only) for the build script and the scoring module; pytest for tests.
- State persists in `localStorage` under key `kob-calibration-v1`, the single source of truth; in-memory state mirrors it.

### Data flow

```
artists.json  --build-artists.py-->  artists.js  --loaded by-->  index.html / app.js
   (source of truth, 996 entries)      (generated global array)        (the game)

app.js  --localStorage kob-calibration-v1-->  Export ratings  -->  kob-calibration-YYYY-MM-DD.json
                                                                          |
                                              spotify-best-of-years pipeline (scoring/load_calibration.py)
```

### Key files

| Path | Purpose |
|---|---|
| `index.html` | The app shell |
| `app.js` | Game logic, safe DOM rendering (no innerHTML) |
| `style.css` | Light-mode-only locked palette |
| `artists.json` | Editable source of truth for the artist pool |
| `artists.js` | Auto-generated from artists.json; do not hand-edit |
| `build-artists.py` | Regenerates artists.js |
| `scoring/` | Pipeline-side Python: `load_calibration.py`, `test_calibration.py`, fixtures |
| `reference/` | Original working starter, kept for reference only (not the live app) |

### Scoring weights

Tier weights: S = +0.30, A = +0.20, B = +0.10, C = 0.00. "No" = hard exclude (filtered out). "Never" / unrated = neutral (0.0). The 7 named tests in `scoring/test_calibration.py` lock these.

## Conventions

- Edit `artists.json`, never `artists.js`. Run `build-artists.py` to regenerate, then Reset in the app (or `localStorage.clear()`) to reshuffle.
- Render with safe DOM construction, not `innerHTML`.
- Tap targets >= 44px, usable at 360px viewport, no horizontal scroll. Mobile is the primary device.
- Keyboard parity on desktop: 1-6 to rate, space to skip, left/backspace to undo.

## Don't

- **Don't hand-edit `artists.js`.** It is generated; changes get overwritten on the next build.
- **Don't add runtime dependencies, a CDN, npm, or a build step for the app.** Zero-dependency static is a hard requirement, the app must run from `file://`.
- **Don't let in-memory state diverge from `localStorage`.** `kob-calibration-v1` is the only store. On localStorage failure (private mode, quota), warn and continue in-memory; never crash.
- **Don't add a dark/light toggle.** Light-mode-only locked palette.
- **Don't confuse `reference/` with the live app.** The app is at the repo root.

## Ship standard

This project has a `SHIP-STANDARD.md` at the root. When planning a phase or any non-trivial change, read it and treat the relevant must-pass commitments as acceptance criteria. Build to the bar; don't wait for `/ship-check` to find the gap.

## Reference

| Path | What |
|---|---|
| `CALIBRATION_GAME.md` | Full locked spec |
| `SHIP-STANDARD.md` | The bar this project builds to |
| `scoring/CALIBRATION_INTEGRATION.md` | How the export plugs into the parent pipeline |
| `README.md` | Run/play/export/edit instructions |
