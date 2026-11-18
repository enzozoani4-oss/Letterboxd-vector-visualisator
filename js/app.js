import { importExportZip } from "./importer.js";
import { demoEntries } from "./demo-data.js";
import { buildRecommendations, getApiKey, saveApiKey, findMovieId, getMovieDetails, runWithConcurrency } from "./tmdb.js";

const state = {
  entries: [],
  librarySort: { key: "rating", dir: "desc" },
  libraryFilter: "",
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
    const entries = await importExportZip(file);
    loadEntries(entries, false);
  } catch (error) {
    setStatus("import-status", `Échec de l'import : ${error.message}`, "error");
  }
}

function loadEntries(entries, isDemo) {
  state.entries = entries;
  document.getElementById("stats-section").classList.remove("hidden");
  document.getElementById("library-section").classList.remove("hidden");
  document.getElementById("reco-section").classList.remove("hidden");
  document.getElementById("reset-btn").classList.remove("hidden");
  document.getElementById("drop-zone").classList.add("hidden");
  document.getElementById("demo-btn").classList.add("hidden");

  if (isDemo) {
    document.getElementById("reco-controls").classList.add("hidden");
    setStatus("import-status", "Données de démonstration chargées — déposez votre export pour vos vraies données.");
  } else {
    setStatus("import-status", `Import réussi : ${formatNumber(entries.length)} films chargés.`, "success");
  }

  if (getApiKey()) {
    document.getElementById("tmdb-key").value = getApiKey();
    document.getElementById("tmdb-key-status").textContent = "Clé enregistrée dans ce navigateur.";
    document.getElementById("tmdb-key-status").className = "status success";
  }
  if (!isDemo && getApiKey()) document.getElementById("reco-controls").classList.remove("hidden");

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

/* ================= RECOMMANDATIONS ================= */

function recoCard(item) {
  const sourceStars = stars(item.sourceRating);
  const poster = item.poster
    ? `<img src="${escapeAttr(item.poster)}" alt="Affiche de ${escapeAttr(item.title)}" loading="lazy" />`
    : '<img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'342\' height=\'513\'%3E%3Crect fill=\'%23242a31\' width=\'342\' height=\'513\'/%3E%3C/svg%3E" alt="" />';
  return `
    <div class="reco-card">
      ${poster}
      <div class="reco-info">
        <div class="reco-title">${escapeHtml(item.title)}</div>
        <div class="reco-meta">${escapeHtml(item.year || "")} ${item.vote ? "· TMDB " + item.vote.toFixed(1) : ""}</div>
        <div class="reco-source">car vous avez aimé « ${escapeHtml(item.sourceName)} »</div>
      </div>
    </div>`;
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
    if (state.entries.length) {
      document.getElementById("reco-controls").classList.remove("hidden");
      document.getElementById("reco-btn").classList.remove("hidden");
      renderGenrePanelPlaceholder();
    }
  });

  document.getElementById("reco-btn").addEventListener("click", async () => {
    const btn = document.getElementById("reco-btn");
    btn.disabled = true;
    try {
      setStatus("reco-status", "Analyse de vos meilleurs films…");
      const { items } = await buildRecommendations(state.entries, {
        onProgress: (msg) => setStatus("reco-status", msg),
      });
      document.getElementById("reco-grid").innerHTML = items.map(recoCard).join("");
      setStatus("reco-status", `Top ${items.length} recommandations générées, classées par pertinence.`, "success");
    } catch (error) {
      setStatus("reco-status", error.message, "error");
    } finally {
      btn.disabled = false;
    }
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
