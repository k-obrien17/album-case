# Security Policy

Album Case is public for reads. Write-key enforcement on mutations is
currently **dropped** (Keith's call, 2026-08-11): a browser that never got
unlocked was silently caching ratings locally instead of saving them,
mistaken for data loss. Mutating routes now accept requests unconditionally
-- `requireWriteKey()` (`web/api/_writeKey.ts`) is a pass-through, not
deleted, so re-enabling is a one-function revert if this gets reconsidered.
Anyone with the URL can currently edit the ranked list; there is no
authentication of any kind on writes.

## What Is Intended (while enforcement is dropped)

- Public reads.
- Public writes -- no key, no login, no rate limit beyond MusicBrainz's own.
- The fixed owner ID is not auth and never was.

## Do Not Expose

- `ALBUM_CASE_WRITE_KEY`
- `VITE_*` env vars containing the write key
- screenshots that reveal the write key
- logs or exports that reveal the write key

## Accepted Tradeoff

- Public read AND write exposure is intentional for now, a deliberate, revertible tradeoff (see above), not an oversight.
- If this needs re-gating later (privacy, or someone actually vandalizing the list), re-enable `requireWriteKey()` first; gate reads only if private rankings matter independently of that.

## Also Considered

- Vercel Password Protection as an additional layer: requires the "Advanced Deployment Protection" add-on, not enabled on this team (paid upgrade, not a toggle). Not pursued. Revisit if write-key enforcement comes back and this team's plan changes for other reasons.

## Reporting

Please report issues privately through the public contact link on https://www.keithrobrien.com rather than opening exploit details in a GitHub issue.
