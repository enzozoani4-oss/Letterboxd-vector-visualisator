import { importExportZip } from "./importer.js";
import { demoEntries } from "./demo-data.js";
import { buildRecommendations, getApiKey, saveApiKey, findMovieId, getMovieDetails, runWithConcurrency } from "./tmdb.js";
import { GENRE_SUGGESTIONS, findEntity, searchFilms, suggestEntities } from "./wikidata.js";

const MAX_SEEDS = 12;

const state = {
  entries: [],
  librarySort: { key: "rating", dir: "desc" },
  libraryFilter: "",
  criteria: { film: [], director: [], actor: [], keyword: [], genre: new Set() },
};

const formatNumber = (n) => new Intl.NumberFormat("fr-FR").format(n);

function stars(rating) {
  if (rating === null) return '<span class="no-rating">non noté</span>';
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.25 ? "½" : "";
  return `<span class="stars">${"★".repeat(full)}${half}</span>`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("fr-FR");
}

function setStatus(id, message, type = "") {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.toggle("error", type === "error");
  el.classList.toggle("success", type === "success");
}

/* ================= IMPORT ================= */

function setupImport() {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const resetBtn = document.getElementById("reset-btn");

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });

  ["dragover", "dragenter"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); })
  );
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
    fileInput.value = "";
  });

  document.getElementById("demo-btn").addEventListener("click", () => {
    loadEntries(demoEntries.map((e) => ({ ...e, date: "", uri: "" })), true);
  });

  resetBtn.addEventListener("click", () => location.reload());
}

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    setStatus("import-status", "Merci de déposer l'archive .zip de l'export Letterboxd.", "error");
    return;
  }
  setStatus("import-status", "Lecture de l'archive en cours…");
  try {
    const result = await importExportZip(file);
    loadEntries(result.entries, false, { watchlistCount: result.watchlistCount, likeCount: result.likeCount, filesFound: result.filesFound });
  } catch (error) {
    setStatus("import-status", `Échec de l'import : ${error.message}`, "error");
  }
}

function loadEntries(entries, isDemo, extras = {}) {
  state.entries = entries;
  state.watchlistCount = extras.watchlistCount ?? 0;
  state.likeCount = extras.likeCount ?? 0;
  document.getElementById("stats-section").classList.remove("hidden");
  document.getElementById("library-section").classList.remove("hidden");
  document.getElementById("reco-section").classList.remove("hidden");
  document.getElementById("reset-btn").classList.remove("hidden");
  document.getElementById("drop-zone").classList.add("hidden");
  document.getElementById("demo-btn").classList.add("hidden");

  if (isDemo) {
    setStatus("import-status", "Données de démonstration chargées — déposez votre export pour vos vraies données.");
  } else {
    const filesText = (extras.filesFound ?? []).join(", ");
    setStatus(
      "import-status",
      `Import réussi : ${formatNumber(entries.length)} films chargés (CSV lus : ${filesText}).`,
      "success"
    );
  }

  if (getApiKey()) {
    document.getElementById("tmdb-key").value = getApiKey();
    document.getElementById("tmdb-key-status").textContent = "Clé enregistrée dans ce navigateur.";
    document.getElementById("tmdb-key-status").className = "status success";
  }
  renderStats();
  renderLibrary();
  renderGenrePanelPlaceholder();
}

/* ================= STATS ================= */

function renderStats() {
  const entries = state.entries;
  const rated = entries.filter((e) => e.rating !== null);
  const avg = rated.length ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : 0;
  const fiveStar = rated.filter((e) => e.rating >= 4.75).length;
  const years = new Set(rated.map((e) => e.year).filter(Boolean));

  const cards = [
    { value: formatNumber(entries.length), label: "films vus" },
    { value: formatNumber(rated.length), label: "films notés" },
    { value: avg.toFixed(2), label: "note moyenne" },
    { value: formatNumber(fiveStar), label: "coups de cœur (5★)" },
    { value: formatNumber(years.size), label: "années différentes" },
  ];
  if (state.watchlistCount) cards.push({ value: formatNumber(state.watchlistCount), label: "dans la watchlist" });
  if (state.likeCount) cards.push({ value: formatNumber(state.likeCount), label: "films likés" });

  document.getElementById("stat-cards").innerHTML = cards
    .map((c) => `<div class="card"><div class="value">${c.value}</div><div class="label">${c.label}</div></div>`)
    .join("");

  renderRatingDistribution(rated);
  renderYearDistribution(rated);
}

