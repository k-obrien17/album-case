# Calibration Game: Spec

This describes the current design as built. Revised 2026-05-21: moved from a one-artist-at-a-time flow to a five-up ranking layout, folded "never heard" into "no," and added per-band notes and song flags. If something here seems wrong, ask before changing it.

## Purpose

I'm building a "Best of [Year]" playlist for every year from 1960 to 2026 (67 playlists, 50 songs each). The pipeline blends my personal listening data with critical consensus from sources like Pitchfork, Christgau, and Acclaimed Music. For the pipeline to surface the right songs when it fills gaps from critical lists, it needs to know how I feel about the artists it might reach for.

This game makes me triage 996 artists across all eras and genres. The output is a ratings JSON that the pipeline reads as a personal-preference weighting layer.

## The 996 artists

The pool is in `artists.json`. Each entry has:

```json
{ "n": "Radiohead", "e": "1990s-present", "g": "alternative", "c": "UK" }
```

- `n` - name (display)
- `e` - era, the active period (rough decade range)
- `g` - primary genre
- `c` - country of origin

The pool is curated for breadth across:

- Eras from 1950s through 2020s (1960s onward heaviest, since that's the year range the pipeline covers)
- All major genres: rock, hip hop, electronic, indie, R&B, soul, jazz, country, folk, punk, metal, ambient, world, K-pop, afrobeats, reggaeton, classical
- 30+ countries

This is the universe of artists that could plausibly show up in critics' year-end lists. Truly obscure artists are excluded because the pipeline filters by critical attention before surfacing anything.

## The interaction

Five artists per screen, each in its own row: name, small metadata pills (era, genre, country), five verdict buttons, two text fields, and reorder/skip controls.

### Verdict buttons

#### Yes-tiers (S, A, B, C)

Tapping one records a "yes" verdict at that tier.

| Tier | Label | Meaning | Pipeline weight |
|------|-------|---------|-----------------|
| S | essential | Top-tier favorite. Almost always include them when they have something | +0.30 score boost |
| A | strong | Multiple songs I'd want across their career | +0.20 |
| B | solid | One song per year if they had a good one | +0.10 |
| C | one song | They get one slot, and only if the year is thin | 0.00 (no boost, no penalty) |

#### No

| Verdict | Label | Meaning | Pipeline weight |
|---------|-------|---------|-----------------|
| no | No songs I want | Hard exclude. Never put them in any year's playlist. Also covers artists I have never knowingly listened to. | -infinity (filter out) |

There is no separate "never heard" verdict. Artists I don't know go under "No," which hard-excludes them. (Earlier versions had a neutral "never" tier; it was removed on 2026-05-21.)

### Ranking (automatic, with manual override)

Rating a band sorts it into position automatically:

- Unrated bands float to the **top** of the screen.
- Rated bands drop **below**, ordered S → A → B → C → No.

So I rate from the top and the ranking builds underneath. The sort is stable: bands at the same rank keep their relative order.

Each row also has ▲/▼ arrows for a manual nudge, mainly to break ties within a tier. A within-tier nudge survives later ratings; a cross-tier nudge is re-sorted the next time I rate something.

### Per-band fields

Each row has two free-text inputs:

- `notes` - anything I want to remember
- `songs to flag` - specific songs I'd want, comma- or newline-separated

### Row and screen controls

- **▲ / ▼** (per row): move a band up or down manually
- **↪ skip** (per row): send the band to the back of the queue and pull in the next one
- **Next 5 →**: enabled once all five on screen have a verdict; loads the next five
- **← Undo** (bottom bar): reverses the last rating
- **Export ratings** (bottom bar): downloads ratings JSON
- **Reset** (bottom bar): confirms once, then clears all ratings and reshuffles

### Stats and progress

- Progress bar showing % of pool rated
- Three stat cards: total rated; yes count (with S/A/B/C breakdown); no count
- A "last: [Artist] [tier]" hint below the screen so I can sanity-check

## Keyboard shortcuts (desktop)

| Key | Action |
|-----|--------|
| Left arrow | Undo last rating |
| Backspace | Undo last rating |

Rating, reordering, and skipping are tap/click only. With five bands on screen there is no single "current" band, so the old number-key and space shortcuts were dropped.

## State persistence

`localStorage` key `kob-calibration-v2`.

State shape:

```json
{
  "order": ["Radiohead", "Stromae", "...all 996 in shuffled order"],
  "ratings": {
    "Radiohead": { "verdict": "yes", "tier": "S", "ts": 1716239400000 },
    "Coldplay": { "verdict": "no", "ts": 1716239435000 }
  },
  "annot": {
    "Radiohead": { "notes": "GOAT", "flagged": "Let Down, Reckoner" }
  },
  "screen": ["Radiohead", "Stromae", "...up to 5 currently shown"],
  "history": [
    { "name": "Radiohead", "prev": null }
  ]
}
```

- `order`: shuffled artist names. Generated once on first load. "Skip" moves a name to the end.
- `ratings`: map of artist name to verdict entry. `tier` is only set when `verdict === "yes"`.
- `annot`: per-band notes and flagged-songs text, kept separate from verdicts.
- `screen`: the up-to-five names currently shown, in display order.
- `history`: stack of rate actions for Undo. Each entry stores the previous rating so it can be restored.

A load-time migration converts any legacy `never` verdicts (and `never` in history) to `no`.

## Export format

User clicks Export, browser downloads `kob-calibration-YYYY-MM-DD.json`:

```json
{
  "version": 1,
  "schema": "kob-calibration-v1",
  "exported_at": "2026-05-21T20:35:00.000Z",
  "rules": {
    "yes": "Has at least one song I would want in a Best of [Year] playlist. Tier S/A/B/C weights how strongly.",
    "no": "Do not want anything by them in any year. Also covers artists I have never knowingly listened to (treated as hard exclude)."
  },
  "stats": {
    "total_rated": 247,
    "yes": 142,
    "no": 105,
    "by_tier": { "S": 18, "A": 41, "B": 53, "C": 30 }
  },
  "ratings": {
    "Radiohead": {
      "verdict": "yes",
      "tier": "S",
      "ts": 1716239400000,
      "notes": "GOAT",
      "flagged_songs": ["Let Down", "Reckoner"]
    }
  }
}
```

The `schema` stays `kob-calibration-v1` so the pipeline loader (`scoring/load_calibration.py`) keeps working. `notes` and `flagged_songs` are added per artist only when present; the loader ignores fields it doesn't use.

## Reset behavior

One confirmation dialog. If confirmed, clear localStorage, reshuffle the pool, start over. Do not require a second confirmation. Do not auto-download the existing ratings before clearing (I can do that manually if I want).

## Visual style

Clean, minimal, light mode only. White cards on a neutral background. No gradients, no shadows, no decorative animation. Standalone palette:

```css
--bg: #ffffff
--bg-secondary: #f7f5ef
--border: rgba(0,0,0,0.12)
--text-primary: #1c1c1a
--text-secondary: #5f5e5a
--tier-s: #534AB7
--tier-a: #185FA5
--tier-b: #0F6E56
--tier-c: #888780
--no: #A32D2D
```

A selected verdict button fills with its tier color.

## Mobile considerations

- All tappable controls are at least 44px on their short axis (iOS guideline)
- The tier row of four buttons fits on a phone screen
- The notes and flag fields stack into one column on narrow viewports
- Artist names use `word-break: break-word` for long names

## What you don't need to build

- No multi-user support
- No accounts, login, auth
- No backend
- No analytics
- No alternative pools (I'll edit `artists.json` directly if I want to add/remove artists)
- No themes/dark mode (unless trivial)

## Edge cases to handle

- First load with no saved state: shuffle and start the first screen of five
- Resume with all 996 already rated: show the completion screen with Export button
- Undo with empty history: no-op
- Skip when few unrated remain: screen shrinks to however many are left; show completion when none remain
- localStorage write fails (quota, private mode): show a console warning, keep going in-memory
- Legacy `never` verdicts in saved state: migrate to `no` on load

## How I'll use the output

The exported JSON drops into the parent pipeline at `data/calibration/kob-calibration-YYYY-MM-DD.json`. The scoring module `src/scoring/load_calibration.py` reads it, builds a weight map, and applies the weights when ranking candidate songs.

See `scoring/CALIBRATION_INTEGRATION.md` for details.
