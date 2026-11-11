# Page projet v2 — décisions

Prises avec Tim entre le 2026-11-09 et le 2026-11-10, en itérant le prototype de la
branche `proto/page-projet` (variantes derrière `?variant=`, jeu de démo `?demo=1`).

## Tranché

### Coque
- Onglets : **Aperçu · Activité · Board · Jalons · Tâches**. Activité et Journal fusionnent ;
  Tâches reste pour l'instant.
- Un clic sur une carte, partout hors du board, ouvre **sa session** : celle qui attend,
  sinon celle qui travaille, sinon la plus récente ; sans session, un brouillon rattaché
  à la carte (`/c/new?card=`).

### Aperçu
- Il répond à **« Où en est le projet ? »**.
- Les variantes A, B, C sont écartées pour leur rendu (pas beau, pas lisible), pas pour
  leur contenu.
- Contenu : *Ce qui t'attend* (bande fine) · **les jalons en bloc phare** (le courant en
  grand, les suivants en file) · *Code en cours* · *Derniers événements*.
- Style : à départager sur quatre variantes (`dense`, `tuiles`, `visuel`, `combo`).

### Jalons
- **Pas de niveau Vision.** Des jalons seuls sous le projet, et au plus une **phrase de
  cap** facultative dans les réglages, affichée en tête de l'horizon et donnée à l'agent
  d'affinage.
- Une barre de Gantt va de la **création de la carte** à son échéance ; sans échéance,
  jusqu'à aujourd'hui, en pointillé. Le futur non lancé se range en **vagues sans dates**
  (Ensuite / Plus tard).
- Maturité d'un jalon : Idée → À affiner → Découpé → Prêt → Lancé → Livré.
- Les dépendances (`blockedBy`) se montrent partout : Gantt et graphe.
- L'onglet s'ouvre sur l'**horizon**, avec une bascule **« Gantt détaillé »** qui déplie
  toutes les cartes sur l'axe.
- La page d'un jalon part de **`jalon-v2`**, avec des retouches à préciser.

### Parcours d'un jalon
1. Ajouter : « idée : … » en conversation (skill `ranger-une-idee`) ou *+ Jalon*.
2. Affiner : une session sur la carte du jalon pose ses questions, puis découpe par
   `propose_cards`. Les « questions en attente » sont cette session qui t'attend.
3. Préciser les cartes (« à préciser », acceptation).
4. Prêt : pas de cycle, rien à préciser, tout accepté, une carte au moins peut partir.
5. Lancer : **à la main** ou **autonome** — le lancement en sandbox est une option, pas
   une obligation. L'emplacement (hôte ou dev container) vient du réglage du projet ;
   le lancement règle le **confinement**, coché d'office en autonome (#146).
6. Pendant : seuls les blocages reviennent ; pause et arrêt.
7. Résolution : Solera ouvre la PR de la branche du jalon vers la branche par défaut,
   que Tim fusionne.
- À la main, les cartes livrent aussi dans la **branche du jalon**.
- Une carte ajoutée à un jalon lancé **entre dans la file** (déjà le cas :
  `adoptNewChildren`).
- On peut **changer de mode en cours de route** (le pilotage adopte les sessions
  ouvertes ; repasser à la main = pause ou arrêt).

### Idées
- Skill `ranger-une-idee` : déclenché par « idée : … », ou en passant (« … : je la range
  comme idée ? »). Classe en déjà là / petite tâche / ajout à un jalon / nouveau jalon /
  trop flou, et propose toujours par `propose_cards`.
- Les skills écrits pour Solera seront livrés par une source préconfigurée du dépôt :
  carte #156.

### Détail d'une carte hors du board
- Une icône « ℹ » sur chaque carte ouvre le **tiroir du board sur place**, par-dessus la
  vue, sans la quitter.

### Marqueur « jalon »
- Un **drapeau « jalon »** sur la carte : coché d'office dès qu'elle a des enfants,
  cochable à la main avant. C'est lui qui fait exister la maturité *Idée*.

### Activité (fusionnée avec le Journal)
- **Le vivant, puis l'historique** : en haut les sessions qui vivent (à toi, à relire, en
  cours), dessous l'historique par jour, filtrable par nature.

### Réglages du projet
- **Quatre sections** : Général (nom, chemin, image, couleur, cap, environnement) ·
  Agents (consignes, mémoire, skills) · Intégrations (forge, issues, design system) ·
  Zone de danger. Les cartes-liens vers le board et les worktrees disparaissent ; la
  couleur sort du `⋯`.

