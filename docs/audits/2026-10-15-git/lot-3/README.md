# Lot 3 — le cher : indexer par ligne, rebaser, résoudre, blâmer

Carte #29, lot 3. Comme celles des lots 1 et 2, ces images **ne sont pas des
maquettes** : elles sortent de `pnpm test:git-ui`, qui monte le vrai serveur, la vraie
interface et un vrai dépôt, et qui fait réellement les gestes qu'elles montrent — y
compris le rebase et le conflit, que la suite fabrique avec git lui-même.

Une image par vue, parce qu'une planche entière est illisible sans zoom.

| image | ce qu'elle montre |
| --- | --- |
| `indexer-par-ligne` | T3 : chaque bloc porte son bouton, chaque ligne modifiée sa case, et **le compteur suit la sélection** — deux lignes ici, le reste du fichier reste dehors |
| `rebase-interactif` | T9 : les quatre verbes (*reprendre · fondre · réécrire · jeter*), le plan lu du plus ancien au plus récent, et le bandeau qui dit **2 → 1** et que les tours sont suspendus pendant qu'il court |
| `conflits` | T10 : la septième destination du rail, en ambre, les trois versions empilées avec leur « prendre », le résultat **modifiable**, et *Laisser l'agent le résoudre* |
| `historique-d-un-fichier` | T12, moitié haute : « 2 commits · 1 fil », et le fil en face de chaque commit |
| `blame-par-fil` | T12, moitié basse : la colonne de droite dit **quel fil** a écrit la ligne, et « Alex Demo, à la main » quand aucun ne la revendique |

## Ce que les images ne montrent pas, et que la suite vérifie

- **Ce qui est coché est exactement ce qui est indexé.** Après le clic, la suite lit
  l'index : la ligne cochée y est, les deux autres y sont restées à leur valeur d'avant,
  et le fichier sur le disque n'a pas bougé. C'est la seule fonction du lot qui ne
  délègue pas à git — elle reconstruit un patch et l'applique avec `git apply --cached`
  — donc la seule qui puisse se tromper en silence.
- **Les deux sens du patch partiel.** Indexer et retirer inversent la règle sur les
  lignes non cochées, et se tromper ne donne pas un mauvais résultat mais un refus de
  `git apply`. `apps/server/test/git-lot3.test.ts` exerce les deux.
- **Le rebase fait ce que son plan annonçait.** La suite compte les commits avant et
  après : le commit marqué *jeter* est parti, l'autre est resté. Et côté serveur, un
  plan qui fond et réécrit garde le message du commit fondu — `fixup` seul le perdrait
  en silence, ce qui serait une perte qu'on n'a pas annoncée.
- **Un diff qui a bougé sous le clic est refusé**, pas appliqué de travers : le client
  renvoie des positions accompagnées de l'en-tête du bloc, et le serveur relit le diff
  pour le comparer. Même politique que le sha d'une remise au lot 2.
- **La destination *Conflits* disparaît** une fois le conflit résolu : la suite attend
  que l'onglet quitte le DOM, et vérifie que le côté pris est bien celui qui est passé
  à l'index.
- **On ne marque pas résolu un fichier qui porte encore un marqueur**, et le refus est
  côté serveur — commiter un `<<<<<<<` ne se voit qu'à la relecture, des jours plus tard.

## Les deux décisions que les planches ne portaient pas

- **Les tours sont suspendus dans `deliver`**, le seul passage par où un message atteint
  un CLI — route, file d'attente ou tâche planifiée. C'est le symétrique du verrou du
  lot 2, qui va dans l'autre sens.
- **« Laisser l'agent le résoudre » écrit un message dans le fil** plutôt que de lancer
  un tour caché : on sait ce qu'on a demandé, et l'agent répond dans la conversation
  comme pour n'importe quelle autre demande. Le bouton est **éteint pendant un rebase**,
  et l'écran dit pourquoi — les tours y sont suspendus, le message partirait dans le vide.

## Ce qui n'est pas là

Glisser une branche sur une autre, et le glisser-déposer qui réordonne les lignes d'un
rebase : **lot 4**, au clavier seulement. Les quatre verbes, eux, passent par le menu de
chaque ligne, qui marche aussi au doigt.
