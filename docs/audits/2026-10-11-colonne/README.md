# La colonne de gauche — décisions du 2026-10-12

Dix-neuf tours de maquettes avec Tim, à la suite de `../2026-10-11-coque/` qui avait
arrêté la bande du haut et le panneau droit en laissant la colonne de côté.

**Ce qui est arrêté est dans [`final/`](final/README.md)** — vingt-six écrans, clair et
sombre. Les images des tours intermédiaires ont été supprimées le 2026-10-13, une fois le
portage fusionné : elles ne servaient qu'à choisir, le choix est fait, et une planche
périmée se confond vite avec la bonne. Elles étaient rendues par un composant jetable,
supprimé avec elles.

[`lieux.md`](lieux.md) dit ce que chaque lieu contient, ce qu'une conversation y peut, et
les droits d'écriture du vault.

## L'anatomie

De haut en bas, et **toujours visible** : logo et repli · *Rechercher* (`Ctrl K`) ·
*Nouvelle conversation* · la **liste verticale des lieux** · l'activité · puis la **zone
basse, seule partie variable** · le **compte en une ligne**.

## Les cinq décisions qui commandent le reste

**1. Les lieux sont une liste verticale, pas des onglets.** Une rangée d'onglets plafonne
à trois dans 17 rem, et il en viendra d'autres — *Planifiées* n'existait pas au premier
tour, et c'est précisément ce qui a tranché. Fils · Projets · Savoir · Planifiées.

**2. Un lieu est une destination, pas une loupe.** Il ouvre sa page au centre *et* règle
la zone basse, les deux ensemble. Le modèle inverse — le lieu ne navigue jamais, seule la
colonne change — a été dessiné et essayé : Tim l'a jugé « très bizarre » à l'usage, et il
avait raison. Un clic qui ne change qu'un coin de l'écran paraît ne pas répondre.

Ce qui est à proscrire reste le **mélange** : un clic qui navigue parfois et parfois non.
Les deux modèles purs sont cohérents ; celui qui navigue toujours a l'avantage de ne rien
pouvoir désynchroniser.

**3. Une conversation neuve n'appartient à rien.** On ouvre un fil parce qu'on a une
question ; savoir qu'il relève d'un projet vient après, parfois bien après. Demander la
destination à l'ouverture, c'est demander ce qu'on ne sait pas encore. *Sans projet*
devient donc le premier groupe de la liste — une boîte de réception, pas un cas
particulier — et `Ranger…` classe après coup.

**4. Un tableau de bord dit ce qui réclame, pas ce qui existe.** « 7 cartes » est un
inventaire ; « 1 attend ta réponse depuis 1 h » est une demande. Chaque tuile est un lien,
et disparaît quand elle tombe à zéro.

**5. Tout tient en une ligne de 32 px.** Les sessions d'un projet en prenaient deux, les
chantiers trois. Sept sessions tiennent désormais là où trois tenaient, et au-delà de
sept le reste est **compté** sur une ligne plutôt que listé — c'est ce qui empêche
l'activité chargée de devenir illisible.

## Ce qui a été écarté, et pourquoi

| | |
|---|---|
| le **rail d'espaces** | une colonne d'icônes contre un panneau qui flotte se lit mal, et coûte 2,75 rem en permanence (déjà écarté par la coque) |
| les **onglets Fils / Projets / Savoir** | ce sont des modes qu'on bascule, ce que les trois contextes ne sont pas |
| les **favoris** | ce qui s'entretient à la main pourrit ; la palette atteint tout et l'activité remonte ce qui bouge. Table supprimée en base |
| la **liste unique triée par récence** | vraie pour qui suit une chose à la fois, fausse pour qui en suit cinq ; et le projet disparaît de la colonne |
| l'**arbre des dossiers** comme porte du vault | il redit ce que la vue *Fichiers* du panneau fait déjà, et suppose un rangement tenu à la main |
| la page Projets **en deux groupes** *Réclament* / *Calmes* | essayée, moins lisible que les lignes à pastilles |
| le **chevron de destination** sur le bouton de création | inutile dès lors que la destination se choisit sur la page du fil neuf |

## Ce qui quitte la colonne

*Rafraîchir* (automatique), le *mode détaillé* (réglages d'apparence), *tous les projets*
(c'est le dépli de la section), le `ProjectSwitcher` (12 rem de haut à lui seul), et
*Services* + *Réglages* du pied, qui entrent dans le menu du compte. L'accueil `/`
disparaît : on rouvre là où on en était, et à froid le centre est la page d'une
conversation neuve.

## Ce que ça a produit

| carte | |
|---|---|
| #11 | porter la colonne, l'activité en une ligne, le menu du compte |
| #12 | les pages de lieu : Projets, tableau de bord d'un projet, Planifiées |
| #13 | les réglages en modale, le réglage *Affichage*, la palette élargie |
| #14 | le fil libre et le geste *Ranger…* — `project_id` devient nullable |
| #15 | dessiner le contexte Savoir (en cours) |
| #17 | fusionner les quatre branches |

## Ce qui n'est pas tranché

- **Le contexte Savoir** en entier : seules la zone basse de son lieu et les droits par
  dossier le sont. Sa page est « un bon début », son panneau, son éditeur, sa boîte des
  agents et son indexation restent à dessiner — carte #15.
- **α contre β** : une conversation qui écrit dans le vault est-elle une *capacité*
  accordée au fil, ou un *rattachement* qui lui fait un groupe à part ? α est proposée,
  Tim ne l'a pas confirmée.
- Deux écarts assumés au portage : le lieu *Savoir* n'est pas rendu (rien derrière), et le
  menu du compte a cinq entrées sur sept — *Consommation* et *Raccourcis* n'ont pas encore
  de destination.
