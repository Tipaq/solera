# La coque — décisions du 2026-10-11

Dix-huit tours de maquettes avec Tim, sur la barre du haut et le panneau droit. Les
images des tours intermédiaires ont été supprimées le 2026-10-11 : elles ne servaient
qu'à choisir, le choix est fait, et une planche périmée se confond vite avec la bonne.

**Ce qui est arrêté est dans [`final/`](final/README.md)** — treize écrans au large,
cinq au téléphone, clair et sombre. Rendues par `scripts/shell-prototypes.mjs` depuis
`apps/web/src/components/ShellPrototypes.tsx`, l'un et l'autre **jetables**, à supprimer
quand ce sera porté.

Les trois documents qui portent le raisonnement :

| | |
|---|---|
| [emplacements.md](emplacements.md) | la carte des emplacements : six zones, un domicile par chose, et où va chaque écran d'aujourd'hui |
| [icones.md](icones.md) | chaque icône au crible : ce qui manquait, ce qui pesait sans rien dire, ce qu'il y a sous les menus |
| [comparatif.md](comparatif.md) | fonction par fonction, en gestes, ce que la proposition gagne et ce qu'elle perd |

## Ce qui n'est pas tranché

- **La colonne de gauche.** Jamais dessinée au-delà d'esquisses, volontairement : elle
  fera l'objet d'une session à elle.
- **Le contexte Savoir** (une note du vault) : seule sa barre est arrêtée. Ses vues de
  panneau, son éditeur, les permissions par dossier, l'emplacement du vault — tout cela
  attend, et attend d'abord la colonne de gauche, qui portera l'arbre des notes.
- **Le fil libre** (ni dépôt ni vault) : sa barre est dessinée, le geste *Ranger…* et ses
  destinations restent à spécifier.

Les trois contextes ne sont pas des modes qu'on bascule : c'est l'objet ouvert qui
décide. La coque est commune ; seuls le centre et les vues du panneau changent.
