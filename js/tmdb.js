const API = "https://api.themoviedb.org/3";
const CACHE_PREFIX = "lbtmdb:";

export function getApiKey() {
  return localStorage.getItem("lvv-tmdb-key") || "";
}

export function saveApiKey(key) {
  localStorage.setItem("lvv-tmdb-key", key.trim());
}

async function apiGet(path, params = {}) {
  const key = getApiKey();
  if (!key) throw new Error("Clé API TMDB absente.");
  const url = new URL(API + path);
  url.searchParams.set("api_key", key);
  url.searchParams.set("language", "fr-FR");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (res.status === 401) throw new Error("Clé API TMDB invalide (erreur 401).");
  if (res.status === 429) throw new Error("Trop de requêtes TMDB (erreur 429), réessayez dans un instant.");
  if (!res.ok) throw new Error(`Erreur TMDB ${res.status} sur ${path}`);
  return res.json();
}

function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)); } catch { return null; }
}

function cacheSet(key, value) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch { /* quota plein */ }
}

const GENRES_BY_ID = {
  28: "Action", 12: "Aventure", 16: "Animation", 35: "Comédie", 80: "Crime",
  99: "Documentaire", 18: "Drame", 10751: "Famille", 14: "Fantastique",
  36: "Histoire", 27: "Horreur", 10402: "Musique", 9648: "Mystère",
  10749: "Romance", 878: "Science-fiction", 53: "Thriller", 10770: "Téléfilm",
  10752: "Guerre", 37: "Western",
};

const genrePdf = (ids) => (ids || []).map((id) => GENRES_BY_ID[id]).filter(Boolean);

export async function findMovieId(name, year) {
  const cacheKey = `id:${name}|${year}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  const data = await apiGet("/search/movie", { query: name, year: year || undefined });
  const hit = data.results?.[0];
  const id = hit ? hit.id : null;
  cacheSet(cacheKey, id);
  return id;
}

export async function getMovieDetails(id) {
  const cached = cacheGet(`details:${id}`);
  if (cached) return cached;
  const data = await apiGet(`/movie/${id}`);
  const details = {
    genreNames: genrePdf(data.genres?.map((g) => g.id)),
  };
  cacheSet(`details:${id}`, details);
  return details;
}

export async function getRecommendations(id) {
  const cached = cacheGet(`reco:${id}`);
  if (cached) return cached;
  const data = await apiGet(`/movie/${id}/recommendations`, { page: 1 });
  const recos = (data.results || []).map((m) => ({
    tmdbId: m.id,
    title: m.title,
    year: (m.release_date || "").slice(0, 4),
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    vote: m.vote_average || 0,
    genreNames: genrePdf(m.genre_ids),
    overview: m.overview || "",
  }));
  cacheSet(`reco:${id}`, recos);
  return recos;
}

export function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      try {
        results[current] = { ok: true, value: await tasks[current]() };
      } catch (error) {
        results[current] = { ok: false, error };
      }
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker)).then(() => results);
}

export async function buildRecommendations(entries, { topCount = 8, onProgress = () => {} } = {}) {
  const watched = new Set(entries.map((e) => normalizeTitle(e.name)));
  const rated = entries.filter((e) => e.rating !== null);
  rated.sort((a, b) => b.rating - a.rating);
  const seeds = rated.slice(0, topCount);

  if (!seeds.length) throw new Error("Aucun film noté dans l'import : impossible de générer des recommandations.");

  let done = 0;
  const seedResults = await runWithConcurrency(
    seeds.map((e) => async () => {
      const tmdbId = await findMovieId(e.name, e.year);
      return { entry: e, tmdbId };
    }),
    4
  );

  const okSeeds = seedResults.filter((r) => r.ok && r.value.tmdbId).map((r) => r.value);
  onProgress(`Recherche des films sources… ${okSeeds.length}/${seeds.length} trouvés sur TMDB.`);
  if (!okSeeds.length) throw new Error("Aucun de vos films n'a été reconnu sur TMDB. Vérifiez l'orthographe ou essayez avec l'export complet.");

  onProgress("Récupération des recommandations en cours…");
  const recoResults = await runWithConcurrency(
    okSeeds.map((seed) => async () => ({ seed, recos: await getRecommendations(seed.tmdbId) })),
    4
  );

  done = recoResults.filter((r) => r.ok).length;
  onProgress(`Recommandations reçues pour ${done}/${okSeeds.length} films.`);

  const scores = new Map();
  for (const result of recoResults) {
    if (!result.ok) continue;
    const { seed, recos } = result.value;
    for (const reco of recos) {
      const key = reco.tmdbId;
      if (watched.has(normalizeTitle(reco.title))) continue;
      const current = scores.get(key) ?? { reco, sources: [] };
      current.sources.push({ name: seed.entry.name, rating: seed.entry.rating });
      scores.set(key, current);
    }
  }

  const items = [...scores.values()].map((item) => ({
    ...item.reco,
    sourceCount: item.sources.length,
    sourceName: item.sources[0].name,
    sourceRating: Math.max(...item.sources.map((s) => s.rating)),
    score: item.sources.length * 10 + item.reco.vote,
  }));

  items.sort((a, b) => b.score - a.score);
  return { seeds: okSeeds, items: items.slice(0, 24) };
}

function normalizeTitle(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
