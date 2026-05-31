# Handoff

## Current task
Pivoting random-music-rankings from a private calibration tool into "Taste Test," a public, data-first artist-ranking product. Definition + de-risk phase. No app build started yet.

## Status
Definition phase is COMPLETE. All 10 product questions answered and locked in `PRODUCT.md`. `SHIP-STANDARD.md` regenerated for the new class (app-with-accounts, US, golden path lane→rank→card). Clustering POC built and passed cleanly: ListenBrainz CC0 similarity + Louvain recovered all 7 planted genre pockets with only correct crossovers; "butt rock" emerged from pure similarity (no curation needed). Attribute lanes work but are cross-genre/noisy, which confirms the lane-type-tag schema decision. Report at poc/report.html.

## Next concrete step
Plan the first real build phase: the **data foundation** (notability-floored MBID artist universe from CC0 bulk dumps, not APIs). This is a /gsd-plan-phase-sized chunk. The POC used live APIs as a spike; production must switch to dumps per PRODUCT.md.

## Open questions
- None blocking. Domain/handle availability for "Taste Test" should be checked before committing the name (consider a distinguishing TLD).

## Don't forget
- Two untracked files at repo root, elo-demo.html and pairwise-demo.html, are NOT mine (earlier session or Codex). Left untouched. Decide whether to keep/commit/delete.
- POC is throwaway: production uses bulk dumps, networkx+python-louvain (Leiden deferred), and the live-API client in poc/client.py is recon-only.
- The legacy 996-artist pool is demoted to anchor seed + test fixture, not the catalog (see PRODUCT.md "Artist universe").
- Atoms must be artist-keyed AND lane-type-tagged from day one (expensive to retrofit).
- Tiering and head-to-head mode remain parked (see PRODUCT.md).

## Files touched this session
- PRODUCT.md — answered Q3-Q9 + Q10; added "The payoff", "Accounts", "Shareable hook", "Day-one content", "Audience and money", "Name", "Artist universe" sections; recorded POC pass
- SHIP-STANDARD.md — fully regenerated for app-with-accounts class
- poc/seed.py, poc/client.py, poc/run.py, poc/report.py — new clustering POC
- poc/result.json, poc/report.html — POC output (committed)
- poc/.gitignore — ignores cache/

## Git state
- Branch: main
- Last commit: 054d63d feat(poc): clustering spike — CC0 similarity + attribute lanes (handoff commit to follow)
- Uncommitted changes: HANDOFF.md only (PRODUCT/SHIP/POC all committed)
- Stashed: no
- Note: several commits ahead of origin/main, not pushed

## Reason for handoff
pause

## Updated
2026-05-31T15:35:59Z
