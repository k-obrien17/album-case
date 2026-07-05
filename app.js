// Album Case: legacy artist calibration game (5-up ranking mode).
// Reads the inlined artist pool (window.CALIBRATION_ARTISTS), shuffles once,
// presents five artists per screen. You reorder them to compare, rate each into
// a tier, add notes and songs to flag, then advance to the next five. Persists
// to localStorage and exports ratings as JSON for the Best of Years pipeline.
//
// Rendering uses textContent / createElement (never innerHTML) so artist names
// and metadata can't inject markup.

(function () {
  const STORAGE_KEY = "kob-calibration-v2";
  const SCREEN_SIZE = 5;

  let ARTISTS = [];
  let state = null;

  // --- DOM helpers ---

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  // --- Loading ---

  function loadArtists() {
    const raw = window.CALIBRATION_ARTISTS;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("artists.js not loaded (window.CALIBRATION_ARTISTS missing)");
    }
    // Normalize: source uses {name,era,genre,country}; game uses {n,e,g,c}.
    return raw.map((a) => ({
      n: a.n || a.name,
      e: a.e || a.era,
      g: a.g || a.genre,
      c: a.c || a.country,
    }));
  }

  // --- State management ---

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!Array.isArray(p.order) || !p.ratings || !Array.isArray(p.screen)) {
        return null;
      }
      if (!p.annot) p.annot = {};
      if (!Array.isArray(p.history)) p.history = [];
      return p;
    } catch (e) {
      console.warn("Failed to load state:", e);
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save state (continuing in-memory):", e);
    }
  }

  // "Never heard" is now treated as a hard exclude ("no"). Convert any legacy
  // never verdicts in saved state (ratings and undo history) to no.
  function migrateNeverToNo(st) {
    let changed = false;
    for (const name of Object.keys(st.ratings)) {
      if (st.ratings[name].verdict === "never") {
        st.ratings[name] = { verdict: "no", ts: st.ratings[name].ts || Date.now() };
        changed = true;
      }
    }
    for (const h of st.history) {
      if (h.prev && h.prev.verdict === "never") {
        h.prev = { verdict: "no", ts: h.prev.ts };
      }
    }
    return changed;
  }

  function freshState() {
    state = {
      order: shuffle(ARTISTS.map((a) => a.n)),
      ratings: {},
      annot: {},
      screen: [],
      history: [],
    };
    fillScreen();
    return state;
  }

  // --- Queue / screen logic ---

  function findArtist(name) {
    return ARTISTS.find((a) => a.n === name);
  }

  // Top up the current screen from the queue with the next eligible bands:
  // not yet rated and not already shown on this screen.
  function fillScreen() {
    const onScreen = new Set(state.screen);
    for (let i = 0; i < state.order.length && state.screen.length < SCREEN_SIZE; i++) {
      const name = state.order[i];
      if (state.ratings[name] || onScreen.has(name)) continue;
      state.screen.push(name);
      onScreen.add(name);
    }
  }

  function newScreen() {
    state.screen = [];
    fillScreen();
  }

  function screenComplete() {
    return state.screen.length > 0 && state.screen.every((n) => state.ratings[n]);
  }

  // Auto-rank: unrated bands float to the top, rated ones sort below by tier
  // (S, A, B, C, then No). Sort is stable, so manual ▲/▼ nudges within a tier
  // (or among the unrated) survive later ratings.
  const TIER_RANK = { S: 0, A: 1, B: 2, C: 3 };
  function rankOf(name) {
    const r = state.ratings[name];
    if (!r) return -1;
    if (r.verdict === "yes") return TIER_RANK[r.tier] != null ? TIER_RANK[r.tier] : 3;
    return 5;
  }
  function sortScreen() {
    state.screen.sort((a, b) => rankOf(a) - rankOf(b));
  }

  function tally() {
    let yes = 0, no = 0, S = 0, A = 0, B = 0, C = 0;
    for (const k of Object.keys(state.ratings)) {
      const r = state.ratings[k];
      if (r.verdict === "yes") {
        yes++;
        if (r.tier === "S") S++;
        else if (r.tier === "A") A++;
        else if (r.tier === "B") B++;
        else if (r.tier === "C") C++;
      } else if (r.verdict === "no") no++;
    }
    return { yes, no, total: yes + no, S, A, B, C };
  }

  // --- Rendering ---

  function statCard(num, label) {
    const card = el("div", "stat");
    card.append(el("div", "stat-num", num), el("div", "stat-lbl", label));
    return card;
  }

  function renderStats() {
    const t = tally();
    document.getElementById("stats").replaceChildren(
      statCard(t.total, "rated"),
      statCard(t.yes, `yes (S${t.S} A${t.A} B${t.B} C${t.C})`),
      statCard(t.no, "no / never"),
    );
    const pct = ARTISTS.length ? Math.round((t.total / ARTISTS.length) * 100) : 0;
    document.getElementById("bar").style.width = pct + "%";
  }

  function renderLastHint() {
    const lastEl = document.getElementById("last");
    lastEl.replaceChildren();
    const last = state.history[state.history.length - 1];
    if (!last) return;
    lastEl.append(document.createTextNode(`last: ${last.name} `));
    const lr = state.ratings[last.name];
    if (!lr) return;
    if (lr.verdict === "yes") {
      const tier = lr.tier || "C";
      const tag = el("strong", null, tier);
      tag.style.color = `var(--tier-${tier.toLowerCase()})`;
      lastEl.append(tag);
    } else if (lr.verdict === "no") {
      const tag = el("span", null, "no");
      tag.style.color = "var(--no)";
      lastEl.append(tag);
    }
  }

  function updateRowSelection(rowEl, name) {
    rowEl.querySelectorAll(".tier-btn,.no-btn,.never-btn")
      .forEach((b) => b.classList.remove("active"));
    const r = state.ratings[name];
    if (!r) return;
    if (r.verdict === "yes") {
      const b = rowEl.querySelector(`.tier-btn[data-tier="${r.tier}"]`);
      if (b) b.classList.add("active");
    } else if (r.verdict === "no") {
      rowEl.querySelector(".no-btn").classList.add("active");
    }
  }

  const TIERS = [["S", "essential"], ["A", "strong"], ["B", "solid"], ["C", "one song"]];

  function buildRow(name, pos) {
    const a = findArtist(name);
    const an = state.annot[name] || {};
    const row = el("div", "band");
    row.dataset.name = name;

    // Header: reorder arrows, rank + name + meta, skip
    const head = el("div", "band-head");

    const reorder = el("div", "reorder");
    const up = el("button", "ro-btn", "▲");
    up.title = "Move up";
    up.disabled = pos === 0;
    up.addEventListener("click", () => moveBand(name, -1));
    const down = el("button", "ro-btn", "▼");
    down.title = "Move down";
    down.disabled = pos === state.screen.length - 1;
    down.addEventListener("click", () => moveBand(name, 1));
    reorder.append(up, down);

    const info = el("div", "band-info");
    const titleLine = el("div", "band-title");
    titleLine.append(el("span", "band-rank", pos + 1), el("span", "band-name", name));
    info.append(titleLine);
    const meta = el("div", "band-meta");
    if (a) {
      if (a.e) meta.append(el("span", null, a.e));
      if (a.g) meta.append(el("span", null, a.g));
      if (a.c) meta.append(el("span", null, a.c));
    }
    info.append(meta);

    const skip = el("button", "skip-btn", "↪ skip");
    skip.title = "Send to back of the queue";
    skip.addEventListener("click", () => skipBand(name));

    head.append(reorder, info, skip);
    row.append(head);

    // Tier buttons
    const tierRow = el("div", "tier-row");
    TIERS.forEach(([t, lbl]) => {
      const b = el("button", `tier-btn tier-${t.toLowerCase()}`);
      b.dataset.tier = t;
      b.append(el("span", "tier-letter", t), el("span", "tier-label", lbl));
      b.addEventListener("click", () => rate(name, "yes", t));
      tierRow.append(b);
    });
    row.append(tierRow);

    // No songs I want (also covers artists never heard)
    const otherRow = el("div", "other-row");
    const noB = el("button", "no-btn", "No songs I want");
    noB.addEventListener("click", () => rate(name, "no", null));
    otherRow.append(noB);
    row.append(otherRow);

    // Notes + songs to flag
    const fields = el("div", "fields");
    const notes = el("input", "field-input");
    notes.type = "text";
    notes.placeholder = "notes";
    notes.value = an.notes || "";
    notes.addEventListener("input", () => setAnnot(name, "notes", notes.value));
    const flag = el("input", "field-input");
    flag.type = "text";
    flag.placeholder = "songs to flag";
    flag.value = an.flagged || "";
    flag.addEventListener("input", () => setAnnot(name, "flagged", flag.value));
    fields.append(notes, flag);
    row.append(fields);

    updateRowSelection(row, name);
    return row;
  }

  function renderScreen() {
    const c = document.getElementById("screen");
    c.replaceChildren();
    state.screen.forEach((name, i) => c.append(buildRow(name, i)));
    document.getElementById("screen-label").textContent =
      state.screen.length ? `${state.screen.length} bands · rate from the top, they sort into rank below` : "";
  }

  function updateNext() {
    document.getElementById("next-btn").disabled = !screenComplete();
  }

  function showActive() {
    document.getElementById("finished").classList.add("hidden");
    document.getElementById("active").classList.remove("hidden");
  }

  function showFinished() {
    document.getElementById("active").classList.add("hidden");
    const fin = document.getElementById("finished");
    fin.classList.remove("hidden");
    document.getElementById("done-title").textContent = `All ${ARTISTS.length} artists rated`;
  }

  // --- Actions ---

  function rate(name, verdict, tier) {
    const prev = state.ratings[name] || null;
    const entry = { verdict, ts: Date.now() };
    if (tier) entry.tier = tier;
    state.ratings[name] = entry;
    state.history.push({ name, prev });
    sortScreen();
    saveState();
    renderScreen();
    renderStats();
    renderLastHint();
    updateNext();
  }

  function setAnnot(name, field, value) {
    const cur = state.annot[name] || {};
    cur[field] = value;
    state.annot[name] = cur;
    saveState();
  }

  function moveBand(name, dir) {
    const i = state.screen.indexOf(name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.screen.length) return;
    [state.screen[i], state.screen[j]] = [state.screen[j], state.screen[i]];
    saveState();
    renderScreen();
  }

  function skipBand(name) {
    state.screen = state.screen.filter((n) => n !== name);
    state.order = state.order.filter((n) => n !== name).concat([name]);
    fillScreen();
    sortScreen();
    saveState();
    if (state.screen.length === 0) showFinished();
    renderScreen();
    updateNext();
  }

  function nextScreen() {
    if (!screenComplete()) return;
    newScreen();
    saveState();
    if (state.screen.length === 0) {
      showFinished();
    } else {
      renderScreen();
    }
    updateNext();
  }

  function undo() {
    if (state.history.length === 0) return;
    const last = state.history.pop();
    if (last.prev) state.ratings[last.name] = last.prev;
    else delete state.ratings[last.name];
    if (!state.screen.includes(last.name)) {
      state.screen.unshift(last.name);
      state.screen = state.screen.slice(0, SCREEN_SIZE);
    }
    sortScreen();
    showActive();
    saveState();
    renderScreen();
    renderStats();
    renderLastHint();
    updateNext();
  }

  function splitSongs(raw) {
    if (!raw) return [];
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function exportRatings() {
    const t = tally();
    const ratings = {};
    for (const name of Object.keys(state.ratings)) {
      const entry = { ...state.ratings[name] };
      const an = state.annot[name];
      if (an) {
        const notes = (an.notes || "").trim();
        const songs = splitSongs(an.flagged);
        if (notes) entry.notes = notes;
        if (songs.length) entry.flagged_songs = songs;
      }
      ratings[name] = entry;
    }
    const out = {
      version: 1,
      schema: "kob-calibration-v1",
      exported_at: new Date().toISOString(),
      rules: {
        yes: "Has at least one song I would want in a Best of [Year] playlist. Tier S/A/B/C weights how strongly.",
        no: "Do not want anything by them in any year. Also covers artists I have never knowingly listened to (treated as hard exclude).",
      },
      stats: {
        total_rated: t.total,
        yes: t.yes,
        no: t.no,
        by_tier: { S: t.S, A: t.A, B: t.B, C: t.C },
      },
      ratings,
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kob-calibration-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function reset() {
    if (!confirm("Clear all ratings and start over?")) return;
    freshState();
    saveState();
    showActive();
    renderStats();
    renderScreen();
    renderLastHint();
    updateNext();
  }

  // --- Event wiring ---

  function wireEvents() {
    document.getElementById("next-btn").addEventListener("click", nextScreen);
    document.getElementById("undo-btn").addEventListener("click", undo);
    document.getElementById("export-btn").addEventListener("click", exportRatings);
    document.getElementById("export-final-btn").addEventListener("click", exportRatings);
    document.getElementById("reset-btn").addEventListener("click", reset);

    document.addEventListener("keydown", (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft" || e.key === "Backspace") undo();
    });
  }

  // --- Boot ---

  try {
    ARTISTS = loadArtists();
    const existing = loadState();
    if (existing) {
      state = existing;
      if (migrateNeverToNo(state)) saveState();
    } else {
      freshState();
      saveState();
    }
    wireEvents();
    renderStats();
    sortScreen();
    if (state.screen.length === 0) showFinished();
    else { showActive(); renderScreen(); }
    renderLastHint();
    updateNext();
  } catch (e) {
    console.error("Boot failed:", e);
    const c = document.getElementById("screen");
    if (c) {
      const err = el("div", "band", e.message);
      err.style.color = "var(--no)";
      c.replaceChildren(err);
    }
  }
})();
