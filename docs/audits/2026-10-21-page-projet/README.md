# La page d'un projet : l'activité, les worktrees, le jalon lancé

Carte #73, dans le jalon #75. **Arrêté le 2026-10-25.** Le jeu final est dans
[`final/`](final/), en clair et en sombre. Les images du tour 1 n'ont pas été versées :
elles ne servaient qu'à choisir, comme pour #31.

Source d'inspiration : l'agent view de Claude Code (https://code.claude.com/docs/en/agent-view).

## Ce que Tim a tranché avant les images (2026-10-21)

1. On ouvre sur l'**Aperçu enrichi**. Il renvoie vers un onglet **Activité** complet.
2. **Une seule** vue Activité, avec deux regroupements : par état et par worktree. Pas
   d'onglets Worktrees ni Branches à part.
3. La vue tous projets confondus vit dans le **portefeuille**.
4. Le jalon lancé (#72) se voit **à trois endroits** : en tête de l'Activité, dans sa
   propre vue et dans la Chronologie.

## Les planches du tour 1

| | ce que la planche met en jeu |
| --- | --- |
| **A1** | l'Aperçu garde ses tuiles et gagne « En ce moment » |
| **A2** | « En ce moment » remplace les tuiles : une question = une ligne et un bouton |
| **B1** | Activité par état : te demande quelque chose · prête à relire · en cours · terminées |
| **B2** | la question ou la permission dépliée sous sa ligne, avec la réponse sans ouvrir le fil |
| **B3** | Activité par worktree : la racine, les worktrees habités, puis ceux sans session (nettoyage) |
| **B4** | l'anatomie de la ligne en huit colonnes, et les cinq états de PR |
| **C1** | le bandeau du jalon lancé en tête de l'Activité, avec un groupe pour ses sessions |
| **C2** | la vue du jalon : ses cartes rangées par vague de dépendances, et la file |
| **C3** | la ligne du jalon dans la Chronologie, avec l'état d'exécution de ses cartes |
| **D1** | l'Activité du portefeuille, avec une colonne Projet |
| **E1** | l'Activité au téléphone, en 390 px |

Les données sont réelles quand elles existent : 19 worktrees, dont 5 fusionnés, et un
dossier absent du disque. Les sessions et les PR sont plausibles, pas relevées.

## Les partis pris des images

- **Les erreurs remontent avec les attentes.** Dans l'agent view, une session échouée va
  dans « Completed ». Ici, elle te demande d'agir, au même titre qu'une question.
- **« Prête à relire »** regroupe les PR ouvertes et les cartes en *À vérifier*.
- **L'aperçu se déplie dans la liste**, sans tiroir latéral : un tiroir cacherait les
  colonnes worktree et PR.
- **« Chronologie » devient « Jalons »**, et la vue d'un jalon (C2) vit sous cet onglet.
  On reste à six onglets : Aperçu · Activité · Board · Planifiées · Jalons · Journal.

## Tranché sur les images du tour 1 (2026-10-25)

1. **A1** : l'Aperçu garde ses quatre tuiles, et le bloc « En ce moment » vient dessous.
   A2 est écarté.
2. **Les erreurs remontent avec les attentes**, dans « Te demande quelque chose ».
3. **« Chronologie » devient « Jalons »**, et la vue d'un jalon (C2) vit sous cet onglet.

4. **Travail se fond dans l'Activité du portefeuille.** Une carte qui réclame quelqu'un
   sans qu'aucune session la porte y entre comme une ligne de carte, dans le groupe de ce
   qu'elle demande. Le portefeuille garde cinq onglets : Projets · Activité · Board ·
   Jalons · Journal.
5. **« Fusionnée » prend le ton de la boucle** (`--color-loop`). On n'ajoute pas de jeton.

## Le jeu final — `final/`

A1 · B1 · B2 · B3 · B4 · C1 · C2 · C3 · D1 · E1, comme au tour 1, avec ces changements :
A2 est retiré, et D1 n'a plus d'onglet Travail mais gagne une ligne de carte sans session.

## Ce que le dessin suppose côté serveur (relevé le 2026-10-25, sur `main`)

- **L'état des worktrees existe** depuis #78 (`ed78d11e`). `WorktreeState` vaut
  `missing | unreadable | dirty | unmerged | empty | merged` et se juge sur le contenu.
  Les arbres créés à la main sont connus, le lien « a travaillé dans » aussi, et le
  nettoyage se fait en un geste. **B3 en est la vue** : le regroupement par worktree
  reprend `WorktreeStatusDto` et les gestes de `WorktreeBoard`, il ne les refait pas.
- **Le worktree disparu** est réglé par #61 (`0ef96070`). B3 montre le même état.
- **Le résumé d'une ligne** n'existe pas : `ConversationDto` n'a pas de champ pour lui.
  L'agent view le fait écrire par un modèle de la classe Haiku.
- **La question en attente** ne remonte pas au niveau de la liste, qui ne voit que
  `status === 'awaiting_input'`. Le texte est dans le journal du fil
  (`question.requested`, `permission.requested`). Les routes pour répondre existent.
- **La branche d'une session** ne remonte pas dans la liste non plus : il faut un
  `GET .../git/head` par fil. Le lien conversation → arbre de #78 peut la donner d'un coup.
- **Les PR** n'existent nulle part : c'est la carte #68.

## Les cartes de portage, ouvertes le 2026-10-25 dans le jalon #75

| | sujet | planches | attend |
| --- | --- | --- | --- |
| **#110** | l'onglet Activité groupé par état, la ligne de session, et « Chronologie » qui devient « Jalons » | B1, B4, E1 | — |
| **#111** | le regroupement par worktree, qui reprend la vue Chantiers des réglages | B3 | #110 |
| **#112** | la question en attente qui remonte dans la liste, dépliée sous sa ligne avec la réponse | B2 | #110 |
| **#113** | le résumé d'une ligne, écrit par un petit modèle | colonne ④ | #110 |
| **#114** | le bloc « En ce moment » de l'Aperçu | A1 | #110 |
| **#115** | le badge de PR sur la ligne et sur l'en-tête de worktree | B1, B3, B4 | #110, #68 |
| **#116** | le jalon lancé : le bandeau, la vue du jalon, la frise | C1, C2, C3 | #110, #72 |
| **#117** | l'Activité du portefeuille, où Travail se fond | D1 | #110 |

Les cartes voisines :
- #74 (l'onglet Agents du panneau) reprend la même ligne de session à l'échelle d'un fil ;
- #95 (l'état des sessions dans la colonne) doit garder la charte des points de B4.

## Les maquettes

Elles étaient rendues par `apps/web/src/components/ProjectActivityPrototypes.tsx` et
`scripts/projet-prototypes.mjs`, deux fichiers jetables. Ils sont versés par le premier
commit de la branche `design/page-projet` et retirés par le second. Pour les rejouer,
on les rétablit depuis le premier commit et on lance :

```sh
LD_LIBRARY_PATH=$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu node scripts/projet-prototypes.mjs
```