function renderBarRows(containerId, rows, valueFormatter = (v) => v) {
  const container = document.getElementById(containerId);
  const max = Math.max(1, ...rows.map(([, count]) => count));
  container.innerHTML = rows
    .map(
      ([label, count]) => `
      <div class="bar-row">
        <span class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div>
        <span class="bar-value">${valueFormatter(count)}</span>
      </div>`
    )
    .join("");
}

function renderRatingDistribution(rated) {
  const buckets = new Map();
  for (let i = 10; i >= 1; i--) buckets.set(i / 2, 0);
  for (const e of rated) {
    const bucket = Math.round(e.rating * 2) / 2;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  renderBarRows(
    "rating-dist",
    [...buckets.entries()].map(([rating, count]) => [stars(rating).replace('<span class="stars">', "").replace("</span>", ""), count])
  );
}

function renderYearDistribution(rated) {
  const byDecade = new Map();
  for (const e of rated) {
    const decade = e.year ? `${e.year.slice(0, 3)}0s` : "inconnue";
    byDecade.set(decade, (byDecade.get(decade) ?? 0) + 1);
  }
  renderBarRows("year-dist", [...byDecade.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function renderGenrePanelPlaceholder() {
  const rated = state.entries.filter((e) => e.rating !== null);
  const container = document.getElementById("genre-dist");
  if (!getApiKey()) {
    container.innerHTML =
      '<p class="status">Indiquez une clé API TMDB ci-dessous (section Recommandations) pour calculer vos genres favoris à partir de vos meilleurs films.</p>';
    return;
  }
  computeGenreDistribution(rated).catch((error) => {
    setStatus("tmdb-key-status", error.message, "error");
  });
}

async function computeGenreDistribution(rated) {
  const container = document.getElementById("genre-dist");
  const seeds = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 12);
  const genreCounts = new Map();

  const results = await runWithConcurrency(
    seeds.map((e) => async () => {
      const id = await findMovieId(e.name, e.year);
      if (!id) return null;
      return getMovieDetails(id);
    }),
    4
  );

  for (const result of results) {
    if (!result.ok || !result.value) continue;
    for (const genre of result.value.genreNames) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }

  const rows = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (rows.length) {
    renderBarRows("genre-dist", rows);
  } else {
    container.innerHTML = '<p class="status">Aucun genre reconnu : vérifiez votre clé API TMDB.</p>';
  }
}

/* ================= BIBLIOTHÈQUE ================= */

function renderLibrary() {
  const tbody = document.querySelector("#library-table tbody");
  const search = state.libraryFilter.toLowerCase();
  let rows = state.entries.filter((e) => !search || e.name.toLowerCase().includes(search));

  const { key, dir } = state.librarySort;
  const sign = dir === "asc" ? 1 : -1;
  rows = rows.slice().sort((a, b) => {
    let va = a[key] ?? "";
    let vb = b[key] ?? "";
    if (key === "rating") { va ??= -1; vb ??= -1; return sign * (va - vb); }
    if (key === "year" || key === "date") return sign * String(va).localeCompare(String(vb));
    return sign * String(va).localeCompare(String(vb), "fr");
  });

  tbody.innerHTML = rows
    .map(
      (entry) => {
        const displayName = entry.uri
          ? `<a href="${escapeAttr(entry.uri)}" target="_blank" rel="noopener">${escapeHtml(entry.name)}</a>`
          : escapeHtml(entry.name);
        return `<tr>
          <td>${displayName}</td>
          <td>${escapeHtml(entry.year || "—")}</td>
          <td>${stars(entry.rating)}</td>
          <td>${escapeHtml(formatDate(entry.date))}</td>
        </tr>`;
      }
    )
    .join("");

  document.getElementById("library-count").textContent =
    `${formatNumber(rows.length)} film(s) affiché(s) sur ${formatNumber(state.entries.length)}.`;
}

function setupLibrary() {
  const search = document.getElementById("library-search");
  search.addEventListener("input", () => {
    state.libraryFilter = search.value;
    renderLibrary();
  });

  document.querySelectorAll("#library-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.librarySort.key === key) {
        state.librarySort.dir = state.librarySort.dir === "asc" ? "desc" : "asc";
      } else {
        state.librarySort = { key, dir: key === "name" ? "asc" : "desc" };
      }
      renderLibrary();
    });
  });
}

