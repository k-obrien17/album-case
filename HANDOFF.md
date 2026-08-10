# Handoff

## Current task
Built and shipped a "Curated lists" feature: browse expert best-of album lists (starting with Pitchfork's 1960s and 2000s decade lists) and see which ones Keith hasn't ranked yet, rate them inline. Along the way, diagnosed a real data-durability issue: Keith's browser had writes locked, so ratings were only saving locally and never reaching the server.

## Status
Feature is live on production (`album-case.vercel.app`), verified against real ranked-list data multiple times. Three real curated-list data mismatches found and fixed (title spelling didn't match MusicBrainz's canonical title: "The Beatles (White Album)" -> "The Beatles", "Greetings from Michigan..." -> "Michigan", "Bows and Arrows" -> "Bows + Arrows"; separately, a ligature-normalization bug was also fixed, "æ" vs "ae"). Redesigned the "rank an unranked entry" flow twice based on live feedback: first from a jump-to-search-results screen to an inline field, then removed an unused auto-focus mechanism that became dead code after that redesign.

Data-durability investigation: confirmed Keith's browser had `writes are locked` this whole time, so 635 locally-cached ratings (including both Vampire Weekend albums) never synced to the server (still at 627). Nothing is confirmed lost from what's checkable (server + that one browser's local storage), but Keith believes more Vampire Weekend albums existed and aren't in either place -- can't confirm or recover those from here. Shipped two hardening fixes: the "writes are locked" banner now shows proactively (before any edit, not just after), and an "Export backup" button (wires up a pre-existing, already-tested `createRankingBackup` in `backup.ts` that had no UI hook until now).

**In progress, blocked on Keith:** walking him through building a bookmarkable `#key=...` auto-unlock URL so his browser stops silently caching writes locally. He pulled the write key locally via `vercel env pull` (file still on disk, see Don't forget), but hit a browser warning describing itself as "sensitive" partway through pasting the URL -- exact wording and which step it's on is still unknown.

## Next concrete step
Ask Keith for the exact wording of the "sensitive" warning and which step it appeared on (most likely Chrome's address-bar paste-protection prompt when pasting a long token-like string). Walk him past it, then confirm the "Writes are locked" banner clears and the nav button reads "Lock writes". Once at least one device is unlocked, re-check the server ranked count (`curl .../api/ranking?session_id=...`) to confirm it jumped from 627 toward 635+.

## Open questions
- Exact wording/location of the "sensitive" warning Keith hit while pasting the unlock URL.
- Whether Keith actually rated Vampire Weekend albums beyond the two found (Vampire Weekend, Modern Vampires of the City) on some other device/browser never checked.

## Don't forget
- `/Users/keithobrien/Desktop/Claude/Projects/album-case/web/.env.vercel-temp` still exists on disk (real write key inside, pulled via `vercel env pull`). Remind Keith to delete it once he's unlocked at least one device: `rm web/.env.vercel-temp`. Never read or display this file's contents.
- Only 2 of the original 9 Pitchfork decade lists are built out in `web/src/data/curatedLists.ts` (1960s, 2000s). The other 7 (1970s, 1980s, 1990s, 2010s, 2020s-so-far, 2000-04, 2010-14) were never scraped/added this session.
- The 3 title mismatches found so far were surfaced reactively (Keith reporting specific albums). Worth proactively re-running the same cross-check script used mid-session (compare every curated entry's artist+title against real ranked-artist titles, flag same-artist-different-title near-misses) across the two existing lists before adding more, and again after adding each new list -- past pattern strongly suggests more hand-transcribed titles won't exactly match MusicBrainz's canonical spelling.
- `pitchfork.com` itself and several mirror sites (`albumoftheyear.org`, `rateyourmusic.com`, `discogs.com`, `listchallenges.com`, `musicthisday.com`) are unreachable via WebFetch (403/blocked). `besteveralbums.com` (paginated, 10/page) and `muzieklijstjes.nl` (single-page, full list) both work and were the actual sources used.
- Standing repo gotchas: similarity-scores-skew-popular, artist locks paused (`web/src/ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger, `vercel dev`'s Development env shares production Turso credentials (use an isolated scratch DB for manual write-path testing, never `vercel dev` against the linked project).

## Files touched this session
- web/src/data/curatedLists.ts — new: curated-list catalog (1960s + 2000s Pitchfork lists, 400 albums)
- web/src/curatedListMatch.ts, web/src/curatedListMatch.test.ts — new: pure unranked-filtering logic incl. ligature/diacritic normalization
- web/src/ui/curatedListView.ts — new: curated-list browsing view, inline per-row rating
- web/src/main.ts — curated-list wiring, inline-rate handler, proactive lock banner, export-backup button
- web/src/ui/rankList.ts — added then removed `focusFirstSearchResult` (superseded by the inline-rate redesign)
- web/src/style.css — curated-list view styles

## Git state
- Branch: main
- Last commit: bfe8a09 feat: wire up the JSON backup export button
- Uncommitted changes: no (only pre-existing untracked `.playwright-mcp/`, not session work; `web/.env.vercel-temp` is untracked and gitignored, contains a real secret, not committed)
- Pushed to origin: yes, deployed to Vercel production
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-08-10T14:04:23Z
