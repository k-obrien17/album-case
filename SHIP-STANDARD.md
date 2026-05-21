# Ship Standard — random-music-rankings
Generated: 2026-05-20 · Class: static-site · Type: side project (personal tool)
Live URL: TBD (GitHub Pages / Cloudflare Pages / local server)
Golden path: open app → rate artists one at a time → progress persists across reload → export schema-valid ratings JSON
Business goal: produce a complete, valid ratings export the Best-of-Years pipeline can consume
Jurisdictions: n/a — internal, no public users, no data collection

## Lenses
On: architecture, ux, visual, tests
Off: seo (private tool, not for search), legal (no accounts/data collection), db-safety (no DB, localStorage only), app-audit (no server/auth/mutations), launch-ops (static files, git is the rollback), feature-prospector (locked spec)

## Must-pass commitments
- Single source of truth for state: localStorage key `kob-calibration-v1` is the only store; in-memory state mirrors it and never diverges
- Golden path works end-to-end: rate → persists across reload → export downloads a schema-`kob-calibration-v1` JSON with correct stats
- localStorage failure (private mode / quota) degrades gracefully: console warn, keep going in-memory, never crash
- Mobile-first: all tap targets ≥44px, fully usable at 360px viewport, no horizontal scroll
- Keyboard parity on desktop: 1-6 rate, space skip, left/backspace undo
- Light-mode-only locked palette; zero external runtime dependencies (no CDN, no npm, no build step)
- Scoring module is tested: the 7 named tests in `scoring/test_calibration.py` pass (S=.30 / A=.20 / B=.10 / C=0, "no"=-inf, "never"/unknown/unrated=0)