/* ================= RECOMMANDATIONS (Wikidata + TMDB) ================= */

function normalizeTitle(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function seenSet() {
  return new Set(state.entries.map((e) => `${normalizeTitle(e.name)}|${e.year || ""}`));
}

function libraryFilms() {
  return [...new Map(state.entries.map((e) => [normalizeTitle(e.name), e])).values()]
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
}

function setupCriteria() {
  for (const kind of ["film", "director", "actor", "keyword"]) {
    const input = document.getElementById(`criteria-${kind}`);
    const dropdown = document.getElementById(`dropdown-${kind}`);
    let suggestions = [];
    let timer;

    const close = () => dropdown.classList.add("hidden");
    const open = () => dropdown.classList.remove("hidden");

    const renderSuggestions = () => {
      if (!suggestions.length) {
        close();
        return;
      }
      dropdown.innerHTML = suggestions
        .map(
          (s, i) =>
            `<button type="button" class="dropdown-item" data-index="${i}"><span>${escapeHtml(s.label)}</span>${s.detail ? `<span class="dropdown-detail">${s.detail}</span>` : ""}</button>`
        )
        .join("");
      open();
    };

    const pick = (value) => {
      addCriteriaChip(kind, value);
      input.value = "";
      suggestions = [];
      close();
    };

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const query = input.value.trim();
      if (!query) {
        suggestions = [];
        close();
        return;
      }
      if (kind === "film") {
        const q = normalizeTitle(query);
        suggestions = libraryFilms()
          .filter((e) => normalizeTitle(e.name).includes(q))
          .slice(0, 8)
          .map((e) => ({ label: e.name, detail: `${e.year || ""} ${stars(e.rating)}` }));
        renderSuggestions();
        return;
      }
      timer = setTimeout(async () => {
        try {
          const entities = await suggestEntities(query, kind === "keyword" ? "theme" : "person");
          suggestions = entities.map((entity) => ({ label: entity.label, detail: "" }));
          renderSuggestions();
        } catch {
          close();
        }
      }, 400);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const top = suggestions[0];
        const value = top && normalizeTitle(top.label) === normalizeTitle(input.value) ? top.label : input.value;
        pick(value);
      } else if (e.key === "Escape") {
        close();
      }
    });

    dropdown.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".dropdown-item");
      if (!item) return;
      e.preventDefault();
      pick(suggestions[Number(item.dataset.index)]?.label ?? input.value);
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (input.value.trim()) {
          addCriteriaChip(kind, input.value);
          input.value = "";
        }
        suggestions = [];
        close();
      }, 150);
    });
  }

  const genreList = document.getElementById("criteria-genre-list");
  genreList.innerHTML = GENRE_SUGGESTIONS.map(
    (genre) => `<button type="button" class="genre-pill" data-genre="${escapeAttr(genre)}">${escapeHtml(genre)}</button>`
  ).join("");
  genreList.addEventListener("click", (e) => {
    const pill = e.target.closest(".genre-pill");
    if (!pill) return;
    const genre = pill.dataset.genre;
    if (state.criteria.genre.has(genre)) {
      state.criteria.genre.delete(genre);
      pill.classList.remove("active");
    } else {
      state.criteria.genre.add(genre);
      pill.classList.add("active");
    }
  });

  document.getElementById("reco-btn").addEventListener("click", runRecommendations);
}

