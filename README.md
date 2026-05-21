# Random Music Rankings

A single-page web app that triages 996 artists into tier ratings for the "Best of Years" Spotify playlist pipeline. It shows five artists per screen, ranks and rates them, and exports the result as JSON.

## What this is for

The parent project builds "Best of [Year]" playlists for every year from 1960 to 2026. The scoring algorithm blends listening data with critical consensus (Pitchfork, Christgau, Acclaimed Music). This game adds one more signal: how I feel about each artist.

The exported JSON feeds the pipeline's scoring step via `scoring/load_calibration.py`. See `scoring/CALIBRATION_INTEGRATION.md`.

## How to run it

The artist pool is inlined in `artists.js`, so it works with no server:

```bash
open index.html
```

Double-click `index.html` or run the line above. That's it. No build step, no dependencies.

### Play on your phone (optional local server)

To play from another device on your network:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open `http://<your-mac-name>:8000` on your phone (Tailscale works well for this).

### Host it (optional)

Drop the whole directory onto GitHub Pages, Cloudflare Pages, or Netlify. Zero config.

## How to play

Five artists per screen. For each, pick a verdict:

| Button | Meaning |
|--------|---------|
| S | Essential favorite. Top tier. |
| A | Strong. Multiple songs I'd want from them. |
| B | Solid. One song per year if they had a good one. |
| C | One song. Only if a year is thin. |
| No songs I want | Hard exclude. Never put them in any playlist. Also use this for artists I've never heard of. |

**Ranking is automatic.** Rating a band sorts it into position: unrated bands stay at the top of the screen, rated ones drop below in S → A → B → C → No order. So you rate from the top and watch the ranking build underneath.

**Manual fallback.** Each row has ▲/▼ arrows to nudge a band by hand, mainly to break ties within a tier. The sort is stable, so a manual nudge within a tier survives later ratings; a cross-tier nudge gets re-sorted the next time you rate something.

**Notes and flags.** Each band has two text fields: `notes` and `songs to flag` (comma- or newline-separated).

**Per-row skip.** `↪ skip` sends that band to the back of the queue and pulls in the next one.

**Advance.** When all five on screen have a verdict, `Next 5 →` loads the next five.

**Keyboard:** `←` (or `Backspace`) undoes the last rating.

## Export

Click "Export ratings" any time (no minimum). The browser downloads `kob-calibration-YYYY-MM-DD.json`.

Drop it into the pipeline at `data/calibration/` (in the parent `spotify-best-of-years` project, once that exists). The pipeline uses the most recent file.

The export keeps the `kob-calibration-v1` schema the pipeline reads. Each rated artist carries `verdict` and (for "yes") `tier`, plus optional `notes` and `flagged_songs` when present.

## Progress persistence

Progress lives in `localStorage` under `kob-calibration-v2`. It survives reloads and browser restarts. If `localStorage` is unavailable (private mode, quota), the app logs a warning and keeps going in-memory for the session.

Reset clears everything and reshuffles (one confirmation, no second prompt).

## Editing the artist pool

`artists.json` is the editable source of truth. Format:

```json
{ "name": "Artist Name", "era": "1990s-present", "genre": "indie", "country": "US" }
```

After editing, regenerate the inlined copy the game reads:

```bash
python3 build-artists.py
```

Then click Reset in the app (or `localStorage.clear()` in DevTools) to reshuffle.

## Files

```
random-music-rankings/
├── index.html              ← the app
├── app.js                  ← game logic (no innerHTML; safe DOM rendering)
├── style.css               ← styles (light mode, locked palette)
├── artists.js              ← inlined pool, generated from artists.json
├── artists.json            ← 996 artists, the editable source of truth
├── build-artists.py        ← regenerates artists.js from artists.json
├── README.md               ← this file
├── CALIBRATION_GAME.md     ← design spec
├── SHIP-STANDARD.md        ← the bar this project builds to
├── reference/              ← original working starter (kept for reference)
└── scoring/                ← pipeline integration, ready to drop in
    ├── load_calibration.py
    ├── CALIBRATION_INTEGRATION.md
    ├── test_calibration.py
    └── fixtures/sample_calibration.json
```

## Scoring module

`scoring/` holds the pipeline-side code, ready to move to `spotify-best-of-years/src/scoring/` when that project exists. Run its tests:

```bash
python3 -m pytest scoring/test_calibration.py -v
```

Tier weights: S = +0.30, A = +0.20, B = +0.10, C = 0.00. "No" = hard exclude (filtered out). Unrated = neutral (0.0). There is no separate "never heard" verdict: artists I don't know go under "No," which hard-excludes them.

## Why a separate web app

Friction reduction. The calibration takes hours and gets done in 5-minute chunks on a phone. A web app plays anywhere; a Python CLI gets touched once and abandoned. The pipeline and the game are loosely coupled by the exported JSON.
