# Les skills de Solera

Ce dossier est la source préconfigurée `Tipaq/solera` de la bibliothèque de skills
(`builtin:solera-skills`, migration 0080). Chaque instance le lit au tag de sa propre
version, et en installe le contenu dans sa bibliothèque globale au premier démarrage.

## Ce qui a sa place ici

Un skill **écrit pour Solera** : il s'appuie sur ses outils MCP (`read_card`,
`propose_cards`…) ou sur son déroulé (board, jalons, sessions), et n'a pas de sens
ailleurs. Exemples : `ranger-une-idee`, `affiner-un-jalon`.

Un skill d'un autre auteur reste hors du dépôt, même s'il sert tous les jours dans la
bibliothèque de Tim (Matt Pocock, Humanlayer…) : le dépôt est public et ces skills ne
sont pas les nôtres à redistribuer. Un skill général, sans outil de Solera, n'y a pas
sa place non plus : sa source naturelle est ailleurs.

## Deux règles qui tiennent au mode de livraison

- **Un skill ne cite que ce que le même commit livre.** Une instance lit ce dossier au
  tag de sa version : un outil MCP ajouté au serveur et cité par un skill doivent partir
  dans la même release.
- **Le rang décide de l'installation d'office.** `skills/<nom>/` est installé au premier
  démarrage, puis désinstallable comme tout skill. `skills/extras/<nom>/` (tout
  sous-dossier, en fait) est seulement proposé dans le catalogue de la source. Un skill
  ajouté après le premier démarrage d'une instance y est proposé, quel que soit son rang.

Le format est celui de tout skill de la bibliothèque : un dossier par skill, un
`SKILL.md` dont le `name` est celui du dossier. Côté Claude, il s'appelle `/solera:<nom>`.