### Demandes (« Ce qui t'attend »)
- **Une seule liste** : toutes les sessions qui ont besoin de Tim sont dans « Ce qui
  t'attend », étiquetées par leur jalon (« Jalon #901 ») quand elles en font partie. Dans
  le jalon, la carte concernée passe en **ambre** (repère), sans recopier la demande.
- **Réponse sur place** : chaque demande montre la question et un champ de réponse, ou
  Autoriser / Refuser, sans ouvrir le fil (l'aperçu de demande existant,
  `SessionRequestPreview`).
- La forme actuelle de la bande ne plaît pas : à refaire avec la réponse sur place.

### Aperçu (suite)
- Restent en lice : `tuiles`, `visuel`, `combo`. `dense` est écartée.
- Le **code en cours** de `visuel` (le graphe des branches) est retenu, à améliorer : un
  moyen rapide de **s'occuper d'un worktree** depuis là.
- Le **panneau latéral** qui s'ouvre au clic sur un événement (la fiche de carte) est à
  améliorer.

### Activité
- Le contenu de la fusion tient ; c'est **le rendu** qui ne va pas.

### Activité (rendu)
- Le rendu **`fil`** (frise chronologique) est retenu, à améliorer ; ses marges doivent
  être celles des autres vues.

### Aperçu (taille des demandes)
- « Ce qui t'attend » est **trop gros** par rapport au reste : une ligne par demande, la
  réponse ne se déplie qu'au geste. La demande n'est pas redite dans le jalon phare
  (règle « une seule liste »).

### Onglet Code (nouveau, à prototyper)
- Tim n'a aucun endroit pour voir **tous ses worktrees** : la place qu'ils prennent, ceux
  qui sont fusionnés, s'il reste du travail dessus. Les **branches git** y sont à tester
  dans le même onglet.

### Gouttière unique
- Bande, rangée d'onglets, barre d'outils et contenu partent du **même bord** : 16 px,
  24 px à partir de `md`. La rangée retranche le `px-1` des onglets pour que leurs icônes
  tombent sur ce bord. Les tiroirs et le panneau gardent leurs propres marges.

### Variantes retenues (2026-11-11)
- **Tableau** : `une-ligne` (barre sur une ligne : recherche, Filtrer ▾, Affichage ▾ avec
  Kanban / Liste / Par geste, + Carte).
- **Travail** : `une-ligne` (Filtrer ▾, Affichage ▾ avec Par arbre / Par moment / Tableau /
  Graphe / Par état / Frise, Nettoyer, + Session).
