// KOB Artist Calibration Game
// Loads artists.json, shuffles, presents one at a time for rating.
// Persists state to localStorage. Exports ratings as downloadable JSON.
//
// Rendering uses textContent / createElement, not raw-markup assignment, so
// artist names and metadata can't inject markup, mirroring root app.js.

(async function () {
  const STORAGE_KEY = "kob-calibration-v1";

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

  // Reads the inlined pool from ../artists.js (window.CALIBRATION_ARTISTS),
  // loaded via a <script> tag in index.html, not fetch(): fetching a local
  // file from a page itself opened via file:// is blocked by Chrome's CORS
  // policy, which is exactly why the root tool's app.js avoids fetch() too
  // (see its own header comment). artists.js is root's generated file
  // (build-artists.py's source of truth is artists.json) -- this is a
  // sibling-of-parent read, not a local copy, so it can't drift from root's
  // regenerated data.
  function loadArtists() {
    const raw = window.CALIBRATION_ARTISTS;
    if (!raw) throw new Error("artists.js not loaded (window.CALIBRATION_ARTISTS missing)");
    // Normalize: prototype used {n,e,g,c}, root's artists.js uses
    // {name,era,genre,country}. Support either by mapping.
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
      const parsed = JSON.parse(raw);
      if (!parsed.order || !parsed.ratings || typeof parsed.idx !== "number") {
        return null;
      }
      return parsed;
    } catch (e) {
      console.warn("Failed to load state:", e);
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save state:", e);
    }
  }

  function freshState() {
    return {
      order: shuffle(ARTISTS.map((a) => a.n)),
      ratings: {},
      idx: 0,
      history: [],
    };
  }

  // --- Helpers ---

  function findArtist(name) {
    return ARTISTS.find((a) => a.n === name);
  }

  function nextUnratedIdx(fromIdx) {
    for (let i = fromIdx; i < state.order.length; i++) {
      if (!state.ratings[state.order[i]]) return i;
    }
    return state.order.length;
  }

  function tally() {
    let yes = 0, no = 0, never = 0;
    let S = 0, A = 0, B = 0, C = 0;
    for (const k of Object.keys(state.ratings)) {
      const r = state.ratings[k];
      if (r.verdict === "yes") {
        yes++;
        if (r.tier === "S") S++;
        else if (r.tier === "A") A++;
        else if (r.tier === "B") B++;
        else if (r.tier === "C") C++;
      } else if (r.verdict === "no") no++;
      else if (r.verdict === "never") never++;
    }
    return { yes, no, never, total: yes + no + never, S, A, B, C };
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
      statCard(t.no, "no songs"),
      statCard(t.never, "never heard"),
    );
    const pct = Math.round((t.total / ARTISTS.length) * 100);
    document.getElementById("bar").style.width = pct + "%";
  }

  function renderCurrent() {
    const idx = nextUnratedIdx(state.idx);
    state.idx = idx;

    if (idx >= state.order.length) {
      document.getElementById("active").classList.add("hidden");
      document.getElementById("finished").classList.remove("hidden");
      document.getElementById("ref-done-title").textContent = `All ${ARTISTS.length} artists rated`;
      return;
    }

    const name = state.order[idx];
    const a = findArtist(name);

    document.getElementById("name").textContent = name;

    const metaEl = document.getElementById("meta");
    metaEl.replaceChildren();
    if (a) {
      if (a.e) metaEl.append(el("span", null, a.e));
      if (a.g) metaEl.append(el("span", null, a.g));
      if (a.c) metaEl.append(el("span", null, a.c));
    }

    // Last action hint
    const last = state.history[state.history.length - 1];
    const lastEl = document.getElementById("last");
    lastEl.replaceChildren();
    if (last) {
      const lr = state.ratings[last.artist];
      lastEl.append(document.createTextNode(`last: ${last.artist}`));
      if (lr) {
        if (lr.verdict === "yes") {
          const tag = el("strong", null, lr.tier);
          tag.style.color = `var(--tier-${(lr.tier || "c").toLowerCase()})`;
          lastEl.append(document.createTextNode(" "), tag);
        } else if (lr.verdict === "no") {
          const tag = el("span", null, "no");
          tag.style.color = "var(--no)";
          lastEl.append(document.createTextNode(" "), tag);
        } else if (lr.verdict === "never") {
          const tag = el("span", null, "never");
          tag.style.color = "var(--text-tertiary)";
          lastEl.append(document.createTextNode(" "), tag);
        }
      }
    }
  }

  // --- Actions ---

  function rate(verdict, tier) {
    const idx = state.idx;
    if (idx >= state.order.length) return;
    const name = state.order[idx];
    const entry = { verdict, ts: Date.now() };
    if (tier) entry.tier = tier;
    state.ratings[name] = entry;
    state.history.push({ artist: name, idx });
    state.idx = idx + 1;
    saveState();
    renderStats();
    renderCurrent();
  }

  function undo() {
    if (state.history.length === 0) return;
    const last = state.history.pop();
    delete state.ratings[last.artist];
    state.idx = last.idx;
    saveState();
    document.getElementById("finished").classList.add("hidden");
    document.getElementById("active").classList.remove("hidden");
    renderStats();
    renderCurrent();
  }

  function skipForLater() {
    const idx = state.idx;
    if (idx >= state.order.length) return;
    const skipped = state.order[idx];
    const remaining = state.order.slice(idx + 1);
    state.order = state.order.slice(0, idx).concat(remaining).concat([skipped]);
    saveState();
    renderCurrent();
  }

  function exportRatings() {
    const t = tally();
    const out = {
      version: 1,
      schema: "kob-calibration-v1",
      exported_at: new Date().toISOString(),
      rules: {
        yes: "Has at least one song I would want in a Best of [Year] playlist. Tier S/A/B/C weights how strongly.",
        no: "Definitely do not want anything by them in any year",
        never: "I have never knowingly listened to this artist; needs evaluation",
      },
      stats: {
        total_rated: t.total,
        yes: t.yes,
        no: t.no,
        never: t.never,
        by_tier: { S: t.S, A: t.A, B: t.B, C: t.C },
      },
      ratings: state.ratings,
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
    state = freshState();
    saveState();
    document.getElementById("finished").classList.add("hidden");
    document.getElementById("active").classList.remove("hidden");
    renderStats();
    renderCurrent();
  }

  // --- Event wiring ---

  function wireEvents() {
    document.querySelectorAll(".tier-btn").forEach((btn) => {
      btn.addEventListener("click", () => rate("yes", btn.dataset.tier));
    });
    document.querySelector(".no-btn").addEventListener("click", () => rate("no"));
    document.querySelector(".never-btn").addEventListener("click", () => rate("never"));
    document.getElementById("undo-btn").addEventListener("click", undo);
    document.getElementById("skip-btn").addEventListener("click", skipForLater);
    document.getElementById("export-btn").addEventListener("click", exportRatings);
    document.getElementById("export-final-btn").addEventListener("click", exportRatings);
    document.getElementById("reset-btn").addEventListener("click", reset);

    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      switch (e.key) {
        case "1": rate("yes", "S"); break;
        case "2": rate("yes", "A"); break;
        case "3": rate("yes", "B"); break;
        case "4": rate("yes", "C"); break;
        case "5": rate("no"); break;
        case "6": rate("never"); break;
        case " ": e.preventDefault(); skipForLater(); break;
        case "ArrowLeft":
        case "Backspace": undo(); break;
      }
    });
  }

  // --- Boot ---

  try {
    ARTISTS = loadArtists();
    state = loadState() || freshState();
    if (!loadState()) saveState();
    wireEvents();
    renderStats();
    renderCurrent();
  } catch (e) {
    console.error("Boot failed:", e);
    document.getElementById("name").textContent = "Error loading artists";
    const metaEl = document.getElementById("meta");
    metaEl.replaceChildren();
    const err = el("span", null, e.message);
    err.style.color = "#A32D2D";
    metaEl.append(err);
  }
})();
