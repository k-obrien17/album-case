# Handoff

## Current task
Built the hands-free "voice speed round" (auto-arm mic, speak a rating, auto-advance to the next candidate) Keith thought already existed, then discovered the whole voice-rating feature (old manual mic buttons included) never actually worked from the live site he uses, and fixed the root cause.

## Status
Two commits, both pushed and deployed to `https://album-case.vercel.app`. First built the speed round loop on top of the existing local Parakeet STT sidecar (`mimir stt-server`) pattern, deployed it, then Keith tested the live site and hit `SidecarUnavailableError`, since that sidecar only ever runs on `127.0.0.1:8765`, the manual mic buttons from two prior sessions never worked live either. Root-caused and fixed: swapped the whole transcription backend to the browser's built-in `SpeechRecognition` API (`web/src/audio/speechToRating.ts`), no local process needed. Confirmed via the live JS bundle that the new code shipped and all `mimir`/`8765`/`SidecarUnavailable` references are gone. Not yet confirmed: an actual end-to-end voice cycle on the live site (mic permission grant, real transcription, auto-advance) — only confirmed the bundle is correct, not that a live "say 8, get an 8.00 rating" round-trip works.

## Next concrete step
Open `https://album-case.vercel.app`, click "Voice speed round," grant mic permission when Chrome prompts, and do one full cycle out loud to confirm the round-trip actually works now (not just that the old error is gone).

## Open questions
- Firefox has no `SpeechRecognition` at all (shows "needs a browser with speech recognition support" inline, doesn't crash) — acceptable, or does this need a fallback for non-Chromium browsers?
- Kylie "Can't Get You Out of My Head": strict album rule says 2001 (Fever, Oct 2001); Keith may keep 2002 as a US-release judgment call. (Spotify tangent, unrelated repo.)

## Don't forget
- Spotify "Best of YYYY" playlist tangent (`~/Desktop/Claude/spotify-export/`, not a git repo): cut "Primitive Painters" (Felt) from the 1984 playlist, resolve the Kylie year decision above, then re-export + `node analyze-years.mjs "exports/Best of"`.
- "KOB Best of 2021 Longer" is ~90% 2022 music, likely mislabeled; compare against "KOB Best of 2022 Longer" someday.
- 2021 short list still needs 2 more picks beyond Snail Mail "Valentine" and Tyler "LUMBERJACK".
- Standing gotchas: similarity-scores-skew-popular, artist locks paused (`ranking/locks.ts`), `Number('') === 0` gotcha, never append-then-sort, `CONFIRM_CANON_IMPORT` danger.
- This machine's `vercel` CLI wasn't logged in at session start and this repo has no GitHub→Vercel auto-deploy hooked up; deploys are manual `vercel --prod` from `web/`, a push to `main` alone does nothing.

## Files touched this session
- web/src/rating/decideSpeedRoundStep.ts, .test.ts — new pure decision function for the speed round loop
- web/src/ui/speedRound.ts — new hands-free voice rating view
- web/src/main.ts — `speedRound` ViewMode, nav tab, showView wiring
- web/src/style.css — speed round status/action styles
- web/src/audio/speechToRating.ts — new, browser `SpeechRecognition` wrapper, replaces recordRatingClip.ts
- web/src/audio/recordRatingClip.ts, wavEncode.ts, wavEncode.test.ts — deleted (sidecar/WAV pipeline, dead after the swap)
- web/src/ui/rankList.ts, web/src/ui/artistBatchView.ts — mic button import + comment updates for the new backend

## Git state
- Branch: main
- Last commit: e87dd1e fix(rating): swap voice rating to browser-native speech recognition
- Uncommitted changes: no (only pre-existing untracked `.playwright-mcp/`, not session work)
- Stashed: no
- Even with `origin/main`; both session commits deployed to production.

## Reason for handoff
session paused

## Updated
2026-08-03T15:05:39Z