function addCriteriaChip(kind, label) {
  const value = label.trim().replace(/\s+/g, " ");
  if (!value) return;
  const list = state.criteria[kind];
  if (list.some((chip) => normalizeTitle(chip) === normalizeTitle(value))) return;
  const total = state.criteria.film.length + state.criteria.director.length +
    state.criteria.actor.length + state.criteria.keyword.length + state.criteria.genre.size;
  if (total >= MAX_SEEDS) {
    setStatus("reco-status", `${MAX_SEEDS} critères maximum (pour éviter la limitation de débit de Wikidata).`, "error");
    return;
  }
  state.criteria[kind].push(value);
  renderCriteriaChips(kind);
  setStatus("reco-status", "");
}

function renderCriteriaChips(kind) {
  const container = document.getElementById(`chips-${kind}`);
  container.innerHTML = state.criteria[kind]
    .map(
      (label, index) =>
        `<span class="chip">${escapeHtml(label)}<button type="button" class="chip-remove" data-kind="${kind}" data-index="${index}" aria-label="Retirer ${escapeAttr(label)}">×</button></span>`
    )
    .join("");
}

function setupChipRemoval() {
  document.getElementById("reco-section").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-remove");
    if (!btn) return;
    state.criteria[btn.dataset.kind].splice(Number(btn.dataset.index), 1);
    renderCriteriaChips(btn.dataset.kind);
  });
}

async function resolveCriteria(status) {
  const groups = [
    { kind: "film", key: "filmIds", terms: state.criteria.film },
    { kind: "person", key: "personIds", terms: [...state.criteria.director, ...state.criteria.actor] },
    { kind: "genre", key: "genreIds", terms: [...state.criteria.genre] },
    { kind: "theme", key: "themeIds", terms: state.criteria.keyword },
  ];

  const resolved = { filmIds: [], personIds: [], genreIds: [], themeIds: [] };
  const missing = [];
  const byLibrary = new Map(state.entries.map((e) => [normalizeTitle(e.name), e]));

  let step = 0;
  const totalSteps = groups.reduce((s, g) => s + g.terms.length, 0);
  for (const group of groups) {
    for (const term of group.terms) {
      step++;
      status(`Critère ${step}/${totalSteps} : « ${term} »…`);
      const entity = await findEntity(term, group.kind).catch((error) => {
        if (/limite|injoignable/.test(error.message)) throw error;
        return null;
      });
      if (!entity) {
        missing.push(term);
        continue;
      }
      if (group.key === "filmIds" && !resolved.filmIds.some((f) => f.id === entity.id)) {
        const lib = byLibrary.get(normalizeTitle(term));
        entity.weight = lib?.rating ?? 2.5;
        resolved.filmIds.push(entity);
      } else if (group.key !== "filmIds" && !resolved[group.key].some((s) => s.id === entity.id)) {
        resolved[group.key].push(entity);
      }
    }
  }
  return { resolved, missing, totalSteps };
}

function recoCard(item) {
  const image = item.image || item.poster;
  const poster = image
    ? `<img src="${escapeAttr(image)}" alt="Affiche de ${escapeAttr(item.title)}" loading="lazy" />`
    : '<img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'342\' height=\'513\'%3E%3Crect fill=\'%23242a31\' width=\'342\' height=\'513\'/%3E%3C/svg%3E" alt="" />';
  const match = item.score ? `· match ${item.score.toFixed(1)}` : item.vote ? `· TMDB ${item.vote.toFixed(1)}` : "";
  const why = item.why?.length ? `via ${item.why.join(", ")}` : item.sourceName ? `car vous avez aimé « ${item.sourceName} »` : "";
  return `
    <div class="reco-card">
      ${poster}
      <div class="reco-info">
        <div class="reco-title">${escapeHtml(item.title)}</div>
        <div class="reco-meta">${escapeHtml(item.year || "")} ${match}</div>
        <div class="reco-source">${escapeHtml(why)}</div>
      </div>
    </div>`;
}

