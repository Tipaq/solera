# Les trois lieux — ce que chacun contient, et ce qu'il autorise

Écrit au neuvième tour, une fois la colonne **B** retenue. Les maquettes disaient à quoi
ça ressemble ; ce document dit **ce que chaque lieu fait**, parce que c'est ça qui
commande le reste — et notamment ce qu'un agent a le droit de toucher.

La colonne porte trois onglets, dans cet ordre : **Fils · Projets · Savoir**. Au-dessus,
hors des onglets et toujours visibles : la recherche, *Nouvelle conversation*, et
l'activité. En dessous : Services, Réglages, le compte.

## Fils — le défaut, et la boîte de réception

**Ce qu'il contient.** Toutes les conversations, groupées : *Sans projet* en tête, puis
un groupe par projet, puis le compte du reste. C'est le premier onglet parce que c'est
là qu'on arrive.

**Ce qu'une conversation y peut.** Rien du répertoire de travail : ni fichiers, ni git,
ni terminaux. Un fil sans projet n'a pas de dossier — c'est sa seule différence, et elle
est entière. Le panneau droit n'y montre donc que *Agent*.

**Comment il se remplit.** *Nouvelle conversation* n'attache à rien. Le rangement est un
geste séparé et tardif — `Ranger…` dans le `⋯` d'un fil — vers un projet existant, vers
un projet neuf, ou vers une note. **Ne rien ranger reste valable** : un fil peut rester
sans projet pour toujours.

## Projets — un répertoire de travail, et ce qui va avec

**Ce qu'il contient.** Le projet courant déplié — *Board*, *Planification* (masquée
quand elle est vide), ses sessions, ses archivées — et les autres projets repliés.

**Ce qu'une conversation y peut.** Tout ce qu'un dossier permet : lire et écrire les
fichiers, voir le diff, ouvrir un terminal, suivre une branche. Les cinq vues du panneau
sont là : Fichiers · Recherche · Git · Terminaux | Agent.

**Ce qui définit un projet.** Un répertoire de travail, et rien d'autre. C'est pourquoi
*En faire un projet* depuis un fil libre demande un dossier : c'est exactement ce qui
manquait.

## Savoir — des fichiers, des dossiers, et des droits posés d'avance

**Ce qu'il contient.** Pas un arbre, mais un état : *Boîte des agents*, *Ébauches*,
*Sans lien entrant*, puis les notes récentes, puis les dossiers — repliés, avec leur
droit en icône. L'arbre complet reste atteignable, il n'est pas la porte d'entrée.

**Où vit le vault.** Un dossier local côté WSL, hors de `/mnt/c` (l'indexation y est trop
lente), **versionné par git** et poussé sur un dépôt privé. Les fichiers sont la vérité ;
Solera n'en garde qu'un index dérivé. Ce que ça donne : la synchro, un historique par
note, et surtout **chaque écriture d'agent relisible et révocable**.

**Les droits, dossier par dossier.** Trois états, et le défaut est le plus fermé :

| droit | ce que l'agent peut | icône |
|---|---|---|
| **Lecture seule** | lire, citer, lier — **le défaut de tout dossier** | bouclier |
| **Proposer dans la boîte** | écrire, mais l'écriture attend la relecture | bac |
| **Écrire directement** | écrire sans passer par la boîte | crayon |

Le droit vaut pour un dossier **et ses enfants**. Il se change depuis le `⋯` du dossier
et depuis les réglages. La *Boîte des agents* est le seul dossier ouvert d'origine.

## Et une conversation « du Savoir » ?

C'est la question que pose Tim, et elle décide d'un troisième domicile possible pour les
conversations. Deux lectures, dessinées en `tour-9/04-fil-et-vault` :

**α — une capacité.** Écrire dans le vault est un **droit accordé à un fil**, visible
dans sa barre (« ⌸ Veille ») et révocable d'un clic. Le fil reste là où il est — sans
projet, ou dans son projet. Aucun domicile nouveau.

**β — un rattachement.** Les fils qui travaillent le vault font leur propre groupe
*Savoir* dans l'onglet Fils, à côté de *Sans projet* et des projets.

**α est la proposition.** Trois raisons : elle n'ajoute pas un troisième endroit où une
conversation peut vivre, ce que la carte des emplacements interdit ; elle répond au cas
mixte — un fil qui touche au code *et* prend des notes n'a pas à choisir son camp ; et
elle rend le droit visible là où il compte, dans la barre du fil qui écrit, pas dans une
liste. β range mieux les fils d'écriture pure, mais au prix d'un classement qui ne tient
plus dès qu'un fil fait deux choses.

Ce que α implique et qu'il faut assumer : un fil sans projet peut écrire dans le vault
mais pas dans un dépôt. Le vault n'est pas un répertoire de travail, c'est une ressource
partagée — comme un service.
