# Handoff

## Current task
Keith is rating albums 1x1 in chat ("go through classics"); results are written to production in batches. Batch 2 is collected but NOT yet written.

## Status
- Code: hides sync, "Skip artist →" navigation, base_updated_at required, opt-in write key and migrations are all committed (5f8b852, 75e7058, ab4ddcd; NOT pushed) and deployed 2026-11-14. Write enforcement is OFF (`ALBUM_CASE_ENFORCE_WRITE_KEY` unset).
- Batch 1 WRITTEN 2026-11-15: 22 ratings + Houses of the Holy re-rate (8.64 → 9.19) + 24 Want to listen. Live is 952 ranked / 75 want / 61 notHeard / 42 dontCare. Backup: `~/Desktop/album-case-server-before-60s70s-2026-11-15.json`. Keith's in-app Kraftwerk edits (Trans Europa Express 9.03, Computerwelt 9.53, Die Mensch·Maschine 9.33) were left as is; he had told chat 9.33 for Trans-Europe Express (unresolved, ask).
- Batch 2 (answered in chat, unwritten):
  - Ratings: Oasis Definitely Maybe 8.32, Beastie Boys Licensed to Ill 8.77, Cypress Hill (self-titled) 9.01, PE Apocalypse 91 8.68, Amy Winehouse Back to Black 8.95, Goldfrapp Black Cherry 9.13. Re-rate: Pharcyde Bizarre Ride II 8.21 → 9.04.
  - Want to listen: Wilco Being There, Built to Spill Perfect from Now On, Yo La Tengo I Can Hear the Heart Beating as One, Depeche Mode Songs of Faith and Devotion, D'Angelo Voodoo, Mercury Rev Deserter's Songs, BDP Criminal Minded + By All Means Necessary, Gang Starr Step in the Arena + Hard to Earn, Pete Rock & CL Smooth Mecca and the Soul Brother, PE Yo! Bum Rush the Show, Kate Bush The Dreaming, Herbie Hancock Head Hunters, Slint Spiderland, Gang of Four Entertainment!, Ride Nowhere, Boards of Canada Geogaddi, Suede Dog Man Star, Mogwai Young Team, Aaliyah One in a Million, Spiritualized Pure Phase, Aphex Twin Richard D. James Album, Pulp This Is Hardcore, Blur 13, Modest Mouse Good News for People Who Love Bad News, Teenage Fanclub Bandwagonesque, Lush Spooky, Swervedriver Raise, Catherine Wheel Ferment, plus 15 Nas albums (It Was Written, I Am…, Nastradamus, Stillmatic, God's Son, Street's Disciple, Hip Hop Is Dead, Untitled, Life Is Good, Nasir, King's Disease, KD II, Magic, KD III, Light-Years).
  - Skipped (no write): Eminem Slim Shady LP, LL Cool J Mama Said, Geto Boys, Common Resurrection, PE Muse Sick-N-Hour, Pharcyde Labcabincalifornia, Nina Simone, Manic Street Preachers, Arctic Monkeys, Deftones White Pony, Grizzly Bear Veckatimest, Janet Jackson Velvet Rope, Supergrass.
  - Pending answer: The Verve, A Storm in Heaven (shown, unanswered).

## Next concrete step
Show Keith the batch-2 tally for approval, then write it with the batch-1 procedure: back up the live copy to ~/Desktop, re-read the live snapshot (Keith edits in-app, so fetch fresh and never overwrite his edits), resolve each album via `/api/search-album` (fallback: MusicBrainz release-group browse by artist MBID; Blackstar-style stylized titles need a direct lookup), splice ratings with insertAtRating semantics (insert before first album with a lower rating), append wants to `lists.wantToListen`, assert no mbid in both ranked and any list, POST with `base_updated_at`, read back. Scripts: `/private/tmp/claude-501/-Users-keithobrien-Desktop-Claude-Projects-album-case/dc2c2b51-8db7-4cbf-acca-42a7b24337c5/scratchpad/` (`resolve.py`, `merge.py` are templates, `tl.py` fetches a MusicBrainz tracklist: `python3 tl.py "<artist>" "<title>" <year>`).

## Open questions
- Mark Deftones as Not interested in the app, or just skip the one album? (Keith said "don't care about deftones"; nu-metal Korn/Linkin Park/Slipknot/Marilyn Manson were dropped from the queue.)
- Add the minor Nas albums (Napalm, Scriptures & Testaments, Distant Relatives, NuMatic, Magic 2/3)?
- Push the three local commits? Needs Keith's say-so.

## Don't forget
- Remaining queue after A Storm in Heaven: Beck Mellow Gold, Prodigy, Autechre, Squarepusher, Super Furry Animals, Orbital, Leftfield, Fatboy Slim, Justice, Moloko, GY!BE, Mastodon, Opeth, Sunn O))), Boris, Earth, Sleep, Arcade Fire Neon Bible, Kings of Leon, Spoon Gimme Fiction, Muse, Norah Jones, Alicia Keys, Gaga, Britney x2, Destiny's Child, Mary J. Blige, Brandy, Usher, Bright Eyes, Iron & Wine, Devendra Banhart, Feist, Regina Spektor, Ani DiFranco, and ~70 cross-genre 50s-80s classics (jazz, soul, country, world, post-punk).
- Filter rule: skip artists already in wantToListen/notHeard/dontCare/blocked_artists (memory `filter-recs-against-triage-lists`).
- Keith still needs to re-hide hidden artists/curated entries made since Nov 8 plus Sam Smith and Christina Aguilera albums (pre-fix merge dropped them); `skipped_albums` should fill after he opens the new build on each device.
- "Cat Power is first" in Artist gaps: it resumes the persisted `currentArtistId`; Skip artist → should move to the next artist (untested by Keith).
- Tracklists from memory were wrong several times; use `tl.py` (MusicBrainz) instead.
- Still open from earlier: UX-teardown slices 5-6 (desktop width, Want to listen sort), gap-bonus shrinkage in `suggestions.ts`, splitting `main.ts`, CSP, friend accounts with server-enforced ownership, redesign decisions in the 2026-10-04 notes.

## Git state
- Branch: main, 3 commits ahead of origin (ab4ddcd, 75e7058, 5f8b852), deployed.
- Uncommitted: only untracked `.playwright-mcp/` (pre-existing, leave).

## Reason for handoff
session paused

## Updated
2026-11-15T14:03:48Z
