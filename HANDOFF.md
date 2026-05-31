# Handoff

## Current task
Pivoting random-music-rankings from a private calibration tool into "Taste Test," a public, data-first artist-ranking product. Definition + de-risk phase. No app build started yet.

## Status
Definition phase is COMPLETE. All 10 product questions answered and locked in `PRODUCT.md`. `SHIP-STANDARD.md` regenerated for the new class (app-with-accounts, US, golden path lane→rank→card). Clustering POC built and passed cleanly: ListenBrainz CC0 similarity + Louvain recovered all 7 planted genre pockets with only correct crossovers; "butt rock" emerged from pure similarity (no curation needed). Attribute lanes work but are cross-genre/noisy, which confirms the lane-type-tag schema decision. Report at poc/report.html.

**Concurrent design thread (2026-05-31) reopened the core loop, so "locked" is qualified.** A parallel session surfaced an unresolved fork: the doc's 5-up-lane core loop vs an ongoing **Elo / head-to-head living ranking** (2-up, never-finished, un-parks head-to-head). The POC validates lane *generation*, which feeds *either* interaction model, so it does not settle the fork. See Open questions.

## Next concrete step
Plan the first real build phase: the **data foundation** (notability-floored MBID artist universe from CC0 bulk dumps, not APIs). This is a /gsd-plan-phase-sized chunk. The POC used live APIs as a spike; production must switch to dumps per PRODUCT.md.

## Open questions
- **THE FORK (decide before any UI build): core loop = 5-up lanes vs ongoing Elo / head-to-head.** The doc has 5-up lanes; the concurrent thread argues for an ongoing 2-up Elo living ranking (never-finished, the year-end top-N becomes the annual playlist, un-parks head-to-head). Resolving it rewrites PRODUCT.md Core loop, Q5, and the parked head-to-head. Tap-through demos at repo root: `elo-demo.html` (Elo, smart vs random pairing, real ~996) and `pairwise-demo.html` (merge-sort). NOT blocking the data-foundation phase (a notability-floored universe is needed either way), so that build can start in parallel.
- If Elo wins: pairing default = smart (under-seen + close-rated) vs pure random. Recommend smart; at tens of thousands of artists pure random can't cover the space.
- Not blocking: domain/handle availability for "Taste Test" before committing the name (consider a distinguishing TLD).

## Don't forget
- The two untracked files at repo root, elo-demo.html and pairwise-demo.html, are from the concurrent design thread this session (the Elo-vs-lanes exploration), not an old session. They are throwaway tap-through prototypes of the two core-loop options. Keep/commit/gitignore/delete is a decision tied to THE FORK above; don't delete before that's resolved.
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
- PRODUCT.md — "Artist universe (decided, 2026-05-31)" section was authored by the concurrent design thread (swept into commit 143f216 via a broad `git add`); content is intact.
- elo-demo.html, pairwise-demo.html — NEW throwaway demos from the concurrent design thread (untracked; see THE FORK).

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
