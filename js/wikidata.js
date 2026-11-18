const SPARQL_URL = "https://query.wikidata.org/sparql?format=json";
const QID_PREFIX = "http://www.wikidata.org/entity/";

export const GENRE_SUGGESTIONS = [
  "science-fiction", "thriller", "horreur", "comédie", "drame", "action",
  "animation", "fantastique", "romance", "film policier", "aventure",
  "crime", "guerre", "western", "documentaire", "super-héros",
];

const qid = (uri) => String(uri).replace(QID_PREFIX, "");
const str = (value) => JSON.stringify(value);
const cache = new Map();

async function runQuery(query) {
  const url = `${SPARQL_URL}&query=${encodeURIComponent(query)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "LetterboxdVectorVisualisator/1.0 (site statique, GitHub enzozoani4-oss)",
      },
    });
  } catch {
    throw new Error("Wikidata est injoignable (réseau ou CORS). Réessayez.");
  }
  if (response.status === 429 || response.status === 403) {
    throw new Error("Wikidata limite le débit : patientez quelques secondes et relancez.");
  }
  if (!response.ok) {
    throw new Error(`Erreur Wikidata ${response.status}. Réessayez dans un instant.`);
  }
  const payload = await response.json();
  return payload.results.bindings.map((binding) => {
    const row = {};
    for (const [name, value] of Object.entries(binding)) {
      row[name] = value.type === "uri" ? qid(value.value) : value.value;
    }
    return row;
  });
}

async function cached(key, factory) {
  if (cache.has(key)) return cache.get(key);
  const value = await factory();
  cache.set(key, value);
  return value;
}

function entitySearchBlock(term, variable = "?e") {
  return `
    SERVICE wikibase:mwapi {
      bd:serviceParam wikibase:endpoint "www.wikidata.org";
                      wikibase:api "EntitySearch";
                      wikibase:limit "5";
                      mwapi:search ${str(term)};
                      mwapi:language "fr".
      ${variable} wikibase:apiOutputItem mwapi:item.
    }`;
}

const ENTITY_FIELDS = `
  OPTIONAL { ?e rdfs:label ?lfr FILTER(LANG(?lfr) = "fr") }
  OPTIONAL { ?e rdfs:label ?len FILTER(LANG(?len) = "en") }
  BIND(COALESCE(?lfr, ?len, "") AS ?label)`;

export function findEntity(term, kind) {
  let constraints = "";
  if (kind === "person") {
    constraints = `?e wdt:P31 wd:Q5 .
    ?e wikibase:sitelinks ?sl .
    FILTER(EXISTS { ?fd wdt:P57 ?e } || EXISTS { ?fa wdt:P161 ?e })`;
  } else if (kind === "genre") {
    constraints = `FILTER EXISTS { ?fg wdt:P136 ?e }
    ?e wikibase:sitelinks ?sl .`;
  } else if (kind === "theme") {
    constraints = `FILTER EXISTS { ?ft wdt:P921 ?e }
    ?e wikibase:sitelinks ?sl .`;
  } else if (kind === "film") {
    constraints = `?e wdt:P31 wd:Q11424 .
    ?e wikibase:sitelinks ?sl .`;
  }

  const query = `
    SELECT ?e ?label (MAX(?sl) AS ?sitelinks) WHERE {
      ${entitySearchBlock(term)}
      ${constraints}
      ${ENTITY_FIELDS}
    } GROUP BY ?e ?label
    ORDER BY DESC(?sitelinks) ?e
    LIMIT 1`;

  return cached(`entity:${kind}:${term.toLowerCase()}`, async () => {
    const rows = await runQuery(query);
    if (!rows.length) return null;
    return { id: rows[0].e, label: rows[0].label || term, kind, query: term };
  });
}

async function findEntities(terms, kind, onTick) {
  const found = [];
  for (const [index, term] of terms.entries()) {
    onTick(`Recherche « ${term} » sur Wikidata (${index + 1}/${terms.length})…`);
    const entity = await findEntity(term, kind).catch((error) => {
      if (/limite|injoignable/.test(error.message)) throw error;
      return null;
    });
    if (entity) found.push(entity);
  }
  return found;
}

function filmCoreQuery(seedClause) {
  return `
    SELECT ?film ?filmLabel (MAX(?sitelinks) AS ?links) (MAX(?release) AS ?dateSample) (MAX(?posterImg) AS ?poster) (MAX(?mainImg) AS ?main) WHERE {
      {
        SELECT DISTINCT ?film WHERE {
          ${seedClause}
          ?film wdt:P31 wd:Q11424 .
          ?film wikibase:sitelinks ?sitelinksInner .
          FILTER(?sitelinksInner >= 4)
        }
        LIMIT 300
      }
      MINUS { ?film wdt:P31 wd:Q5398426 }
      OPTIONAL { ?film wikibase:sitelinks ?sitelinks }
      OPTIONAL { ?film rdfs:label ?lfr FILTER(LANG(?lfr) = "fr") }
      OPTIONAL { ?film rdfs:label ?len FILTER(LANG(?len) = "en") }
      BIND(COALESCE(?lfr, ?len, "") AS ?filmLabel)
      OPTIONAL { ?film wdt:P577 ?release }
      OPTIONAL { ?film wdt:P3383 ?posterImg }
      OPTIONAL { ?film wdt:P18 ?mainImg }
    }
    GROUP BY ?film ?filmLabel
    HAVING (LANG(?filmLabel) != "")
    ORDER BY DESC(?links)
    LIMIT 30`;
}

function filmSeedClause(queryId) {
  return `
    VALUES ?fseed { wd:${queryId} }
    { ?film wdt:P57 ?dCommon . ?fseed wdt:P57 ?dCommon }
    UNION { ?film wdt:P136 ?gCommon . ?fseed wdt:P136 ?gCommon }
    UNION { ?film wdt:P921 ?tCommon . ?fseed wdt:P921 ?tCommon }`;
}

const PERSON_CLAUSE = (id) => `?film wdt:P57|wdt:P161 wd:${id} .`;
const GENRE_CLAUSE = (id) => `?film wdt:P136 ?gDirect . ?gDirect wdt:P279* wd:${id} .`;
const THEME_CLAUSE = (id) => `?film wdt:P921 wd:${id} .`;
const FILM_CLAUSE = filmSeedClause;

const CLAUSES = { person: PERSON_CLAUSE, genre: GENRE_CLAUSE, theme: THEME_CLAUSE, film: FILM_CLAUSE };

function toImageUrl(fileName) {
  if (!fileName) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(fileName).replace(/^File:/, ""))}?width=300`;
}