async function runRecommendations() {
  const btn = document.getElementById("reco-btn");
  const grid = document.getElementById("reco-grid");
  const hasCriteria = state.criteria.film.length || state.criteria.director.length ||
    state.criteria.actor.length || state.criteria.keyword.length || state.criteria.genre.size;
  if (!hasCriteria && !getApiKey()) {
    setStatus("reco-status", "Ajoutez au moins un critère ci-dessus, ou saisissez votre clé TMDB dans la barre en haut de page.", "error");
    return;
  }

  btn.disabled = true;
  grid.innerHTML = "";
  try {
    const seen = seenSet();
    const status = (msg, type = "") => setStatus("reco-status", msg, type);
    const results = [];
    let missing = [];

    if (hasCriteria) {
      const { resolved, missing: unresolved, totalSteps } = await resolveCriteria(status);
      missing = unresolved;
      const foundCount = resolved.filmIds.length + resolved.personIds.length + resolved.genreIds.length + resolved.themeIds.length;
      if (!foundCount && !getApiKey()) {
        status("Aucun critère n'a été reconnu sur Wikidata. Vérifiez l'orthographe.");
        return;
      }
      if (foundCount) {
        status(`Recherche Wikidata pour vos ${foundCount} critère(s)…`);
        const items = await searchFilms({
          ...resolved,
          seedWeights: Object.fromEntries(resolved.filmIds.map((f) => [f.id, f.weight ?? 2.5])),
          onProgress: status,
        });
        for (const item of items) {
          if (seen.has(`${normalizeTitle(item.title)}|${item.year || ""}`)) continue;
          results.push(item);
        }
      }
    }

    if (getApiKey()) {
      status(results.length ? "Enrichissement via TMDB…" : "Analyse de vos meilleurs films via TMDB…");
      try {
        const { items } = await buildRecommendations(state.entries, { onProgress: status });
        for (const item of items) {
          if (seen.has(`${normalizeTitle(item.title)}|${item.year || ""}`)) continue;
          const dupe = results.find(
            (r) => normalizeTitle(r.title) === normalizeTitle(item.title) && (!r.year || !item.year || r.year === item.year)
          );
          if (dupe) {
            dupe.poster ||= item.poster;
            dupe.vote = item.vote;
            continue;
          }
          results.push({
            ...item,
            score: 1 + (item.vote ?? 0) / 10,
            why: [`TMDB — proche de « ${item.sourceName} »`],
          });
        }
      } catch (error) {
        if (!results.length) throw error;
      }
    }

    results.sort((a, b) => b.score - a.score);
    const fresh = results.slice(0, 30);
    grid.innerHTML = fresh.map(recoCard).join("");

    const missingText = missing.length ? ` Critères non reconnus : ${missing.join(", ")}.` : "";
    status(`${fresh.length} recommandations combinées.${missingText}`, "success");
  } catch (error) {
    setStatus("reco-status", error.message, "error");
  } finally {
    btn.disabled = false;
  }
}

function setupRecos() {
  const keyInput = document.getElementById("tmdb-key");
  const keyBtn = document.getElementById("tmdb-key-save");

  keyBtn.addEventListener("click", () => {
    if (!keyInput.value.trim()) {
      setStatus("tmdb-key-status", "Collez d'abord votre clé API.", "error");
      return;
    }
    saveApiKey(keyInput.value);
    setStatus("tmdb-key-status", "Clé enregistrée !", "success");
    if (state.entries.length) renderGenrePanelPlaceholder();
  });
}

/* ================= UTILS ================= */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

/* ================= INIT ================= */

setupImport();
setupLibrary();
setupRecos();
setupCriteria();
setupChipRemoval();
