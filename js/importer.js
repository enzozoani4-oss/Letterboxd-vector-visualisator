import { parseCSV } from "./csv-parser.js";

const CSV_FILES = ["films.csv", "ratings.csv", "diary.csv", "reviews.csv"];

export async function importExportZip(file) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip n'a pas pu être chargé. Vérifiez votre connexion et rechargez la page.");
  }
  const zip = await JSZip.loadAsync(file);
  const found = {};
  const names = Object.keys(zip.files);
  for (const name of names) {
    const base = name.split("/").pop();
    if (CSV_FILES.includes(base) && !found[base]) {
      found[base] = await zip.file(name).async("string");
    }
  }
  if (!found["films.csv"] && !found["ratings.csv"] && !found["diary.csv"]) {
    throw new Error(
      "Aucun fichier CSV exploitable trouvé. Assurez-vous de déposer l'archive .zip telle quelle, sans décompresser ni renommer."
    );
  }

  const filmsText = found["films.csv"] ?? found["ratings.csv"] ?? "";
  const ratingsText = found["ratings.csv"] ?? "";
  const diaryText = found["diary.csv"] ?? "";

  return mergeEntries(filmsText, ratingsText, diaryText);
}

export function importCSVFiles(files) {
  const entries = [];
  for (const f of files) {
    if (/films|ratings|diary|review/i.test(f.name)) {
      entries.push(...parseCSV(f.content));
    }
  }
  return entries;
}

export function mergeEntries(filmsText, ratingsText, diaryText) {
  const byUri = new Map();

  const upsert = (row, { hasRating }) => {
    const uri = row["Letterboxd URI"] || row["Letterboxd URL"] || "";
    const name = row["Name"];
    if (!name) return;
    const key = uri || `${name}|${row["Year"]}`;
    const current = byUri.get(key) ?? {
      name,
      year: row["Year"] || "",
      rating: null,
      date: "",
      uri,
    };
    if (hasRating && row["Rating"] !== "") {
      current.rating = normalizeRating(row["Rating"]);
    }
    if (row["Date"]) current.date = row["Date"];
    current.name ||= name;
    current.year ||= row["Year"] || "";
    current.uri ||= uri;
    byUri.set(key, current);
  };

  for (const row of parseCSV(filmsText)) upsert(row, { hasRating: true });
  for (const row of parseCSV(ratingsText)) upsert(row, { hasRating: true });
  for (const row of parseCSV(diaryText)) upsert(row, { hasRating: true });

  return [...byUri.values()];
}

export function normalizeRating(raw) {
  const value = parseFloat(String(raw).replace(",", "."));
  if (Number.isNaN(value) || value <= 0) return null;
  return Math.min(5, value);
}
