# 🎬 Letterboxd Vector Visualisator

Site web statique (sans back-end) pour **importer ses données Letterboxd, visualiser ses notes et obtenir des films recommandés**.

👉 **Démo** : hébergez-le gratuitement sur GitHub Pages (voir ci-dessous), vos données ne quittent jamais votre navigateur.

## Fonctionnalités

- **Import de l'export officiel Letterboxd** (fichier `.zip` obtenu sur [letterboxd.com → Paramètres → Données → Exporter](https://letterboxd.com/settings/data/)) : films, notes et journal sont fusionnés.
- **Profil de visionnage** : nombre de films, note moyenne, coups de cœur, distribution des notes, films par décennie.
- **Bibliothèque** : tableau triable et filtrable (note, année, date de visionnage, liens Letterboxd).
- **Recommandations par critères (sans clé API)** : menus déroulants pour choisir des films (parmi ceux de votre bibliothèque, triés par note), des réalisateurs et acteurs (liste + recherche Wikidata), des genres et des mots-clés (thèmes abordés) — le site interroge [Wikidata](https://www.wikidata.org/) en direct et croise directeur, cast, genres, thèmes et notoriété. Les films choisis sont pondérés par votre note. Les films déjà vus sont exclus.
- **Un seul bouton "Générer mes recommandations"** : il combine automatiquement les résultats Wikidata (critères choisis) et TMDB (si la clé est enregistrée), dédoublonne, exclut les films vus et classe le tout par pertinence.
- **Jumeaux de goût** : via un bouton dédié, vos notes sont comparées à [Letterboxd Movie Ratings 10M (2025)](https://huggingface.co/datasets/titouann/letterboxd-10m-movies-ratings-2025) (10,4 millions de notes publiques de 6 519 membres actifs de Letterboxd, décembre 2025, CC BY-NC-SA 4.0). Le site calcule les profils anonymisés qui ont vu vos films avec exactement les mêmes notes, affiche votre taux de match avec chacun, et recommande leurs mieux notés que vous n'avez pas encore vus. Données pré-compilées dans `data/twins-data.zip` (~18 Mo, téléchargées une fois par clic).
- **Genres favoris** : calculés via TMDB sur vos meilleurs films et affichés en barres.
- **Mode démo** : un bouton « données de démo » permet d'explorer le site sans export.
- Tout est calculé **localement dans le navigateur** ; la clé TMDB est stockée uniquement dans `localStorage`.

## Utiliser le site

1. Sur Letterboxd : **Paramètres → Importer & exporter → Exporter vos données** → téléchargez le `.zip`.
2. Ouvrez le site et déposez le `.zip` dans la zone d'import.
3. Optionnel : collez votre [clé API TMDB](https://www.themoviedb.org/settings/api) dans la barre toujours visible en haut de page — sans clé, les recommandations par critères fonctionnent quand même via Wikidata.

> Les données d'export Letterboxd peuvent prendre quelques minutes à être générées après la demande.

## Héberger avec GitHub Pages

```
Settings → Pages → Build and deployment → Deploy from a branch → main / (root)
```

Le site est alors servi sur `https://<votre-compte>.github.io/Letterboxd-vector-visualisator/`.

## Structure

data/twins-data.zip  Base compacte des notes (films ≥ 100 notes) pour les jumeaux de goût

```
index.html          Page unique (SPA légère, sans framework)
css/style.css       Thème sombre, inspiré de Letterboxd
js/csv-parser.js    Parseur CSV robuste (guillemets, virgules, retours ligne)
js/importer.js      Lecture du .zip (JSZip) et fusion des CSV d'export
js/app.js           État, rendu des stats/bibliothèque/recommandations
js/wikidata.js      Moteur de recommandations par critères via SPARQL (sans clé API)
js/tmdb.js          Client TMDB (recherche, genres, recommandations) + cache localStorage
js/demo-data.js     Jeu de données de démonstration
```

## Stack

- HTML/CSS/JavaScript vanilla, modules ES.
- [JSZip 3.10](https://cdnjs.com/libraries/jszip) (CDN) pour lire l'archive d'export.
- Aucune dépendance côté serveur, aucun cookie, aucun envoi de données.

## Limites connues

- L'export Letterboxd ne contient pas les genres : ils sont estimés via TMDB sur vos 12 meilleurs films.
- Les recommandations SQL/JSON de TMDB sont en `fr-FR` quand disponibles.
- TMDB limite le débit : le site applique une concurrence de 4 requêtes et met en cache chaque réponse.
- Le mode par critères est limité à 12 critères par recherche (limite de débit anonyme de Wikidata) ; chaque critère et chaque recherche est mis en cache en mémoire.
- Les jumeaux de goût ne couvrent que les films comptant au moins 100 notes dans la base (assez pour le grand public, pas pour les films très obscurcs) ; les profils sont anonymisés par le dataset, donc impossible de les relier à de vrais comptes — c'est voulu (vie privée).
