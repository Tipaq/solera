# La marque : la bague

Un anneau ouvert en haut, et un chaton en triangle inversé qui s’y reverse.

L’anneau est la solera : la rangée de barriques qu’on ne vide jamais, la recette qui ne
bouge pas. Son ouverture est ce par quoi on recomplète. Le triangle pointe vers le bas,
dans l’anneau : ce qui a été validé y retourne au lieu d’être redemandé. La lecture
« bague » est voulue — un objet qu’on transmet et qui ne s’use pas.

Le dessin a remplacé « L’écho », les trois ondes parallèles héritées de Sillage. Celui-ci
appartient à son auteur et ne doit réapparaître nulle part dans le dépôt.

## Sources

| Fichier | Usage |
| --- | --- |
| `docs/brand/symbol.svg` | Tracé de référence, sans police, en `currentColor`. |
| `docs/brand/wordmark.svg` | En-tête du README, symbole et lettrage, deux modes. |
| `apps/web/src/components/Logo.tsx` | Marque dans l’application, suit la couleur du thème. |
| `apps/web/public/favicon.svg` | Accent par défaut de l’application, variante sombre. |
| `site/favicon.svg`, `site/index.html` | Marque du site, suit sa palette. |

Les copies SVG autonomes portent les mêmes deux tracés et le même repère 100 × 100.
Une modification du dessin demande de toutes les mettre à jour : `scripts/brand-assets.mjs`
ne régénère que les PNG, pas les copies SVG.

## Couleur et placement

Le vert #436E69 est la couleur de la signature autonome et des icônes d’application.
Dans les interfaces, `currentColor` conserve la palette du site et les thèmes choisis
par l’utilisateur. Les favicons suivent la préférence système clair/sombre, chacun avec
son accent : ambre pour l’application, violet pour le site.

Conserver autour du symbole une marge d’au moins 10 % de sa largeur. La signature
horizontale s’utilise à partir de 150 px ; en dessous, préférer le symbole seul.

## Régénérer les PNG

Depuis la racine du dépôt : `node scripts/brand-assets.mjs`.

Le rendu passe par `@resvg/resvg-js` et non par un navigateur. Chromium réclame des
bibliothèques système (`libnspr4`, `libnss3`) qu’on ne peut pas poser sans privilèges ;
resvg est un binaire autonome, donc le script tourne même sur une machine verrouillée.
Contrepartie : resvg n’a pas de moteur de polices à lui et prend celles du système, donc
le lettrage de `og.png` suit la police disponible sur la machine qui le génère.

| Fichier | Format | Particularité |
| --- | --- | --- |
| `apps/web/public/icon-192.png` | 192 × 192 | Tuile arrondie, manifest et notifications. |
| `apps/web/public/icon-512.png` | 512 × 512 | Tuile arrondie, manifest. |
| `apps/web/public/icon-maskable-512.png` | 512 × 512 | Fond plein ; symbole dans le cercle de sécurité de 80 %. |
| `apps/web/public/apple-touch-icon.png` | 180 × 180 | Fond plein ; iOS applique son propre masque. |
| `apps/web/public/og.png`, `site/og.png` | 1200 × 630 | Vignette de partage. |

Les captures du produit dans `site/screenshots` sont régénérées avec
`scripts/screenshots.mjs` sur une instance de démonstration isolée — ce script-là passe
encore par Playwright, donc par un navigateur complet.

## Licence de police

`LATO-LICENSE.txt` reste joint : il couvrait le lettrage vectorisé des anciennes
signatures. Plus aucun fichier du dépôt n’embarque la police ; le wordmark utilise la
pile système.
