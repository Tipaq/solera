# Lot 2 — les écritures, telles qu'elles rendent

Carte #29, lot 2. Comme celles du lot 1, ces images **ne sont pas des maquettes** :
elles sortent de `pnpm test:git-ui`, qui monte le vrai serveur, la vraie interface et
un vrai dépôt, et qui fait réellement les gestes qu'elles montrent — indexer, écrire un
message, commiter, annuler.

Une image par vue, parce qu'une planche entière est illisible sans zoom.

| image | ce qu'elle montre |
| --- | --- |
| `en-cours` | Non indexés / Indexés, l'indexation **par fichier**, le résumé et la description séparés, *Amender* et le **co-auteur** — qui désigne l'agent du fil |
| `annuler` | le bandeau de T13 : il ne dit pas « annuler » mais *quoi* il annule et *où* ça ramène, et il ajoute que rien n'a été poussé |
| `menu-d-un-commit` | les douze entrées de T5, **réinitialisations dépliées** et en rouge, et la nôtre en dernier : ouvrir le fil qui a écrit ce commit |
| `garde-fou` | ce qui ne s'annule pas demande avant, et **nomme la perte** : un fichier modifié, un commit écrit par un agent — et propose de remiser d'abord |
| `remises` | chaque remise avec l'aperçu de son contenu, sans lequel on n'ose plus dépiler, et *En faire une branche* |
| `un-tour-tourne` | les écritures fermées pendant qu'un agent travaille ici : les gestes éteints, un bandeau qui dit **quoi attendre**, et la liste des fichiers toujours à jour |

## Ce que les images ne montrent pas, et que la suite vérifie

- **Le garde-fou dit vrai.** `apps/server/test/git-write.test.ts` compare ce qu'il
  annonce à ce que le geste détruit réellement, sur un vrai dépôt : un garde-fou qui se
  trompe de chiffre est pire que pas de garde-fou, et ça ne se voit pas sur une capture.
- **Le verrou tient côté serveur.** Les boutons éteints de `un-tour-tourne` sont du
  confort ; ce qui protège le dépôt est le 409 de la route, vérifié à part.
- **Le fil se tait quand il hésite.** La fixture de la suite date maintenant ses
  commits, et pose exprès un commit à une heure où **deux** fils travaillaient au même
  endroit : la règle de rattachement doit alors ne rien dire plutôt que de choisir.

## Ce qui n'est pas là

L'indexation par bloc et par ligne, le rebase interactif (l'entrée du menu est là,
éteinte), l'éditeur de conflits et la destination *Conflits*, l'historique d'un fichier
et le blâme : lot 3. Glisser une branche sur une autre : lot 4.
