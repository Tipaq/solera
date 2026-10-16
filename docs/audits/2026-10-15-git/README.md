# La vue Git du panneau — tour 1

Carte #10. **Décision en cours, rien n'est arrêté.** Ce dossier date l'état du débat au
2026-10-15 ; la décision, quand elle tombera, ira dans `final/`.

## D'où on part

Tim a répondu « en gros je voulais un petit GitKraken » aux trois questions de la carte.
C'est une réponse sur l'objet, pas sur ses arbitrages : GitKraken est une fenêtre de
1 400 px avec trois colonnes, le panneau fait 20 à 45 rem et suit le répertoire de
travail d'un fil. On lui rend donc les trois questions en images.

## Les maquettes — `tour-1/clair/`

| | ce que la planche met en jeu |
| --- | --- |
| **A1** `01-a1-le-graphe-au-centre` | GitKraken compressé : WIP en tête, histoire, auteur, hash, étiquettes |
| **A2** `02-a2-la-console-d-abord` | indexé / à indexer, message, commit, indexation par bloc |
| **A3** `03-a3-l-en-tete-d-action` | `GitPane` tel quel, plus une barre d'action — l'étalon à battre |
| **B1** `04-b1-pendant-un-tour` | écritures fermées pendant qu'un tour tourne |
| **B2** `05-b2-l-agent-a-commite` | l'agent a commité sous la vue, et le message écrit survit |
| **C1** `06-c1-le-graphe-du-worktree` | le graphe au périmètre du fil : une ligne droite |
| **C2** `07-c2-le-graphe-du-depot` | le dépôt entier dans le panneau, worktree du fil surligné |
| **C3** `08-c3-le-graphe-ailleurs` | le graphe sur une page du dépôt, avec la colonne « Fil » |
| **D1** `09-d1-la-console-a-22-rem` | A2 à la largeur minimale du panneau accosté |

La matière est le vrai dépôt : douze worktrees vivants, un `main` en avance rapide.
C'est ce contenu réel qui porte l'argument du volet C — voir C1.

## Ce que les images ont déjà tranché, avant même l'avis de Tim

- **Un graphe au périmètre du panneau est une décoration.** C1 n'est pas un épouvantail,
  c'est `git log --graph` sur un worktree : une colonne de points. Le graphe demande
  soit un changement de portée (C2), soit une autre page (C3).
- **A1 ne survit pas à 22 rem.** Couloir, étiquettes, auteur, hash et date ne tiennent
  pas ensemble ; A2 survit (D1). Le panneau peut être étroit, donc le parti doit l'être.
- **A1 ne laisse pas de place au diff**, qui est ce qu'on regarde vraiment.
- **B2 est inévitable quel que soit le choix de B.** Même si l'on ferme les écritures
  pendant un tour, un tour qui se termine périme ce qu'on a à l'écran.

## Ce qui reste à trancher avec Tim

1. **A1, A2 ou A3** — et surtout : A1 ou A2 gagne-t-il *visiblement* contre A3, qui coûte
   quatre routes au lieu de huit ?
2. **B1 : ferme-t-on les écritures pendant un tour ?** Le verrou est simple et subi.
3. **C2 ou C3** — une règle de la coque cassée, ou une carte de plus.
4. Le volet « indexation par bloc » de A2 est le plus cher du lot (`git apply --cached`
   sur un patch partiel, côté serveur). Il se retire de A2 sans la défaire.

## Coût serveur, pour mémoire

Aujourd'hui **aucune route ne sait écrire** : ni indexer, ni commiter, ni pousser, ni
changer de branche. Les seules écritures existantes sont les worktrees, le clone et
`setCredentialHelper`. A3 demande ~4 routes, A2 ~8 plus l'application de patch partiel,
A1 ~8 plus un `git log --graph` paginé.

## Les maquettes

`apps/web/src/components/GitPrototypes.tsx` et `scripts/git-prototypes.mjs`, jetables,
à retirer ensemble quand la décision est prise. Rien n'a été écrit dans `GitPane.tsx`.

---

# Tour 2 — GitKraken pour de bon

« Vraiment reprends l'UI de GitKraken et ses features, on peut mm mettre une sous
navigation », Tim, le 2026-10-15. Le tour 1 posait la question « jusqu'où ? » ; le
tour 2 répond « tout », et montre ce que ça veut dire.

## La source

