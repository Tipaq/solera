# L'onglet Projet du panneau droit — 2026-10-17

Demande de Tim : depuis une conversation de projet, voir les tâches du projet, et
d'abord la carte que la session traite. Élargit la carte **#27** (onglet *Carte*,
branche `wip/carte-panneau`).

Maquettes : `apps/web/src/components/panel/OngletProjetPrototypes.tsx` sur la branche `proto/onglet-projet`, captures par
`node scripts/onglet-projet-prototypes.mjs` (une planche par tour, réglée dans le script).

## Tour 1 — quatre partis

A la pile, B deux segments, C le voisinage, D le mini-board.

## Tour 2 — tranché

Tim garde **B**, parce qu'il veut y lire aussi *ce que la session est en train de faire* :

- **Cette session → S2** : la carte en tête (description comprise), l'activité en une
  bande au-dessus, et le plan de l'agent à côté des cases de la carte.
- **Le projet → P** : autour de la carte (jalon, bloque, citée par), puis « dans le
  projet, maintenant » (sessions vivantes, file de relecture), puis le reste replié —
  **avec un bouton vers le board** (tour 3, sur la ligne du projet).
- **Sans carte → K2** : une proposition (la meilleure devinette et sa raison),
  Rattacher / Autre… / Créer ; « Autre… » ouvre le choisisseur de K1.

## Tour 3 — la fiche d'une carte : F2 et F3

Une seule fiche pour le panneau et le tiroir du board. Tim retient **F2** (d'un seul
tenant : propriétés, énoncé, fil) et **F3** (la même en deux colonnes quand c'est large),
contre F1 (les onglets d'aujourd'hui, resserrés).

## Porté (2026-10-19)

- `components/board/CardDetail.tsx` — la fiche, sur sa propre largeur : deux colonnes
  au-delà de 42 rem. À l'étroit, les propriétés passent **après** l'énoncé et non sous le
  titre comme dans F2 : dans le panneau elles repoussaient les cases sous la ligne de
  flottaison.
- `components/board/CardThread.tsx` — le fil : sessions et notes dans l'ordre du temps.
- `components/panel/ProjectPane.tsx` — l'onglet *Projet* : S2 + P + K2. Le plan de l'agent
  se lit sous les cases de la carte plutôt qu'à côté : à 34 rem, deux colonnes de cases
  ne tiennent pas.
- La puce `#12` du titre d'une conversation ouvre l'onglet au lieu du board.
- Les maquettes restent hors de `main`, sur la branche `proto/onglet-projet` (`95884e6`) : `OngletProjetPrototypes.tsx` et `scripts/onglet-projet-prototypes.mjs`.
