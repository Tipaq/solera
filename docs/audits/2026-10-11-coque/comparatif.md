# Ce qu'on gagne, ce qu'on perd

Comparaison fonction par fonction entre l'interface d'aujourd'hui et la coque des
images `final/`. « Gestes » compte les clics depuis une conversation ouverte, au
pointeur ; un raccourci clavier compte pour zéro clic mais il faut le connaître.

## Le travail quotidien — ce qui ne doit rien perdre

| fonction | aujourd'hui | proposé | verdict |
|---|---|---|---|
| Ouvrir les fichiers | 1 (onglet du panneau, panneau déjà ouvert) ou 2 | 1 (rail) ou `⌥1` | **égal**, et un raccourci en plus |
| Ouvrir le diff git | 1 ou 2 | 1 (rail) ou `⌥2` | **égal** |
| Ouvrir un terminal | 1 ou 2 | 1 (rail) ou `⌥3` | **égal** |
| Passer de l'un à l'autre | 1, mais la bande défile au doigt et les onglets bougent de place | 1, position **fixe** : les trois du travail sont toujours en haut du rail | **gagné** |
| Ouverture rapide d'un fichier | icône du panneau, onglet Fichiers requis | `Ctrl P` ou palette, depuis n'importe où | **gagné** |
| Arborescence, rafraîchir | 2 icônes dans l'en-tête du panneau | `⋯` du rail (+1 geste) | **perdu**, assumé : deux icônes permanentes pour un geste rare |
| Élargir / plein écran du panneau | 2 icônes dans l'en-tête | `⋯` du rail, ou glisser la poignée | **perdu léger** |
| Historique, agents, MCP | onglets mêlés aux trois précédents | deuxième famille du rail, séparée d'un trait | **gagné** : on ne les confond plus |

## La navigation

| fonction | aujourd'hui | proposé | verdict |
|---|---|---|---|
| Retrouver un fil | colonne, ou `Ctrl K` | identique | **égal** |
| Voir ce qui tourne | 5 contrôles, 3 onglets, 2 doublons | 1 ligne, 3 compteurs, la même modale | **gagné** |
| Passer d'un projet à l'autre | switcher **et** liste des projets | une seule liste, les projets se déplient | **gagné** |
| Board, planifications | lignes du projet | identique | **égal** |
| Signets | section dédiée | section dédiée, masquable | **égal** |
| Archivées | ligne par projet | identique | **égal** |
| Conversations sans projet | impossible | section *Mes fils* | **nouveau** |
| Notes du vault | impossible | section *Savoir* | **nouveau** |
| Accueil (`/`) | page de départ | supprimé : on rouvre là où on était | **perdu**, mais la page listait ce que la colonne montre déjà |
| Rafraîchir les listes | bouton dans la colonne | automatique, et dans la palette | **perdu léger** |
| Mode détaillé (tours, octets, contexte sous chaque ligne) | bouton dans la colonne | réglage d'apparence | **perdu** : 3 gestes au lieu d'un, pour un affichage qu'on choisit une fois |

## L'objet ouvert

| fonction | aujourd'hui | proposé | verdict |
|---|---|---|---|
| Consommation | pastille de l'en-tête | identique | **égal** |
| Consignes | icône | identique | **égal** |
| Chercher dans le fil | icône | identique | **égal** |
| Compacter | icône | `⋯` (+1 geste) | **perdu**, voulu : une action qui efface du contexte ne se frôle pas |
| Détails | `⋯` | identique | **égal** |
| Ouvrir / fermer le panneau | icône tout à droite | identique | **égal** |
| Réglages | page, **avec une seconde colonne de 14 rem** | modale à deux volets, par-dessus ce qu'on faisait | **gagné** : on ne quitte plus la conversation |
| Éditeur de skill | page | centre, pleine largeur | **égal** |
| Services | page | identique | **égal** |

## Le compte des barres

| | aujourd'hui | tours intermédiaires | retenu |
|---|---|---|---|
| barres horizontales | 2 à 4 selon la vue, **aucune de la même hauteur** | 4 | **1** |
| colonnes de navigation | 1 (2 dans les réglages) | 2 | **1** |
| endroits où chercher une commande | colonne, en-tête de vue, en-tête de panneau, composer, `⋯` | 5 | **4** : barre, colonne, rail, palette |

## Ce qu'on perd vraiment, en une phrase

Trois gestes deviennent plus longs — compacter, l'arborescence et son rafraîchissement,
le mode détaillé — et une page disparaît (l'accueil). Tous les quatre sont rares ou
redondants ; aucun ne touche le travail quotidien, qui est servi à l'identique ou mieux.

**Le risque restant** n'est pas un geste perdu, c'est le `⋯` : s'il devient le tiroir où
l'on range ce qu'on n'a pas su placer, on aura déplacé le fouillis au lieu de le retirer.
Règle à tenir : **sept entrées maximum par `⋯`**, et au-delà, c'est que la zone est mal
découpée.

## Le réglage *Affichage* (image `R4`)

Il n'est pas là pour rattraper un mauvais rangement, mais pour une raison précise :
**le même produit sert à coder et à tenir un savoir**, et personne ne fait les deux dans
les mêmes proportions. Chacun retire ce qu'il n'utilise pas — une section de la colonne,
une vue du rail — et ce qui est retiré **reste joignable par la palette**. C'est ce qui
permet de proposer sept vues de panneau sans encombrer celui qui n'en veut que trois.
