# L'indexation du vault — ce qu'elle calcule, quand elle tourne, ce qu'elle coûte

Écrit au sixième tour de la carte #15. Ce n'est pas une question d'interface, mais elle
commande ce que l'interface peut promettre : une page centrée sur les **rapprochements**
ne tient que si les rapprochements arrivent, et au bon moment.

Trois choses sont déjà posées et ne se rouvrent pas : le vault est un **dossier local
côté WSL hors de `/mnt/c`** (l'indexation y est trop lente), **versionné par git** et
poussé sur un dépôt privé ; **les fichiers sont la vérité**, l'index n'en est qu'un
dérivé ; toute écriture d'agent est un commit relisible et révocable.

## Deux niveaux, et ils n'ont rien à voir

Le mot « indexation » recouvre deux choses de nature différente. Les confondre, c'est se
condamner soit à payer trop, soit à répondre trop tard.

### Niveau 1 — les faits du texte

Exacts, déterministes, sans modèle. Une passe de lecture suffit.

| | |
|---|---|
| liens sortants | les `[[cibles]]` de chaque note |
| **liens entrants** | l'inversion des précédents — c'est tout ce qu'est un *backlink* |
| **liens cassés** | une cible qui n'existe pas |
| **sans lien entrant** | degré entrant nul |
| **carrefours** | degré entrant élevé — un seuil, pas un calcul |
| métadonnées | titre, dossier, dates, nombre de mots, tags du *frontmatter* |
| **ébauches** | les notes sans dossier |

Tout cela est reconstructible en une passe sur les fichiers, se calcule en millisecondes
pour une note, et n'a **aucune raison d'attendre**. Les quatre entrées de la colonne « À
ranger » et les deux pilules de la barre d'une note sortent entièrement d'ici.

### Niveau 2 — ce qui se calcule et peut se tromper

Un vecteur par note (ou par section, pour les longues), et une distance. C'est ce qui
produit les **voisines**, et trois des quatre espèces de rapprochement :

- **« Tu l'as écrit deux fois »** — deux passages très proches dans deux notes ;
- **« Une note ancienne te répond »** — une question du texte courant, proche d'un
  passage affirmatif ailleurs ;
- **« Il manque la note qui les tient »** — un amas dense sans note de degré entrant
  élevé dedans.

La quatrième, **« tu dis l'inverse ailleurs »**, ne se calcule pas par distance : deux
passages contradictoires sont *sémantiquement proches*. Elle demande un jugement, donc un
appel au modèle — et c'est la seule.

**Conséquence de dessin, et elle est bonne** : le niveau 1 est sûr, le niveau 2 est une
proposition. C'est pourquoi un rapprochement porte toujours un geste de rejet (« pas un
rapprochement ») et jamais les liens entrants.

## Quand elle tourne

**À l'écriture dans Solera.** Niveau 1 sur la note enregistrée, immédiat. Niveau 2 à la
pause de frappe, avec un délai d'amortissement — on ne recalcule pas un vecteur à chaque
touche.

**Quand le vault change ailleurs** — et c'est le vrai cas, puisque c'est un dossier qu'on
peut ouvrir dans n'importe quel éditeur. Deux mécanismes, et le second est celui qui
compte :

1. un *watcher* sur le dossier, tant que Solera tourne ;
2. **au démarrage, un `git diff` entre le commit que l'index dit refléter et `HEAD`**, et
   on réindexe exactement ce qui a bougé.

Le second rend le premier facultatif : même si Solera a été éteint trois semaines pendant
qu'on écrivait depuis le téléphone, le rattrapage est borné et exact. C'est le bénéfice
le plus concret d'avoir mis le vault dans git, et il faut le dire ainsi — **l'index
stocke le SHA qu'il reflète**, rien d'autre ne garantit qu'il ne ment pas.

**La nuit.** Une passe complète du niveau 2 sur le vault : les amas, les contradictions,
les rapprochements entre notes qu'on n'a pas touchées. C'est là que le modèle est appelé,
une fois, sur des paires déjà sélectionnées par la distance.

## Les délais qu'on s'engage à tenir

C'est la question que Tim a laissée ouverte, et la réponse dépend du parti retenu. **D2**
a été choisi contre D1 : les rapprochements ne montent pas sous le curseur pendant la
frappe, ils tiennent dans une colonne qu'on consulte. Le budget s'en trouve détendu.

| | |
|---|---|
| liens entrants, liens cassés, compteurs | **immédiat** — c'est du niveau 1 |
| rapprochements de la note ouverte | **sous deux secondes** après la pause de frappe |
| rapprochements du vault entier | **la nuit** |

Ce budget laisse D1 possible plus tard sans rien refondre : passer de deux secondes à
moins d'une demanderait un cache de vecteurs chaud sur la note courante, pas une autre
architecture.

## Ce qu'elle coûte

**Le stockage.** Quelques mégaoctets pour un millier de notes — un vecteur par section,
plus les tables du niveau 1. Négligeable, à une condition :

> **L'index ne vit pas dans le vault.** S'il y était, il serait versionné, il créerait un
> conflit à chaque synchronisation entre deux machines, et un dérivé finirait par
> apparaître dans l'historique d'un fichier que l'on relit.

**Le calcul.** Le niveau 1 est gratuit à l'échelle d'un vault personnel : lire mille
fichiers texte est l'affaire d'une seconde. Le poste réel est le niveau 2, et il se tient
par trois bornes : on ne vectorise que ce qui a changé ; on n'appelle le modèle que sur
des paires déjà retenues par la distance ; et seulement pendant la passe nocturne.

**Ce qu'on accepte de perdre.** Un index corrompu, en retard ou absurde **se jette et se
refait** — il ne contient rien qui ne soit dans les fichiers. C'est la propriété qui
autorise tout le reste : aucune migration à écrire, aucune réparation à prévoir, et un
bouton « tout réindexer » qui n'est pas une opération dangereuse.

## Ce qu'on ne fait pas

- Pas d'indexation continue d'un vault sur `/mnt/c` — déjà tranché, et c'est la raison
  pour laquelle le vault vit côté WSL.
- Pas d'écriture dans le vault par l'indexation. Elle lit, elle dérive, elle n'écrit
  jamais : ce qui écrit passe par la boîte des agents et par un commit.
- Pas de *graphe* affiché pour lui-même. Les carrefours et les amas servent à produire
  des rapprochements, pas une jolie image — la carte #15 n'a dessiné aucun graphe, et
  c'est délibéré.
