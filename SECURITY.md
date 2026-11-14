# Security Policy

Album Case is public for reads. Write protection is **opt-in and currently
off** in production. Keith dropped enforcement on 2026-08-11 because a browser
that never got unlocked was silently caching ratings locally instead of saving
them, which read as data loss. On 2026-11-14 `requireWriteKey()`
(`web/api/_writeKey.ts`) became an explicit switch: it enforces the key only
when `ALBUM_CASE_ENFORCE_WRITE_KEY=1` and `ALBUM_CASE_WRITE_KEY` is set. A stale
`ALBUM_CASE_WRITE_KEY` is still in the production environment from the earlier
era, so the flag (not the key) is what turns enforcement on. With the flag off,
anyone with the URL can edit the ranked list.

The client no longer fails silently when enforcement is on: a 401 puts the sync
banner into an explicit locked state (changes kept on the device, not saved,
with an unlock field), and a bookmarkable `/#key=...` link unlocks a device in
one visit (a URL fragment never reaches the server or its logs).

Separately, `POST /api/ranking` now requires `base_updated_at` (null for a first
insert, a number for an update). A write without it is rejected with 400
`missing_base_updated_at`, so a script or old client can no longer overwrite the
list outside the compare-and-set check.

## What Is Intended (while enforcement is off)

- Public reads.
- Public writes -- no key, no login, no rate limit beyond MusicBrainz's own, but always version-checked.
- The fixed owner ID is not auth and never was.

## To turn enforcement on

1. Confirm `ALBUM_CASE_WRITE_KEY` in Vercel production is a value Keith still has.
2. Set `ALBUM_CASE_ENFORCE_WRITE_KEY=1` in Vercel production and redeploy.
3. Open `https://album-case.vercel.app/#key=<the key>` once on each device.

## Do Not Expose

- `ALBUM_CASE_WRITE_KEY`
- `VITE_*` env vars containing the write key
- screenshots that reveal the write key
- logs or exports that reveal the write key

## Accepted Tradeoff

- Public read AND write exposure is intentional for now, a deliberate, revertible tradeoff (see above), not an oversight.
- If this needs re-gating later (privacy, or someone actually vandalizing the list), set `ALBUM_CASE_ENFORCE_WRITE_KEY=1` first; gate reads only if private rankings matter independently of that. Friends with their own lists need real sign-in, not a shared key.

## Backup Export Is One-Way

The sync-conflict banner's "Export unsaved backup" button (`syncEngine.ts`)
writes a JSON file via `createRankingBackup` (`backup.ts`). There is no
in-app import path for it -- `parseRankingBackup` exists and is exercised by
tests, but nothing in the UI calls it. Treat an exported backup as a
one-way emergency copy to read or hand-merge manually, not something that
currently round-trips back into the app.

## Also Considered

- Vercel Password Protection as an additional layer: requires the "Advanced Deployment Protection" add-on, not enabled on this team (paid upgrade, not a toggle). Not pursued. Revisit if write-key enforcement comes back and this team's plan changes for other reasons.

## Reporting

Please report issues privately through the public contact link on https://www.keithrobrien.com rather than opening exploit details in a GitHub issue.
