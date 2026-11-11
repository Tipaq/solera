# Page projet v2 — Aperçu, Travail, Tableau, Réglages

Analyse d'écarts entre le prototype de la branche `proto/page-projet` (fichiers non commités
compris) et `main` (`029af4ae`), pour reproduire le prototype **1 pour 1**. Décisions de
référence : `docs/audits/2026-11-09-page-projet-v2/DECISIONS.md`.

**Domaine de ce fichier** : les quatre pages d'un projet — Aperçu (`combo`), Travail
(`une-ligne`), Tableau (`une-ligne`), Réglages (`page-gauche`) — et leurs besoins serveur.

**Hors domaine, mais dont ce fichier dépend** (traités par les autres specs du dossier) :

| Domaine | Ce que ces pages en attendent |
| --- | --- |
| Coque (`PlaceShell`) | la rangée Aperçu · Travail · Tableau · Jalons · Actions … Réglages ; les comptes à trois tons (Travail = ambre `askingCount`, Tableau = gris « feuilles ouvertes ») ; le calque des tiroirs `#proto-drawer-layer` sous la rangée ; la route `/p/:id/settings` **dans** la coque ; la gouttière 16/24 |
| Jalons | le modèle de maturité (`maturity.ts` : `horizonOf`, `nextAction`, `MATURITY_LABEL`), les vagues (`waves.tsx` : `layersOf`), le drapeau « jalon » d'une carte (`flags.ts`), `cardDestination` / `sessionOf` (`destination.ts`), la **fiche de carte** commune (`CardDrawer.tsx`, `?fiche=`), les demandes de jalon dans « Ce qui t'attend » (affinage, brouillon, PR finale), le **cap** lu en tête de l'horizon |
| Actions | `ServiceMark` (« ⚡ :5173 » : quel arbre un service sert, `prototype-automations/served.tsx`), le tiroir d'une action (`/p/:id/actions?action=`) |
| Panneau | `ProtoSidePanel` (le panneau git qu'ouvre « Diff ») ; l'onglet *Projet* du panneau réutilise `CodeGraph` et le modèle de l'Aperçu |
| Portefeuille | `/projects/travail` réutilise les vues de Travail (`prototype-portfolio/Work.tsx`) |

Conventions : un chemin `P:x` est relatif à `apps/web/src/` **dans le worktree du
prototype** ; un chemin `M:x` est relatif à `apps/web/src/` **sur main**. Chaque élément de
l'inventaire porte un identifiant (`A-…`, `T-…`, `B-…`, `R-…`) repris par les critères
d'acceptation des cartes (§7).

Tout ce qui est fuchsia dans le prototype (`DemoToggle`, « simulé », « local »,
`?demo=1`, `PrototypeSwitcher`, `PrototypeVerdict`, `TabMenuOff`) **disparaît**. Les
données de démo ne sont gardées ici que pour ce qu'elles révèlent d'un besoin serveur (§3).

---

## 1. Inventaire du prototype (checklist de recette)

### 1.A Aperçu — variante `combo`

Fichiers : `P:routes/prototype-overview/v2/{V2Overview,Combo,CodeGraph,data,parts}.tsx`,
`P:routes/prototype-overview/data.ts` (`useOverviewData`), `Events` de
`P:routes/prototype-overview/v2/Dense.tsx`, `P:components/prototype/AskInbox.tsx`,
`P:components/prototype/ProjectActions.tsx`. Entrée : `P:routes/ProjectOverviewPage.tsx`.

**A-1 Mise en page** (`Combo`)
- A-1.1 Une colonne qui défile (`h-full overflow-y-auto`), `p-4 md:p-6`, blocs espacés de `gap-10`, pleine largeur (pas de colonne plafonnée).
- A-1.2 Ordre : « Ce qui t'attend » → le phare des jalons → une grille `xl:grid-cols-[minmax(0,1fr)_24rem]` : à gauche « Code en cours » (titre `text-xs` gris + `CodeGraph`), à droite la pile « Actions » puis « Derniers événements ».
- A-1.3 Une seule surface teintée sur la page : le phare (`rounded-2xl bg-surface p-6`).
- A-1.4 Rien tant que les données chargent (`isPending` → `null`).

**A-2 « Ce qui t'attend »** (`AskInbox`, partagé avec Travail, la fiche de carte, le tiroir d'un commit, le panneau *Projet*, le portefeuille, la page Sessions)
- A-2.1 Vide : pastille verte ✓ + « Rien ne t'attend. ».
- A-2.2 En-tête bouton « Ce qui t'attend » + résumé « N demande(s) · M à relire » (point ambre si au moins une demande) + chevron ; clic = replier/déplier toute la liste (`aria-expanded`). Variante `bare` sans en-tête.
- A-2.3 Ordre : les « lourdes » (demandent une réponse) puis les « légères » (coup d'œil).
- A-2.4 Trois lignes visibles, puis « N de plus » / « Montrer moins ». Une ligne dépliée au-delà de la 3ᵉ reste visible.
- A-2.5 Ligne lourde, une hauteur `min-h-10` : icône (agent + point ambre/rouge pour une session ; ❓ ambre affinage ; arbre accent brouillon ; fusion verte PR de jalon), titre (`#n titre` si carte) tronqué à 18 rem, indice gris (≥ md seulement), puce « ⚑ Jalon #n » (≥ sm, lien vers le jalon), âge (≥ sm), geste à droite (« Répondre » / « Voir » si la session est tombée / « Examiner » / « Fusionner ») ; « Fermer » quand dépliée.
- A-2.6 **Une seule réponse dépliée à la fois** ; le dépliement est sur la ligne (`bg-surface`), `sm:pl-8`.
- A-2.7 Session réelle qui attend : `SessionRequestBody` (question ou Autoriser/Refuser, existant sur main) + « Ouvrir le fil → ». Session tombée ou sans demande lisible : « ⚠ La session s'est arrêtée. Ouvre-la pour la relancer. » / « Elle attend dans son fil. » + « Ouvrir le fil ».
- A-2.8 Champ de réponse : textarea qui s'agrandit (`field-sizing-content`, max 8 rem), autofocus, **Entrée envoie, Maj+Entrée va à la ligne**, « Envoyer » désactivé si vide.
- A-2.9 Affinage : une question par bloc, chacune son champ ; la dernière répondue referme la ligne. Brouillon : liste numérotée des cartes proposées (« après 1, 2 »), « ✓ Valider » + « Corriger dans le jalon ». PR de jalon : phrase « Toutes les cartes sont fusionnées dans `jalon/n`… » + « Fusionner dans main ». (Ces trois genres sont fournis par le domaine Jalons ; la liste doit les accepter.)
- A-2.10 Ligne légère (lien entier) : point accent (carte à relire) ou icône PR verte, titre, détail (≥ md), âge, « Relire → » / « Ouvrir la PR ↗ » (externe, nouvel onglet).
- A-2.11 `openInboxItem(key)` : un repère ailleurs (« 1 t'attend » d'un jalon) déplie la liste, l'agrandit si besoin, déplie la ligne et la fait défiler au centre.
- A-2.12 Sources réelles : sessions du groupe `asking` (`useActivityRows`), étiquetées par le jalon de leur carte (la parente) ; cartes feuilles en colonne `review` (« Carte #n à relire ») ; PR `ready` de la forge (« PR #n prête à fusionner »). Tri des légères par ancienneté.

**A-3 Le phare des jalons** (`Phare`, `Current`, `Sessions`, `Waves`, `Queue`)
- A-3.1 Sans jalon ouvert : « Aucun jalon ouvert. Lance une idée dans une conversation : « idée : … ». » dans la surface.
- A-3.2 Grille `lg:grid-cols-[minmax(0,1fr)_17rem]` : le jalon courant à gauche, une colonne à droite séparée d'un filet (`lg:border-l lg:pl-8`).
- A-3.3 Jalon courant = le premier des jalons non livrés triés par maturité (Lancé < Prêt < À régler < À affiner < Idée), puis par numéro.
- A-3.4 Anneau 88 px (trait 8) en accent : « NN % » et « fait/total » dessous.
- A-3.5 « Jalon en cours » + étiquette de maturité (point + mot, couleur par étape) ; titre `text-lg` lien vers la page du jalon ; ligne « #n · échéance <relative> » ou « sans échéance », « · +N depuis le lancement ».
- A-3.6 Sessions vivantes du jalon : « N session(s) · K t'attend » (ambre) puis jusqu'à 6 pastilles (icône agent, point d'état — accent pulsant si elle tourne, ambre si elle attend —, titre sans le `#n`) liens vers la session ; « +N ». Sans session : « Aucune session ne tourne. ».
- A-3.7 Vagues : « N vagues · C cartes à la fois au plus » (concurrence du pilotage, 3 par défaut) ; une boîte par vague « Vague i · fait/total » (✓ vert si finie, opacité 60 %), la vague courante (première avec du travail) cerclée d'accent et « en cours » ; une pastille par carte de la couleur de son état (pulsante si en cours), survol = `#n titre — état`, clic = destination de la carte ; flèches entre vagues. Sans cartes : « Pas encore découpé en cartes. ».
- A-3.8 Le geste suivant : bouton `→ <action>` (Affiner, Répondre, Valider le découpage, Préciser, Défaire le cycle, Revoir les dépendances, Lancer, Fusionner, Suivre, Relire le bilan) qui mène au jalon, + phrase de détail. Si une demande du jalon attend : à la place, le repère « ● N t'attend » (ouvre la demande dans « Ce qui t'attend », A-2.11) + « Le jalon reprend dès ta réponse. ». **La demande n'est jamais redite dans le phare.**
- A-3.9 Colonne de droite : « Ensuite · N » (Prêt, À régler, Lancé au-delà du premier) et « Plus tard · N » (À affiner, Idée), 4 lignes max (titre, point ambre si une demande lui appartient, maturité) + « +N autres » ; vide « Rien pour l'instant. » ; en pied « Tous les jalons · N livrés ↗ ».

**A-4 Code en cours** (`CodeGraph`)
- A-4.1 Vide (pas de dépôt ou rien) : « Pas de dépôt git, ou rien en cours. ».
- A-4.2 Lignes de 56 px : la racine (branche par défaut) en tronc, chaque worktree vivant en rameau (courbe SVG), point coloré par statut ; le tronc continue sous une ligne dépliée.
- A-4.3 Statut (le plus urgent l'emporte) : session en erreur (rouge) > t'attend (ambre) > conflit (rouge) > tourne (accent pulsant) > CI rouge > prête à fusionner (vert) > à nettoyer (PR fusionnée) > au repos / branche par défaut.
- A-4.4 Colonnes fixes (`44px · 1fr · 4.5rem · 5.5rem · 4rem · 1.25rem` ≥ sm) : branche (mono) + mot de statut coloré ; dessous ce qu'elle sert : `#n titre` (lien carte) + puce « ⚑ Jalon #m » (lien), ou « branche par défaut » / « sans carte » ; pile de sessions (3 icônes d'agent avec point d'état, `+N`) ; dérive « ↑a ↓b ●d conflit » (↓ ambre au-delà de 2) ou « à jour » ; PR `#n` colorée par état ou « — » ; `⋯` (opaque au survol/ouvert). Au téléphone : graphe + texte + `⋯` seulement.
- A-4.5 Ordre : racine, puis arbres avec session, puis le plus récent (dernier commit ou édition).
- A-4.6 Ne figurent que les arbres « vivants » : fusionnés/vides/introuvables **sans session** sont comptés à part → lien « + N arbres fusionnés à nettoyer » (vers Travail filtré « À nettoyer »).
- A-4.7 Clic, Entrée ou Espace sur une ligne : déplie ses gestes (une ligne à la fois) :
  - « Répondre à la session » (primaire si elle attend) ou « Ouvrir la session » ; sans session et hors racine « Lancer une session ici » (`/c/new?worktree=`).
  - « Voir le diff (N) » : ouvre le panneau git à l'arrivée sur la session de l'arbre, ou sur Travail pour la racine.
  - PR : « Fusionner la PR #n » (prête) / « Voir la CI #n » (rouge) / « Ouvrir la PR #n » ↗.
  - « Rebaser sur main (↓b) » si en retard (hors racine).
  - « Nettoyer l'arbre » (rouge) si PR fusionnée ou aucune session (hors racine), avec confirmation.
  - Pied : « PR #n · état » ou « Pas de PR », « dernière activité il y a … », et la dérive au téléphone.

**A-5 Actions** (`ProjectActionsBlock`)
- A-5.1 Titre « ACTIONS ». Ne montre que ce qui vit ou attend : services en marche, tâches en cours dans un terminal, actions proposées par un agent à relire.
- A-5.2 Ligne : point (vert pulsant en marche / ambre à relire), libellé, détail (« service · :5173 · depuis 26 min », « tâche en cours dans un terminal · 2 min », « à relire — proposée dans « titre » »), à droite « Ouvrir ↗ » (URL du service), « Relire » (ambre) ou « Panneau » (tâche).
- A-5.3 Vide : « Aucune action dans ce projet. » ou « Rien ne tourne. » ; « N autres au repos ».
- A-5.4 **À corriger** : le prototype renvoie au « lanceur ⚡ », retiré par la décision du 2026-11-11 → tous ces renvois vont à l'onglet Actions (`/p/:id/actions`, `?action=<id>` pour « Relire »).

**A-6 Derniers événements** (`Events`)
- A-6.1 Titre « Derniers événements » + lien à droite (« Journal ↗ » dans le proto → **Travail, vue Par moment**, le Journal n'existant plus).
- A-6.2 5 lignes de 36 px : icône de nature teintée (`JOURNAL_KIND_ICONS`, `journalIconTone`), titre, nature (≥ sm), âge ; lien vers la session, sinon la fiche de la carte, sinon ligne inerte.
- A-6.3 Vide : « Rien ces quinze derniers jours. ».

**A-7 Téléphone** : une colonne ; grille Code/Actions empilée sous `xl` ; phare empilé sous `lg` ; puces jalon, âges et indices de « Ce qui t'attend » masqués ; colonnes du graphe masquées sous `sm`.

### 1.B Travail — variante `une-ligne`

Fichiers : `P:routes/prototype-travail/{ProjectTravailPage,UneLigne,UneLigneViews,GitGraph,CommitSessions,TravailPanels,branches,Couloirs,shared}.tsx`, réutilisés : `P:routes/prototype-code/{ProjectCodePage,data}.tsx` (`TreeLine`, `VERDICT_TONE`, `PR_LABEL`, `GRID`, `verdictOf`…), `P:routes/prototype-activity/{FilActivity,shared}.tsx` (`FilBody`, `useActivityModel`), `P:components/prototype/{ViewSwitch,Drawer,GitPanelHost}.tsx`. Route : `/p/:id/travail`.

**T-1 La barre sur une ligne** (`OneLineToolbar`, `h-12`, bord bas, `px-4 md:px-6`)
- T-1.1 Recherche compacte (w-36 → w-56 au focus ou remplie, ✕ pour effacer), placeholder « Chercher, #12, branche » ; elle filtre le vivant et l'historique (`parseActivityFilter` : mots, `#n`, branche, carte).
- T-1.2 « Filtrer » (popover w-80, max 70vh qui défile), badge accent du nombre de filtres actifs ; sections :
  - Quoi : Worktrees · Branches sans arbre · Sessions · Événements du projet ;
  - État : T'attend · Travaille · À relire · PR prête · CI rouge ou conflit · Abandonné ? · À nettoyer · Fusionné ;
  - Jalon (si au moins un) : jalons des arbres, des branches et cartes de haut niveau ouvertes ayant des enfants — `#n titre` + avancement `fait/total` ;
  - Agent (si au moins un) : icône + nom des agents présents ;
  - Période de l'historique : segment Tout · Aujourd'hui · 7 j · 30 j ;
  - « Effacer tous les filtres » (efface aussi l'arbre choisi) si au moins un actif.
- T-1.3 Puces des filtres actifs sur la même ligne, défilement horizontal, ✕ par puce : « ● Arbre : feat-… » (infobulle = chemin), « Branche : nom », Quoi, États, « Jalon #n », agent, période.
- T-1.4 Bilan neutre non cliquable (≥ xl) : « N arbres · X Go ».
- T-1.5 « 🗑 Nettoyer · N » (si des arbres fusionnés sans rien à perdre ou des branches fusionnées) → dialogue unique T-12. *(Le compte vaut le nombre d'arbres, sinon celui des branches : à corriger en total ? voir §2.5.)*
- T-1.6 « Affichage » (popover w-80, déclencheur = icône de la vue courante + « Affichage » ≥ sm, infobulle « Affichage : <vue> ») :
  - six tuiles en deux rangées : **Par arbre · Par moment · Tableau / Graphe · Par état · Frise** ;
  - « Index des arbres à gauche (défile) » (Par arbre) / « (filtre) » (Par moment) ;
  - Regrouper (Aucun · Par jalon · Par état) et Trier (Ce qui t'attend · Récent · Taille) — Par arbre et Tableau ;
  - Montrer : Arbres à nettoyer · Branches fusionnées · Couloir « Projet » (Par arbre seulement).
- T-1.7 « + Session » (bouton primaire, popover w-72) : « OÙ TRAVAILLER » — la racine « main (racine) » puis chaque arbre utilisable (ni à nettoyer, ni introuvable, créé par Solera), point de verdict ; puis « + Nouveau worktree… ». Choix → `/c/new` ou `/c/new?worktree=<id>`.
- T-1.8 Persistance : vue dans l'adresse `?vue=` (sinon la dernière choisie pour ce projet, sinon « Par arbre ») ; réglages d'affichage et filtres retenus **par projet** ; l'arbre ou la branche choisis dans l'adresse `?arbre=<clé>` (`replace`).
- T-1.9 Défauts d'affichage : index oui, regroupement aucun, fusionnées oui, à nettoyer oui, couloir Projet oui, tri « Ce qui t'attend ».

**T-2 Ligne de base** (`BaseCard compact`, en tête de toutes les vues sauf quand un arbre/une branche est choisi)
- T-2.1 « ⎇ Base `main` · ✓ la racine y est » (gris).
- T-2.2 Racine sortie sur une autre branche : ambre « ⎇ Base `main` · ⚠ la racine est sur `feat/x`, N fichiers non commités ». (Remplace la pastille de branche retirée de la bande.)

**T-3 L'index** (colonne `17rem` à gauche, ≥ lg, Par arbre et Par moment, si l'option est cochée et le projet est un dépôt)
- T-3.1 « ○ Tous » (« en haut » / « tout le fil »).
- T-3.2 Une ligne par arbre actif (+ à nettoyer si le filtre les force) : point de verdict, nom (racine entière en gras, sinon sans préfixe `feat/`), raison colorée, taille.
- T-3.3 « BRANCHES » puis `IndexBranch` : point de genre, icône (nuage si distante), nom, « PR #n · état » ou genre, carte `#n titre` + « Jalon #m », date du dernier commit, « ↑a ↓b ».
- T-3.4 « Projet — ce qui ne vit dans aucun arbre » (Par arbre seulement).
- T-3.5 Par arbre : un clic fait défiler jusqu'au couloir (« Tous » remonte) et l'entoure d'accent 1,6 s. Par moment : un clic **filtre** le fil (`?arbre=`), l'élément choisi surligné.

**T-4 Vue Par arbre** (`CouloirsView`, `Lane dense`, `BranchLane`, `ProjectLane`, `CleanupSection`, `MergedBranches`)
- T-4.1 Sans regroupement : les couloirs d'arbres, puis « ⎇ BRANCHES SANS WORKTREE N » et leurs couloirs. Avec regroupement : sections « Jalon #n · titre » (« Sans jalon » en dernier) ou par verdict / « Branche · genre », chacune titrée + compte.
- T-4.2 Ordre des couloirs : ceux qui t'attendent, puis le plus récent (dernier usage, dernier événement, vivant = maintenant) ; tri « Récent » ou « Taille » si choisi.
- T-4.3 Couloir d'arbre : anneau ambre s'il attend ; en-tête cliquable (ouvre le tiroir T-11, sauf clic sur un lien/bouton/menu) : point de verdict, icône (dossier pour la racine), branche mono, raison colorée, `ServiceMark` ; faits (`TreeFacts` : badge PR « #n état », ↑a ↓b — ↓ ambre au-delà de 20 —, ●N ambre non commités, 🖴 taille) ; carte `#n titre` + « Jalon #m » (ouvre la fiche) ; `SessionDots` (icônes, ambre si attend) ; `⋯` (gestes T-13, séparateur avant le geste rouge).
- T-4.4 Corps : sessions vivantes (`SessionRow` existant), puis 3 événements (`LaneEntry` : âge, pastille de nature, titre, nature) + « Plus · N autres » / « Moins » (20 max). Couloir sans rien en mode dense : en-tête seul.
- T-4.5 Couloir de branche sans arbre : anneau accent si PR ouverte ; en-tête (point de genre, ⎇ ou ☁, `origin/` devant une distante, genre, « sans worktree ») ; faits (« ↑a ↓b », « dernier commit il y a … », badge PR lien, carte + jalon) ; corps : 3 derniers commits (icône, hash court, titre, âge) ; gestes en ligne : « Ouvrir dans un worktree », « Lancer une session dessus », « Diff avec la base », « PR #n ↗ », « Supprimer » (rouge, fusionnées seulement).
- T-4.6 Couloir « Projet » : ce qui ne vit dans aucun arbre (notes, cartes fermées seules, jalons) ; 4 lignes + « Plus ».
- T-4.7 « À nettoyer » (si montré) : filet, bouton repli « › N arbres fusionnés · X · rien à perdre », bouton « 🗑 Nettoyer » (dialogue T-12) ; déplié : couloirs atténués. Déplié d'office si l'état « À nettoyer » ou « Fusionné » est filtré.
- T-4.8 « Branches fusionnées » (si montré) : repli « › ⎇ N branches fusionnées · sans arbre, rien à perdre » + « 🗑 Supprimer » (dialogue T-12) ; déplié : liste encadrée (point vert, nom, « PR #n », âge).

**T-5 Vue Par moment** (`FilBody bare`)
- T-5.1 Pas de barre propre (celle de la page) ; marges `px-4 md:px-6` ; jours collés en haut (`top-0`).
- T-5.2 Ligne de base (T-2) en tête, pleine largeur.
- T-5.3 Rail vertical ; « Maintenant » (pastille pulsante si du vivant) : bandeau des jalons lancés (`MilestoneBanner` existant), « Ce qui t'attend » (seulement s'il y a des demandes), « En cours N » : `SessionRow` encadrées + dessous « ⚑ Jalon #n titre » et la puce d'arbre.
- T-5.4 Jours (« Aujourd'hui », « Hier », « lundi 9 novembre »), en-têtes collants ; heure à gauche, pastille sur le rail (teinte par famille ; carte fermée en vert ; échec en ambre ; jalon livré = losange vert plein ; icône d'agent pour une session).
- T-5.5 Regroupement : événements consécutifs d'une même session ou carte à moins de 3 h → une ligne « [N] titre · #n · N événements depuis HH:MM ⌄ », dépliable.
- T-5.6 Ligne : titre (« Jalon livré · » en vert pour une carte-jalon fermée), méta (nature, `#n`, source, « ⚑ Jalon #n », **puce d'arbre** cliquable qui filtre le fil sur l'arbre et se surligne quand active).
- T-5.7 Bas : chargement automatique de l'historique plus ancien après défilement (fenêtre doublée, 1 an max), sinon « Plus ancien · au-delà de N jours », « Chargement… », « Début du fil : un an d'historique. ».
- T-5.8 Vides : « Aucune session vivante ne correspond. » (en recherche), « Rien dans l'historique ne correspond. », « Rien ne s'est passé ces N derniers jours. ».

**T-6 Vue Tableau** (`TableView`, `TreeLine`, `BranchRowLine`)
- T-6.1 En-tête en capitales : « Branche · pourquoi elle est là · Sessions · PR · Base · Disque · Vu » (grille `GRID` : `1fr 9rem 8rem 5.5rem 5rem 5.5rem 2.5rem`).
- T-6.2 Ligne d'arbre (toute la ligne ouvre le tiroir T-11) : point, ⎇, branche mono (racine en gras, fond `surface/40`), badges « hors Solera » et « ⚠ conflit », raison colorée, carte + « Jalon #m » (lien vers le jalon) ; sessions (boutons icône d'agent + point, ouvrent la session) ou « — » ; PR « #n » + badge d'état (lien) ou « pas de PR » ; base « ↑a ↓b ●N » ; taille (encre forte au-delà de 400 Mo) ; « vu » (âge) ; geste principal visible **au téléphone seulement** (Répondre / Nettoyer / Relire) ; `⋯` : geste principal, Ouvrir la session / Lancer une session ici, Voir le diff, Ouvrir la PR #n, Rebaser sur la base, Fusionner la PR (prête), Nettoyer l'arbre (rouge, désactivé pour un arbre externe).
- T-6.3 Ligne de branche : point de genre, ⎇, nom (`origin/…`), genre, carte + jalon ; « sans arbre » ; « #n · état » ; « ↑a ↓b » (vide si fusionnée) ; « — » ; âge du dernier commit.
- T-6.4 Regroupements comme T-4.1 ; « À nettoyer » (T-4.7) en lignes de tableau ; « Branches fusionnées » (T-4.8).
- T-6.5 Téléphone : chaque ligne devient une carte bordée, les colonnes une rangée de faits sous le titre.

**T-7 Vue Graphe** (`ProjectGitGraph`, `Annotation`, `CommitSessions`)
- T-7.1 Le graphe façon GitKraken du panneau git (`GraphHeader`, `GraphRow`, `RunHighlight`, couloirs colorés, survol d'une course qui la nomme dans l'en-tête) sur **tout le dépôt du projet** (`useGraph(projectScope)`), fenêtre paginée « 60 commits de plus ».
- T-7.2 Colonne « DANS SOLERA » de 24 rem (≥ lg) en face de chaque rangée : sur la tête d'une branche connue — arbre : pastille du verdict (ambre si t'attend) qui ouvre le tiroir de l'arbre, icônes des sessions vivantes, `#carte` + « Jalon #m », PR « #n état » (lien), `ServiceMark` ; branche sans arbre : pastille pointillée « sans arbre » qui la choisit/dé-choisit comme filtre, carte, PR ; « +N » si plusieurs ; nœud « en cours » : « racine du projet · non commité ».
- T-7.3 L'arbre/la branche choisi dans les filtres : les autres rangées à 35 % d'opacité (100 % au survol).
- T-7.4 Période du filtre → `since` du graphe. Branches fusionnées : leurs étiquettes disparaissent (leurs commits restent) sauf si le filtre « À nettoyer/Fusionné » est actif.
- T-7.5 Menus d'écriture du graphe éteints (`locked`) : restent « copier le SHA » et « aller au fil ».
- T-7.6 Clic sur un commit → **tiroir large** : en haut `CommitSessions`, dessous le détail du commit du panneau (`CommitDetail beside` : fichiers, diff, menu).
- T-7.7 `CommitSessions` : « SESSIONS » — liste des sessions rattachées, dédoublonnées, dans l'ordre : celle qui a écrit le commit (« a écrit ce commit · d'après sa branche » si sûr, « · déduit des dates » sinon), celles de l'arbre (« a travaillé sur la branche »), celles de la carte (« session de la carte ») ; chaque ligne : icône d'agent, titre, état (t'attend ambre / en erreur / travaille / terminée / état inconnu), provenance, date, « Ouvrir la session ↗ » ; une session qui t'attend porte sa réponse sur place (`AskInbox bare`). Vide : « Aucune session connue pour ce commit… ».
- T-7.8 Puces sous les sessions : carte `#n titre` (infobulle « Carte déduite du nom de la branche » si devinée) → fiche ; « Jalon #m » → fiche ; « PR #n » ↗ ; « 📁 branche » → tiroir de l'arbre (ferme le tiroir du commit).
- T-7.9 États : « Lecture du graphe… », bannière d'erreur, « Ce projet n'est pas un dépôt git. », « Aucun commit dans cette période. ».

**T-8 Vue Par état** (`StateBoard`)
- T-8.1 Quatre colonnes (≥ md, défilement horizontal sinon) : « T'attend » (la liste `AskInbox bare`) · « Travaille » · « À relire » · « Terminées récemment » (3 derniers jours, 12 max, sessions au repos non archivées des arbres montrés).
- T-8.2 Carte : icône d'agent teintée, titre, âge ; dessous puce d'arbre (filtre sur l'arbre), `#carte titre`, « Jalon #m » ; lien vers la session.
- T-8.3 Vides : « Rien ne t'attend. », « Aucune session au travail. », « Rien à relire. », « Rien ces trois derniers jours. ».

**T-9 Vue Frise** (`Timeline`)
- T-9.1 Axe collant : jusqu'à 14 graduations datées (jour, mois court), « maintenant » en accent à droite ; fenêtre = période du filtre, sinon 7 jours.
- T-9.2 Une rangée par arbre (étiquette w-48 / md w-56 : point, nom) : barres de sessions (début = création, fin = maintenant si vivante sinon dernière mise à jour ; accent tourne, ambre t'attend, gris terminée ; alternées sur deux lignes ; survol entouré ; infobulle titre · état), points d'événements colorés par nature ; trait « maintenant ».
- T-9.3 Une rangée par branche sans arbre : losanges des commits ; « dernier commit il y a … » si plus ancien que la fenêtre.
- T-9.4 Clic sur l'étiquette : choisit/dé-choisit l'arbre (rangée surlignée).
- T-9.5 Légende : session qui tourne · t'attend · terminée · carte fermée · branche, PR, fusion · commit.

**T-10 Les verdicts et les genres** (`verdictOf`, `VERDICT_TONE`, `BRANCH_TONE`, `PR_LABEL`)
- T-10.1 Verdict d'un arbre (ordre d'urgence, qui est l'ordre d'affichage) : racine (« La branche par défaut, propre » / « N fichiers non commités sur la branche par défaut ») · introuvable (« Le dossier a disparu du disque » / « git n'a pas pu lire cet arbre ») · t'attend (« Une session t'attend ici ») · en cours (« En cours : une session y travaille ») · attention (« Fusionné, mais N non commités : les nettoyer les perdrait ») · à nettoyer (« Fusionné : rien à perdre, à nettoyer ») · à relire (« PR ouverte : à relire » / « PR en brouillon ») · abandonné ? (« Aucune activité depuis N jours », 14 j) · vide (« Jamais commité… ») · en suspens (« Du travail non fusionné, sans session ouverte »).
- T-10.2 Pastilles : gris / ambre / accent pulsant / accent / rouge / ambre 60 % / gris foncé / cerclée grise / vert / cerclée rouge.
- T-10.3 Genres de branche sans arbre : PR ouverte (accent) · du travail non fusionné · distante seulement (bleu ciel, ☁) · fusionnée, supprimable (vert). Ordre : PR, non fusionnées récentes, distantes, fusionnées.
- T-10.4 États de PR : brouillon · CI en cours · CI rouge · prête · fusionnée (tons neutre/accent/critique/positif/neutre).

**T-11 Tiroir d'un arbre** (`TreeDrawer`)
- T-11.1 Tiroir commun (36 rem, sous la rangée d'onglets, ombre, Échap / clic dehors ferment) ; titre = branche mono ; sous-titre = point + « Racine du projet » ou verdict + `ServiceMark`.
- T-11.2 Raison (rouge si attention/introuvable) ; rangée de boutons des gestes T-13.
- T-11.3 Faits : Carte (→ fiche), Jalon (→ page du jalon), PR (« #n » + badge, ou « aucune »), Sur la base (« ↑a propres ↓b en retard »), Non commités (ambre), Taille, Dernier usage, Chemin (mono, infobulle).
- T-11.4 « SESSIONS ET DERNIERS ÉVÉNEMENTS » : deux colonnes (≥ md) — sessions de l'arbre (vivantes d'abord, « tourne » / « t'attend » ou âge, 8 max) et historique de l'arbre (âge, nature, titre). Vides : « Aucune session vivante dans cet arbre. », « Rien ces N derniers jours. ».

**T-12 Le dialogue « Nettoyer »** (`CleanAllDialog`, unique pour tout nettoyage de Travail)
- T-12.1 Titre « Nettoyer » ; deux sections cochables (cochées à chaque ouverture) : « Worktrees fusionnés · N » (taille totale) et « Branches fusionnées · M » (« sans arbre ») ; aperçu de 4 noms (mono, taille) + « et N autres ».
- T-12.2 Avertissement rouge si un arbre coché a du non commité ou des commits non fusionnés : « a, b : du travail non fusionné ou non commité serait perdu. » ; sinon « Tout est déjà dans main : rien ne se perd. Les sessions des arbres sont archivées. ».
- T-12.3 Bouton « Supprimer N arbres et M branches — libère X » (ton critique si perte), « Rien de coché » quand vide.
- T-12.4 Après : ce qui est supprimé disparaît de la vue ; retour « N arbres et M branches supprimés, X libérés. ».

**T-13 Les gestes**
- T-13.1 Arbre (`useTreeActions`) : « Session » (la session qui attend, sinon la première, sinon la plus récente) ou « Lancer une session » (`/c/new?worktree=`) ; « Diff » (panneau git à l'arrivée sur la session de l'arbre, sinon Travail) ; « PR #n » ↗ ; « Rebaser » ; « Nettoyer » (→ T-12). Racine : Session et Diff seulement.
- T-13.2 Branche (T-4.5) : ouvrir dans un worktree, lancer une session dessus, diff avec la base, PR, supprimer (fusionnée).
- T-13.3 Tout retour de geste au même endroit, sous la barre (aujourd'hui une bulle fuchsia « Simulé : … » → toast réel).

**T-14 Divers**
- T-14.1 « Rien ne correspond à ces filtres. » + « Effacer les filtres » (cadre pointillé) quand rien à montrer.
- T-14.2 Projet sans dépôt : pas d'index, pas de ligne de base, vues d'arbres vides, le fil reste.
- T-14.3 Le tiroir de carte commun (`?fiche=`) et le panneau git (`GitPanelHost` : pas de bouton, seul « Diff » l'ouvre) sont montés sur la page.
- T-14.4 Défilement : vue en `overflow-y-auto` sous la barre, `pb-28` ; ancres `scroll-mt-4`.

### 1.C Tableau — variante `une-ligne`

Fichiers : `P:routes/prototype-board/{OneLineBoard,KanbanVariant,ListVariant,GestureVariant,parts,data}.tsx`, `P:components/prototype/ViewSwitch.tsx`. Entrée : `P:routes/BoardPage.tsx`. L'onglet s'appelle « Tableau » (adresse `/board` inchangée).

**B-1 La barre** (même kit que T-1)
- B-1.1 Recherche « Chercher, ou #12 » : `#12` vise un numéro (préfixe), sinon numéro + titre + titre du jalon.
- B-1.2 « Filtrer » : Jalon (jalons ouverts : point de teinte, `#n`, titre court 30 car., aside `fait/total`) + « Sans jalon » (aside : nombre de feuilles ouvertes sans jalon) ; État (en **ou**) : T'attend · À préciser · À accepter ; Échéance : En retard · Cette semaine (exclusifs) ; Agent (présents) ; « Effacer tous les filtres ».
- B-1.3 Puces : jalon (point, `#n`, titre court 18 car., infobulle titre entier), « t'attend », « à préciser », « à accepter », « en retard » / « échéance cette semaine », agent, « colonne : Fait ».
- B-1.4 « Affichage » : tuiles Kanban · Liste · Par geste ; Kanban : « Regroupement » Aucun · Couloirs par jalon ; Kanban et Liste : « Fait » Les 5 récentes · Toutes · Masquées + « Montrer les abandonnées » ; Kanban : « Tri dans les colonnes » Ce qui t'attend · Récentes · Échéance · Numéro ; Liste : « Le tri de la liste se règle en cliquant ses en-têtes. ».
- B-1.5 « + Carte » au bout (le formulaire existant `NewCardDialog`).
- B-1.6 Vue dans `?vue=` + dernière choisie par projet ; affichage retenu par projet ; filtres non retenus (état de page).

**B-2 Données** (`useBoardData`)
- B-2.1 Seules les **feuilles** sont des tuiles ; une carte qui a des enfants devient un filtre et un couloir. Une **idée de jalon** (haut niveau, sans enfants, drapeau « jalon ») n'est pas une tuile.
- B-2.2 Le jalon d'une feuille = l'ancêtre de haut niveau qui a des enfants ; ses feuilles à toute profondeur ; avancement = closes (faites ou abandonnées) / feuilles.
- B-2.3 Une teinte par jalon (6 qui tournent, jalons triés par échéance puis numéro) : point, texte, lavis.
- B-2.4 Par carte : sous-tâches `fait/total` (markdown), « t'attend » (une session non archivée en `awaiting_input`), sessions vivantes, en retard (échéance passée, ouverte).

**B-3 La tuile** (`Tile`)
- B-3.1 Bouton entier (ouvre la fiche de la carte), glissable ; bord ambre + filet gauche ambre si elle t'attend ; opacité 60 % si close.
- B-3.2 Étiquette de jalon (lavis teinté, point, `#n`, titre court, infobulle « Jalon #n — titre ») sauf dans les couloirs.
- B-3.3 Titre sur 2 lignes ; drapeaux « t'attend » (ambre), « 📥 à accepter », « ❓ à préciser ».
- B-3.4 Pied : `#n`, barre de sous-tâches (w-10 + `fait/total`), échéance « ⏰ relative » (rouge si en retard), agents vivants empilés (anneau ambre s'il attend, point accent pulsant s'il tourne, 3 max).

**B-4 Kanban** (`KanbanVariant external`)
- B-4.1 Colonnes de largeur fixe (w-72) : À faire · En cours · À relire toujours ; Fait sauf « Masquées » ; Abandonné si « Montrer les abandonnées ». En-tête : point de colonne, nom, compte.
- B-4.2 Tri d'une colonne selon l'affichage ; « Ce qui t'attend » = attend d'abord, puis non acceptées, puis en retard, puis entrées récentes. Fait toujours par récence.
- B-4.3 Fait/Abandonné étroites (w-60) : en-tête bouton « Fait · N › » qui **replie** la colonne en bande verticale de 40 px (« Fait · N » écrit à la verticale), toujours cible de dépôt ; clic → déplie.
- B-4.4 Fait limitée à 5 en « Les 5 récentes » → « Tout voir (N) » : pose le filtre « colonne : Fait » et bascule en Liste.
- B-4.5 Colonne vide : « Vide » discret.
- B-4.6 Glisser une tuile vers une colonne : la colonne survolée s'éclaire (`accent-wash`, anneau) ; le dépôt **change la colonne de la carte** (réel : `PATCH /api/cards/:id`).
- B-4.7 Couloirs par jalon : rangée d'en-têtes de colonnes collante ; une section par jalon ayant des feuilles ouvertes, puis « Sans jalon » : chevron de repli, point de teinte, titre, `fait/total`, barre fine teintée (w-16), « N t'attend » (ambre), « Ouvrir le jalon » ; cellules par colonne (Fait limitée à 2 + « N de plus »), tuiles sans étiquette de jalon.
- B-4.8 Défilement : horizontal et vertical dans la zone (`px-4 md:px-6 py-4`).

**B-5 Liste** (`ListVariant external`)
- B-5.1 Table dense (min 46 rem, défile), en-tête collant : État · Titre · Signal · Sous-tâches · Sessions · Échéance · Vu ; État, Titre, Échéance et Vu triables (clic = sens inverse, flèche).
- B-5.2 Groupes par jalon (tous les jalons de haut niveau) puis « Sans jalon » : chevron, point, titre, « fait/total faites » ; repliables.
- B-5.3 Ligne de 40 px : point + nom de colonne, `#n` + titre (barré gris si close), drapeaux, barre de sous-tâches, agents vivants, échéance, âge ; clic = sélectionne et ouvre la fiche ; sélection = filet gauche accent + fond ; t'attend = filet ambre.
- B-5.4 Clavier (la liste prend le focus) : ↑↓ ou j/k déplacent la sélection (défilement au plus près), Entrée ouvre la fiche, **1–4 rangent la carte** (à faire, en cours, à relire, fait).
- B-5.5 Montre les closes si Fait n'est pas masqué, si les abandonnées sont montrées, ou si le filtre « colonne : Fait » est posé ; « Aucune carte ne correspond. » ; aide « ↑↓ ou j/k pour se déplacer · Entrée ouvre la fiche · 1–4 range la carte ».

**B-6 Par geste** (`GestureVariant external`)
- B-6.1 Cinq sections (titre bouton qui replie, icône teintée, compte, indice ≥ sm) : **À toi** (ambre : t'attend, à relire, à accepter ou à préciser) · **Les agents travaillent** (accent : en cours) · **Prêtes à partir** (à faire sans bloqueur ouvert, sous chaque tuile « ▶ Lancer » → destination de la carte) · **Attendent une autre carte** (à faire avec bloqueur ouvert, « après #a, #b ») · **Fait cette semaine** (vert, repliée d'office).
- B-6.2 Une carte n'apparaît qu'une fois (« À toi » prime). Grille `auto-fill minmax(16rem,1fr)`, tuiles non glissables. Vide : « Rien ici. ».

**B-7 Fiche** : un clic sur une tuile ouvre la fiche de la carte **sur place** (tiroir commun du domaine Jalons, `?fiche=<n>`), sans quitter le tableau.

**B-8 Téléphone** : la barre tient sur une ligne (libellé « Affichage » masqué < sm) ; le Kanban défile horizontalement ; la Liste défile dans sa largeur minimale ; Par geste en une colonne.

### 1.D Réglages — variante `page-gauche`

Fichiers : `P:routes/prototype-settings/{PageLeftFlat,flat,knowledge,model,parts}.tsx`. Entrée : `P:routes/ProjectPage.tsx`. Route : `/p/:id/settings`, onglet au bout de la rangée.

**R-1 Mise en page**
- R-1.1 Au large : menu de 16 rem à gauche (bord droit) + contenu qui défile ; au téléphone (< md) : un `select` « Aller à » (optgroups « Catégorie › Groupe ») + bouton loupe 40 px.
- R-1.2 En-tête du menu (h-16) : « RÉGLAGES » + loupe (« Rechercher un réglage (touche /) »).
- R-1.3 Catégories : Général · Agents · Intégrations, puis **Zone de danger** en bas, séparée d'un filet, sans sous-groupes. Catégorie lue = pilule teintée (`accent-wash`, rouge pour le danger) ; sous-groupes en retrait avec filet gauche, le lu en accent et trait épais ; **point accent** sur une catégorie qui a des modifications en attente.
- R-1.4 Défilement suivi : le sous-groupe dont le titre a passé la ligne `haut + 96 px` est le lu ; arrivé en bas, le dernier titre visible l'emporte. Clic dans le menu → défilement doux et l'élément cliqué reste allumé jusqu'au prochain défilement à la main (molette, toucher, pointeur, flèches/Page/Début/Fin/Espace). Cliquer une catégorie allume son premier sous-groupe.
- R-1.5 Contenu : `max-w-[72rem]`, `px-4 md:px-6`, marge basse 60vh ; chaque catégorie : titre `text-xl` (rouge pour le danger), la première alignée sur l'en-tête du menu (min-h-16), les suivantes après `mt-16` + filet + `pt-10`.
- R-1.6 Groupe : titre `text-sm` au-dessus, **une seule surface légère** (`rounded-xl border bg-surface/50 px-5`), rangées séparées de filets.
- R-1.7 Rangée : libellé (+ point « modifié ») et aide grise à gauche sur 22 rem, contrôle à droite plafonné à 36 rem (empilés < md) ; un « bloc » (consignes, mémoire, skills) prend toute la largeur sous son titre.
- R-1.8 Projet partagé (non propriétaire) : bannière « lecture seule » en tête (`project.shared.readonly`) ; Agents réduits à « Ce que les agents savent » ; ni Intégrations ni Zone de danger.

**R-2 Recherche** (palette)
- R-2.1 S'ouvre par la loupe ou la touche `/` (hors champ de saisie) ; voile, boîte centrée à 12vh, champ autofocus « Chercher un réglage : couleur, confin, modèle… », ✕.
- R-2.2 Correspondance sans accents ni casse, tous les mots dans libellé + aide + groupe + catégorie + mots-clés ; 10 résultats « Libellé  Catégorie › Groupe » ; ↑↓, Entrée, Échap, survol ; vide « Aucun réglage pour « q ». » ; sans saisie « ↑↓ pour choisir, Entrée pour y aller, Échap pour fermer. ».
- R-2.3 Choisir → ferme, fait défiler la rangée au centre et la surligne 1,8 s.

**R-3 Brouillon et barre d'enregistrement**
- R-3.1 Les réglages simples et les réglages d'agent se modifient dans un brouillon ; chaque rangée modifiée porte un point accent ; sa catégorie aussi dans le menu.
- R-3.2 Barre flottante centrée en bas : « N modification(s) non enregistrée(s) » + « Annuler » + « Enregistrer » ; après enregistrement, un retour bref (3,2 s) à la même place.
- R-3.3 Hors brouillon (effet immédiat, avec leurs propres boutons) : image, consignes, mémoire, skills, intégrations, retrait du projet.

**R-4 Général**
- Identité :
  - R-4.1 **Nom** (champ) — « Affiché dans la bande, la sidebar et le portefeuille. »
  - R-4.2 **Dossier du workspace** (champ mono + « Parcourir ») — aide existante ; bannière ambre `project.settings.pathChanged.warning` quand il diffère.
  - R-4.3 **Visibilité** (si l'instance partage des projets) — segment Privé · Partagé ; « Privé : toi seul. Partagé : les membres de l'instance le voient. »
  - R-4.4 **Cap** (zone de 2 lignes, pleine largeur) — « Une phrase, facultative : où va le projet. En tête des Jalons, donnée à l'agent qui affine un jalon. » ; exemple en placeholder.
- Apparence :
  - R-4.5 **Couleur** — pastilles rondes de `PROJECT_COLORS` (la « par défaut » en accent), anneau sur la choisie. (La couleur quitte le `⋯` de la bande et de la sidebar.)
  - R-4.6 **Image** — avatar 40 px (couleur du brouillon) + « Changer » + « Retirer » (si une image) — « Remplace la pastille de couleur par une image carrée. »
- Exécution :
  - R-4.7 **Environnement d'exécution** — liste avec icônes et indices (hôte, hôte confiné, dev container, dev container confiné), désactivée s'il n'y a qu'un choix — « Où tournent le CLI et les terminaux des sessions ouvertes ensuite. Une session garde le sien. »
  - R-4.8 **Sessions autonomes confinées** — liste libre / confinées (icônes Monitor / ShieldCheck, indices).
  - R-4.9 **Services des sessions confinées** — « Ceux du projet, partagés » / « Une copie par session » (« Supprimée avec la session »).
  - R-4.10 **Points de reprise** — interrupteur (libellé et aide existants).
- Les libellés des listes d'environnement ne sont pas répétés au-dessus du contrôle (la rangée les dit déjà ; `aria-label` seulement).

**R-5 Agents** (propriétaire)
- « Ce que les agents savent » : R-6 Consignes, R-7 Mémoire, R-8 Skills (blocs).
- R-5.1 « Ce que l'agent demande à Solera » : une rangée par réglage de `requestSettings` (commun aux CLI).
- R-5.2 « Ce que Solera lui prête » : bibliothèque de skills, mémoire de l'agent, et « Serveurs MCP » (`cliDefaults.mcp.*`, le contrôle existant).
- R-5.3 « Permissions du CLI » : rangée **CLI** (« Ces réglages valent pour un CLI à la fois. », boutons Claude · Codex · Grok · OpenCode avec icônes) puis permission, approbation, bac à sable, permissions d'édition / bash / webfetch **du CLI choisi** (celles qui existent pour lui).
- R-5.4 « Modèle par défaut » : rangée CLI, modèle, effort, compte, puis la file d'envoi (commune).
- R-5.5 Contrôle d'une rangée : segment si ≤ 3 options courtes (≤ 22 car.), liste sinon ; une option « à risque » montre son indice en ambre avec 🛡 sous le contrôle ; sinon l'indice de l'option choisie est l'aide de la rangée.
- R-5.6 Héritage, sous chaque contrôle : « hérité du compte » (gris) ou « modifié ici ↺ » (accent, clic = revenir à la valeur du compte).

**R-6 Consignes** (`InstructionsPanel`)
- R-6.1 « Où vivent les consignes du projet » (+ « déduit du dossier, jamais choisi » si non choisi) : deux options radio en cartes — **Dans le dépôt** (« Le fichier AGENTS.md (ou CLAUDE.md) versionné avec le code… ») · **Dans Solera** (« Un texte gardé par Solera et donné aux 4 CLI… »).
- R-6.2 « Fichiers à la racine du dépôt » : `AGENTS.md`, `CLAUDE.md` dépliables (contenu brut) avec méta « absent » / « renvoie à X » / « N lignes » (+ « · masqué aux CLI » en mode Solera).
- R-6.3 « Ce que lit chaque CLI » : table CLI · Partie globale (« SOLERA.md global » ✓ ou « vide » ✕) · Partie projet (« texte de Solera », `AGENTS.md + CLAUDE.md`, ou la raison : « aucun fichier de consignes », « Codex ignore CLAUDE.md », « le texte de Solera est vide »). Règle : Codex ne lit que `AGENTS.md` ; Claude, Grok, OpenCode lisent les deux.
- R-6.4 Alertes ambre : « X n'aura/n'auront pas les consignes du projet » (+ conseil de renommage si seul `CLAUDE.md` existe) ; « AGENTS.md et CLAUDE.md ont chacun leur contenu… garde-en un seul, l'autre en renvoi. » (un fichier de ≤ 4 lignes qui cite l'autre est un renvoi).
- R-6.5 « La partie globale vaut pour tous tes projets. La modifier » → réglages globaux, section consignes.
- R-6.6 Édition : titre du texte édité (« Texte tenu par Solera », `AGENTS.md`, `CLAUDE.md` ou « AGENTS.md (à créer) »), « N lignes · date » ; rendu markdown (max 18 rem, défile) ou « Vide. » ; « ✎ Modifier » (désactivé sans droit) → textarea mono 14 lignes + « Enregistrer » / « Annuler ».

**R-7 Mémoire** (`MemoryPanel`)
- R-7.1 Phrase d'explication (MEMORY.md index ; Claude natif ; Codex, Grok, OpenCode par l'index et les outils de Solera).
- R-7.2 Outils : recherche dans les notes ; filtres par type avec comptes (Toutes · Toi · Retour · Projet · Référence · Sans type, les vides masqués) ; « Nouvelle note » (propriétaire).
- R-7.3 Ligne d'index : `MEMORY.md` · « N notes indexées » · « N absentes de l'index » (ambre) · « N lignes sans note » (ambre) · « 🔧 Réparer l'index » ou « ✓ à jour ».
- R-7.4 Notes (plus récentes d'abord) : chevron, nom de fichier mono, type en pastille colorée, description, « hors index » (ambre), date ; dépliée : corps en markdown (`[[lien]]` → code), « Liée à » (liens vers une note existante qui l'ouvrent et défilent, sinon « nom · à écrire » en pointillé), « ✎ Modifier » / « 🗑 Supprimer ».
- R-7.5 Supprimer : bandeau rouge « Supprimer x.md ? » + case « retirer aussi sa ligne de MEMORY.md » (cochée, si indexée) + Annuler / Supprimer.
- R-7.6 Éditeur : textarea mono 12 lignes, « Enregistrer » / « Annuler ». Création : cadre, nom de fichier (validé `^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.md$`, pas `MEMORY.md`, sinon bord rouge + « un nom de fichier .md, sans dossier »), gabarit (frontmatter name/description/type, Why / How to apply), case « l'ajouter à MEMORY.md » ; « Créer ».
- R-7.7 Réparer l'index : retire les lignes orphelines, ajoute `- [nom](fichier) — description` pour chaque note hors index.
- R-7.8 Vides : « Aucune note pour l'instant. » / « Aucune note ne correspond. » ; « Chargement… ».

**R-8 Skills** : skills propres au projet (`FoldLine` : nom mono, description, « désactivé ») ou « Aucun skill propre au projet. » ; « + N skills de l'instance, livrés ici aussi. » ; « + Ajouter un skill » (propriétaire).

**R-9 Intégrations** (propriétaire)
- R-9.1 Forge › **Dépôt des issues** : dépôt mono ou « Aucun dépôt relié » ; dessous l'erreur (rouge) ou « N cartes venues de là · lu il y a … ». Aide : « Les issues de ce dépôt deviennent des cartes à accepter. »
- R-9.2 Design › **Design system** : chemin mono ou « Aucun Storybook lié ». Aide : « Un Storybook lié au projet, que les agents consultent. »

**R-10 Zone de danger** (propriétaire) : groupe « Irréversible » › **Retirer le projet** (aide `project.settings.remove.notice`, bouton rouge).

**R-11 Disparu de la page** : les cartes-liens « Board » et « Worktrees », l'en-tête (avatar, badges visibilité/branche/propre), la catégorie Actions (l'onglet Actions la tient ; `?actions=reglages` est un reste de comparaison).

### 1.E Variantes à jeter (ni à porter, ni à garder)

- Aperçu : `P:routes/prototype-overview/{VariantA,VariantB,VariantC,widgets}.tsx`, `v2/{Tiles,Visual,Dense}.tsx` (sauf `Events`, à extraire), et le switcher.
- Travail : `Empile.tsx`, `Rail.tsx`, `Hybride.tsx`, `Couloirs` (la page autonome ; `Lane`, `ProjectLane`, `useLanes` sont gardés), `Bascule` et `MaitreDetail` de `ProjectTravailPage.tsx`, `tabs-mode.ts`, et la page `P:routes/prototype-code/ProjectCodePage` en tant qu'onglet (ses `TreeLine`, `CleanDialog` → remplacé par T-12, `Branches`/`BranchesLink` → remplacés par T-4.5/T-4.8).
- Tableau : `ViewsBoard.tsx`, `TabViewMenu.tsx`, `Toolbar`/`MilestoneChips`/`Toggle` de `parts.tsx` (barre de la variante `vues`), le « menu ▾ dans l'onglet ».
- Réglages : `AccueilVariant`, `GrilleVariant`, `LeftNavVariant`, `PageVariant`, `RangeesVariant`, `SettingsSections`, `useCategorySummaries`, `RowGroup`/`SearchBox`/`NoResult` de `parts.tsx`, `ReadOnlyBlock`, la catégorie Actions.

---

## 2. État actuel sur main, et écarts

### 2.1 Coque et routes (`M:App.tsx`, `M:routes/ProjectLayout.tsx`)
- Main : onglets Aperçu · Activité · Board · Planifiées · Jalons · Journal ; `/p/:id/settings` **hors** de la coque (pleine page) ; `⋯` de la bande (Réglages, couleurs) ; pastille de branche ; « + Carte » / « Découper en cartes » / « + Tâche » dans la rangée.
- Écart pour ce domaine : routes `travail` (nouvelle) et `settings` (dans la coque) ; `/activity`, `/activity?groupe=worktree` et `/journal` deviennent des **redirections** vers `/travail` (`?vue=fil` pour le journal, `?vue=couloirs` pour le regroupement par worktree) ; pas de route `/code`. La rangée elle-même est dans la spec Coque.

### 2.2 Aperçu (`M:routes/ProjectOverviewPage.tsx`, 561 lignes)
- Existe : `NowBlock` (« En ce moment » : `SessionRow` des sessions vivantes), `MilestoneTile` (jalon courant via `milestonesOf`), `DueTile` (échéances proches), `JournalTile`, `TaskLine` + `ScheduleDialog` (planifiées), liens `?carte=` vers le board.
- Réutilisable : `useActivityRows`, `usePullRequests`/`pullRequestFor`, `useWorktreeStatuses`, `useJournal`, `JOURNAL_KIND_ICONS`/`journalIconTone`, `SessionRequestBody`, `useSessionRequests`, `useActions`/`actionView`, `openPanelOnArrival`, `useActiveMilestones`.
- Disparaît : tout le corps actuel (`NowBlock`, `MilestoneTile`, `DueTile`, `JournalTile`, `TaskLine`, l'import de `ScheduleDialog`), les clés `project.overview.*` non reprises.
- Nouveau : A-1 à A-7 (le phare dépend du modèle de maturité du domaine Jalons).

### 2.3 Travail (remplace `M:routes/ProjectActivityPage.tsx`, `M:routes/ProjectJournalPage.tsx`)
- Existe sur main : l'Activité groupée par état ou par worktree (`?groupe=worktree`, `WorktreeGroups`, `lib/worktree-groups.ts`, dépliement des demandes sur place), le Journal (`JournalView`), le nettoyage **réel** d'un arbre avec son plan (`useWorktreeCleanupPlan`, `useCleanWorktree`, `CleanMergedDialog` « Nettoyer les N fusionnés »), les branches sans arbre (`LooseBranches`), le panneau git sur la portée projet, le graphe (`useGraph`, `GraphRow`, `CommitDetail`), `ThreadRefDto` sur les nœuds, `MilestoneBanner`, `SessionRow`, `parseActivityFilter`.
- Change : une seule page, une barre, six vues ; le nettoyage passe par un dialogue unique (T-12) qui réunit arbres et branches, mais doit garder ce que le plan réel dit (sessions archivées, sessions au travail attendues, services arrêtés, terminaux) ; la liste des sessions par état devient la vue « Par état » ; le Journal devient la vue « Par moment ».
- Nouveau : verdicts d'arbre (T-10), taille sur disque, index, couloirs, Frise, Graphe projet avec colonne « Dans Solera », tiroir d'un arbre, tiroir d'un commit avec ses sessions, gestes de branche, « + Session » avec choix de l'arbre.
- Disparaît : `ProjectActivityPage`, `ProjectJournalPage`, `WorktreeGroups` (+ story), `lib/worktree-groups.ts` si plus rien ne l'importe (le portefeuille l'utilise peut-être : vérifier), les clés `projectActivity.*` non reprises, la suite `project-activity-ui-check.mjs` réécrite.

### 2.4 Tableau (`M:routes/BoardPage.tsx`)
- Existe : kanban `dnd-kit` (glisser avec réordonnancement **persisté** `useReorderCards`, ordre `manual | recent | oldest` en réglage utilisateur `boardOrder`), feuilles seulement, non acceptées en tête, filtre par parente `?parente=`, recherche, repli des colonnes fermées, ajout rapide par colonne (« + » en pied), au téléphone **une colonne à la fois avec une rangée d'onglets de colonnes**, tiroir `CardPanel` (`?carte=`, éditeur complet), `NewCardDialog` (`?nouvelle=1`), `ActionsLauncher`, bouton du panneau de droite, `SidePanel`.
- Change : barre une ligne (B-1), trois vues, filtres par jalon/état/échéance/agent, tri « Ce qui t'attend », colonnes Fait/Abandonné étroites repliables, couloirs par jalon, tuile refaite (B-3).
- Nouveau : Liste avec clavier, Par geste, teintes de jalon.
- Disparaît : `?parente=` (remplacé par Filtrer › Jalon), menu d'ordre, bouton « Fermées », `ActionsLauncher`, bouton et montage du panneau de droite, texte d'aide de la barre, « Découper en cartes ».
- **Absent du prototype mais présent sur main — à trancher (§2.6)** : ordre manuel et réordonnancement dans une colonne ; navigation par colonne au téléphone ; ajout rapide par colonne ; `CardPanel` (édition complète) au lieu de la fiche commune.

### 2.5 Réglages (`M:routes/ProjectPage.tsx`, 750 lignes)
- Existe : une colonne de cartes (`max-w-2xl`) — en-tête avec badges, carte-lien Board, carte-lien Worktrees, `ProjectInstructions`, `ProjectMemory` (lecture, édition, suppression **réelles**), `ProjectSkills` (ajout réel), `ProjectImage` (réel), `ProjectDesignSystem` (+ `PrototypeCandidates`), `ProjectIssueSource` (réel), `ProjectEnvironment` (+ `ProjectDevcontainer` et `ConfinedServicesSetting`), `ProjectAgentSettings` (niveau projet de la configuration, réel), `ProjectSettings` (nom, chemin, visibilité, points de reprise, retrait avec confirmation).
- Change : une page à menu gauche, des rangées à plat, un brouillon unique et une barre d'enregistrement, la recherche ; les réglages d'agent passent de l'éditeur en bloc à des rangées avec héritage ; les consignes gagnent « ce que lit chaque CLI » et les alertes ; la mémoire gagne types, index, réparation, création et liens.
- Nouveau : le **cap** (aucun champ serveur), la couleur dans les Réglages.
- Disparaît : cartes-liens, en-tête, `max-w-2xl`, le `⋯` de couleur de la bande (spec Coque).
- **Absent du prototype — à garder** : l'éditeur du dev container (`ProjectDevcontainer`, rangée « Dev container » dans Exécution), les candidats Storybook (`PrototypeCandidates`) et l'édition de la source d'issues et du design system (le proto ne les montre qu'en lecture : la vraie rangée doit écrire, avec les composants de main).

### 2.6 Questions à trancher avec Tim (avant les cartes concernées)
1. Tableau : l'ordre manuel (glisser pour réordonner dans une colonne, `boardOrder: manual`) disparaît-il au profit du tri « Ce qui t'attend » ? (Proposition : oui, et `boardOrder` migre vers le tri de l'affichage.)
2. Tableau au téléphone : garder la rangée « une colonne à la fois » de main, ou le défilement horizontal du proto ?
3. Tableau : le « + » d'ajout rapide en pied de colonne disparaît-il ?
4. Fiche d'une carte depuis le Tableau : la fiche commune (`?fiche=`) ou l'éditeur complet `CardPanel` (`?carte=`) ? Un seul paramètre doit survivre (`?carte=` est produit par la palette, le journal, les liens de carte…).
5. Code en cours (Aperçu) et ⋯ d'un arbre : « Fusionner la PR #n » ouvre-t-il la PR (proto de l'Aperçu) ou fusionne-t-il réellement (menu de Travail) ? (Proposition : fusion réelle avec confirmation, PP-09.)
6. Travail : filtres retenus par projet (proto) alors que ceux du Tableau ne le sont pas — aligner ?
7. Travail : « Nettoyer · N » compte les arbres, ou les branches si aucun arbre — afficher plutôt le total ?
8. Réglages : où ranger le dev container et les candidats Storybook (absents du proto) ?

---

## 3. Ce que le prototype simule, et ce qu'il faut rendre réel

### 3.1 Gestes « Simulé »

| Geste (proto) | Fichier | Réel | Serveur |
| --- | --- | --- | --- |
| Aperçu › Rebaser sur main | `CodeGraph.tsx` | session de l'arbre : lui envoyer « rebase sur <base> » ; sans session : `branch-rebase`/`rebase-start` sur l'arbre | envoi de message : **existe** ; git sur un arbre sans session : **à créer** (S5) |
| Aperçu › Nettoyer l'arbre (`window.confirm`) | `CodeGraph.tsx` | dialogue de nettoyage avec le plan réel | `GET/POST /api/projects/:id/worktrees/cleanup` : **existe** |
| Aperçu › Voir le diff d'un arbre sans session | `CodeGraph.tsx` | panneau git sur l'arbre | **à créer** (S5) |
| Travail › Nettoyer (dialogue unique) | `UneLigne.tsx`, `TravailPanels.tsx` | arbres : plan + cleanup par arbre ; branches : suppression des fusionnées | arbres **existe** ; branches en lot **à créer** (S8) |
| Travail › + Session (démo) | `UneLigne.tsx` | `/c/new?worktree=` | **existe** |
| Arbre › Rebaser | `shared.tsx`, `ProjectCodePage.tsx` | comme l'Aperçu | S5 |
| Arbre › Diff sans session | `shared.tsx` | le proto ouvre le panneau **de la racine** (faux) | S5 |
| Arbre › Fusionner la PR | `ProjectCodePage.tsx` | fusion par la forge | **à créer** (S7) ; `forge.mergePullRequest` existe côté service |
| Branche › Ouvrir dans un worktree | `branches.tsx` | `POST /api/projects/:id/worktrees` `{ name: <branche> }` (branche existante acceptée) | **existe** |
| Branche › Lancer une session dessus | `branches.tsx` | créer l'arbre puis `/c/new?worktree=<id>` (le proto va à `/c/new` sans arbre : faux) | **existe** |
| Branche › Diff avec la base | `branches.tsx` | diff `base...branche` dans un tiroir | **à créer** (S6) |
| Branche(s) › Supprimer | `branches.tsx` | suppression après vérification « fusionnée » | `git/act branch-delete` existe, un par un et sans garde « fusionnée » → lot **à créer** (S8) |
| Tableau › glisser, 1–4 de la Liste | `data.ts` (`move` local) | `PATCH /api/cards/:id { column }` (`useMoveCard`) | **existe** |
| Tableau › + Carte | `OneLineBoard.tsx` | `NewCardDialog` | **existe** |
| Réglages › Enregistrer | `model.tsx` | un `PATCH /api/projects/:id` (champs du brouillon) + les `configLayer` des rangées d'agent | **existe**, sauf `cap` (S9) |
| Réglages › Parcourir | `model.tsx` | `DirectoryPicker` / `PathField` | **existe** |
| Réglages › Image Changer/Retirer | `model.tsx` | `PUT/DELETE /api/projects/:id/image` | **existe** |
| Réglages › Retirer le projet | `model.tsx` | confirmation + `DELETE /api/projects/:id` + retour à l'accueil | **existe** |
| Réglages › « modifié ici ↺ » | `flat.tsx` | `configLayer: { scope, unset: [champs] }` | **existe** |
| Réglages › Ajouter un skill | `flat.tsx` | le menu d'ajout de `ProjectSkills` | **existe** |
| Consignes › changer de mode, Enregistrer | `knowledge.tsx` | `PATCH /api/projects/:id/instructions` ; fichier du dépôt : `PUT …/instructions/repo-file` | **existe** |
| Mémoire › créer, modifier, supprimer, réparer l'index | `knowledge.tsx` | `PUT/DELETE /api/projects/:id/memory/:file` (l'index est un fichier comme un autre) | **existe** |

### 3.2 Données simulées ou devinées

| Donnée | Où | Besoin |
| --- | --- | --- |
| **Taille d'un arbre** et de la racine (`simulatedSize`) | `prototype-code/data.ts` | **S1** : `sizeBytes: number \| null` par arbre et pour la racine dans `WorktreeStatusListDto`, mesuré en tâche de fond (`du -sb` ou parcours `lstat`), mis en cache longtemps (10 min, invalidé par le nettoyage), `null` tant que non mesuré. |
| **Date du dernier commit** d'une branche sans arbre | `branches.tsx` | **S2** : `lastCommitAt`, `head`, `subject` sur `branches[]` (aujourd'hui `{ name, merged }`). |
| **Avance / retard sur la base** d'une branche sans arbre | `branches.tsx` | **S2** : `ahead`, `behind` (comme pour un arbre). |
| **Derniers commits** propres à une branche | `branches.tsx` (`simulatedCommits`) | **S2** : `recentCommits: { hash, shortHash, subject, ts }[]` (3, `base..branche`). |
| **Branches distantes seules** | `prototype-code/data.ts` (démo) | **S2** : `remoteOnly: true` pour les `refs/remotes/<remote>/x` sans locale (HEAD exclu), jugées fusionnées comme les locales. (La route `refs` existe mais ne dit ni la base ni l'état.) |
| **Carte d'un arbre / d'une branche** (dernière session, sinon `feat/153-…` → #153, « HEURISTIQUE ») | `prototype-overview/data.ts`, `prototype-code/data.ts`, `branches.tsx` | **S3** : `card: { id, number } \| null` sur chaque arbre et chaque branche, résolu côté serveur : carte de la session la plus récente de l'arbre, sinon la carte donnée à la création (`createWorktreeBody.cardId`, à **stocker** : colonne `worktrees.card_id`), sinon le numéro du nom de branche s'il désigne une carte du projet ; `cardSource: 'session' \| 'created' \| 'name'` pour marquer la déduction. |
| **Tour qui a produit un commit** (« aucune route ne le rend ») | `CommitSessions.tsx` | **S4** : `GET {portée}/commits/:hash/turn` → `{ conversationId, title, turn, message } \| null`, en cherchant le point de reprise (`refs/solera/checkpoints/<fil>/<tour>/before|after`, dont la méta garde HEAD) tel que `before.head` n'est pas descendant du commit et `after.head` l'est. En repli, `ThreadRefDto` peut porter plusieurs candidats (`candidates?: ThreadRefDto[]`). |
| Services qui servent un arbre (`ServiceMark`) | `prototype-automations/served.tsx` | domaine Actions (`service.cwd` existe ; le commit servi n'est pas lisible). |
| Concurrence d'un pilotage (`runConcurrency`, 3 par défaut) | `prototype-overview/v2/data.ts` | **existe** : `MilestoneRunDto.concurrency` (`useActiveMilestones`). |
| Drapeau « jalon » (`flags.ts`, localStorage) | Tableau B-2.1, Aperçu | domaine Jalons (champ serveur sur la carte). |
| **Cap** du projet (localStorage `proto-cap-<id>`) | `prototype-settings/model.tsx` | **S9** : `projects.heading: text \| null` (≤ 200 car.), dans `ProjectDto` et `updateProjectBodySchema` ; lu par l'horizon des jalons et donné à l'agent d'affinage (domaine Jalons). |
| Demandes de jalon (affinage, brouillon, PR finale) | `prototype-milestones/demo-store.ts` | domaine Jalons. |
| Durées de session de la Frise (démo) | `UneLigneViews.tsx` | rien : `createdAt` / `updatedAt` des conversations suffisent. |

### 3.3 Les routes et champs serveur à créer (récapitulatif)

- **S1** — `WorktreeStatusDto.sizeBytes`, `WorktreeStatusListDto.rootSizeBytes` (nouveau module `apps/server/src/worktrees/disk-usage.ts`, appelé par `status-service.ts` hors du chemin critique : une liste rendue sans tailles puis complétée, `fresh` reste vrai).
- **S2** — `WorktreeStatusListDto.branches[]` : `{ name, merged, remoteOnly, head, subject, lastCommitAt, ahead, behind, recentCommits, card }` (`assess.ts › looseBranches`).
- **S3** — `card` / `cardSource` sur `WorktreeStatusDto` et sur les branches ; migration `worktrees.card_id` ; `create.ts` l'écrit.
- **S4** — `GET /api/{projects|conversations}/:id/commits/:hash/turn`.
- **S5** — une troisième portée de `workspace-scopes.ts` : `worktree:<id>` → `/api/worktrees/:id/…` (cwd = chemin de l'arbre, projet = celui de l'arbre), pour `git/state`, `git/act` (rebase), `graph`, `commits/:hash/detail`, fichiers ; `lib/workspace-scope.ts` apprend `worktreeScope(id)` ; le panneau git s'ouvre sur cette portée depuis Travail et l'Aperçu.
- **S6** — `GET /api/projects/:id/compare?base=<ref>&head=<ref>` → `{ files: DiffFileDto[], patch, truncated, ahead, behind }` (lecture seule, dans `git-views.ts`).
- **S7** — `POST /api/projects/:id/pull-requests/:number/merge` (propriétaire ; `forge.mergePullRequest` avec le SHA de tête lu sur la forge ; 409 si la PR n'est pas prête ; invalide le cache des PR et des worktrees). Partagé avec la PR finale d'un jalon.
- **S8** — `POST /api/projects/:id/branches/cleanup { names: string[] }` → `{ deleted: string[], refused: { name, reason }[] }` : rejuge « fusionnée » côté serveur (même règle que `looseBranches`), refuse la base et les branches sorties dans un arbre, supprime les locales (`git branch -d`, `-D` si fusionnée par PR squash), passe par le verrou et le journal d'annulation de `git-actions.ts`.
- **S9** — `projects.heading`.

---

## 4. Composants génériques à extraire

### 4.1 Design system (`~/projects/solera-ds`, épinglé ensuite dans les deux `package.json`)

Les primitives ne savent rien du produit (`AGENTS.md` du DS) : seuls entrent ici des
composants sans CLI, carte, projet ni texte de Solera (les libellés sont passés en props).

| Primitive | API proposée | Source proto |
| --- | --- | --- |
| `ToolbarSearch` | `{ value, onChange, placeholder, clearLabel }` — compacte, s'élargit au focus / remplie | `ViewSwitch.tsx` |
| `ToolbarButton` (+ `toolbarButtonClass`) | `{ active?, icon, count?, children, …button }` — hauteur de `Button sm` (36 px souris, 44 doigt) | `ViewSwitch.tsx` |
| `FilterChip` | `{ children, onClear, clearLabel, title? }` | `ViewSwitch.tsx` |
| `MenuHeading`, `MenuCheck`, `MenuSegment` | `MenuCheck { checked, onChange, aside?, children }` (`role=menuitemcheckbox`) ; `MenuSegment<K> { options, value, onChange }` | `ViewSwitch.tsx` |
| `ViewTiles<K>` | `{ options: { key, label, icon }[], value, onChange, columns? }` | `ViewSwitch.tsx` |
| `OneLineToolbar` (gabarit) | `{ search, filter, chips, extra?, display, action? }` — `h-12`, gouttière de la page | `ViewSwitch.tsx` |
| `Drawer` + `useEscapeLayer` | `{ open, onClose, label, title?, subtitle?, width: 'normal' \| 'wide', layerId? }` ; Échap ferme la couche du dessus ; `DrawerLayer` — **si la spec Coque ne la prend pas** | `Drawer.tsx` |
| `ProgressRing` | `{ value 0..1, size, stroke, children }` | `parts.tsx` (`Ring`) |
| `ProgressBar` | `{ value, tone?, className }` (fine, 4 px) | `parts.tsx` (`Bar`), `SubtaskBar`, couloirs du Kanban |
| `SaveBar` | `{ count, labels: { pending, cancel, save }, notice?, onCancel, onSave }` — flottante, centrée | `PageLeftFlat.tsx` (`FlatSaveBar`) |
| `TabCount` trois tons | ajouter `positive` à `neutral \| caution` — **spec Coque** | `ProjectLayout.tsx` |
| Palette catégorielle | 6 teintes (point / texte / lavis) pour distinguer des groupes (jalons) — jetons dans `tokens.ts`, plus de `sky-500` en dur | `prototype-board/data.ts` (`MILESTONE_TINTS`) |

Les pages de règles à mettre à jour dans le DS : `GabaritLieu.mdx` (barre sur une ligne,
gouttière 16/24), `Couches.mdx` (tiroir vs panneau).

### 4.2 Application (`apps/web/src`, avec leur story dans le même commit)

| Composant / module | API proposée | Utilisé par |
| --- | --- | --- |
| `components/inbox/AskInbox` | `{ items: InboxItem[], bare?, className? }` ; `InboxItem` = `session \| light` + genres enregistrés par le domaine Jalons (`refine`, `draft`, `merge`) ; `openInboxItem(key)` ; `inboxMilestoneNumber(item)` ; `ReplyField { placeholder, onSend }` | Aperçu, Travail (Par moment, Par état, couloirs), tiroir d'un commit, fiche de carte, panneau *Projet*, portefeuille, Sessions |
| `lib/inbox.ts` (pur) | `inboxOf({ rows, cards, pullRequests, milestoneOf }) → InboxItem[]` (ordre lourdes/légères, ancienneté) | idem |
| `lib/code-model.ts` (pur) | `TreeRow`, `BranchInfo`, `verdictOf(row, now)`, `isCleanable`, `sortTrees`, `statesOfTree/Branch/Row`, `branchKindOf`, `statusOfLine` (A-4.3), `formatBytes(bytes, locale)`, `scopeOf/rowInTree/entryInTree/inboxInTree`, `shortBranch` | Aperçu, Travail, panneau, portefeuille |
| `lib/code-data.ts` | `useCodeData(projectId, project)`, `useBranchInfos(…)` (sans démo, sans simulation) | idem |
| `components/code/*` | `VerdictDot { verdict }`, `Drift { ahead, behind, dirty, conflicts }`, `PrTag { pr }`, `SessionStack { sessions, max }`, `TreeFacts`, `TreeChip { tree, active, onSelect }`, `BaseLine { code, branches }` (T-2), `MilestoneChip { milestone }` (« ⚑ Jalon #n »), `MaturityTag` (avec le domaine Jalons) | Aperçu, Travail |
| `components/code/CodeGraph` | `{ lines: CodeLine[], settled, projectId }` | Aperçu, panneau *Projet* |
| `components/travail/*` | `TreeLine`, `Lane`, `BranchLane`, `ProjectLane`, `TreeDrawer`, `CleanDialog { request, base, onClose, onDone }`, `ProjectGitGraph`, `CommitSessions`, `StateBoard`, `ActivityTimeline` | Travail, `/projects/travail` |
| `components/activity/ActivityRail` | le `FilBody` (props `bare`, `before`, `inbox`, `showInbox`, `entryAside`, `rowAside`) + `useActivityModel` | Travail, `/sessions` |
| `components/board/*` | `BoardTile`, `useBoardData` (sans déplacement local), `KanbanView`, `ListView`, `GestureView`, `MilestoneTag` | Tableau, `/projects/board` |
| `components/settings-page/*` | `SettingsPage { categories, items, model }` (menu, défilement suivi, palette, téléphone), `SettingRow`, `searchSettings(items, q)` | Réglages du projet (réutilisable pour les réglages globaux plus tard) |
| `lib/view-prefs.ts` | `useView(scope, projectId, keys)` (`?vue=` + souvenir) et `useViewPrefs<T>(key, projectId, defaults)` — réglages d'affichage retenus dans `user-settings` (synchronisés entre appareils : Tim travaille aussi au téléphone), à défaut le `localStorage` | Travail, Tableau, Jalons, Actions |

---

## 5. i18n

Toutes les chaînes du prototype sont en dur ; chacune devient une clé fr + en dans
`M:lib/i18n/catalog-{fr,en}.ts`. Les pluriels suivent la convention existante
(`….one` / `….other`, `{count}`). Les tailles (`formatBytes`) et les dates (Frise,
`dayLabel`) passent par `Intl` avec `locale()` — le proto écrit `fr-FR` en dur. Les noms
d'agents viennent de `AGENT_LABELS` (le proto les recopie).

Familles à créer :

- `toolbar.*` — search.clear, filter, filter.clearAll, filter.remove, display, display.title (« Affichage : {view} »).
- `inbox.*` — title, summary.requests.one/other, summary.review, more, less, empty, gesture.{reply,see,examine,merge,close,review,openPr}, hint.{broken,waiting}, broken.notice, waiting.notice, openThread, reply.placeholder, reply.send, refine.title.one/other, draft.title, draft.after, draft.validate, draft.fix, merge.title, merge.text, merge.action, milestone (« Jalon #{number} »), waitingMark (« {count} t'attend »), resumes (« Le jalon reprend dès ta réponse. »).
- `overview.*` — phare.empty, phare.current, phare.due, phare.noDue, phare.addedSinceLaunch, sessions.count.one/other, sessions.awaiting, sessions.none, waves.summary, wave.label, wave.current, waves.empty, queue.next, queue.later, queue.empty, queue.more, allMilestones, code.title, code.empty, code.settled.one/other, events.title, events.more, events.empty, actions.title, actions.empty, actions.idle, actions.proposed, actions.service, actions.task, actions.open, actions.review, actions.panel, actions.others.one/other.
- `code.*` — status.{broken,awaiting,conflict,running,ciRed,ready,toClean,default,idle}, line.{defaultBranch,noCard}, drift.{ahead,behind,dirty,conflict,upToDate}, action.{reply,openSession,launchHere,diff,diffCount,mergePr,seeCi,openPr,rebase,clean}, foot.{noPr,lastActivity}, verdict.{root,waiting,active,review,mergedDirty,stale,wip,empty,clean,missing}.{label,reason} (raisons avec `{count}`/`{days}`), branchKind.{pr,unmerged,remote,merged}, pr.{draft,checks,failing,ready,merged}, base.{label,rootHere,rootOff}, external, conflictBadge, size.unknown.
- `travail.*` — search.placeholder, what.{trees,branches,sessions,events}, state.{waiting,working,review,prReady,ciRed,stale,cleanup,merged}, period.{all,today,7,30}, section.{what,state,milestone,agent,period}, chip.{tree,branch}, summary.trees.one/other, clean.button, view.{couloirs,fil,tableau,graphe,etat,frise}, display.{index,indexScroll,indexFilter,group,groupNone,groupMilestone,groupState,sort,sortWaiting,sortRecent,sortSize,show,showCleanup,showMerged,showProject}, session.{button,where,root,newTree}, empty.{filters,clear}, index.{all,top,wholeThread,branches,project,projectHint}, group.{noMilestone,branchesNoTree,branchPrefix}, lane.{more,less,quiet}, cleanup.{toggle,nothingLost,action}, mergedBranches.{toggle,hint,action}, branchLane.{noTree,lastCommit,openTree,launch,diff,delete}, table.{branch,sessions,pr,base,disk,seen,noTree,noPr}, graph.{solera,loading,error,notGit,empty,more,working,noTree,openTree,filterOn,filterOff}, commit.{sessions,empty,provenance.{sure,dates,branch,card},status.{awaiting,error,running,unknown,done},openSession,deducedCard,turn}, state.column.{waiting,working,review,done}, state.empty.{waiting,working,review,done}, timeline.{now,legend.{running,awaiting,done,cardClosed,branch,commit},lastCommit}, drawer.{root,facts.{card,milestone,pr,base,baseValue,uncommitted,size,lastUse,path,none},sessionsEvents,sessions,history,noSession,noHistory}, cleanDialog.{title,trees,branches,noTree,andMore.one/other,losing,nothingLost,confirm,nothing,done}, toast.{rebaseAsked,rebased,merged,deleted,error}.
- `board.*` (existant, à compléter) — search.placeholder, filter.{milestone,noMilestone,state,waiting,clarify,accept,due,late,week,agent}, chip.column, view.{kanban,list,gesture}, display.{grouping,none,lanes,done,doneRecent,doneAll,doneHidden,abandoned,sort,sortGesture,sortRecent,sortDue,sortNumber,listHint}, column.{fold,unfold,seeAll,empty}, lane.{openMilestone,waiting,more}, tile.{waiting,accept,clarify,milestone}, list.{state,title,signal,subtasks,sessions,due,seen,done,empty,help,label}, gesture.{forYou,forYouHint,agents,agentsHint,ready,readyHint,blocked,blockedHint,doneWeek,launch,after,empty}. L'onglet devient « Tableau » (fr) / « Board » (en) : `project.board.title`.
- `projectSettings.*` — nav.{title,search,goTo}, category.{general,agents,integrations,danger}, group.{identity,appearance,execution,knowledge,requests,lent,permissions,model,forge,design,irreversible}, item.{name,path,visibility,heading,color,image,environment,autonomous,services,checkpoints,cli,…}.{label,help}, heading.placeholder, image.{change,remove}, services.{shared,copy,copyHint}, inheritance.{inherited,local}, cli.help, search.{placeholder,empty,hint}, save.{pending.one/other,cancel,save,done.one/other}, skills.{none,instance,add,disabled}, issues.{none,cards.one/other,read}, design.none, remove.confirm.
- `instructions.*` (existant, à compléter) — where, deduced, mode.repo.{title,text}, mode.solera.{title,text}, repoFiles, file.{absent,pointsTo,lines,hidden}, readers.{title,cli,global,project,globalOn,empty,soleraText,noFile,codexIgnores,soleraEmpty}, alert.{missing.one/other,rename,diverge}, globalNote, globalEdit, edit.{solera,toCreate,lines,modify,save,cancel,empty}.
- `memory.*` (existant, à compléter) — intro, search, type.{all,user,feedback,project,reference,none}, new, index.{indexed.one/other,unindexed.one/other,orphans.one/other,repair,upToDate}, outOfIndex, linkedTo, toWrite, edit, delete, delete.confirm, delete.alsoIndex, editor.{newTitle,invalidName,addToIndex,create,save,cancel}, empty, noMatch, template.

Clés de main qui disparaissent avec les pages remplacées : `project.overview.*`, `projectActivity.*` (sauf celles de `SessionRow`/`SessionRequestPreview`), `board.order.*`, `board.parent.*`, `board.hint*`, `board.closed`, `project.board.{description,open}`, `project.worktrees.*`, `project.git.{dirty,clean,none}` (si plus utilisées). À vérifier par `grep` avant suppression.

---

## 6. Plan TDD

Les outils qui existent (pas de nouveau lanceur) :

- **Tests unitaires et de route** : `apps/server/test/*.test.ts`, `node:test` + `tsx` (`pnpm --filter @solera/server test`, un fichier : `cd apps/server && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null npx tsx --test test/x.test.ts`). La logique pure du web s'y teste par import dynamique de `../../web/src/lib/x.js`, comme `tool-summary.test.ts` — d'où l'exigence de modules **purs** (`lib/code-model.ts`, `lib/inbox.ts`, `lib/board-model.ts`, `lib/settings-search.ts`, `lib/instructions-readers.ts`, `lib/memory-index.ts`).
- **Composant seul** : une suite `scripts/*-ui-check.mjs` qui le monte par `viteDependency()` (`scripts/checks/vite-deps.mjs`) et lance Chromium par `launchBrowser()`.
- **Parcours** : les suites `scripts/*-ui-check.mjs` sur vrai serveur et vraie base temporaire. Chromium : `LD_LIBRARY_PATH=$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu`. **N'en lancer qu'une, celle qui concerne la carte** : elles écrivent des captures.

| Comportement | Test qui le prouve | Où |
| --- | --- | --- |
| Verdict d'un arbre, dans chaque cas et dans l'ordre (T-10.1) | table de cas `verdictOf` | `test/code-model.test.ts` (nouveau) |
| Statut d'une ligne du graphe (A-4.3), arbres « vivants » vs comptés à nettoyer (A-4.6), ordre (A-4.5) | `statusOfLine`, `liveTrees` | `test/code-model.test.ts` |
| États filtrables d'un arbre / d'une branche / d'une session (T-1.2) | `statesOfTree/Branch/Row` | `test/code-model.test.ts` |
| Rattachement événement/session → arbre (worktree avant racine, racine non cherchée par son nom) | `entryInTree`, `rowInTree`, `treeOf` | `test/code-model.test.ts` |
| `formatBytes` en fr et en en | cas limites Ko/Mo/Go | `test/code-model.test.ts` |
| Ordre et genres de « Ce qui t'attend » (A-2.3, A-2.12) | `inboxOf` | `test/inbox.test.ts` (nouveau) |
| Feuilles, jalon le plus proche, idée exclue, teintes, tri « Ce qui t'attend » (B-2, B-4.2) | `boardModel` | `test/board-model.test.ts` (nouveau) |
| Filtres du Tableau (états en « ou », échéance, agent, colonne) et recherche `#12` (B-1) | `passes`, `matches` | `test/board-model.test.ts` |
| Sections Par geste, une carte une fois (B-6) | `gestureSections` | `test/board-model.test.ts` |
| Recherche des réglages sans accents, tous les mots (R-2.2) | `searchSettings` | `test/settings-search.test.ts` (nouveau) |
| Ce que lit chaque CLI, renvois, divergence (R-6.3, R-6.4) | `readersOf(mode, files, global)` | `test/instructions-readers.test.ts` (nouveau) |
| Parse d'une note, index, orphelines, réparation (R-7.3, R-7.7) | `parseNote`, `indexEntries`, `repairIndex` | `test/memory-index.test.ts` (nouveau) |
| S1 taille d'un arbre et de la racine, cache, invalidation au nettoyage | dépôt temporaire, fichier de N octets → `sizeBytes ≥ N` | `test/worktree-status.test.ts` (étendre) |
| S2 branches : date, avance/retard, 3 commits, distantes seules, fusion jugée | dépôt + remote bare temporaires | `test/worktree-status.test.ts` |
| S3 carte d'un arbre (session > création > nom), colonne `card_id` | route `/worktrees/status` | `test/worktree-status.test.ts` + migration |
| S4 commit → tour (dans le tour, hors tour, plusieurs candidats) | points de reprise réels | `test/checkpoints.test.ts` (étendre) ou `test/commit-turn.test.ts` |
| S5 portée worktree : `git/state`, `graph`, `git/act` rebase sur un arbre sans session ; refus hors projet | routes | `test/git-write.test.ts` / `test/git-graph.test.ts` (étendre) |
| S6 compare base…branche | route | `test/git-graph.test.ts` (étendre) |
| S7 fusion d'une PR (forge simulée), 409 si non prête, propriétaire seul | route | `test/pull-requests.test.ts` (étendre, forge factice comme `reviews`) |
| S8 suppression en lot : fusionnées supprimées, non fusionnée / base / sortie dans un arbre refusées | route | `test/worktree-status.test.ts` ou `test/branches-cleanup.test.ts` |
| S9 cap : PATCH, longueur, partage en lecture | route | `test/api-projects.test.ts` (étendre) |
| Barre une ligne : filtres → puces → effacer ; `?vue=` partagé ; souvenir par projet | composant monté | `scripts/toolbar-ui-check.mjs` (nouveau) |
| `AskInbox` : 3 lignes + « N de plus », un seul dépliement, Entrée envoie / Maj+Entrée, `openInboxItem` | composant monté | `scripts/inbox-ui-check.mjs` (nouveau) |
| Aperçu : ordre des blocs, phare, graphe des branches et ses gestes, liens corrigés (Actions, Travail) | parcours | `scripts/places-ui-check.mjs` (étendre ; il couvre déjà l'Aperçu) |
| Travail : redirections `/activity`, `/journal`, `?groupe=worktree` ; six vues ; filtres ; index ; tiroirs ; nettoyage réel (plan, perte annoncée) ; téléphone sans débordement | parcours | `scripts/project-activity-ui-check.mjs` → renommée `scripts/travail-ui-check.mjs` ; `scripts/worktree-status-ui-check.mjs` (ses étapes « Activité groupée par worktree » passent à Travail) |
| Graphe : colonne « Dans Solera », tiroir de commit et provenance | parcours | `scripts/git-ui-check.mjs` (étendre) ou `travail-ui-check.mjs` |
| Tableau : trois vues, glisser réel, 1–4, Fait repliée, « Tout voir », couloirs, + Carte, fiche sur place | parcours | `scripts/board-ui-check.mjs` (réécrire ses étapes de kanban) ; `scripts/frontend-ui-check.mjs` (son étape board) |
| Réglages : menu suivi, `/`, brouillon → barre → PATCH, héritage, consignes, mémoire, partagé en lecture, téléphone | parcours | `scripts/project-settings-ui-check.mjs` (nouveau ; `settings-ui-check.mjs` couvre la modale globale, pas le projet) + entrée `test:project-settings-ui` dans `package.json` |

Toute carte se termine par `pnpm typecheck` et `pnpm --filter @solera/server test`.

---

## 7. Découpage en cartes

Chaque carte = une session, une PR, faite en TDD. « Proto » = fichiers de référence à
reproduire 1:1 (dans le worktree `proto__page-projet`, à lire, jamais à fusionner).
`[COMMUNE]` = composant partagé avec d'autres specs du dossier : à fusionner avec la
carte équivalente si une autre spec la propose déjà.

### Socle

**PP-01 [COMMUNE] Kit « barre sur une ligne » (design system + `useView`)**
- À faire : ajouter au DS `ToolbarSearch`, `ToolbarButton`, `FilterChip`, `MenuHeading`, `MenuCheck`, `MenuSegment`, `ViewTiles`, le gabarit `OneLineToolbar` (stories, page `GabaritLieu.mdx`), pousser, épingler ; dans l'app `lib/view-prefs.ts` (`useView`, `useViewPrefs` adossé à `user-settings`).
- Proto : `P:components/prototype/ViewSwitch.tsx` ; usages `P:routes/prototype-board/OneLineBoard.tsx`, `P:routes/prototype-travail/UneLigne.tsx`.
- Acceptation : T-1.1, T-1.3, T-1.6 (tuiles), T-1.8 (mécanique), B-1.6 ; hauteurs 36/44 px ; puces qui défilent sans passer à la ligne ; libellés fournis par l'app (i18n `toolbar.*`).
- Tests : stories du DS ; `scripts/toolbar-ui-check.mjs` ; `useViewPrefs` (souvenir par projet) dans un test de route `user-settings`.
- Dépendances : aucune.

**PP-02 [COMMUNE] Tiroir commun et couche Échap**
- À faire : `Drawer`, `DrawerHeader`, `useEscapeLayer`, `DrawerLayer` (DS si la règle le permet, sinon app) ; deux largeurs ; plein écran au téléphone ; Échap ferme la couche du dessus et laisse un menu Radix se fermer seul ; clic dehors ferme ; focus entrant.
- Proto : `P:components/prototype/Drawer.tsx`.
- Acceptation : T-11.1 (géométrie), décision « Panneaux latéraux » ; un menu ouvert dans le tiroir se ferme sans fermer le tiroir.
- Tests : composant monté (Échap empilé, menu Radix, clic dehors).
- Dépendances : calque posé par la coque (spec Coque) — sinon repli `fixed`.

**PP-03 [COMMUNE] « Ce qui t'attend » : une liste, une ligne par demande, réponse sur place**
- À faire : `components/inbox/AskInbox`, `lib/inbox.ts` (`inboxOf` pour les sessions et les « légères »), registre de genres extensible pour le domaine Jalons, `openInboxItem`, `ReplyField`.
- Proto : `P:components/prototype/AskInbox.tsx`, construction réelle dans `P:routes/prototype-overview/v2/data.ts` (branche non-démo) et `P:routes/prototype-overview/data.ts` (`asks`).
- Acceptation : A-2.1 à A-2.8, A-2.10 à A-2.12 (A-2.9 rendu possible pour le domaine Jalons).
- Tests : `test/inbox.test.ts` ; `scripts/inbox-ui-check.mjs` (réponse réelle par `SessionRequestBody`).
- Dépendances : aucune.

**PP-04 Modèle « Code » : arbres, verdicts, branches, rattachement au fil**
- À faire : `lib/code-model.ts` (pur) et `lib/code-data.ts` (`useCodeData`, `useBranchInfos` sans simulation : tailles, dates, avance/retard, commits et distantes valent `null`/vide tant que PP-05/06 ne sont pas là), composants `components/code/*` (`VerdictDot`, `Drift`, `PrTag`, `SessionStack`, `TreeFacts`, `TreeChip`, `BaseLine`, `MilestoneChip`), i18n `code.*` ; `formatBytes` localisé.
- Proto : `P:routes/prototype-code/data.ts`, `VERDICT_TONE`/`PR_LABEL`/`TreeLine` de `P:routes/prototype-code/ProjectCodePage.tsx`, `P:routes/prototype-travail/{branches,shared}.tsx` (hors démo), `P:routes/prototype-overview/v2/parts.tsx`.
- Acceptation : T-10.1 à T-10.4, T-2.1, T-2.2 ; la carte d'une branche reste devinée par son nom jusqu'à PP-07 (marquée comme déduite).
- Tests : `test/code-model.test.ts` (tous les cas de §6).
- Dépendances : aucune.

### Serveur

**PP-05 Taille sur disque des worktrees et de la racine**
- À faire : S1 ; le web affiche la taille (bilan, index, tableau, tiroir, nettoyage « libère X ») ; plus aucune marque « simulé ».
- Proto (où elle se lit) : `TreeSummary`, `TreeFacts`, `Index`, `TreeLine`, `TreeDrawer`, `CleanAllDialog`.
- Acceptation : T-1.4, T-3.2, T-6.2 (colonne Disque, encre forte ≥ 400 Mo), T-11.3, T-12.1, T-12.3, tri « Taille » (T-1.6) ; une liste rendue n'attend jamais la mesure.
- Tests : `test/worktree-status.test.ts`.
- Dépendances : après PP-04.

**PP-06 Branches sans arbre : date, avance/retard, derniers commits, distantes**
- À faire : S2 ; brancher `useBranchInfos` dessus.
- Proto : `P:routes/prototype-travail/branches.tsx` (tout ce qui est `seed`, `simulatedCommits`, `remoteOnly`).
- Acceptation : T-3.3, T-4.5 (faits et commits), T-6.3, T-9.3, T-10.3 (genre « distante seulement »), état « Abandonné ? » d'une branche (14 j).
- Tests : `test/worktree-status.test.ts` (dépôt + remote bare).
- Dépendances : après PP-04.

**PP-07 La carte d'un arbre et d'une branche, rendue par le serveur**
- À faire : S3 (colonne `worktrees.card_id`, migration, `create.ts`, `cardSource`) ; retirer l'heuristique du client ; marquer la provenance « déduite du nom ».
- Proto : `cardOf` de `P:routes/prototype-overview/data.ts`, `cardNumberOf` de `branches.tsx`, `cardOf` de `prototype-code/data.ts`.
- Acceptation : A-4.4 (carte + jalon d'une branche), T-4.3, T-4.5, T-7.8 (« Carte déduite du nom de la branche »), filtre Jalon de Travail sur les branches.
- Tests : `test/worktree-status.test.ts` (trois sources).
- Dépendances : après PP-04.

**PP-08 Portée « worktree » du panneau git, et diff d'une branche avec la base**
- À faire : S5 et S6 ; `worktreeScope(id)` dans `lib/workspace-scope.ts` ; « Diff » et « Rebaser » d'un arbre sans session ouvrent / agissent sur cette portée ; « Rebaser » d'un arbre **avec** session lui envoie la demande ; tiroir « Diff avec la base » d'une branche (fichiers + patch, rendu du `CommitDetail`).
- Proto : `useTreeActions` (`P:routes/prototype-travail/shared.tsx`), `Actions` de `CodeGraph.tsx`, gestes de `BranchLane`.
- Acceptation : A-4.7 (Voir le diff, Rebaser), T-13.1, T-13.2 (Diff avec la base), retour par toast.
- Tests : routes de §6 (S5, S6).
- Dépendances : aucune.

**PP-09 Fusionner une PR et supprimer les branches fusionnées depuis Solera**
- À faire : S7, S8, hooks `useMergePullRequest`, `useCleanBranches`.
- Proto : menu « Fusionner la PR » de `TreeLine`, « Supprimer » de `BranchLane`/`MergedBranches`, section branches de `CleanAllDialog`.
- Acceptation : T-6.2 (Fusionner la PR, avec confirmation), T-4.8, T-12 (branches), refus expliqués (toast par branche refusée).
- Tests : `test/pull-requests.test.ts` (étendre), route S8.
- Dépendances : aucune (le domaine Jalons réutilise S7 pour la PR finale).

**PP-10 Commit → tour : retrouver la session et le tour d'un commit**
- À faire : S4 (+ candidats multiples de `ThreadRefDto` en repli) ; `CommitSessions` affiche « tour N · message » et retire la note « le tour précis n'est pas encore exposé ».
- Proto : `P:routes/prototype-travail/CommitSessions.tsx`.
- Acceptation : T-7.7 (provenance « a écrit ce commit » au tour près), DECISIONS « Commit ↔ session ».
- Tests : `test/commit-turn.test.ts`.
- Dépendances : aucune (consommé par PP-17).

### Aperçu

**PP-11 Aperçu combo : la page, « Ce qui t'attend », Actions, Derniers événements**
- À faire : remplacer `ProjectOverviewPage` par la mise en page `combo` (sans le phare ni le graphe, posés par PP-12/13 : laisser leur place) ; bloc Actions corrigé (renvois à l'onglet Actions) ; Derniers événements (lien vers Travail › Par moment) ; supprimer `NowBlock`, `MilestoneTile`, `DueTile`, `JournalTile`, `TaskLine` et leurs clés.
- Proto : `P:routes/prototype-overview/v2/Combo.tsx`, `P:components/prototype/ProjectActions.tsx`, `Events` de `Dense.tsx`.
- Acceptation : A-1.1 à A-1.4, A-2 (placement), A-5.1 à A-5.4, A-6.1 à A-6.3, A-7.
- Tests : `scripts/places-ui-check.mjs` (ordre des blocs, liens Actions et Travail).
- Dépendances : après PP-03 ; la coque (spec Coque).

**PP-12 Aperçu : « Code en cours » en graphe de branches, et ses gestes**
- À faire : `components/code/CodeGraph` + données (`useOverviewData › code` sans démo) ; gestes réels (session, diff, PR, rebaser, nettoyer avec le plan réel) ; lien « + N arbres fusionnés à nettoyer » vers Travail filtré « À nettoyer ».
- Proto : `P:routes/prototype-overview/v2/CodeGraph.tsx`, `fromLine` de `v2/data.ts`, `code` de `prototype-overview/data.ts`.
- Acceptation : A-4.1 à A-4.7.
- Tests : `test/code-model.test.ts` (statut, vivants) ; `places-ui-check.mjs` (déplier, gestes).
- Dépendances : après PP-04, PP-11 ; PP-08 pour Diff/Rebaser d'un arbre sans session (en attendant : geste masqué) ; PP-09 si « Fusionner la PR » fusionne (§2.6-5).

**PP-13 Aperçu : le phare des jalons**
- À faire : `Phare`, `Current`, `Sessions`, `Waves`, `Queue`, repère « N t'attend » branché sur `openInboxItem` ; `ProgressRing` (DS).
- Proto : `Combo.tsx` (`Phare` et suivants), `toMilestone`/`withWaiting`/`RANK` de `v2/data.ts`, `MaturityTag`/`Ring`/`WaitingMark` de `v2/parts.tsx`.
- Acceptation : A-3.1 à A-3.9.
- Tests : unitaire du rang et de l'aiguillage Ensuite / Plus tard (avec le modèle de maturité) ; `places-ui-check.mjs`.
- Dépendances : après PP-11 ; modèle de maturité, vagues et drapeau « jalon » (spec Jalons).

### Travail

**PP-14 Travail : l'onglet, la barre et la vue « Par moment » (remplace Activité et Journal)**
- À faire : route `/p/:id/travail` ; redirections `/activity` (→ `?vue=couloirs` pour `?groupe=worktree`) et `/journal` (→ `?vue=fil`) ; `useTravail` (modèle d'activité, code, demandes, rattachements) ; barre complète (recherche, Filtrer, puces, bilan, Affichage, + Session ; « Nettoyer » posé en PP-16) ; filtrage du vivant, de l'historique et des demandes ; vue Par moment (`ActivityRail` en mode `bare`, ligne de base, puces d'arbre) ; index en mode filtre ; état « rien ne correspond » ; supprimer `ProjectActivityPage`, `ProjectJournalPage`, `WorktreeGroups` (si plus utilisé).
- Proto : `P:routes/prototype-travail/{UneLigne,shared}.tsx` (barre, filtres, `useTravail`, `useModelWith`), `P:routes/prototype-activity/{FilActivity,shared}.tsx`.
- Acceptation : T-1.1 à T-1.4, T-1.6 à T-1.9, T-2, T-3 (mode filtre), T-5.1 à T-5.8, T-14.1, T-14.2.
- Tests : `test/code-model.test.ts` (états, rattachements) ; `scripts/travail-ui-check.mjs` (renommage de `project-activity-ui-check.mjs` ; redirections, filtres, puces, `?vue=`).
- Dépendances : après PP-01, PP-03, PP-04 ; onglet Travail de la coque (spec Coque).

**PP-15 Travail : vue « Par arbre » et tiroir d'un arbre**
- À faire : `useLanes`, `Lane` (dense), `BranchLane`, `ProjectLane`, `CleanupSection`, `MergedBranches`, regroupement / tri, index en mode défilement (ancres, surbrillance), `TreeDrawer` (ouvert par l'en-tête d'un couloir).
- Proto : `P:routes/prototype-travail/{Couloirs,branches,TravailPanels}.tsx` (`Lane`, `ProjectLane`, `useLanes`, `BranchLane`, `MergedBranches`, `IndexBranch`, `TreeDrawer`), `CouloirsView`, `CleanupSection`, `Index` de `UneLigne.tsx`.
- Acceptation : T-3.1 à T-3.5, T-4.1 à T-4.8, T-11.1 à T-11.4.
- Tests : `travail-ui-check.mjs` (couloirs, index, tiroir, téléphone).
- Dépendances : après PP-14, PP-02.

**PP-16 Travail : vue « Tableau », gestes d'un arbre et d'une branche, « Nettoyer », « + Session »**
- À faire : `TreeLine` (cliquable → tiroir), `BranchRowLine`, `TableView` ; `useTreeActions` réel ; gestes de branche réels ; dialogue unique « Nettoyer » adossé aux plans réels (`GET …/worktrees/cleanup` par arbre : perte, sessions archivées, sessions au travail attendues, services arrêtés) puis `POST` par arbre et S8 pour les branches ; bouton « Nettoyer · N » ; « + Session » réel ; toasts.
- Proto : `TreeLine` de `ProjectCodePage.tsx`, `TableView`/`BranchRowLine` de `UneLigne.tsx`, `useTreeActions` de `shared.tsx`, `CleanAllDialog` de `TravailPanels.tsx`, `sessionMenu` de `UneLigne.tsx`.
- Acceptation : T-1.5, T-1.7, T-6.1 à T-6.5, T-12.1 à T-12.4, T-13.1 à T-13.3.
- Tests : `scripts/worktree-status-ui-check.mjs` (étapes de nettoyage portées sur Travail) ; `travail-ui-check.mjs`.
- Dépendances : après PP-15, PP-08, PP-09.

**PP-17 Travail : vue « Graphe » et tiroir d'un commit**
- À faire : `ProjectGitGraph` sur la portée projet (sans `demoGraph`), colonne « Dans Solera » (`Annotation`, `CardMark`, `PrMark`), mise en retrait hors cible, `since`, étiquettes des fusionnées, pagination ; tiroir large `CommitSessions` + `CommitDetail beside`.
- Proto : `P:routes/prototype-travail/{GitGraph,CommitSessions}.tsx`.
- Acceptation : T-7.1 à T-7.9.
- Tests : `scripts/git-ui-check.mjs` ou `travail-ui-check.mjs` (annotation, tiroir, provenance).
- Dépendances : après PP-14, PP-02 ; PP-10 pour la provenance au tour près (sans elle : `ThreadRefDto` seul).

**PP-18 Travail : vues « Par état » et « Frise »**
- À faire : `StateBoard` et `ActivityTimeline` sur les données réelles (conversations du projet), dates localisées.
- Proto : `StateBoard`, `Timeline` de `P:routes/prototype-travail/UneLigneViews.tsx`.
- Acceptation : T-8.1 à T-8.3, T-9.1 à T-9.5.
- Tests : unitaire de la fenêtre et des graduations ; `travail-ui-check.mjs`.
- Dépendances : après PP-14.

### Tableau

**PP-19 Tableau : barre une ligne, données, Kanban, + Carte**
- À faire : remplacer `BoardPage` : `useBoardData` (sans déplacement local), `BoardTile`, `KanbanView` (colonnes, tri, Fait/Abandonné étroites repliables, « Tout voir » → Liste filtrée, couloirs par jalon, glisser **réel**), barre (filtres, puces, Affichage), `NewCardDialog` ; teintes de jalon depuis la palette du DS ; clic sur une tuile → fiche sur place ; retirer `?parente=`, l'ordre, « Fermées », `ActionsLauncher`, le panneau de droite. Appliquer les réponses aux questions §2.6-1 à 4.
- Proto : `P:routes/prototype-board/{OneLineBoard,KanbanVariant,data,parts}.tsx` (`Tile`, `MilestoneTag`, `SubtaskBar`, `LiveAgents`, `CardFlags`, `DueLabel`).
- Acceptation : B-1.1 à B-1.6, B-2.1 à B-2.4, B-3.1 à B-3.4, B-4.1 à B-4.8, B-7, B-8.
- Tests : `test/board-model.test.ts` ; `scripts/board-ui-check.mjs` (glisser → colonne persistée, Fait repliée, couloirs, + Carte, fiche) ; étape board de `frontend-ui-check.mjs`.
- Dépendances : après PP-01 ; fiche de carte commune (spec Jalons) ; drapeau « jalon » (spec Jalons) pour exclure les idées.

**PP-20 Tableau : vues « Liste » et « Par geste »**
- À faire : `ListView` (groupes, tri par en-têtes, clavier ↑↓ j/k Entrée 1–4 avec `useMoveCard`) et `GestureView` (cinq sections, « Lancer » → destination de la carte).
- Proto : `P:routes/prototype-board/{ListVariant,GestureVariant}.tsx`.
- Acceptation : B-5.1 à B-5.5, B-6.1, B-6.2.
- Tests : `test/board-model.test.ts` (sections) ; `board-ui-check.mjs` (clavier, 1–4 persisté).
- Dépendances : après PP-19.

### Réglages

**PP-21 Réglages : la page à menu gauche, la recherche, le brouillon ; Général et Zone de danger**
- À faire : `components/settings-page/*` (menu, défilement suivi, téléphone, palette `/`, surbrillance, `SaveBar` du DS) ; modèle de brouillon (un seul `PATCH`) ; Général (R-4.1 à R-4.10, dont la rangée « Dev container » si §2.6-8 la garde) ; S9 (cap) ; image réelle ; Zone de danger réelle ; bannière « partagé » ; retirer l'ancien `ProjectPage` (cartes-liens, en-tête).
- Proto : `P:routes/prototype-settings/{PageLeftFlat,model,parts}.tsx` (`useSettingsModel`, `useSettingItems` hors Agents, `EnvironmentPicker`, `AutonomousPicker`).
- Acceptation : R-1.1 à R-1.8, R-2.1 à R-2.3, R-3.1 à R-3.3, R-4.1 à R-4.10, R-10, R-11.
- Tests : `test/settings-search.test.ts` ; `test/api-projects.test.ts` (cap) ; `scripts/project-settings-ui-check.mjs` (nouveau).
- Dépendances : route `/p/:id/settings` dans la coque (spec Coque).

**PP-22 Réglages › Agents : réglages d'agent à plat**
- À faire : rangées de `useFlatItems` (sections R-5.1 à R-5.4, `GroupControl`, `Inheritance`, `AgentPick`) branchées sur `useLevelConfig` : modifications comptées dans la barre, enregistrées avec le reste, « modifié ici ↺ » = `unset`.
- Proto : `P:routes/prototype-settings/flat.tsx` (hors consignes, mémoire, skills, intégrations).
- Acceptation : R-5.1 à R-5.6, R-3.1 (points), R-1.8 (non-propriétaire).
- Tests : `project-settings-ui-check.mjs` (changer un réglage → barre → enregistré au niveau projet ; revenir à l'héritage).
- Dépendances : après PP-21.

**PP-23 Réglages › Agents : Consignes**
- À faire : `InstructionsPanel` réel (mode, fichiers du dépôt, table des lecteurs, alertes, édition du texte de Solera ou du fichier du dépôt) ; `lib/instructions-readers.ts` pur.
- Proto : `P:routes/prototype-settings/knowledge.tsx` (partie consignes).
- Acceptation : R-6.1 à R-6.6.
- Tests : `test/instructions-readers.test.ts` ; `project-settings-ui-check.mjs` (changer de mode, enregistrer `AGENTS.md`).
- Dépendances : après PP-21.

**PP-24 Réglages › Agents : Mémoire, Skills ; Intégrations**
- À faire : `MemoryPanel` réel (types, recherche, index, réparation, création, édition, suppression avec retrait de l'index) ; `lib/memory-index.ts` pur ; Skills à plat avec le menu d'ajout réel ; Intégrations en rangées **éditables** (composants de main `ProjectIssueSource`, `ProjectDesignSystem` + candidats) ; retirer `ProjectMemory` s'il n'a plus d'usage.
- Proto : `P:routes/prototype-settings/knowledge.tsx` (partie mémoire), `SkillsFlat` et `replaced.issues/design` de `flat.tsx`.
- Acceptation : R-7.1 à R-7.8, R-8, R-9.1, R-9.2.
- Tests : `test/memory-index.test.ts` ; `test/memory.test.ts` (déjà là : création d'une note nouvelle et de l'index) ; `project-settings-ui-check.mjs`.
- Dépendances : après PP-21.

### Récapitulatif des dépendances

```
PP-01 ─┬─────────────► PP-14 ─┬► PP-15 ─► PP-16
PP-03 ─┤  PP-11 ─┬► PP-12     ├► PP-17
PP-04 ─┼─────────┘   PP-13    └► PP-18
       ├► PP-05, PP-06, PP-07
PP-02 ─► PP-15, PP-17
PP-08 ─► PP-16 (et PP-12)       PP-09 ─► PP-16 (et PP-12)       PP-10 ─► PP-17
PP-01 ─► PP-19 ─► PP-20
PP-21 ─► PP-22, PP-23, PP-24
Externes : Coque (PP-11, PP-14, PP-21) ; Jalons (PP-13, PP-19) ; Actions (ServiceMark dans PP-15/16/17).
```
