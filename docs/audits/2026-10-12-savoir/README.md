# Le contexte Savoir — carte #15

Suite de [`2026-10-11-colonne`](../2026-10-11-colonne/README.md), qui a arrêté le lieu
*Savoir* dans la colonne, les trois droits par dossier et l'emplacement du vault, et
laissé la page du vault à l'état de « bon début » (`tour-17/01-page-savoir-v3`).

Rendu par `scripts/vault-prototypes.mjs` depuis `apps/web/src/components/VaultPrototypes.tsx`,
l'un et l'autre **jetables** : à supprimer avec la carte de portage. Une image par bloc,
clair et sombre, gros plans — la colonne de gauche n'y figure pas, elle est arrêtée.

## tour-1/ — le parti de la page, et les vues du panneau

Deux questions seulement, et trois réponses à chacune.

### Ce que la page du vault met en premier

Ce que le v3 ratait, et qui vaut pour les trois : la semaine en sept cases **inventorie**
au lieu de réclamer (le reproche que Tim avait déjà fait au bandeau du tour 16) ; les
trois cartes *Reprendre* coupaient les titres à six mots ; les tuiles de dossiers
affichaient « 128 » en gros sans en rien dire ; et la moitié basse restait vide.

Dans les trois partis, ce qui est tranché ne bouge pas : les agents tiennent une colonne
de côté de 15 rem, ils proposent et n'occupent pas.

| | |
|---|---|
| `01-page-a-flux` | **A · « Ce qui s'est écrit »** — la page est le journal daté du vault : qui a écrit quoi, quand, de combien. Le dépôt git rend ce flux gratuit |
| `02-page-b-reprendre` | **B · « Reprendre »** — le v3 corrigé : notes à reprendre en lignes pleines, dossiers en lignes avec le droit en toutes lettres, carrefours |
| `03-page-c-ecrit` | **C · « La page écrit »** — le vault ouvre le curseur dans la note du jour ; l'état tient autour |

**Ce qui les départage.** A répond à « qu'est-ce qui a bougé depuis hier ? », et c'est la
seule question qu'un vault partagé avec des agents pose vraiment ; il montre aussi les
propositions **à leur date**, dans le flux, ce que la colonne de côté seule ne fait pas.
B répond à « où en suis-je ? » et reste la vue la plus dense en matière. C donne au lieu
*Savoir* une **action par défaut** — écrire — que les deux autres n'ont pas, au prix de
l'état, qu'il faut aller chercher plus bas.

### Les vues du panneau droit en contexte Savoir

En Travail la bande est arrêtée : *Fichiers · Recherche · Git · Terminaux | Agent*.
La question ici est **combien de vues**, et si « le chat du vault » en est une.

| | |
|---|---|
| `04-bande-p1-symetrie` | **P1** — *Liens · Voisines · Historique \| Agent* : la même forme qu'en Travail |
| `05-bande-p2-autour` | **P2** — *Autour · Historique \| Agent* : liens entrants et voisines fusionnés |
| `06-bande-p3-chat` | **P3** — *Liens · Voisines · Chat · Historique \| Agent* : le chat du vault comme vue |

**L'argument contre P3**, et il est de principe : une conversation vit au centre, et
écrire dans le vault est une **capacité** accordée à un fil (lecture α). Un chat dans le
panneau rouvrirait par la bande ce que la carte des emplacements ferme — un second
domicile pour les conversations.

**Entre P1 et P2.** *Liens entrants* est un fait du texte ; *voisines* est un calcul de
l'index, donc faillible. Les confondre dans *Autour* (P2) répond en un geste à « qu'est-ce
qui touche cette note », mais mélange une certitude et une estimation. P1 les sépare, au
prix d'une vue de plus.

## Ce qui reste à dessiner après ce tour

L'éditeur de note (`[[liens]]`, insertion des passages proposés, lecture seule), la boîte
des agents en entier (accepter, refuser, diff, tout accepter — et ce que « refuser » fait
du commit), et l'indexation : ce qu'elle calcule, quand elle tourne, ce qu'elle coûte.

## tour-2/ — le vault est un atelier, et l'IA met en corrélation

**Correction de cap, de Tim**, et elle commande tout le reste : le vault n'est pas une
archive qu'on consulte, c'est **ce avec quoi il produit**. Ce qu'il attend de l'IA n'est
pas qu'elle écrive des notes à sa place — c'est qu'elle **mette en corrélation ce que lui
a déjà écrit**, pour qu'il écrive davantage. C'est l'idée qu'Obsidian a remise en
circulation, et que l'index d'un vault rend calculable.

