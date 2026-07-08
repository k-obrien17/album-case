# Handoff

## Current task
The artist-lock feature (rank one artist's albums in isolation, lock that relative order, global list refuses any drag that would violate it) shipped end to end: merged to `main`, pushed to `origin`, deployed to production (`https://album-case.vercel.app`). Keith just reported two follow-up issues while trying it live — not investigated yet, this session ended before triage.

## Status
Feature is live and confirmed reachable (production `/api/ranking` response includes `artist_locks`). While actually using it, Keith hit two things:

1. **Bug report:** "the play button doesn't seem to work - either/way." This is almost certainly the ▶ discover-artist button (`rank-discover` in `rankList.ts`, existing pre-this-feature functionality — but it's also possible he means something inside the new artist-lock scoped view, since opening that view also triggers a discovery call). Not reproduced or diagnosed yet — needs investigation from scratch next session. "either/way" is ambiguous as reported; could mean "either way" (regardless of what he tries) or could be shorthand for something else — ask him to clarify exactly what he clicked and what happened (or didn't) if it's not obvious once you reproduce it.

2. **Feature request:** "when I'm ranking the albums of the band, I want to be able to see which LPs of theirs are not yet ranked." Note: the artist-lock scoped view (`web/src/ui/artistLockView.ts`) already has a "Not yet ranked" section listing exactly this (`artistAlbumsFor`'s `unranked` group) — so either (a) he's asking for this same visibility somewhere else too, e.g. during the normal main candidate-ranking flow (not just inside the scoped lock view), or (b) the "Not yet ranked" section in the scoped view isn't showing/working correctly for him, which could tie back to bug #1 if the discover button feeding that list is broken. Don't assume which — ask him to clarify what screen he was on when he wanted this.

**Neither issue was investigated this session** — Keith explicitly said "not right now, I'm closing down" and asked for `/handoff` immediately after reporting them.

## Next concrete step
Start a fresh investigation of both reports. Use the `systematic-debugging` skill for #1 (reproducer-first per this project's CLAUDE.md convention: get the exact click path and expected-vs-actual behavior from Keith before touching code). For #2, clarify scope with Keith first (which screen, main list vs. scoped lock view) before assuming it needs new code — the scoped view may already do this and just be broken, in which case it's the same root cause as #1.

## Open questions
- What exactly does "the play button doesn't seem to work" mean — which button, what did he click, what happened (nothing? an error? wrong albums?), on which screen (main ranked list's ▶ icon, or something inside the artist-lock scoped view)?
- Is the "see unranked LPs while ranking" request about the artist-lock scoped view specifically (which already has this, so it'd be a bug there) or the main candidate-ranking flow (which would be new scope)?

## Don't forget
- Production deploy this session: `vercel --prod --yes` from `web/`, aliased to `https://album-case.vercel.app`, deployment id `dpl_J1rq8nmj2yWQsBLCBDVRWEMwn8j6`. Prior to this, the last production deploy was ~6h stale (this project has no GitHub auto-deploy hook — pushing to `origin/main` does NOT deploy; deploys are always manual via the `vercel` CLI).
- The write path of the artist-lock feature (actually locking/dragging/placing) was still never exercised live before this session ended — only read-only browser verification plus extensive code review. If bug #1 or #2 turns out to be inside the lock feature itself, this is the first real user contact with that code path.
- `rankList.ts` grew from 509→565 lines and `main.ts` from 622→743 across the artist-lock feature — both already over the project's 300-line guideline; flagged as a candidate for extraction on the *next* feature touching either file.
- Vercel dev auto-created a stray project named "web" on Vercel's dashboard during last session's manual verification — harmless, low-priority cleanup if Keith wants to tidy it.
- `ALLOW_PUBLIC_WRITES` Vercel env var is still unused dead config, low-priority cleanup (carried over from prior sessions).
- Vercel MCP tools (`list_deployments`, `get_runtime_errors`, etc.) return 403 for this project's scope — the `vercel` CLI works fine instead.

## Files touched this session
None — this session was deployment + a bug/feature report, no code changes.

## Git state
- Branch: `main`.
- Last commit: `36a3a09 chore: update handoff (session paused)`.
- Uncommitted changes: no (working tree clean).
- Stashed: no.
- Ahead of `origin/main`: no — pushed and matches.

## Reason for handoff
Session paused (Keith closing down).

## Updated
2026-07-08T05:54:06Z
