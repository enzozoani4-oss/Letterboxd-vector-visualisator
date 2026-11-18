/**
 * Parseur CSV minimal mais robuste : gère les guillemets, virgules
 * et retours à la ligne inclus dans les cellules (format export Letterboxd).
 */

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
      return obj;
    });
}

export function csvToMapRows(text) {
  return parseCSV(text);
}