function parseFilmRows(rows) {
  return rows.map((row) => ({
    id: row.film,
    title: row.filmLabel || "",
    year: row.dateSample ? String(row.dateSample).slice(0, 4) : "",
    links: parseInt(row.links, 10) || 0,
    image: toImageUrl(row.poster || row.main),
  }));
}

const toSeed = (kind, seed) =>
  typeof seed === "string" ? { id: seed, kind, label: "" } : { ...seed, kind };

export async function searchFilms({ personIds = [], genreIds = [], themeIds = [], filmIds = [], seedWeights = {}, onProgress = () => {} } = {}) {
  const seeds = [
    ...personIds.map((seed) => toSeed("person", seed)),
    ...genreIds.map((seed) => toSeed("genre", seed)),
    ...themeIds.map((seed) => toSeed("theme", seed)),
    ...filmIds.map((seed) => toSeed("film", seed)),
  ];
  if (!seeds.length) throw new Error("Choisis au moins un film, réalisateur, acteur, genre ou mot-clé.");

  const total = seeds.length;
  const byFilm = new Map();

  for (const [index, seed] of seeds.entries()) {
    onProgress(`Recherche des films pour le critère ${index + 1}/${total}…`);
    const rows = await cached(`films:${seed.kind}:${seed.id}`, async () => {
      const clause = CLAUSES[seed.kind](seed.id);
      return parseFilmRows(await runQuery(filmCoreQuery(clause)));
    });
    const weight = seedWeights[seed.id] ?? 2.5;
    for (const film of rows) {
      const current = byFilm.get(film.id) ?? { ...film, weight: 0, why: [] };
      current.weight += weight;
      if (!current.why.includes(seed.id) && seed.label) current.why.push(seed.label);
      byFilm.set(film.id, current);
    }
  }

  const items = [...byFilm.values()];
  for (const item of items) {
    item.score = item.weight + Math.min(2, item.links / 400);
  }
  items.sort((a, b) => b.score - a.score);
  return items;
}
