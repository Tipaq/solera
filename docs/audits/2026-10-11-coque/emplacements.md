# Où va chaque chose — la carte des emplacements

Écrit le 2026-10-11, après quatre tours de maquettes. Les images disaient *à quoi ça
ressemble* ; ce document dit **où chaque écran et chaque commande habite**, et pourquoi.
C'est lui qu'il faut valider avant de redessiner : tant qu'une action peut vivre à trois
endroits, chaque maquette sera fouillie par construction.

## La règle : six emplacements, et un seul par chose

| emplacement | ce qu'il accepte | ce qu'il refuse |
|---|---|---|
| **La bande du haut**, segmentée par zone | chaque segment porte ce qui appartient à sa zone : logo et repli au-dessus de la colonne, titre + `⋯` + bouton du panneau au-dessus de la conversation (le bouton **au bout**, contre le panneau), les vues au-dessus du panneau | qu'un segment porte ce qui relève d'une autre zone |
| **La colonne de gauche** | **naviguer** et **créer** : une ligne par objet, un `+` par section, un `⋯` au survol d'une ligne | les actions globales, les réglages d'affichage, tout ce qui n'ouvre rien |
| **Le rail du panneau** (bord droit) | **les vues** du panneau, groupées par famille, et un seul `⋯` pour les actions de la vue affichée | des actions qui ne sont pas des vues |
| **La palette** (`Ctrl K`) | **tout**, sans exception : tout écran, tout objet, toute commande | rien |
| **Les menus contextuels** | ce qui agit sur **la ligne** qu'on désigne | ce qui agit sur l'application |
| **Les modales** | la **configuration** et la **consultation** : réglages, consommation, détails, consignes | un travail qui dure — éditer, lire un diff, tenir un terminal : ça va au centre ou au panneau |

Trois conséquences qui tranchent des cas précis :

1. **Une action n'a qu'un domicile.** Le seul doublon autorisé est entre son domicile et
   la palette — qui, elle, atteint tout. C'est ce qui permet de garder les barres vides.
2. **Ce qui est rare ou dangereux quitte la barre** pour le `⋯`. Compacter une
   conversation efface un contexte : ce n'est pas un bouton qu'on frôle.
3. **La palette doit vraiment tout atteindre.** Aujourd'hui elle ne cherche que les
   conversations et les messages (`apps/web/src/components/CommandPalette.tsx`) : il faut
   y ajouter les projets, les notes, les réglages, les services, les planifications, les
   skills, et les commandes elles-mêmes. Sans ça, la règle 1 enferme des fonctions.

## Tous les écrans d'aujourd'hui, et par où on y arrive

| écran | aujourd'hui | dans la coque proposée |
|---|---|---|
| Accueil (`/`) | logo, ou racine | disparaît : on rouvre là où on était. La palette et la colonne suffisent |
| Conversation (`/p/:id/c/:cid`) | colonne | **centre**, titre dans la barre du haut |
| Brouillon (`/p/:id/c/new`) | `+` d'un projet | **centre**, identique à une conversation |
| Board (`/p/:id/board`) | ligne du projet | **centre**, ligne *Board* sous le projet |
| Carte du board | clic sur une carte | **modale** (inchangé) |
| Planifications (`/p/:id/schedules`) | ligne du projet | **centre**, ligne *Planifiées* sous le projet |
| Page projet (`/p/:id`) | clic sur le projet | **centre** ; sa ligne se déplie en colonne, son nom ouvre la page |
| Nouveau projet (`/projects/new`) | lien de la colonne | **modale**, depuis le `+` de la section *Projets* |
| Services (`/services`) | pied de colonne | **centre**, pied de colonne et palette |
| Réglages (`/settings/*`, 14 sections) | pied de colonne, **seconde colonne de 14 rem** | **modale** à deux volets : la seconde colonne disparaît |
| Éditeur de skill (`/skills/:id`) | depuis les réglages | **centre** en pleine largeur, colonne repliée |
| Consommation | pastille de la barre | **modale**, depuis la jauge |
| Détails de la conversation | `⋯` | **modale** (inchangé) |
| Consignes | icône de la barre | **modale**, depuis le `⋯` |
| Recherche dans le fil | icône de la barre | reste une **icône de barre** : c'est l'objet ouvert qu'elle fouille |
| Compacter | icône de la barre | passe au **`⋯`** |
| Vue d'ensemble de l'activité | **quatre boutons** | **une ligne**, trois compteurs, une modale à trois onglets |
| Recherche globale | `Ctrl K` | **la palette**, élargie à tout |
| Panneau : fichiers, git, historique, terminaux, agents, MCP | onglets à plat | **rail du panneau**, trois familles |
| Ouverture rapide (`Ctrl P`) | icône du panneau | **la palette**, filtrée au répertoire |