- **Jalons** : `vues` (une page, Horizon / Gantt dans la barre, + Jalon).
- **Réglages** : `page-gauche`.
- **Planifiées (page globale)** : `v2`, vues **Lanceur · Agenda · Liste** (la Liste = l'ancienne Santé).
- **Jalons** : `flux-v2` (composer « + Jalon ») et page d'un jalon `jalon-v3`. Les autres variantes sont retirées des sélecteurs.

### Largeur des pages
- **Toutes les vues du projet prennent toute la largeur**, sans colonne plafonnée ni
  couloir centré (Aperçu, Travail, Actions, Réglages…). Seuls les textes à l'intérieur
  d'une ligne peuvent être bornés, pour garder les gestes près de leur contenu.

### Bande du projet
- **Plus de pastille de branche** : elle montrait la branche extraite dans le dossier du
  projet (la racine), un détail sans sens à l'échelle du projet. La racine et sa branche
  se lisent dans Travail.
- Plus de `⋯` : Réglages devient un onglet, à droite de la rangée.

### Menu ⋯ d'un projet dans la sidebar
- Plus de couleurs (elles vivent dans Réglages › Général). Il mène directement à chaque
  onglet, dans l'ordre de la rangée (Aperçu, Travail, Tableau, Jalons, Actions), puis
  Réglages et Renommer.

### Board
- L'onglet s'appelle **« Tableau »** en français (le mot de Trello et de Jira). L'adresse
  `/board` et le code ne changent pas.
- **« Découper en cartes » disparaît** : le découpage passe par « idée : » en
  conversation et par la page d'un jalon.
- **Plus d'action de vue dans la rangée d'onglets** : « + Carte » va dans la barre
  d'outils du tableau, « + Tâche » dans l'en-tête des Planifiées.
- **Plus de panneau de droite sur le board** : ni bouton pour l'ouvrir, ni panneau. Le
  diff de la branche par défaut, qui n'a pas de session où s'ouvrir, s'ouvre depuis
  Travail (ou Code), appelé par le geste « Diff ».

### Actions du projet
- Ce sont des **raccourcis** : un bouton qui lance une commande (tâche ou service).
  Le lanceur ⚡ passe dans la bande du projet, sur toutes ses pages.
- Un endroit pour **toutes les voir** et une meilleure UI d'ajout : à prototyper
  (Réglages › Actions).
- Planifiées : « Lancer maintenant » n'emploie plus l'éclair, qui est celui des actions.

### Panneaux latéraux
- **Deux familles seulement.** Le *panneau* (git, fichiers, terminal) est ancré et pousse
  le contenu. Le *tiroir* (fiche de carte, gérer les actions, éditeurs) passe par-dessus.
  Même géométrie pour les deux : sous la rangée d'onglets jusqu'en bas, bord gauche fin,
  sans coins arrondis ; le tiroir a une ombre légère, une seule largeur, le même en-tête,
  et se ferme par Échap ou un clic dehors.

### Onglet Actions (fusion des actions et des tâches planifiées)
- Un onglet **Actions** remplace Planifiées : Aperçu · Travail · Tableau · Jalons ·
  Actions … Réglages.
- Une action = **Quoi** (*Commande* : tâche ou service ; *Agent* : un prompt confié à un
  CLI) × **Quand** (*À la demande* et/ou *Planifiée*). On peut planifier une commande.
- Chaque action montre ses deux faces : étiquette Commande/Agent et « À la demande » ou
  sa cadence. L'éditeur suit le même ordre : Quoi, puis Quand.
- L'onglet montre aussi **ce qui tourne** (services actifs, commandes en cours, passages
  planifiés en cours). Le ⚡ de la bande reste le lanceur rapide, avec « Tout voir ».
- À prévoir côté serveur : un historique des passages pour les commandes planifiées. Le
  service planifié (démarrer/arrêter à heure fixe) reste un cas limite.

### Commit ↔ session (Graphe de Travail)
- Le tiroir d'un commit montre ses sessions (celle qui l'a écrit si le serveur le sait,
  puis celles du worktree, puis celles de la carte), avec « Ouvrir la session » et la
  réponse sur place ; chaque provenance déduite est marquée.
- **Côté serveur, retenu** : une route qui retrouve le **tour** d'un commit dans les points
  de reprise (`refs/solera/checkpoints/<fil>/<tour>/before|after`) et rend la conversation,
  le numéro de tour et le message. **Écarté** : le trailer `Solera-Session` dans les
  commits, qui écrirait dans le dépôt de l'utilisateur. En repli, `ThreadRefDto` peut
  porter plusieurs candidats quand les dates se recoupent.

### Un seul comportement de panneau par page
- **Jamais deux panneaux à droite en même temps.** Sur une page qui a déjà le panneau
  (une conversation), un détail s'ouvre **dans le panneau**, en pile (« ‹ Actions » pour
  revenir), jamais dans un tiroir à côté. Sur une page sans panneau (les onglets d'un
  projet, le portefeuille), le détail s'ouvre dans le tiroir commun.
- L'Aperçu du portefeuille n'a pas de barre recherche / Filtrer / Affichage.

### Le ⚡ est retiré ; comptes à trois tons (2026-11-11)
- Le lanceur ⚡ quitte la bande d'un projet et l'en-tête d'une conversation : l'onglet
  Actions (du projet, ou du panneau) est à un clic et tient tout.
- Ce qu'il disait est repris : **compte de l'onglet Actions** = ambre « N à relire »
  d'abord, sinon vert « N en marche » (services en marche + processus lancés par les
  sessions du projet) ; dans une conversation, le **bouton du panneau** porte un point
  (ambre s'il y a à relire, sinon vert si quelque chose tourne) ; la ligne d'outils des
  deux onglets Actions affiche « N en marche » / « N à relire », cliquables vers le
  groupe concerné.
- **Règle des comptes d'onglet, trois tons** : gris = inventaire, ambre = ce qui
  t'attend, vert = ce qui tourne.

## Ouvert
- Choix final entre `tuiles`, `visuel` et `combo`.
- Onglet Code : périmètre (worktrees seuls, ou aussi les branches) et place dans la rangée.
