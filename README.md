# 🎬 Letterboxd Vector Visualisator

Site web statique (sans back-end) pour **importer ses données Letterboxd, visualiser ses notes et obtenir des films recommandés**.

👉 **Démo** : hébergez-le gratuitement sur GitHub Pages (voir ci-dessous), vos données ne quittent jamais votre navigateur.

## Fonctionnalités

- **Import de l'export officiel Letterboxd** (fichier `.zip` obtenu sur [letterboxd.com → Paramètres → Données → Exporter](https://letterboxd.com/settings/data/)) : films, notes et journal sont fusionnés.
- **Profil de visionnage** : nombre de films, note moyenne, coups de cœur, distribution des notes, films par décennie.
- **Bibliothèque** : tableau triable et filtrable (note, année, date de visionnage, liens Letterboxd).
- **Recommandations personnalisées** : à partir de vos meilleurs films notés, le site interroge l'[API TMDB](https://www.themoviedb.org/) (gratuite) et croise les recommandations officielles de chaque film source, en excluant ce que vous avez déjà vu.
- **Genres favoris** : calculés via TMDB sur vos meilleurs films et affichés en barres.
- **Mode démo** : un bouton « données de démo » permet d'explorer le site sans export.
- Tout est calculé **localement dans le navigateur** ; la clé TMDB est stockée uniquement dans `localStorage`.

## Utiliser le site

1. Sur Letterboxd : **Paramètres → Importer & exporter → Exporter vos données** → téléchargez le `.zip`.
2. Ouvrez le site et déposez le `.zip` dans la zone d'import.
3. Pour les recommandations : créez un compte gratuit sur [themoviedb.org](https://www.themoviedb.org/signup), générez une [clé API](https://www.themoviedb.org/settings/api) (type « Developer ») et collez-la dans la section « Films recommandés ».

> Les données d'export Letterboxd peuvent prendre quelques minutes à être générées après la demande.

## Héberger avec GitHub Pages

```
Settings → Pages → Build and deployment → Deploy from a branch → main / (root)
```

Le site est alors servi sur `https://<votre-compte>.github.io/Letterboxd-vector-visualisator/`.

## Structure

```
index.html          Page unique (SPA légère, sans framework)
css/style.css       Thème sombre, inspiré de Letterboxd
js/csv-parser.js    Parseur CSV robuste (guillemets, virgules, retours ligne)
js/importer.js      Lecture du .zip (JSZip) et fusion des CSV d'export
js/app.js           État, rendu des stats/bibliothèque/recommandations
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
