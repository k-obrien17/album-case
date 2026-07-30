# Ship Standard — Album Case
Generated: 2026-07-30 · Class: personal-app (custom — no ship-standard preset fits a single-owner tool with no accounts/signup surface) · Type: side project, live for owner only
Live URL: TBD (no recorded production URL; Vercel project `album-case` exists but is unlinked in this checkout)
Golden path: show one candidate album, drag it into the exact position in the ranked list, repeat until the ranking is self-consistent
Business goal: n/a — personal correctness tool, not a growth surface (closest bucket: engagement, but the real target is ranking accuracy for one owner)
Jurisdictions: n/a — no public signup or data-collection surface; public reads are an accepted, documented tradeoff (see SECURITY.md), not a compliance concern

Supersedes the 2026-05-31 standard, which described the app-with-accounts /
Taste Test class (lanes, shareable ranked cards, account data export) that
CLAUDE.md's Positioning section rules out.

## Lenses
On: architecture, app-audit, db-safety, tests, ux, visual
Off: seo (no public discovery surface — single fixed owner id), legal (no accounts, no data collection beyond the owner's own ranking), launch-ops (personal live tool — ongoing regression risk is covered by `/regression-smoke`, not a full ops audit), feature-prospector (generative, and CLAUDE.md's Positioning explicitly rules out re-expanding toward accounts/crowd features)

## Must-pass commitments
- Owner ranking snapshot in Turso is the single source of truth; localStorage stays cache-only, never authoritative
- Every mutation route validates `ALBUM_CASE_WRITE_KEY`; the key never lands in source, `VITE_*` env vars, logs, or screenshots
- Migrations reversible + collision-free; ms timestamps; ranking snapshot writes stay versioned to prevent stale-tab/stale-browser overwrites
- Insertion logic (`insertAtRating`) and the append-then-sort tie regression stay covered by tests
- Golden path (drag candidate to exact rank position) usable at 360px, no horizontal scroll, tap targets >= 44px
- Consistent, intentional visual design on the ranking surface; doesn't read as generic-AI scaffold