Ça déclasse **A** (le flux daté : de l'administration) et **B** (la table des matières :
de l'inventaire). **C** était le bon parti — ouvrir sur l'écriture — mais trop maigre :
il posait le curseur et s'arrêtait là.

**L'objet neuf est le rapprochement**, et c'est lui le vrai sujet du tour : une raison
écrite en clair, les notes concernées avec leur extrait, un geste qui produit quelque
chose. Quatre espèces, et elles ne se valent pas :

| | |
|---|---|
| **Tu l'as écrit deux fois** | la même idée à deux dates, dans deux dossiers — *Lier · Fusionner* |
| **Une note ancienne te répond** | une question laissée ouverte ici, résolue ailleurs — *Lier · Ouvrir* |
| **Il manque la note qui les tient** | n notes autour d'un sujet, aucune ne les noue — *Écrire la note* |
| **Tu dis l'inverse ailleurs** | la contradiction, la plus précieuse pour produire — *Trancher* |

### Où les rapprochements se posent dans la page

| | |
|---|---|
| `01-page-d1-pendant-que-tu-ecris` | **D1** — ils montent sous la note, déclenchés par la phrase en cours |
| `02-page-d2-atelier` | **D2** — l'écriture à gauche, la pile des rapprochements en colonne de 19 rem à droite |
| `03-page-d3-chantiers` | **D3** — le vault a des **chantiers** : une question ouverte, ses notes, ce qui manque |

**Ce qui les départage.** D1 est le plus vivant et le plus exigeant : les rapprochements
changent pendant la frappe, donc l'indexation doit répondre sous la seconde ou la bande
arrive après que la pensée est passée. D2 est le plus sobre et le plus relisible — on y
revient quand on veut, rien ne bouge sous le curseur ; la colonne de côté y change de
métier, elle ne porte plus ce que les agents veulent écrire mais ce qu'ils ont trouvé
dans ce qu'on a écrit. D3 introduit un **troisième objet** après la note et le dossier :
le chantier, c'est-à-dire la *map of content* d'Obsidian, mais tenue par l'index plutôt
qu'à la main — l'IA y gagne un but au lieu de ressemblances à signaler, et on y perd en
simplicité.

### Comment un rapprochement s'écrit

| | |
|---|---|
| `04-rappro-r1-face-a-face` | **R1** — les deux extraits côte à côte : on juge sur pièces |
| `05-rappro-r2-la-phrase` | **R2** — la phrase d'abord, les notes en preuve dessous |
| `06-rappro-r3-la-liste` | **R3** — une ligne chacun : en voir dix, en ouvrir un |

R1 est la seule écriture où *Fusionner* est un geste honnête — on voit ce qu'on fusionne.
R2 en loge deux fois plus dans la même hauteur, au prix d'un peu de confiance. R3 est la
seule qui tienne dans une colonne de côté ; dépliée, elle redevient R1.

### Ce que ça change à ce qui était arrêté

Rien ne se rouvre, mais deux choses se déplacent. La **boîte des agents** reste (toute
écriture d'agent passe par une relecture) mais cesse d'être la contribution principale de
l'IA à la page — elle redescend. Et la vue **Voisines** du panneau (tour 1) n'est plus une
commodité : c'est le même calcul que les rapprochements, vu depuis une note. Si D1 ou D2
est retenu, elle devrait s'appeler *Rapprochements* comme la colonne, et P1 l'emporte sur
P2 — on ne fusionne pas dans *Autour* une certitude (qui me cite) et un calcul (ce qui me
ressemble) quand le calcul devient le cœur du produit.

## tour-3/ — l'éditeur, et où un rapprochement se déplie

**Tim a pris D2** (l'écriture au centre, la pile des rapprochements à côté) **et R3**
pour la liste, R1 pour le détail. Restait un trou : R1 demande 38 rem, la colonne de D2
en fait 19 et le panneau droit 20. On ne peut donc pas « déplier R1 » là où R3 est listé.

| | |
|---|---|
| `01-editeur-ecriture` | l'éditeur : largeur de lecture, `[[` ouvre le sélecteur, le panneau porte les rapprochements |
| `02-ouvrir-x1-dans-la-colonne` | **X1** — le rapprochement s'ouvre sur place, les deux extraits empilés |
| `03-ouvrir-x2-en-modale` | **X2** — il s'ouvre en modale de 38 rem, face à face |
| `04-insertion-e1-en-ligne` | **E1** — un passage proposé par un fil arrive **en ligne**, au curseur |
| `05-insertion-e2-par-la-boite` | **E2** — il attend dans la boîte, l'éditeur montre le point d'insertion |
| `06-editeur-lecture-seule` | une note proposée et pas encore acceptée : on lit, on décide |

**Deux choses se sont décidées en dessinant.** La vue *Voisines* du tour 1 devient
**Rapprochements** : c'est le même calcul, vu depuis une note. Et à 20 rem la règle de la
coque fait tomber les noms de la bande — le panneau du Savoir est donc **une rangée
d'icônes dans le cas courant**, ce qui rend l'icône de chaque vue décisive et retire à
l'argument « P2 est plus court » l'essentiel de sa force.

**Ce que « refuser » fait**, et il fallait le dire : le commit de l'agent est révoqué
(`git revert`), la note revient à son état d'avant, et la proposition part dans
*Refusées* où elle reste sept jours. Un refus se défait comme le reste — c'est tout
l'intérêt d'avoir mis le vault dans git.

**La proposition sur X1/X2** : X1 par défaut, X2 au second clic — quand on s'apprête à
fusionner ou à trancher une contradiction, c'est-à-dire quand on a besoin du face-à-face.

## tour-4/ — le panneau droit porte aussi des vues qu'on se fabrique

Idée de Tim en cours de tour, et elle est juste : **le panneau latéral est un
emplacement, pas une liste fermée** — c'est ce qui a fait Obsidian. Rien ne s'y oppose
dans la coque : la règle arrêtée est « les vues portent leur nom tant qu'il y a la
place », pas « il y a cinq vues ».

| | |
|---|---|
| `01-vues-c1-a-la-suite` | **C1** — un second trait, puis les vues à soi, et un `+` au bout |
| `02-vues-c2-menu-vues` | **C2** — une seule porte, *Vues*, qui les contient toutes |
| `03-vues-c3-epinglees` | **C3** — deux épingles au plus dans la bande, le reste dans le `+` |
| `04-vue-requete` | ce qu'une vue **contient** : une recherche enregistrée, et son résultat |
| `05-vue-note-epinglee` | la vue qu'on veut vraiment : lire une note en en écrivant une autre |
| `06-vue-creer` | d'où une vue **naît** : on cherche, on affine, on enregistre |

**Une vue ne stocke rien, elle recalcule.** L'index étant dérivé, une vue l'est aussi :
aucune ne peut mentir sur l'état du vault, et aucune ne survit à un vault qu'on reprend
ailleurs. C'est ce qui permet d'en ouvrir la porte sans ouvrir une boîte de Pandore.

**La vue la plus demandée n'est pas une requête** : c'est une note épinglée à côté de
celle qu'on écrit. Elle ne coûte aucune mécanique de filtre, mais elle oblige le panneau
à savoir afficher une note — en lecture, sans curseur, avec les `[[liens]]` cliquables.

**Trois questions ouvertes**, et seule la première est de dessin :

1. **C1, C2 ou C3.** C3 est proposé : la borne est explicite, donc la bande ne peut pas
   enfler toute seule — ce que C1 ne garantit pas — et l'usage courant reste à un clic,
   ce que C2 ne donne pas.
2. **À quoi une vue est attachée.** La modale de `06` propose trois portées : le Savoir,
   partout, ou cette note seulement. La portée « partout » suppose que les vues ne sont
   pas propres au vault — un projet pourrait en avoir, ce qui déborde cette carte.
3. **Les vues partagées.** `02` en montre une rangée « partagées par le projet » : si une
   vue peut venir d'ailleurs que de soi, elle devient un objet à synchroniser. À écarter
   pour l'instant, ou à assumer.

## tour-5/ — créer, parcourir, et la bande une fois pleine

**Quatre décisions de Tim** avant ce tour, et elles ferment autant de questions :

- **pas de modale** — le rapprochement se déplie sur place (**X1**), X2 est écarté ;
- **le passage proposé reste dans le panneau** (**E2**), pas en ligne dans le texte ;
- **C1** pour les vues à soi : à la suite dans la bande, après un second trait ;
- les vues **partagées** entre un projet et le Savoir : non, on verra au besoin.

Et une demande neuve : **créer d'autres notes, et parcourir le vault**.

| | |
|---|---|
| `01-naviguer-n1-vue-notes` | **N1** — l'arbre du vault comme vue du panneau, à la place qu'occupe *Fichiers* en Travail |
| `02-naviguer-n2-page-parcourir` | **N2** — la page *Parcourir* au centre : des colonnes qu'on trie, pour ranger |
| `03-creer-k1-dans-l-arbre` | **K1** — créer dans un dossier : le `+`, le titre se tape dans l'arbre |
| `04-creer-k2-ebauche` | **K2** — créer sans ranger : la note naît en *Ébauche* |
| `05-bande-c1-la-place` | C1 à l'épreuve de la place, et ce qui se replie en premier |
| `06-ecran-savoir-entier` | l'écran entier, une fois seulement, pour vérifier que les trois zones tiennent |

**Pourquoi le panneau, et pas la colonne.** Le lieu *Savoir* est arrêté sur un état, pas
un arbre — « l'arbre complet reste atteignable, il n'est pas la porte d'entrée ». Le
panneau est donc l'endroit : la grammaire existe déjà, puisqu'en Travail il porte l'arbre
du dépôt. N1 et N2 ne s'opposent pas : le panneau sert **pendant qu'on écrit**, la page
**quand on range** — un arbre de 20 rem ne montre qu'un titre tronqué, et ranger deux
cents notes demande des colonnes triables.

**Les deux chemins de création sont les deux moments.** K1 pour qui sait où il range : la
note hérite du droit du dossier sans qu'on y pense. K2 pour qui écrit d'abord : la note
vit dans *Ébauches*, que la page du vault compte déjà, et **ne jamais la ranger reste
valable** — c'est exactement le fil sans projet. Conséquence qu'il faut assumer et qui
est bonne : **tant qu'une note est en ébauche, aucun agent ne la voit**, puisqu'elle n'a
pas de dossier, donc pas de droit. Une ébauche est à soi.

**C1 à l'épreuve.** La bande compte maintenant quatre vues du contexte — *Notes ·
Rapprochements · Liens · Historique* — plus *Agent*, et les vues à soi s'ajoutent après.
À 26 rem tout tient. En dessous, **ce sont les vues à soi qui se replient**, sous un
bouton qui dit leur nombre ; jamais les vues du contexte, qui sont les mêmes pour tout le
monde et doivent rester au même endroit. C'est la mécanique du « Plus » de la colonne
(tour 10), qui n'apparaît que si la liste déborde.

## tour-6/ — capacité ou rattachement, reposé

La question du tour 9 de la carte #8, laissée ouverte depuis : une conversation qui écrit
dans le vault, **capacité** (α) ou **rattachement** (β) ? Elle se repose mieux
aujourd'hui, parce que le Savoir a gagné entre-temps une page, un panneau et une zone
basse — il y a maintenant un endroit où montrer des fils du vault **sans leur donner un
domicile**, ce qui n'existait pas quand α et β ont été écrits.

| | |
|---|---|
| `01-alpha-la-capacite` | **α** — le droit est dans la barre du fil, le fil ne bouge pas de sa liste |
| `02-beta-le-groupe` | **β** — un groupe *Savoir* dans les fils, et le cas mixte qui n'a pas de réponse |
| `03-gamma-fils-du-vault` | **γ** — le modèle de α, le rassemblement de β, dans le lieu *Savoir* |

**Ce que β a pour lui, et il ne faut pas le minimiser** : avec vingt fils, on veut voir
d'un coup ceux qui travaillent le vault. α ne le donnait pas — elle répondait « le droit
est visible dans la barre », ce qui ne sert à rien quand on cherche *lequel* ouvrir.

**Ce que β coûte** : un fil qui travaille le dépôt Solera *et* prend des notes appartient
à deux groupes. Le mettre dans les deux fausse les comptes ; choisir pour lui, c'est
deviner. Et le cas n'est pas théorique — c'est exactement ce que fait un fil « indexation
du vault ».

**γ sépare les deux questions**, et c'est ce qui la fait tenir : *où un fil vit* (son
domicile, qui doit être unique) et *où on le retrouve* (une vue, qui peut être multiple).
Le fil garde son domicile — sans projet, ou dans son projet. Le lieu *Savoir* ajoute une
section **Fils du vault**, exactement comme la section *Activité* montre les sessions qui
tournent sans être leur domicile. Le fil mixte y est listé **et** reste dans son projet,
avec sa puce de projet pour le dire — ce n'est pas une contradiction, parce que cette
liste n'est pas un classement.

**γ est la proposition.** Elle donne à Tim ce qu'il demandait en penchant pour β, sans la
question sans réponse ; elle respecte la carte des emplacements, qui interdit un troisième
domicile ; et elle est cohérente avec le modèle « destination » du tour 15 — un lieu
montre ce qui le concerne, y compris des objets qui vivent ailleurs.

## Ce qui reste, et pour une autre carte

L'**indexation** est écrite à part, dans [`indexation.md`](indexation.md) : les deux
niveaux de calcul et pourquoi il ne faut pas les confondre, les délais qu'on s'engage à
tenir, le rattrapage par `git diff` d'un vault modifié hors de Solera, et la règle qui
autorise tout le reste — l'index ne vit pas dans le vault, et se jette.

Les maquettes et leurs deux composants jetables restent en place : ils serviront à la
**carte de portage** du contexte Savoir, qui prendra tout d'un bloc.
