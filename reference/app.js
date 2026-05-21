// KOB Artist Calibration Game
// Loads artists.json, shuffles, presents one at a time for rating.
// Persists state to localStorage. Exports ratings as downloadable JSON.

(async function () {
  const STORAGE_KEY = "kob-calibration-v1";
  const ARTISTS_URL = "artists.json";

  let ARTISTS = [];
  let state = null;

  // --- Loading ---

  async function loadArtists() {
    const res = await fetch(ARTISTS_URL);
    if (!res.ok) throw new Error(`Failed to load ${ARTISTS_URL}: ${res.status}`);
    const data = await res.json();
    // Normalize: prototype used {n,e,g,c}, this uses {name,era,genre,country}
    // Support either by mapping.
    return data.map((a) => ({
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

  function renderStats() {
    const t = tally();
    document.getElementById("stats").innerHTML = `
      <div class="stat"><div class="stat-num">${t.total}</div><div class="stat-lbl">rated</div></div>
      <div class="stat"><div class="stat-num">${t.yes}</div><div class="stat-lbl">yes (S${t.S} A${t.A} B${t.B} C${t.C})</div></div>
      <div class="stat"><div class="stat-num">${t.no}</div><div class="stat-lbl">no songs</div></div>
      <div class="stat"><div class="stat-num">${t.never}</div><div class="stat-lbl">never heard</div></div>
    `;
    const pct = Math.round((t.total / ARTISTS.length) * 100);
    document.getElementById("bar").style.width = pct + "%";
  }

  function renderCurrent() {
    const idx = nextUnratedIdx(state.idx);
    state.idx = idx;

    if (idx >= state.order.length) {
      document.getElementById("active").classList.add("hidden");
      document.getElementById("finished").classList.remove("hidden");
      return;
    }

    const name = state.order[idx];
    const a = findArtist(name);

    document.getElementById("name").textContent = name;

    let meta = "";
    if (a) {
      if (a.e) meta += `<span>${a.e}</span>`;
      if (a.g) meta += `<span>${a.g}</span>`;
      if (a.c) meta += `<span>${a.c}</span>`;
    }
    document.getElementById("meta").innerHTML = meta;

    // Last action hint
    const last = state.history[state.history.length - 1];
    const lastEl = document.getElementById("last");
    if (last) {
      const lr = state.ratings[last.artist];
      let suffix = "";
      if (lr) {
        if (lr.verdict === "yes") {
          suffix = ` <strong style="color:var(--tier-${(lr.tier || "c").toLowerCase()})">${lr.tier}</strong>`;
        } else if (lr.verdict === "no") {
          suffix = ` <span style="color:var(--no)">no</span>`;
        } else if (lr.verdict === "never") {
          suffix = ` <span style="color:var(--text-tertiary)">never</span>`;
        }
      }
      lastEl.innerHTML = `last: ${last.artist}${suffix}`;
    } else {
      lastEl.innerHTML = "";
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
    ARTISTS = await loadArtists();
    state = loadState() || freshState();
    if (!loadState()) saveState();
    wireEvents();
    renderStats();
    renderCurrent();
  } catch (e) {
    console.error("Boot failed:", e);
    document.getElementById("name").textContent = "Error loading artists";
    document.getElementById("meta").innerHTML = `<span style="color:#A32D2D">${e.message}</span>`;
  }
})();
