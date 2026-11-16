# Handoff

## Current task
Keith is rating albums 1x1 in chat ("go through classics" and his Want to listen list); results are written to production in batches. Batch 2 is fully collected but NOT yet written. Keith has not said "write it".

## Status
- Code unchanged: 3 local commits (5f8b852, 75e7058, ab4ddcd) deployed 2026-11-14, NOT pushed. Write enforcement OFF.
- Batch 1 written 2026-11-15. Live (re-fetched 2026-11-15): 952 ranked / 75 want / 61 notHeard / 42 dontCare, `updated_at` 1794745725206. Backup of pre-batch-1 state: `~/Desktop/album-case-server-before-60s70s-2026-11-15.json`.
- Batch 2, all answered in chat, nothing written:
  - New ratings (18): Oasis Definitely Maybe 8.32, Beastie Boys Licensed to Ill 8.77, Cypress Hill 9.01, PE Apocalypse 91 8.68, Amy Winehouse Back to Black 8.95, Goldfrapp Black Cherry 9.13, Slint Spiderland 9.34, Can Tago Mago 9.04, Nick Drake Pink Moon 9.55, Scott Walker Scott 4 9.45, Joni Mitchell Hejira 9.18, Yo La Tengo I Can Hear the Heart Beating as One 9.56, Aphex Twin Richard D. James Album 9.86 (first said 9.34, corrected), Mercury Rev Deserter's Songs 8.78, Suede Dog Man Star 8.78, Pulp This Is Hardcore 8.88, Built to Spill Perfect From Now On 8.92, Teenage Fanclub Bandwagonesque 8.87.
  - Re-rate: Pharcyde Bizarre Ride II 8.21 to 9.04.
  - Remove from live wantToListen (now ranked): Tago Mago, Pink Moon, Scott 4, Hejira.
  - Add to wantToListen (37): Wilco Being There, D'Angelo Voodoo, BDP Criminal Minded + By All Means Necessary, Gang Starr Step in the Arena + Hard to Earn, Pete Rock & CL Smooth Mecca and the Soul Brother, PE Yo! Bum Rush the Show, Kate Bush The Dreaming, Depeche Mode Songs of Faith and Devotion, Herbie Hancock Head Hunters, Gang of Four Entertainment!, Ride Nowhere (Keith could not find it on Spotify), Boards of Canada Geogaddi, Mogwai Young Team, Aaliyah One in a Million, Spiritualized Pure Phase, Blur 13 (Keith skipped the suggestion, still wanted), Modest Mouse Good News for People Who Love Bad News, Lush Spooky, Swervedriver Raise, Catherine Wheel Ferment, plus 15 Nas albums (It Was Written, I Am..., Nastradamus, Stillmatic, God's Son, Street's Disciple, Hip Hop Is Dead, Untitled, Life Is Good, Nasir, King's Disease, KD II, Magic, KD III, Light-Years).
  - Skipped, no write: Eminem Slim Shady LP, LL Cool J Mama Said, Geto Boys, Common Resurrection, PE Muse Sick-N-Hour, Pharcyde Labcabincalifornia, Nina Simone, Manic Street Preachers, Arctic Monkeys, Deftones White Pony, Grizzly Bear Veckatimest, Janet Jackson Velvet Rope, Supergrass.
  - Pending answer: The Verve, A Storm in Heaven (shown, unanswered). Last suggestion made, unanswered: Boards of Canada Geogaddi.

## Next concrete step
Ask Keith for "write it" (writes to production), then run the batch-1 procedure from `merge.py`: back up live to `~/Desktop/album-case-server-before-batch2-2026-11-15.json`, re-fetch fresh (Keith edits in-app, never overwrite his edits), splice ratings with insertAtRating semantics (insert before first album with a lower rating), remove the 4 rated albums from wantToListen, append the 37 wants, assert no mbid in both ranked and any list, POST with `base_updated_at`, read back. Scripts and resolved data: `/private/tmp/claude-501/-Users-keithobrien-Desktop-Claude-Projects-album-case/707534b2-e012-4d0f-9a2e-ab1eb647f946/scratchpad/` (`resolve2.py`, `resolved2.json`, `live2.json`; `merge.py` and `tl.py` live in the older dc2c2b51 scratchpad). Overlap check vs live found only the Pharcyde re-rate.

## Open questions
- Deftones: mark Not interested, or skip only White Pony? (default: skip only White Pony)
- Add minor Nas albums (Napalm, Scriptures & Testaments, Distant Relatives, NuMatic, Magic 2/3)? (default: no)
- Trans-Europe Express: app has 9.03, Keith told chat 9.33. Left as is, ask.
- Push the 3 local commits? Needs Keith's say-so.

## Don't forget
- `resolved2.json` has four bad or missing entries: Oasis (use `451dca98...`), Wilco Being There (`5aed5f2c...`), Yo La Tengo (`901ddfef...`), Mogwai (wrong hit, tribute album; correct is Young Team `8cc9da13...`). Spiderland resolves to `e9f4b96a...`. Get full mbids from `/api/search-album` before building the payload.
- Light-Years is stored with release year 2025; Untitled is "[untitled]". Fine.
- Remaining queue: Beck Mellow Gold, Prodigy, Autechre, Squarepusher, Super Furry Animals, Orbital, Leftfield, Fatboy Slim, Justice, Moloko, GY!BE, Mastodon, Opeth, Sunn O))), Boris, Earth, Sleep, Arcade Fire Neon Bible, Kings of Leon, Spoon Gimme Fiction, Muse, Norah Jones, Alicia Keys, Gaga, Britney x2, Destiny's Child, Mary J. Blige, Brandy, Usher, Bright Eyes, Iron & Wine, Devendra Banhart, Feist, Regina Spektor, Ani DiFranco, and ~70 cross-genre 50s-80s classics.
- Keith is also picking from his Want to listen list; I suggest by taste fit (artist averages from the live ranking). Remaining live wants include Stevie Wonder Innervisions, Cluster Zuckerzeit, Faust IV, Dirty Projectors x3.
- Filter rule: skip artists already in wantToListen/notHeard/dontCare/blocked_artists.
- Keith still needs to re-hide hidden artists/curated entries made since Nov 8 plus Sam Smith and Christina Aguilera albums.
- Tracklists from memory were wrong; use `tl.py`.
- Still open: UX-teardown slices 5-6, gap-bonus shrinkage in `suggestions.ts`, splitting `main.ts`, CSP, friend accounts, redesign decisions in the 2026-10-04 notes.

## Git state
- Branch: main, 3 commits ahead of origin, deployed.
- Last commit: 98acebc chore: handoff session paused
- Uncommitted changes: only untracked `.playwright-mcp/` (pre-existing, leave out).
- Stashed: no

## Reason for handoff
session paused

## Updated
2026-11-16T01:24:00Z
