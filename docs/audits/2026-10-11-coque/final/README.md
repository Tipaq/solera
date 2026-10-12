# Ce qui est arrêté

Gros plans, sans la colonne de gauche : elle n'est pas encore dessinée, et la faire
figurer ici laisserait croire qu'elle l'est. `clair/` et `sombre/`.

| | |
|---|---|
| `01-v-barre-travail` | la barre, contexte Travail : identité à gauche (projet au-dessus, titre dessous), branche et signal à droite, bouton du panneau au bout. Aucun menu « ⋯ » |
| `02-v-barre-contextes` | la même en contexte Savoir (une note) et sur un fil libre — **la barre seulement ; le contexte Savoir n'est pas arrêté** |
| `03-v-barre-etats` | les quatre états : repos, tour en cours, attente, hors ligne |
| `04-fichiers-final` | Fichiers : arbre (dossier, +fichier, +dossier, relire, replier), onglets, et leur « ⋯ » à la VS Code |
| `05-recherche-contenu` | Recherche : par nom **et** par contenu, options, inclure/exclure, résultats groupés |
| `06-v-panneau-git` | Git : l'état du dépôt, les fichiers, le diff, les commits |
| `07-v-panneau-terminaux` | Terminaux : onglets, sortie, répertoire et branche en pied |
| `08-v-panneau-agent` | Agent : sous-agents, travaux de fond, **ses écritures** (ce qui était l'onglet Historique) |
| `09-image-visionneuse` | une image : ajuster / 100 % / largeur, zoom, molette, glisser, arbre replié d'office |
| `10-image-plein-ecran` | la même, sortie de la coque |
| `11-bande-adaptative` | les vues portent leur nom tant qu'il y a la place ; sous 30 rem elles tombent toutes ensemble |
| `12-v-composer-plus` | le `+` du composer : chercher dans le fil, détails, skills, MCP, réglages de la session |
| `13-v-mcp` | les serveurs MCP : la liste dans le `+`, l'écriture dans la modale |

Le panneau Travail est arrêté à cinq vues : **Fichiers · Recherche · Git · Terminaux |
Agent**.

## Ce qui n'est pas arrêté, et ne doit pas partir en carte tel quel

**Le contexte Savoir.** Seule sa barre est dessinée ici. Tout le reste attend :

- les vues de son panneau — liens entrants, notes voisines, chat du vault, historique
  d'une note — et lesquelles méritent une icône ;
- l'éditeur de note lui-même : `[[liens]]`, insertion des passages proposés, mode lecture ;
- les permissions d'écriture par dossier, et la boîte des agents ;
- l'emplacement du vault et son indexation, qui ne sont pas des questions d'interface.

Il attend aussi la colonne de gauche : c'est elle qui portera l'arbre du vault, et on ne
dessine pas le panneau d'un objet dont la navigation n'est pas tranchée.

**Les trois contextes** — Travail, Savoir, fil libre — ne sont pas des modes qu'on
bascule : c'est l'objet ouvert qui décide. La coque (barre, colonne, panneau) est
commune aux trois ; seuls le contenu du centre et les vues du panneau changent. C'est ce
qui permet de traiter Savoir après coup sans rien remettre en cause de ce qui est arrêté.

Restent à faire, dans l'ordre : la colonne de gauche, le mobile, puis le contexte Savoir
en entier.
