import { parseCSV } from "./csv-parser.js";

export async function importExportZip(file) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip n'a pas pu être chargé. Vérifiez votre connexion et rechargez la page.");
  }
  const zip = await JSZip.loadAsync(file);
  const all = [];
  const seenBases = new Set();

  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const base = path.split("/").pop().toLowerCase();
    if (!base.endsWith(".csv")) return;
    if (path.includes("lists/")) return;
    if (seenBases.has(base) && path.includes("/")) return;
    seenBases.add(base);
    all.push({ path, base, entry });
  });

  const parsed = [];
  for (const { path, base, entry } of all) {
    const rows = parseCSV(await entry.async("string"));
    if (!rows.length) continue;
    const header = Object.keys(rows[0]);
    if (!header.includes("Name")) continue;
    if (!header.includes("Year") && !header.includes("Letterboxd URI")) continue;
    parsed.push({ path, base, header, rows });
  }

  if (!parsed.length) {
    const names = all.slice(0, 12).map((f) => f.path).join(", ") || "aucun (vide)";
    throw new Error(
      `Aucun CSV exploitable dans l'archive (contenu : ${names}). Assurez-vous de déposer le .zip d'export de Letterboxd tel quel, sans le décompresser.`
    );
  }

  const entries = [];
  let watchlistCount = 0;
  let likeCount = 0;

  for (const { path, base, header, rows } of parsed) {
    const isWatchlist = base === "watchlist.csv";
    const hasRating = header.includes("Rating");
    const hasDate = header.includes("Date");

    if (isWatchlist) { watchlistCount += rows.length; continue; }
    if (path.includes("likes/")) { likeCount += rows.length; continue; }

    for (const row of rows) {
      const name = row["Name"];
      if (!name) continue;
      entries.push({
        name,
        year: row["Year"] || "",
        rating: hasRating ? normalizeRating(row["Rating"]) : null,
        date: hasDate ? row["Date"] : "",
        uri: row["Letterboxd URI"] || row["Letterboxd URL"] || "",
        source: base,
        rewatch: /yes/i.test(row["Rewatch"] || ""),
      });
    }
  }

  return { entries: dedupeEntries(entries), watchlistCount, likeCount, filesFound: parsed.map((p) => p.base) };
}

function dedupeEntries(entries) {
  const byUri = new Map();
  for (const entry of entries) {
    const key = entry.uri || `${entry.name}|${entry.year}`;
    const current = byUri.get(key);
    if (!current) { byUri.set(key, entry); continue; }
    if (entry.rating !== null) {
      current.rating = current.rating === null ? entry.rating : Math.max(current.rating, entry.rating);
    }
    if (!current.date && entry.date) current.date = entry.date;
    if (!current.year && entry.year) current.year = entry.year;
  }
  return [...byUri.values()];
}

export function normalizeRating(raw) {
  const value = parseFloat(String(raw).replace(",", "."));
  if (Number.isNaN(value) || value <= 0) return null;
  return Math.min(5, value);
}
