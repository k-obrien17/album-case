# Ship Standard — Taste Test (random-music-rankings)
Generated: 2026-05-31 · Class: app-with-accounts · Type: side project (nurtured)
Live URL: TBD (currently GitHub Pages, old private tool)
Golden path: open a lane → rank/rate 5 artists → get a shareable ranked card
Business goal: engagement
Jurisdictions: US

Supersedes the 2025-12-29 standard, which described the dead private-tool
(static-site) version. See PRODUCT.md for the full product definition.

## Lenses
On: architecture, app-audit, db-safety, tests, ux, visual, seo, legal, launch-ops
Off: feature-prospector (generative — runs at end audit only, not a must-pass)

## Must-pass commitments
- Single source of truth for state; no parallel data stores; preference atoms are MBID/artist-keyed and lane-type-tagged from day one
- Authz + rate-limiting on every write to the atom store; input validated at boundaries; errors caught at boundaries, not swallowed
- Stored asset stays CC0-clean: nothing Spotify/Last.fm-origin persisted (Spotify only at the UI edge, mapped to MBIDs)
- Migrations reversible + collision-free; ms timestamps; no unbounded queries on hot paths
- Golden path (lane → rank → card) tested end-to-end
- Golden path completable without confusion on mobile at 360px; primary CTA unambiguous
- Consistent design tokens; mobile/responsive; doesn't read as generic-AI
- Title/meta/OG present (OG image = the shareable card); sitemap + robots; semantic headings
- Privacy policy + terms present; consent gates analytics before it fires; account data export/delete path
- Rollback path exists; error tracking live; dev/prod separation; one smoke test on the golden path