L'inventaire vient de la documentation officielle, pas d'une impression :
[help.gitkraken.com/gitkraken-desktop/interface](https://help.gitkraken.com/gitkraken-desktop/interface/).

- **Barre d'outils** : Annuler, Refaire, Tirer, Pousser, Branche, Remiser, Dépiler, LFS
- **Panneau de gauche** : Local, Distant, Pull requests, Tickets, Équipes, Étiquettes,
  Remises, Sous-modules
- **Graphe** : colonnes Branche/Tag · Graphe · Message · Auteur · Date · Sha ;
  nœuds commit, fusion, WIP, branche, remise
- **Panneau de commit** : Non indexés, Indexés, Message (résumé et description)

Ce qui fait sa réputation par ailleurs : le graphe lui-même, le rebase interactif par
glisser-déposer, l'indexation par ligne, la résolution de conflits, et le bouton
*Annuler*.

## Ce qui ne se transpose pas, et comment

GitKraken tient trois colonnes dans 1 400 px. Le panneau en a 44 rem au mieux, 20 au
pire. Le panneau de gauche devient donc une **sous-navigation à quatre destinations**
— Graphe, En cours, Branches, Remises — et le panneau de commit devient l'une d'elles.
Pull requests, Tickets, Équipes et Sous-modules sont laissés de côté.

## Les maquettes — `tour-2/clair/`

| | ce que la planche met en jeu |
| --- | --- |
| **S1** `01` | la sous-navigation en barre segmentée, + la barre d'outils complète |
| **S2** `02` | la même en rail vertical — 30 px de hauteur contre 44 px de largeur |
| **G1** `03` | le graphe et ses quatre natures de nœud, colonnes comprises |
| **G2** `04` | « En cours » : non indexés / indexés, résumé + description, amender |
| **G3** `05` | indexer par bloc **et par ligne** — le geste qui justifie l'outil |
| **G4** `06` | le commit sélectionné, avec le **fil** qui l'a produit |
| **G5** `07` | le menu d'un commit : basculer, fusionner, rebaser, picorer, revert, reset |
| **G6** `08` | glisser une branche sur une autre — fusionner ou rebaser |
| **G7** `09` | Branches : Local, **Worktrees**, Distant, Étiquettes |
| **G8** `10` | Remises, avec aperçu du contenu |
| **G9** `11` | rebase interactif : reprendre / fondre / réécrire / jeter |
| **G10** `12` | l'éditeur de conflits, les trois versions empilées |
| **G11** `13` | *Annuler*, qui dit toujours quoi il annule et comment |
| **D2** `14` | graphe et « En cours » à 22 rem |

## Les deux choses que Solera ajoute à GitKraken

Elles n'ont pas d'équivalent chez lui et ne doivent pas se perdre :

1. **Le fil qui a produit un commit** (G4) et **le fil qui occupe un worktree** (G7).
   GitKraken affiche un auteur ; ici l'auteur est presque toujours un agent, et ce qui
   renseigne est la conversation.
2. **La section Worktrees** (G7). Chez GitKraken une branche est une branche ; ici c'est
   un chantier en cours avec quelqu'un dedans.

## Ce qui attend l'arbitrage de Tim

- **S1 ou S2** — barre segmentée ou rail.
- **Le lot indispensable.** G1, G2, G4, G7 forment le socle. G3 (par ligne), G6
  (glisser), G9 (rebase interactif), G10 (conflits) sont chacun un chantier à part.
- **Les entrées de G5 à garder** — `reset --hard` à portée de pouce sur mobile ?
- **G10 en entier, ou seulement « montrer le conflit » + prendre les miens / les leurs**,
  le reste renvoyé à l'agent.
- **Ce que la barre d'outils garde** quand la largeur tombe à 22 rem (D2).

---

# Tour 3 — S2, et tout

« S2 et mets tout », Tim, le 2026-10-15. Le rail est retenu, et plus aucune fonction
n'est écartée pour cause de coût. Ce tour n'arbitre plus *si*, il montre **où**.

## La règle de rangement

« Mets tout » impose une règle, sans quoi la barre d'outils finit à dix-huit boutons.
Celle de GitKraken, reprise telle quelle :

- **une liste qu'on vient consulter** → une destination du rail ;
- **un geste sur le dépôt, sans objet à désigner** → la barre d'outils ;
- **un geste sur *ce* commit, *cette* branche, *ce* fichier** → le menu de cet objet.

C'est pour ça que la barre de GitKraken tient en six boutons. La planche `01` est la
carte complète : rien n'y est en double, et rien n'y manque.

## Le rail — sept destinations

Graphe · En cours · Branches · Remises · Recherche · Historique, plus **Conflits**,
qui n'apparaît que pendant un conflit et n'occupe rien le reste du temps.

## Les maquettes — `tour-3/clair/`

| | |
| --- | --- |
| **T0** `01` | la carte : où vit chaque fonction, et pourquoi là |
| **T1** `02` | Graphe — l'écran d'accueil, nœud « en cours » sélectionné |
| **T2** `03` | En cours — non indexés / indexés, résumé + description, co-auteur |
| **T3** `04` | indexer par bloc et par ligne |
| **T4** `05` | le commit sélectionné, avec **le fil qui l'a écrit** |
| **T5** `06` | le menu d'un commit — douze entrées, réinitialisations dépliées |
| **T6** `07` | glisser une branche sur une autre |
| **T7** `08` | Branches — Local, **Worktrees**, Distants, Étiquettes, Sous-modules |
| **T8** `09` | Remises, avec aperçu |
| **T9** `10` | rebase interactif, et la suspension des tours pendant qu'il court |
| **T10** `11` | Conflits — destination conditionnelle, en ambre |
| **T11** `12` | Recherche — filtres, dont « par fil » et « à la main / par un agent » |
| **T12** `13` | Historique d'un fichier et blâme — **par fil**, pas par auteur |
| **T13** `14` | Annuler, et le garde-fou de ce qui ne s'annule pas |
| **T14** `15` | le rail à 22 rem — le prix de S2, 44 px qui ne se négocient pas |

## Les quatre endroits où Solera s'écarte de GitKraken

Ce ne sont pas des libertés prises : ce sont les points où copier GitKraken
donnerait une vue fausse.

1. **Le fil qui a écrit un commit** (T4) et **qui occupe un worktree** (T7).
2. **Le blâme par fil** (T12). Dans un dépôt où presque tout est signé d'un agent,
   « qui a écrit cette ligne » ne renseigne plus ; « quelle conversation » si.
3. **La suspension des tours pendant un rebase** (T9). Un rebase à moitié fait n'est
   pas un dépôt qu'un agent sait lire.
4. **« Laisser l'agent le résoudre »** (T10). L'éditeur de conflits est là, mais passer
   la main doit coûter un clic.

## Ce qui n'y est toujours pas, et pourquoi

**Pull requests, Tickets, Équipes** — trois sections du panneau de gauche de GitKraken.
Elles demandent le compte GitHub de Tim et une intégration, pas une route `git` : c'est
une carte à part, à ouvrir si le besoin se confirme. La section Sous-modules, elle, est
présente et vide (T7) plutôt qu'absente.

## Ce qui reste avant d'écrire du code

- Valider T0, qui est la vraie décision : tout le reste en découle.
- Valider T14 : si le rail à 22 rem ne convient pas, S2 tombe et S1 revient.
- Écrire la carte de portage, avec l'ordre de livraison. Proposition : socle
  (T1 T2 T4 T7 T11) → gestes (T5 T6 T8 T13) → le cher (T3 T9 T10 T12).

---

# Tour 4 — les colonnes suivent la largeur du panneau

« On peut faire en sorte que ça dépende de la taille du panneau : s'il est très large
je voudrais pouvoir voir auteur, date et sha », Tim, le 2026-10-15. **Le reste du
tour 3 est validé.**

Les colonnes ne sont donc pas un choix fait une fois : c'est une échelle. Les maquettes
du tour 4 utilisent de **vraies requêtes de conteneur** (`@container`, `@min-[…]`),
pas une simulation — ce qu'on voit sur les images est le mécanisme lui-même.

Le palier porte sur la largeur du **panneau**, pas de la fenêtre : un panneau de 30 rem
se comporte pareil dans une fenêtre de 1 600 px et sur un portable. L'idiome existe
déjà dans le dépôt (`GitPane` est en `@container`, `SidePanel` réduit ses onglets en
`@max-[30rem]:hidden`).

| palier | ce qui entre | ce qui change aussi |
| --- | --- | --- |
| `< 28 rem` | Graphe · Message | une seule étiquette par commit |
| `@28rem` | **+ Date** | toutes les étiquettes reviennent |
| `@36rem` | **+ Auteur** | les libellés de la barre d'outils reviennent |
| `@46rem` | **+ Sha** | |
| `@56rem` | **+ Fil** | la colonne que GitKraken n'a pas |

L'ordre suit l'utilité par pixel : Date d'abord (étroite, et c'est la question qu'on se
pose devant un graphe) ; Sha en dernier, parce qu'on le copie depuis le menu du commit
plutôt qu'on ne le lit. **Rien ne se règle** — il n'y a pas de préférence à poser dans
un écran de réglages, la place décide.

## Les maquettes — `tour-4/clair/`

`01` l'échelle en tableau, puis le même écran à `02` 22 rem, `03` 32 rem, `04` 40 rem
(la largeur par défaut, donc l'image qu'on verra le plus), `05` 50 rem, `06` 62 rem.

## Une conséquence pour le tour 1

À 62 rem avec la colonne Fil, le panneau **est** la page de dépôt que la planche C3 du
tour 1 proposait d'ouvrir ailleurs. Elle n'a donc plus besoin d'exister à part : la
question 3 de la carte #10 (« le graphe, de quoi ? ») se referme ici.

---

# Où en est la décision

**Arrêté :** le rail (S2), l'inventaire entier de GitKraken, la règle de rangement T0,
les quatre écarts assumés, et l'échelle de colonnes du tour 4.

**Suites ouvertes, en cartes à part :**

- les sections GitHub (Pull requests, Tickets, Équipes) — ce qu'il faudrait pour les
  ajouter un jour ;
- le développement de la vue Git elle-même.