## Les écrans du savoir, à créer

| écran | emplacement |
|---|---|
| Une note | **centre**, comme une conversation ; son titre dans la barre du haut |
| L'arbre du vault | **section *Savoir*** de la colonne |
| Liens entrants, notes voisines, chat du vault | **vue *Savoir*** du panneau droit |
| Recherche dans le vault | **la palette** |
| Historique d'une note (git) | **vue *Historique*** du panneau, la même que pour le code |
| Permissions d'écriture par dossier | **modale**, depuis le `⋯` d'un dossier et depuis les réglages |
| Boîte des agents (ce qu'ils proposent) | **section de la colonne**, avec un compteur |

## Les icônes, zone par zone

**Barre du haut** — identité à gauche (logo, puis l'objet : icône, puce de projet,
titre), actions à droite. Jamais plus de six éléments.

| objet ouvert | ce que la barre porte |
|---|---|
| conversation | `⋯` · bouton du panneau (scindé : ouvrir / choisir la vue) |
| note | état d'écriture (bouclier) · liens · `⋯` · panneau |
| board | filtre · nouvelle carte · `⋯` · panneau |
| réglages, services, page projet | `⋯` seul, ou rien |

Le `⋯` d'une conversation : renommer, archiver, partager, supprimer. Révision du
2026-10-11 — la barre a été vidée de quatre choses qui n'y avaient pas leur place :

| ce qui quitte la barre | où ça va | pourquoi |
|---|---|---|
| Chercher dans le fil | **`+` du composer** | ça fouille la session, comme les skills et les serveurs qui y sont déjà |
| Détails de la conversation | **`+` du composer** | même raison, et c'est une consultation rare |
| Consignes | **réglages du projet** | ce sont les consignes du dossier, pas de la conversation : les éditer depuis un fil laissait croire qu'elles lui appartenaient |
| Compacter | **modale du contexte** (déjà fait) | la jauge dit l'état, la modale porte le geste qui le change |
| Consommation | **menu du compte**, au pied de la colonne | elle appartient au compte : le chiffre est le même quel que soit le fil ouvert |

**Colonne de gauche** — rechercher (ouvre la palette), la ligne d'activité, puis les
sections. Un `+` par section, un `⋯` par ligne au survol. Quittent la colonne :
*rafraîchir* (automatique, et dans la palette), *mode détaillé* (réglages d'apparence),
*tous les projets* (c'est le dépli de la section).

**Le panneau** — aucun chrome : il n'est que son contenu. Ses vues se choisissent par
**six icônes dans la barre du haut**, à côté du bouton du panneau, et elles n'y
apparaissent que quand il est ouvert. Deux familles séparées d'un trait : Travail
(fichiers, git, terminaux) · Session (historique, agents) · et la note liée. Raccourcis
`⌥1`…`⌥6`.

Le rail vertical du cinquième tour est abandonné : une colonne d'icônes contre le bord
d'un panneau qui flotte au milieu de l'écran se lit mal, et elle coûtait 2,75 rem en
permanence.

**Les serveurs MCP ne sont plus une vue du panneau.** Ils étaient à deux endroits — une
vue et une entrée du `+` — pour une seule fonction, dont une moitié ne servait qu'à
regarder. Tout est dans le `+` : la liste avec l'état, la portée, le nombre d'outils et
l'interrupteur de session ; *Ajouter* et *Gérer* ouvrent une modale (`final/clair/13-v-mcp`), qui
est le seul endroit où l'on écrit une commande ou une variable.

**Composer** — inchangé, il a déjà été tranché (`docs/audits/2026-10-11-composer-une-ligne/`).

## Ce qui disparaît

- l'accueil, la seconde colonne des réglages, l'en-tête du panneau, le rail d'espaces du
  troisième tour, le bouton *tous les projets*, le *mode détaillé* de la colonne, les
  trois boutons d'activité en doublon, et la bascule de mode code/écriture ;
- `md:pl-14` dans quatre vues : la barre du haut est unique, le bouton de réaffichage de
  la colonne y a sa place.
