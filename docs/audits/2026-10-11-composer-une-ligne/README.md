# Composer en une seule rangée — maquettes

Rendues par `scripts/composer-prototypes.mjs` depuis
`apps/web/src/components/chat/ComposerRowPrototypes.tsx` (maquette jetable, à
supprimer une fois la disposition portée dans le vrai composer).

Chaque bloc a son image, dans `ordinateur/` (820 px) et `telephone/` (390 px) : une
planche entière fait plus de trois mille pixels de haut, et toute visionneuse qui
l'ajuste à l'écran la rend illisible. Les quatre fichiers `ordinateur-*.png` et
`telephone-*.png` à la racine gardent la vue d'ensemble, clair et sombre.

## La rangée, dans ses cinq états

| | |
|---|---|
| `01-rangee-au-repos` | `+` · dictée ——— modèle · jauge · flèche |
| `02-reglage-hors-defaut` | la pastille d'alerte remonte sur `+`, le mode Plan garde son étiquette |
| `03-tour-rien-tape` | un tour est en cours, rien n'est écrit : la flèche devient un carré d'arrêt |
| `04-tour-message-tape` | on réécrit pendant le tour : le carré redevient flèche, et l'envoi infléchit |
| `05-tour-mise-en-file` | si la mise en file a été choisie dans les réglages : arrêt et flèche coexistent, horloge sur la flèche |

## Les menus

| | |
|---|---|
| `06-menu-plus` | joindre, skills, serveurs MCP, réglages de la session |
| `07-menu-plus-skills` | recherche, bibliothèque, commandes de la session |
| `08-menu-plus-mcp` | serveur Solera, serveurs du projet, isolation stricte |
| `09-menu-plus-reglages` | permissions, vitesse, style, conseiller, mise en file, ultracode, skills |
| `10-menu-plus-permissions` | les cinq modes de permission |
| `11-menu-modele` | trois modèles, catalogue complet, effort, mode rapide |
| `12-menu-modele-plus` | tout le catalogue du CLI |
| `13-modale-contexte` | ce que la jauge ouvre |

## Ce qui reste à trancher

- `Réglages de la session` : sous-menu partout, ou feuille complète au téléphone ?
- Compacter : depuis la modale de contexte seulement, ou aussi depuis le menu de la conversation comme aujourd'hui ?
- En mode infléchir, arrêter n'est plus accessible tant qu'un brouillon est en cours. `Échap` pour vider le champ ?
