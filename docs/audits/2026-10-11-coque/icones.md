# Chaque icône, au crible

Neuvième tour, le 2026-10-11. Les images retenues : `final/clair/` et `final/sombre/`.

## Segment de la colonne

| icône | verdict |
|---|---|
| Logo | **garder** — ce n'est pas une icône mais l'ancre du produit, et le seul endroit où son nom s'écrit |
| Replier la colonne | **garder** — et le bouton de réaffichage retrouve enfin une place réelle, au même endroit, au lieu du `md:pl-14` recopié dans quatre vues |
| Rafraîchir les listes | **retiré** — les listes se révalident déjà toutes seules ; le bouton existait du temps où elles ne le faisaient pas |
| Mode détaillé | **retiré** de la colonne, descendu dans les réglages d'apparence : c'est un choix qu'on fait une fois |
| Ajouter un projet | **garder**, mais devenu le `+` de la section *Projets*, comme chaque section a le sien |

## Segment de la conversation

| icône | verdict |
|---|---|
| Icône du CLI | **garder, et fusionner avec l'état** : elle porte l'anneau d'activité. Deux éléments disaient « Claude » et « il travaille » ; un seul suffit |
| Puce du projet | **garder** — elle remplace la deuxième ligne de titre d'aujourd'hui |
| **Puce de branche / worktree** | **ajouté** — aujourd'hui enterrée dans la modale *Détails* (`ConversationPage.tsx:1042`). Quand un agent écrit, savoir *où* il écrit est l'information la plus utile de la barre, et deux fils voisins sont indiscernables sans elle |
| **Signal d'état** (erreur, tour interrompu, liaison coupée, attente) | **remis** — il existe aujourd'hui (`HEADER_SIGNALS`, `ConversationPage.tsx:911`) et il avait disparu de mes maquettes. C'est la seule chose de la barre qui réclame une action |
| Jauge de contexte | **déplacée** au composer, où elle est déjà, et où le geste qui la change (compacter) habite aussi |
| Consignes | **déplacée** aux réglages du projet — ce sont celles du dossier |
| Chercher dans le fil | **déplacée** dans le `+` du composer |
| Compacter | **déplacée** dans la modale du contexte |
| Détails | **déplacée** dans le `+` du composer |
| `⋯` | **garder**, mais il change de contenu — voir plus bas |
| Bouton du panneau | **garder**, au bout de la conversation, contre le panneau |

## Segment du panneau

| icône | verdict |
|---|---|
| Fichiers · Git · Terminaux | **garder**, toujours dans cet ordre, en tête |
| Historique · Agents | **garder**, deuxième famille. Le compteur d'agents en cours reste sur l'icône |
| Note liée | **garder**, mais **n'apparaît que si un vault est configuré** |
| Serveurs MCP | **retiré** du panneau : la liste vit dans le `+`, les réglages dans sa modale |
| Recherche · Arborescence | **gardées, mais rendues à leur vue** : elles ne concernent que *Fichiers* et n'apparaissent que quand elle est affichée, après un séparateur |
| Fermer le panneau | **retiré** : le bouton de la conversation le fait déjà, et il est juste à côté |
| Accoler / élargir, plein écran | **passés au `⋯`** : trois états de géométrie qu'on règle rarement |

## Les deux `⋯` — ce qu'il y a vraiment dessous

Question posée, et elle est juste : un menu dont on ignore le contenu est un aveu.

**Celui de la conversation.** Aujourd'hui il contient **une seule entrée** — *Détails*
(`ConversationPage.tsx:965`). Un menu pour un item : c'est le pire des cas, et ça
justifiait ta question. Dans la proposition il en porte **quatre** : signet, renommer,
archiver, supprimer — qui n'existent aujourd'hui **que** dans le menu de la ligne de la
colonne. Ouvrir une conversation et ne pas pouvoir la renommer est un trou réel ; ce
menu le bouche. Et *Détails* n'y est plus : elle est descendue dans le `+`.

**Celui du panneau.** Aujourd'hui, six icônes sont posées en dur dans son en-tête
(`SidePanel.tsx:263`). Dans la proposition, il n'en garde que **trois** : accoler,
plein écran, relire le répertoire. Tout le reste est sorti — la fermeture (le bouton du
fil la fait), la recherche et l'arborescence (rendues à la vue *Fichiers*).

**La règle qui en sort** : un `⋯` ne se justifie qu'entre **trois et sept entrées**.
En dessous, l'action se pose directement ; au-dessus, c'est que la zone est mal
découpée. Les deux menus proposés tiennent dans cette fourchette ; celui d'aujourd'hui,
avec son unique entrée, non.

## Ce qui reste à décider

- **La consommation** : sous l'avatar, ou un pourcentage à côté du nom au pied de la
  colonne ?
- **Relire le répertoire** : à retirer purement si l'arbre se met à jour tout seul. À
  vérifier dans le serveur avant de trancher — s'il n'y a pas de surveillance de
  fichiers, l'entrée reste nécessaire.
