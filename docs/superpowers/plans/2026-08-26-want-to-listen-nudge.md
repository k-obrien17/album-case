# Want to listen nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "Mark as heard" on all three saved lists with inline rating (so listening leads straight to a ranked placement instead of a random future re-draw), and add a plain, non-interactive "Want to listen" reminder to Keith's `/today` command.

**Architecture:** Part A reuses the existing `addSearchedAlbum` pure function and the candidate card's existing rate-form markup/CSS pattern, so no new mutation logic or styling primitives are introduced. Part B is a standalone Turso-direct script, matching the existing `web/scripts/*.mjs` convention, wired into a global command file outside this repo. Neither part has any automated test, matching this codebase's existing convention for UI glue (`web/src/ui/`) and one-shot operational scripts (`web/scripts/`) -- both categories have zero `.test.ts`/test coverage today, and this plan doesn't introduce a new convention.

**Tech Stack:** TypeScript 6, Vite 8, Vitest 3, `@libsql/client` 0.14, Node ESM scripts.

**Spec:** `docs/superpowers/specs/2026-08-26-want-to-listen-nudge-design.md`

## Global Constraints

- Mobile-first: usable at 360px width, no horizontal scroll, 44px minimum tap targets (existing project convention, `CLAUDE.md`).
- Safe DOM construction only -- no `innerHTML` (existing project convention, `CLAUDE.md`).
- Reuse `addSearchedAlbum` (`web/src/main.ts`) for the rating mutation; do not write new list-splice-and-insert logic.
- No new API endpoint, no CORS handling -- Part B talks to Turso directly, never through the deployed HTTP API.
- `web/scripts/*.mjs` convention: duplicate `OWNER_ID` as a hardcoded constant rather than importing `web/src/owner.ts` (plain Node ESM has no TS loader -- see `web/scripts/export-collect-albums.mjs`'s own comment on this).
- Turso credentials come from `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`, loaded via `node --env-file=web/.env.local ...` -- never hardcoded, never logged.
- No automated tests for `web/src/ui/*` or `web/scripts/*.mjs` -- matches existing project convention; verification is manual/typecheck/build.

---

### Task 1: Inline rating on saved lists (replaces "Mark as heard")

**Files:**
- Modify: `web/src/ui/savedList.ts`
- Modify: `web/src/main.ts:1106-1123` (the `markAsHeard`/`removeFromSavedList`/`renderCurrentSavedList` block)
- Modify: `web/src/style.css` (`.saved-item`, `.saved-mark`/`.saved-mark:hover` removed, new `.saved-actions`/`.saved-rate-status`)

**Interfaces:**
- Consumes: `addSearchedAlbum(ranked: RankedAlbum[], lists: SavedLists, album: Album, rating: number): { ranked: RankedAlbum[]; lists: SavedLists }` (already exported from `web/src/main.ts:227`, unchanged).
- Produces: `renderSavedList(container: HTMLElement, albums: Album[], onRate: (album: Album, rating: number) => void, onRemove: (album: Album) => void): void` -- the second callback's shape change from `onMarkHeard: (album: Album) => void` is the breaking interface change this task makes; nothing outside `savedList.ts`/`main.ts` calls it.

- [ ] **Step 1: Replace the "Mark as heard" button with an inline rate form in `savedList.ts`**

Edit `web/src/ui/savedList.ts` to this full content:

```ts
import type { Album } from '../ranking/types';

/**
 * Render a set-aside list (Want to listen / Haven't heard / Don't care) into
 * `container`, replacing prior content. Each row shows a cover thumbnail,
 * title, and artist, plus an inline 0-10 rate form that places the album
 * directly into the ranked list via `onRate`, and a "Remove" button that
 * discards it from the app entirely via `onRemove`. Empty state shows a
 * short message rather than a blank screen.
 */
export function renderSavedList(
  container: HTMLElement,
  albums: Album[],
  onRate: (album: Album, rating: number) => void,
  onRemove: (album: Album) => void
): void {
  container.textContent = '';

  if (albums.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'saved-empty';
    empty.textContent = 'Nothing here yet.';
    container.append(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'saved-list';

  for (const album of albums) {
    const item = document.createElement('li');
    item.className = 'saved-item';

    // Non-blocking image, same approach as the pick loop / ranked list.
    const thumb = new Image();
    thumb.className = 'saved-thumb';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    thumb.alt = '';
    thumb.src = album.cover_url;

    const meta = document.createElement('div');
    meta.className = 'saved-meta';

    const title = document.createElement('p');
    title.className = 'saved-title';
    title.textContent = album.title;

    const artist = document.createElement('p');
    artist.className = 'saved-artist';
    artist.textContent = album.primary_artist_name;

    meta.append(title, artist);

    const actions = document.createElement('div');
    actions.className = 'saved-actions';

    // Same markup/validation shape as the candidate card's "Or rate it
    // directly" control (rankList.ts's buildDirectRate), reused here rather
    // than duplicated logic.
    const form = document.createElement('form');
    form.className = 'candidate-place';
    form.noValidate = true;

    const input = document.createElement('input');
    input.className = 'candidate-place-input';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.max = '10';
    input.step = '0.01';
    input.placeholder = '0-10';
    input.setAttribute('aria-label', `Rating for ${album.title}`);

    const rateBtn = document.createElement('button');
    rateBtn.type = 'submit';
    rateBtn.className = 'candidate-place-button';
    rateBtn.textContent = 'Rate';

    const status = document.createElement('p');
    status.className = 'saved-rate-status';
    status.hidden = true;

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = input.value.trim();
      const rating = Number(raw);
      if (raw === '' || !Number.isFinite(rating) || rating < 0 || rating > 10) {
        status.hidden = false;
        status.textContent = 'Enter 0-10.';
        return;
      }
      onRate(album, rating);
    });

    form.append(input, rateBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'saved-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => onRemove(album));

    actions.append(form, removeBtn, status);
    item.append(thumb, meta, actions);
    list.append(item);
  }

  container.append(list);
}
```

- [ ] **Step 2: Run typecheck to confirm the caller (main.ts) now fails to compile**

Run: `cd web && npx tsc --noEmit`
Expected: FAIL -- `main.ts`'s `renderCurrentSavedList` still passes a `(album) => markAsHeard(album, which)` callback shaped for the old `onMarkHeard`, which no longer matches `onRate`'s two-argument signature.

- [ ] **Step 3: Replace `markAsHeard` with `rateFromSavedList` in `main.ts`**

In `web/src/main.ts`, replace this block (currently around line 1106):

```ts
  function markAsHeard(album: Album, which: ListName): void {
    lists = removeFromList(lists, album.mbid, which);
    persistLists();
    // Eligible again: if the pool was exhausted (no candidate), offer it now.
    if (!candidate) reselectCandidate();
    renderNav();
    renderCurrentSavedList(which);
  }

  function removeFromSavedList(album: Album, which: ListName): void {
    lists = removeFromList(lists, album.mbid, which);
    persistLists();
    // Unlike markAsHeard, this is a permanent discard, not a return to the
    // pool -- skippedAlbums already keeps it out of candidate selection
    // (see reselectCandidate), so there's nothing new to offer.
    skippedAlbums.add(album.mbid);
    saveSkippedAlbums(skippedAlbums);
    renderNav();
    renderCurrentSavedList(which);
  }

  function renderCurrentSavedList(which: ListName): void {
    renderSavedList(
      stage,
      lists[which],
      (album) => markAsHeard(album, which),
      (album) => removeFromSavedList(album, which)
    );
  }
```

with:

```ts
  function rateFromSavedList(album: Album, which: ListName, rating: number): void {
    const added = addSearchedAlbum(state.ranked, lists, album, rating);
    state = { ranked: added.ranked, pending: null };
    lists = added.lists;
    persistRankingState();
    persistLists();
    reselectCandidate();
    renderNav();
    renderCurrentSavedList(which);
  }

  function removeFromSavedList(album: Album, which: ListName): void {
    lists = removeFromList(lists, album.mbid, which);
    persistLists();
    // Unlike rateFromSavedList, this is a permanent discard, not a ranked
    // placement -- skippedAlbums already keeps it out of candidate selection
    // (see reselectCandidate), so there's nothing new to offer.
    skippedAlbums.add(album.mbid);
    saveSkippedAlbums(skippedAlbums);
    renderNav();
    renderCurrentSavedList(which);
  }

  function renderCurrentSavedList(which: ListName): void {
    renderSavedList(
      stage,
      lists[which],
      (album, rating) => rateFromSavedList(album, which, rating),
      (album) => removeFromSavedList(album, which)
    );
  }
```

`addSearchedAlbum`, `state`, `lists`, `persistRankingState`, `persistLists`, `reselectCandidate`, and `renderNav` are all already defined/in scope elsewhere in this file -- no new imports needed.

- [ ] **Step 4: Run typecheck again to confirm it passes**

Run: `cd web && npx tsc --noEmit`
Expected: PASS, no output.

- [ ] **Step 5: Update `style.css`**

Remove this block entirely (now-dead CSS, nothing renders a `.saved-mark` element anymore):

```css
.saved-mark {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--color-border-btn);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  cursor: pointer;
}

.saved-mark:hover {
  background: var(--color-bg-alt);
  color: var(--color-fg);
}
```

Change `.saved-item` from:

```css
.saved-item {
  display: flex;
  align-items: center;
  gap: 12px;
}
```

to:

```css
.saved-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
```

(The rate form + Remove button need more horizontal room than a single "Mark as heard" button did; `flex-wrap` plus the new `.saved-actions` class below lets them drop to their own full-width row under the thumbnail/title at narrow widths instead of overflowing.)

Add these two new rules, placed near `.saved-remove` (keep `.saved-remove`/`.saved-remove:hover` as they already are -- unchanged):

```css
.saved-actions {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.saved-rate-status {
  flex: 1 1 100%;
  margin: 0;
  color: var(--color-error);
  font-size: 0.72rem;
}
```

- [ ] **Step 6: Run the full verification suite**

Run: `cd web && npm run test`
Expected: 312/312 pass (unchanged count -- this task adds no new tests, matching the existing zero-test convention for `web/src/ui/*`; `addSearchedAlbum`'s own existing tests in `main.test.ts` are untouched since the function itself didn't change).

Run: `cd web && npm run build`
Expected: clean build, no errors.

- [ ] **Step 7: Manual browser verification**

Run: `cd web && npm run dev`, open the printed local URL.

1. Add an album to Want to listen (via the candidate card's "Want to listen" action), open the "Want to listen" tab. Confirm the row shows a `0-10` input, a "Rate" button, and a "Remove" button -- no "Mark as heard" button anywhere.
2. Type a rating (e.g. `7.5`) and click Rate. Confirm: the row disappears from Want to listen, and switching to the Ranked list tab shows the album inserted at the position matching a 7.5 rating.
3. Repeat step 1-2 for "Haven't heard" and "Don't care" (add an album to each via the candidate card's corresponding action, rate it from that list) -- confirm the same behavior on all three lists.
4. On any saved-list row, submit the rate form empty, and separately with a value like `15` (out of range). Confirm both show "Enter 0-10." inline and the album stays in the list (no mutation).
5. Confirm "Remove" still works unchanged (row disappears, album does not reappear as the next candidate) -- this is a regression check on work already shipped earlier this session, not new behavior.
6. At a 360px-wide viewport (browser devtools device toolbar), confirm no horizontal scroll on the saved-list view and all tap targets look reasonably sized.

- [ ] **Step 8: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/src/ui/savedList.ts web/src/main.ts web/src/style.css
git commit -m "$(cat <<'EOF'
feat(web): replace Mark as heard with inline rating on saved lists

Instead of returning an album to the general candidate pool to wait
for a random future re-draw, rate it directly from Want to listen /
Haven't heard / Don't care and it lands in the ranked list right
away. Reuses the existing addSearchedAlbum mutation and the candidate
card's rate-form pattern -- no new mutation logic.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `want-to-listen-pick.mjs` script

**Files:**
- Create: `web/scripts/want-to-listen-pick.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 (independent of the app's runtime code -- reads Turso directly).
- Produces: a CLI contract Task 3 depends on -- running `node --env-file=web/.env.local web/scripts/want-to-listen-pick.mjs` prints exactly one line of JSON to stdout: an array of `{ title: string, primary_artist_name: string, release_year: number | null }`, always (empty array `[]` on any failure -- missing creds, no snapshot row, empty pile, or any thrown error), exit code always `0`.

- [ ] **Step 1: Create the script**

Create `web/scripts/want-to-listen-pick.mjs`:

```js
/**
 * Print N random picks from the owner's "Want to listen" list, for /today
 * to surface as a reminder -- see
 * docs/superpowers/specs/2026-08-26-want-to-listen-nudge-design.md.
 *
 * Read-only over Turso. Prints exactly one line of JSON (an array) to
 * stdout, always -- an empty array `[]`, never an error/non-zero exit, on
 * any failure (missing credentials, no snapshot row, empty pile, thrown
 * error), so a caller like /today can render nothing rather than break.
 *
 * Usage:
 *   node --env-file=web/.env.local web/scripts/want-to-listen-pick.mjs
 *   COUNT=5 node --env-file=web/.env.local web/scripts/want-to-listen-pick.mjs
 */
import { createClient } from '@libsql/client';

// Matches web/src/owner.ts's OWNER_ID. Duplicated, not imported: this is a
// plain Node ESM script with no TS loader, so it can't import a .ts file.
const OWNER_ID = 'c0ffee00-0000-4000-8000-000000000001';

const COUNT = Number(process.env.COUNT || 3);

function randomSample(items, count) {
  const pool = [...items];
  const picked = [];
  while (pool.length > 0 && picked.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.log('[]');
    return;
  }

  const client = createClient({ url, authToken });
  const rows = await client.execute({
    sql: 'SELECT lists_json FROM ranking_snapshots WHERE session_id = ?',
    args: [OWNER_ID],
  });

  const row = rows.rows[0];
  if (!row) {
    console.log('[]');
    return;
  }

  const lists = JSON.parse(String(row.lists_json));
  const wantToListen = Array.isArray(lists.wantToListen) ? lists.wantToListen : [];

  const picks = randomSample(wantToListen, COUNT).map((album) => ({
    title: album.title,
    primary_artist_name: album.primary_artist_name,
    release_year: album.release_year ?? null,
  }));

  console.log(JSON.stringify(picks));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  console.log('[]');
});
```

- [ ] **Step 2: Run it against real data**

Run: `node --env-file=web/.env.local web/scripts/want-to-listen-pick.mjs`
Expected: one line of JSON -- either `[]` (if the Want to listen pile is currently empty) or an array of up to 3 objects, each with `title`, `primary_artist_name`, `release_year`. Confirm the titles/artists correspond to real albums currently in the app's Want to listen list (cross-check against the app's "Want to listen" tab).

Run it 2-3 more times in a row.
Expected: picks vary between runs (confirms randomness) when the pile has more than 3 albums; if the pile has 3 or fewer, the same set repeats (correct -- `randomSample` never exceeds the input length).

- [ ] **Step 3: Commit**

```bash
cd /Users/keithobrien/Desktop/Claude/Projects/album-case
git add web/scripts/want-to-listen-pick.mjs
git commit -m "$(cat <<'EOF'
feat(web): add want-to-listen-pick script for /today reminder

Read-only, Turso-direct, matching the existing web/scripts/*.mjs
convention. Prints N random Want to listen picks as JSON; always
exits clean with an empty array on any failure so a caller (the
/today command) never breaks on it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire the reminder into `/today`

**Files:**
- Modify: `~/.claude/commands/today.md` (a separate git repository from `album-case` -- `~/.claude`, not this repo)

**Interfaces:**
- Consumes: the Task 2 script's CLI contract (JSON array on stdout, always exit 0).
- Produces: nothing consumed elsewhere -- this is the final integration point.

- [ ] **Step 1: Add the data-collection step**

In `~/.claude/commands/today.md`, in the `## Data Collection` numbered list, after item 5 ("Waiting For"), add:

```markdown
6. **Want to listen** — Run:
   ```
   node --env-file=~/Desktop/Claude/Projects/album-case/web/.env.local ~/Desktop/Claude/Projects/album-case/web/scripts/want-to-listen-pick.mjs
   ```
   Parse stdout as a JSON array of `{ title, primary_artist_name, release_year }` picks. If the array is empty, skip the "Want to listen" output section entirely.
```

- [ ] **Step 2: Add the output section**

In the `## Output Format` code block, after the `### Waiting On` table block and before `### One Thing`, add:

```markdown
### Want to listen
[Each pick as: **Title** — Artist (Year)]
[If step 6 returned an empty array, omit this entire section — no header, no placeholder text]
```

- [ ] **Step 3: Verify the full file reads correctly**

Read `~/.claude/commands/today.md` back in full and confirm:
- Step 6 sits after step 5 and before `## Output Format`, numbered correctly.
- The new `### Want to listen` block sits between `### Waiting On` and `### One Thing` in the template.
- The closing instruction line ("Do not anonymize names... Do not add sections beyond what is specified...") still reads correctly below the whole template -- it does not need to change, since the new section is now part of "what is specified."

- [ ] **Step 4: Smoke-test the referenced command directly**

Run: `node --env-file=~/Desktop/Claude/Projects/album-case/web/.env.local ~/Desktop/Claude/Projects/album-case/web/scripts/want-to-listen-pick.mjs`
Expected: same JSON-array-on-stdout behavior verified in Task 2, confirming the exact command string now embedded in `today.md` (with `~`-expanded absolute paths) works when run standalone, not just from inside the `web/` directory.

- [ ] **Step 5: Commit in the `~/.claude` repository**

```bash
cd /Users/keithobrien/.claude
git add commands/today.md
git commit -m "$(cat <<'EOF'
feat(today): add Want to listen reminder from Album Case

New step 6 runs album-case/web/scripts/want-to-listen-pick.mjs and
surfaces up to 3 random Want to listen picks as a plain reminder
section. No reply-to-act interaction -- rating happens later, in-app.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Note: this commit lands in a different git repository than Tasks 1-2 (`~/.claude`, not `album-case`). Confirm you're in the right repo before committing -- `git rev-parse --show-toplevel` should print `/Users/keithobrien/.claude`, not the album-case path.

---

## Self-Review Notes

- **Spec coverage:** Part A (inline rating, all three lists, `addSearchedAlbum` reuse) → Task 1. Part B (Turso-direct pick script) → Task 2. `/today` wiring (plain reminder, no reply-to-act) → Task 3. All three spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact command.
- **Type consistency:** `renderSavedList`'s `onRate` signature in Task 1 Step 1 matches the call site built in Task 1 Step 3 exactly (`(album, rating) => rateFromSavedList(album, which, rating)`). `want-to-listen-pick.mjs`'s output shape in Task 2 matches what Task 3's parsing instructions describe (`title`, `primary_artist_name`, `release_year`).
- **Scope check:** single coherent feature, three tasks, no further decomposition needed.
