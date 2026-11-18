const DATA_URL = "data/twins-data.zip";
const YEAR_SUFFIX = /-(19|20)\d{2}$/;

let indexCache = null;

function concat(chunks) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export class TwinsIndex {
  constructor(bin) {
    this.bin = bin;
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    let p = 0;
    p += 4;
    p += 3;
    const nMovies = view.getUint32(p, true);
    p += 4;
    this.view = view;
    this.movieCount = nMovies;
    this.entries = [];
    for (let i = 0; i < nMovies; i++) {
      this.entries.push({
        id: view.getUint32(p, true),
        count: view.getUint16(p + 4, true),
        start: view.getUint32(p + 6, true),
        len: view.getUint16(p + 10, true),
        off: view.getUint32(p + 12, true),
      });
      p += 16;
    }
    this.slugBase = p;
    let slugEnd = 0;
    for (const entry of this.entries) slugEnd = Math.max(slugEnd, entry.off + entry.len);
    this.ratingsBase = this.slugBase + slugEnd;
    this.ratingRows = this.entries.reduce((sum, e) => sum + e.count, 0);
    this.bySlug = new Map();
    for (let i = 0; i < nMovies; i++) {
      this.bySlug.set(this.slug(i), i);
    }
    this.normalized = null;
  }

  slug(index) {
    const entry = this.entries[index];
    return String.fromCharCode(...this.bin.subarray(this.slugBase + entry.off, this.slugBase + entry.off + entry.len));
  }

  rowCount(index) {
    return this.entries[index].count;
  }

  ratingAt(index, row) {
    const entry = this.entries[index];
    const offset = this.ratingsBase + (entry.start + row) * 3;
    const user = this.view.getUint16(offset, true);
    const rating = this.view.getUint8(offset + 2);
    return { user, rating: rating / 2 };
  }

  normalizedKey(slug) {
    return slug.replace(YEAR_SUFFIX, "");
  }

  buildNormalized() {
    this.normalized = new Map();
    for (let i = 0; i < this.movieCount; i++) {
      const key = this.normalizedKey(this.slug(i));
      const existing = this.normalized.get(key);
      if (existing === undefined || this.entries[i].count > this.entries[existing].count) {
        this.normalized.set(key, i);
      }
    }
  }

  findMovie({ slug = "", name = "", year = "" }) {
    if (slug && this.bySlug.has(slug)) return this.bySlug.get(slug);
    if (slug && year) {
      const withYear = this.bySlug.get(`${slug}-${year}`);
      if (withYear !== undefined) return withYear;
    }
    if (!this.normalized) this.buildNormalized();
    const base = slug || slugifyName(name);
    const byNorm = this.normalized.get(this.normalizedKey(base));
    if (byNorm !== undefined) return byNorm;
    if (year) {
      const withYear = this.normalized.get(`${base}-${year}`);
      if (withYear !== undefined) return withYear;
    }
    return undefined;
  }
}

export function slugifyName(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`]/g, "-")
    .replace(/&/g, "-and-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function loadTwinsData({ url = DATA_URL, onProgress = () => {} } = {}) {
  if (indexCache) return indexCache;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Téléchargement de la base de notes impossible (${response.status}).`);
  let bytes;
  if (response.body && typeof response.body.getReader === "function") {
    const total = Number(response.headers.get("content-length")) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    onProgress(`Téléchargement de la base de notes…`);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) onProgress(`Téléchargement de la base de notes : ${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(0)} Mo…`, received / total);
    }
    bytes = concat(chunks);
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("twins.bin");
  if (!file) throw new Error("Base de notes invalide (fichier interne manquant).");
  const bin = new Uint8Array(await file.async("arraybuffer"));
  indexCache = new TwinsIndex(bin);
  return indexCache;
}

export function findTasteTwins(index, ratedEntries, { minCommon = 4, maxTwins = 8 } = {}) {
  const mine = [];
  let missing = 0;
  for (const entry of ratedEntries) {
    const movieIndex = index.findMovie(entry);
    if (movieIndex === undefined) {
      missing++;
      continue;
    }
    mine.push({ movieIndex, rating: entry.rating });
  }

  const users = new Map();
  for (const { movieIndex, rating } of mine) {
    const n = index.rowCount(movieIndex);
    for (let row = 0; row < n; row++) {
      const { user, rating: theirs } = index.ratingAt(movieIndex, row);
      let stats = users.get(user);
      if (!stats) {
        stats = { co: 0, exact: 0, diff: 0 };
        users.set(user, stats);
      }
      stats.co++;
      const delta = Math.abs(theirs - rating);
      if (delta < 0.05) stats.exact++;
      stats.diff += delta;
    }
  }

  const twins = [...users.entries()]
    .map(([user, stats]) => ({
      user,
      co: stats.co,
      exact: stats.exact,
      match: stats.exact / stats.co,
      avgDiff: stats.diff / stats.co,
    }))
    .filter((twin) => twin.co >= minCommon && twin.exact >= 2)
    .sort((a, b) => b.exact - a.exact || b.match - a.match || a.avgDiff - b.avgDiff)
    .slice(0, maxTwins);

  return { twins, matched: mine.length, missing };
}

export function recommendationsFromTwins(index, twins, seenSlugs, { topN = 24 } = {}) {
  if (!twins.length) return [];
  const similarity = new Map(twins.map((twin) => [twin.user, twin.match]));
  const seen = new Set([...seenSlugs, ...[...seenSlugs].map((slug) => slug.replace(YEAR_SUFFIX, ""))]);
  const acc = new Map();

  for (let movie = 0; movie < index.movieCount; movie++) {
    const slug = index.slug(movie);
    if (seen.has(slug)) continue;
    const n = index.rowCount(movie);
    for (let row = 0; row < n; row++) {
      const { user, rating } = index.ratingAt(movie, row);
      const sim = similarity.get(user);
      if (sim === undefined) continue;
      let current = acc.get(movie);
      if (!current) {
        current = { weighted: 0, weight: 0, support: 0, best: 0 };
        acc.set(movie, current);
      }
      current.weighted += rating * sim;
      current.weight += sim;
      current.support++;
      if (rating > current.best) current.best = rating;
    }
  }

  const ranked = [...acc.entries()].map(([movie, stats]) => ({
    slug: index.slug(movie),
    score: stats.weighted / stats.weight,
    support: stats.support,
    best: stats.best,
  }));

  for (const minSupport of [3, 2, 1]) {
    const selected = ranked
      .filter((item) => item.support >= minSupport)
      .sort((a, b) => b.score - a.score || b.support - a.support)
      .slice(0, topN);
    if (selected.length >= topN / 2) return selected;
  }
  return [];
}

export function prettyTitle(slug) {
  return String(slug)
    .replace(YEAR_SUFFIX, "")
    .split("-")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}
