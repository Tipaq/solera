# La gestion de projet — décisions des 2026-10-14 et 15

Neuf tours de maquettes avec Tim, partis de deux questions : **comment on atteint les
vues d'un projet** (son tableau de bord, son board, ses tâches planifiées), et **jusqu'où
va la gestion de projet** — il n'a pas voulu trancher sur un formulaire de questions, il
a demandé des images.

**Ce qui est arrêté est dans [`final/`](final/)** — quinze écrans, clair et sombre. Les
tours intermédiaires ont été supprimés le 2026-10-15, une fois le jeu final monté : ils
ne servaient qu'à choisir, le choix est fait, et une planche périmée se confond vite avec
la bonne. Ils étaient rendus par un composant jetable, `ProjectPrototypes.tsx`, supprimé
avec eux.

Le portage est la carte **#31** ; les champs de carte qu'exigent les chronologies sont la
carte **#32**, volontairement séparée.

## Le constat de départ

| | |
|---|---|
| **trois chemins redondants** | le `⋯` du projet dans la colonne et le `⋯` du tableau de bord portaient les mêmes trois entrées, que les sous-liens de la colonne redisaient |
| **aucune remontée** | depuis le board ou les planifiées, rien ne ramenait au tableau de bord |
| **une fonction qui se cache** | *Planification* disparaissait de la colonne à zéro, donc ne se découvrait que par le tableau de bord |
| **rien de transversal** | *Planifiées* et *Projets* existaient en global ; le board restait par projet |
| **des cartes plates** | ni échéance, ni jalon, ni étiquette, ni sous-tâche, ni lien typé |

## Les sept décisions

**1. Les vues d'un projet sont des onglets, dans le contenu.** Pas dans la bande : la
rangée y entrait en concurrence avec le nom du projet et deux boutons, et plafonnait à
quatre vues. Dans le contenu elle en tient cinq, ce qui est précisément ce qui rend
*Chronologie* et *Journal* possibles. La rangée porte l'**action de la vue** — *+ Carte*,
*+ Tâche*, *+ Jalon* — et le retour au tableau de bord devient gratuit.

**2. La bande ne porte que ce qui ne dépend pas de la vue** : le projet, son dépôt,
*Nouvelle conversation*, le `⋯`. Elle est donc identique sur les cinq vues et ne clignote
pas quand on change d'onglet. Le `⋯` ne navigue plus : il porte les gestes du projet, et
les vues seulement en second rang, pour aller droit au board sans passer par l'aperçu.

**3. Pas de couloir centré.** Pleine largeur, marge de 1 rem, et c'est la **grille** qui
tient la lecture : trois colonnes à l'aperçu, quatre au board, deux aux planifiées. Un
couloir centré faisait sauter le bord gauche de la rangée de six centimètres entre une
vue de lecture et le board, et il coûtait une semaine entière d'axe à la chronologie.

**4. « Aperçu » remplace « Tableau de bord » ; « Board » reste.** Deux mots pour la même
chose dans deux langues, et c'est le premier qui cède : « tableau de bord » n'est ni dans
le code, ni dans les URL, ni dans les consignes, alors que « board » y est partout.

**5. Le portefeuille a la même grammaire, un cran au-dessus** : Projets · Board · Travail
· Chronologie · Journal. C'est ce qui rend les projets à leur page — serrés dans une
colonne de 22 rem à côté d'une liste de cartes, ils passaient au second plan — et ce qui
donne au transversal sa propre largeur au lieu de la leur.

**6. La colonne garde l'arbre, et perd tous ses sous-liens de vue.** Les onglets les
portent ; c'est la fin de l'hésitation « je clique le sous-lien ou l'onglet ? ». Échelle :
projet 14 px semi-gras, session 13 px, **pas d'en-tête « Sessions »** — sous un projet
déplié il n'y a que des sessions, et le filet de couleur le dit.

**7. La ligne de projet porte quatre cibles, et pas une de plus.** Le corps ouvre
l'Aperçu (`/p/:id`), le chevron ne fait que déplier — il ne navigue jamais — et au survol
les deux points d'état **cèdent la place** à `+` (conversation neuve) et `⋯` : on échange,
on n'ajoute pas. Au doigt, où il n'y a pas de survol, les deux boutons sont permanents et
le nom est tronqué d'autant. C'est la limite du parti.

## Ce qui a été écarté, et pourquoi

| | |
|---|---|
| les onglets **dans la bande** | quatre tiennent, cinq non — et c'est la cinquième vue qui portait la gestion de projet |
| un **sélecteur de vue** déroulant | ne plafonne jamais, mais on ne voit plus d'un coup d'œil ce qui existe : le reproche déjà fait aux onglets de lieux |
| le **tableau de bord comme seule porte** | deux clics pour toute vue, et un carrefour obligatoire qui n'a rien à dire quand le projet est calme |
| un **résumé du board** sur l'aperçu | il redit le board au rabais ; avec l'onglet à portée d'œil, il n'a plus d'objet |
| un cinquième **lieu « Travail »** | le transversal appartient à la page Projets, qui est déjà la vue de tous les projets |
| la page Projets en **deux colonnes** | les projets y passent au second plan ; c'est leur page |
| la **colonne maigre** (une ligne par projet, sans dépli) | tentante — hauteur constante, rien à entretenir — mais on perd les sessions des autres projets, que l'arbre montre |
| la **colonne à contexte** (le projet ouvert occupe le bas) | écrit les vues deux fois, et cache les autres projets : tranché contre le `ProjectSwitcher` le 2026-10-11 |
| les **pilules** pour les onglets | un rail creusé sur un board déjà creusé, et des bords qui se coupent mal au doigt |

## Les écrans

[`final/pages/`](final/pages/) :

| | |
|---|---|
| **F1–F5** | un projet : Aperçu · Board · Planifiées · Chronologie · Journal |
| **F6–F7** | le portefeuille : Projets · Travail |
| **F8** | le board global, **retenu** : cartes mêlées dans quatre colonnes, projet en pastille, barre de filtres (projet · jalon · étiquette · agent) |
| **F9** | le même en couloirs par projet — **écarté**, gardé en image : on surveille mieux par projet, mais un projet calme occupe une bande vide et la hauteur double |
| **F10–F11** | le portefeuille : Chronologie · Journal |
| **F13** | la ligne de projet et ses quatre cibles, en quatre états |
| **F14** | au téléphone : la rangée déborde et défile, la bande tient |
| **T2** | la carte enrichie — échéance, jalon, étiquettes, sous-tâches, liens typés. **Carte #32**, à discuter avant d'écrire |

[`final/colonne/`](final/colonne/) : **F12**, la colonne entière — identité, recherche,
*Nouvelle conversation*, un filet, les quatre lieux, l'activité, puis la section Projets,
seule partie qui défile.

## Ce que T2 commande

Ce n'est pas un écran de plus, c'est un changement de schéma : sans échéance ni jalon sur
une carte, **les échéances proches de F1, la chronologie d'un projet (F4) et celle du
portefeuille (F10) n'ont rien à afficher**. D'où la carte séparée : le reste du portage
n'y touche pas et peut avancer sans.

Le **Journal** (F5, F11) n'invente rien, lui : cartes fermées, notes de carte, sessions,
audits versés, branches fusionnées, tirs planifiés existent déjà — rien ne les rassemble.
