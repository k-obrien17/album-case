# Handoff

## Current task
Designing the pivot of random-music-rankings from a private calibration tool into a public, **data-first** artist-ranking product. We are in the definition phase, working through open questions before any build. Decisions live in `PRODUCT.md`.

## Status
`PRODUCT.md` (design draft) is written and captures the vision, core loop, CC0 data stack, principles, decomposition, parked items, and 10 open questions. We have answered Q1 (ambition = **nurtured side project**) and Q2 (launch priority = **data-first**). Paused partway through the questions. The shipped app (live on GitHub Pages) is still the OLD private single-user tool; it is the interaction prototype, not the product being designed.

## Next concrete step
Resume the open-questions Q&A in `PRODUCT.md`, starting at **Q6 (the data payoff: what the data becomes)**. Data-first means we cannot design the schema/collection without knowing the target, so Q6 is the priority. Then work the rest (accounts, shareable hook, day-one content, audience, money, name), then run `/ship-standard` with class `app-with-accounts`.

## Open questions
- **Q6 (next): the payoff** — recommendations / publishable culture insights / feed Best-of-Years / licensable dataset / model training. Pick primary + secondary.
- Q3 accounts: anonymous vs light accounts vs anon+optional save (data-first leans toward durable identity).
- Q4 the shareable hook (growth engine) — undefined.
- Q5 day-one content: how many curated lanes; random mode in/out for v1.
- Q7 long-term audience: mass / nerds / you-clients.
- Q8 money: passion / ads / premium / data licensing / B2B / not yet.
- Q9 name: "random music rankings" no longer fits (it is cluster-based, not random).

## Don't forget
- **Clustering POC is parked.** API recon is done and verified: MusicBrainz search (MBID + tags, 1 call) and ListenBrainz similar-artists (valid algorithm: `session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30`). Resume it as the de-risk inside the data-foundation phase.
- Current `SHIP-STANDARD.md` is **stale** (describes the dead private-tool version). Redo via `/ship-standard` after the open questions are answered.
- Data-first decision means **the data model is the heart of v1**, not the UI. Absolute sentiment capture is mandatory; everything MBID-keyed; coverage must be balanced, not just popular artists.
- Hard-won principle to preserve: relative ranking != absolute sentiment; tiers are absolute and were **deferred**; never derive tiers from comparisons.

## Files touched this session
- `PRODUCT.md` — new design doc (the artifact for this thread); uncommitted until this handoff.
- (Already committed + pushed earlier this session: `app.js`, `index.html`, `style.css`, `README.md`, `CALIBRATION_GAME.md`, `scoring/*` — the 5-up redesign, never→no merge, auto-sort, 44px fix, and "never" retirement on the pipeline side. Repo initialized, pushed public, GitHub Pages live.)

## Git state
- Branch: main
- Last commit: 762d6de fix: raise secondary tap targets to 44px minimum
- Uncommitted changes: yes (PRODUCT.md + this HANDOFF.md, being committed now)
- Stashed: no

## Reason for handoff
pausing mid product-design Q&A (data-first pivot)

## Updated
2026-05-21T15:17:27Z
