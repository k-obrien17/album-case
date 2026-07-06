# Security Policy

Album Case is public for reads, but mutations require a write key.

## What Is Intended

- Public reads may be available.
- Mutating API routes require `ALBUM_CASE_WRITE_KEY`.
- The fixed owner ID is not auth.
- The browser stores the write key locally as a pragmatic personal-app compromise, not enterprise authentication.

## Do Not Expose

- `ALBUM_CASE_WRITE_KEY`
- `VITE_*` env vars containing the write key
- screenshots that reveal the write key
- logs or exports that reveal the write key

## Accepted Tradeoff

- Read-only music-ranking exposure is intentional for now.
- If private rankings matter later, gate reads as well.

## Also Considered

- Vercel Password Protection as an additional layer: requires the "Advanced Deployment Protection" add-on, not enabled on this team (paid upgrade, not a toggle). Deliberately not pursued; the write-key gate above is considered sufficient. Revisit only if the plan is upgraded for other reasons.

## Reporting

Please report issues privately through the public contact link on https://www.keithrobrien.com rather than opening exploit details in a GitHub issue.
