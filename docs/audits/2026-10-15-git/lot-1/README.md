# Lot 1 — le socle en lecture, tel qu'il rend

Carte #29, lot 1. Ces images **ne sont pas des maquettes** : elles sortent de
`pnpm test:git-ui`, qui monte le vrai serveur, la vraie interface et un vrai dépôt —
celui du projet de démo, enrichi d'une fusion, d'une étiquette, d'une remise et d'un
commit co-signé par un agent. Ce qu'on y voit est ce que le code produit.

Une image par vue, parce qu'une planche entière est illisible sans zoom.

| image | ce qu'elle montre |
| --- | --- |
| `graphe-22rem` | le minimum accosté : Graphe et Message, une seule étiquette, la barre d'outils en icônes seules — et le rail, qui coûte ses 44 px |
| `graphe-40rem` | la largeur par défaut : Date et Auteur sont entrés |
| `graphe-60rem` | tout est entré, **la colonne Fil comprise** — celle que GitKraken ne peut pas avoir |
| `commit-selectionne` | l'agent qui l'a écrit, la date, le sha, le parent, les branches qui le contiennent, le fil, et le diff |
| `branches` | Local, Worktrees **avec le fil qui les occupe**, Distant, Étiquettes, Sous-modules — les deux sections vides restent et disent qu'elles sont vides |
| `en-cours` | ce que l'onglet Git montrait déjà, en lecture : indexer et commiter sont le lot 2 |
| `recherche` | le graphe filtré, par message et par « écrit par un agent » |

Les trois largeurs ne sont pas une coquetterie : les paliers de colonnes sont des
**requêtes de conteneur**, donc ils ne se vérifient pas à l'œil sur une seule image.
La suite les mesure à chaque fois — Date à `@28rem`, Auteur à `@36rem`, Sha à `@46rem`,
Fil à `@56rem`.

Le palier de 60 rem est pris dans une fenêtre plus large : un panneau accosté ne peut
pas dépasser ce que la coque lui laisse, soit 760 px dans une fenêtre de 1 440. Ce qui
décide reste la largeur du **panneau**, et c'est précisément ce que ce palier démontre.

## Ce qui n'est pas là

*Remises* et *Historique d'un fichier* sont dans le rail et renvoient à leur lot. La
destination *Conflits* n'existe pas encore : elle ne doit apparaître que pendant un
conflit, et la détection comme l'éditeur sont le lot 3. La barre d'outils est dessinée
et inerte, pour qu'elle ne change pas de forme quand le lot 2 arrivera.
