# Lot 4 — les gestes de confort : glisser une branche, réordonner un plan

Carte #52, détachée de #29. Comme celles des trois lots précédents, ces images **ne
sont pas des maquettes** : elles sortent de `pnpm test:git-ui`, qui monte le vrai
serveur, la vraie interface et un vrai dépôt. Et elles sortent d'un geste **fait au
clavier** — la suite presse Espace, les flèches et Entrée, parce qu'un `click()` de
Playwright ne dirait rien d'un geste qui n'existe qu'au clavier.

Une image par vue, parce qu'une planche entière est illisible sans zoom.

| image | ce qu'elle montre |
| --- | --- |
| `glisser-une-branche` | T6, pendant le geste : la branche saisie s'efface, et **une seule** destination s'allume — la branche courante |
| `la-proposition` | T6, au lâcher : « Lâcher feat/lot-4-drop sur feat/radar-prefetch : » et les deux issues, *Fusionner* et *Rebaser*, plus l'échappée. Le dépôt n'a pas bougé |
| `plan-avant` | le plan de rebase tel que le serveur l'a lu, du plus ancien au plus récent, chaque ligne avec sa poignée |
| `plan-reordonne` | le même après Espace ↓ Entrée : « second step » est passé devant, et c'est l'ordre dans lequel git rejouera |
| `le-clic-droit` | la question du lot 2, tranchée : le menu d'une branche s'ouvre **aussi** au clic droit, au curseur, avec les mêmes neuf entrées |

## Les décisions prises en route

- **La destination d'un lâcher est la branche courante, et elle seule.** Les deux
  gestes que T6 propose sont `git merge <branche>` et `git rebase <branche>` : tous
  deux partent de là où l'on est. Lâcher sur une branche où l'on n'est pas voudrait
  dire y basculer d'abord — un troisième geste que personne n'a demandé, et qui
  déplacerait les fichiers sous un agent. Les autres lignes ne s'allument donc pas,
  et les flèches ne s'y arrêtent pas.
- **Le lâcher propose, il n'agit pas** — la réserve que la planche écrit noir sur
  blanc. Les deux boutons repassent ensuite par `useGitActions`, donc par le verrou du
  tour en cours et par le garde-fou de T13 : ce raccourci n'ouvre aucune porte dérobée,
  et **aucune route n'a été ajoutée** pour ce lot (`POST …/git/act` et
  `POST …/git/impact` du lot 2 suffisaient, le plan de rebase partant déjà ordonné).
- **Un seul mécanisme pour les deux points d'application** (`git/drag.tsx`) : l'état
  tenu est `(saisi, visé)`, deux identifiants, et ce qui se voit à l'écran s'en dérive
  au rendu — la même fonction `moved` sert à l'aperçu pendant le geste et au résultat
  au lâcher, ce qui est la seule façon que les deux soient d'accord. Déplacer vraiment
  les lignes pendant le geste aurait demandé de savoir les remettre en place sur Échap.
- **Pas de `dnd-kit`, pas de souris, pas de doigt.** Au doigt le geste n'existe pas —
  l'appui long y sert au défilement — et le même choix passe par le menu de l'objet
  (règle T0), livré au lot 2. À la souris, le menu rend déjà le service en un clic ;
  au clavier il demande d'ouvrir, de descendre et de lire. Le clavier est le seul
  endroit où ce geste gagne quelque chose, et c'est le seul où il est.
- **Le clic droit, tranché avec Tim : les deux.** Le `⋯` au survol reste le seul chemin
  au doigt, et c'est lui qui apprend qu'il y a un menu ; le clic droit est ce qu'on
  essaie d'abord à la souris, et tomber sur le menu du navigateur fait croire qu'il n'y
  a rien. `Item` et `Separator` appartenant à deux modules Radix qui ne se partagent
  pas, les entrées sont écrites **une fois**, en fonction, et rendues par l'une ou
  l'autre trousse (`ObjectMenu` dans `git/menus.tsx`).

## Ce que les images ne montrent pas, et que la suite vérifie

- **Le lâcher n'a rien fusionné** : la suite lit `HEAD` avant et après, et il n'a pas
  bougé d'un octet — ni au lâcher, ni après l'échappée. C'est la réserve de T6, et
  c'est la seule qui ne se voie pas sur une image.
- **Réordonner change l'ordre dans lequel git rejoue**, pas seulement l'écran. La suite
  lance le rebase et relit `git log` : les deux commits sont revenus dans l'ordre du
  plan, et non dans celui d'avant.
- **Le `⋯` et le clic droit ouvrent les mêmes entrées.** Les deux ouvertures sont
  faites l'une après l'autre et les mêmes entrées attendues dans les deux — une entrée
  ajoutée d'un seul côté ferait deux menus différents selon la main qui ouvre.
- **Une ligne saisie qui disparaît repose le geste** plutôt que de viser un fantôme :
  une branche supprimée ailleurs, un plan rechargé.
- **Saisir une ligne qui n'a nulle part où aller ne commence pas le geste** — sur un
  dépôt d'une seule branche, Espace ne fait rien plutôt que d'ouvrir une impasse.
