# Page projet v2 — coque, composants partagés, sidebar, portefeuille, sessions

Analyse d'écarts entre le prototype de la branche `proto/page-projet` (worktree
`proto__page-projet`, fichiers non commités compris, état du 2026-11-11) et `main`
(`029af4ae`). Décisions de référence : `docs/audits/2026-11-09-page-projet-v2/DECISIONS.md`.

**Périmètre de ce document** : la coque commune (`PlaceShell`, `ProjectLayout`, bande,
rangée d'onglets, comptes à trois tons, gouttière, Réglages à droite, retrait du ⚡ et du
`⋯`), les composants partagés de `components/prototype/` (barre d'outils sur une ligne,
menus, tiroir et Échap par couches, « Ce qui t'attend », compte des actions, hôte du
panneau), la règle « un seul comportement de panneau par page », la sidebar, la page
`/sessions`, le portefeuille `/projects` v2 et la palette.

**Hors périmètre, renvoyé aux autres domaines** (cités comme dépendances) : le contenu
des onglets d'un projet (Aperçu `combo`, Travail `une-ligne`, Tableau `une-ligne`, Jalons
`flux-v2` / `jalon-v3`, Actions, Réglages `page-gauche`), le panneau de droite
(`components/prototype/panel/*`), la page globale Planifiées v2, le skill
`ranger-une-idee`.

Convention : chaque élément d'inventaire porte un identifiant (`COQ-3`, `SID-12`…). Les
cartes du §7 s'y réfèrent comme critères d'acceptation.

---

## 0. À jeter, sans équivalent dans la vraie version

| Fichier / mécanisme | Raison |
| --- | --- |
| `components/PrototypeSwitcher.tsx`, `components/PrototypeVerdict.tsx` | Outils du proto. |
| `?variant=…` partout (`usePrototypeVariant`, `PortfolioSwitch`, `PORTFOLIO_VARIANTS`, `?variant=actuel`), `?panel=actuel` (`GitPanelHost`, `ConversationPage`) | Bascules de démo : la v2 devient la seule version. |
| `?demo=1`, `DemoToggle` (`prototype-milestones/HorizonVariant.tsx:794`), `demoData()` (`prototype-portfolio/data.ts`), `demoSessions()` (`prototype-sessions/data.ts`), `demoActions` dans `ProjectActions.tsx` / `actionsCount.tsx`, le paramètre `search` de `PlaceShell` (ne servait qu'à propager `?demo=1`) | Jeux fictifs. Les besoins serveur qu'ils révèlent sont au §3. |
| `useNotice()` et ses bandeaux fuchsia « Simulé : … » (`prototype-portfolio/parts.tsx:265`) | Remplacés par les vrais gestes (§3) ; un retour d'erreur réel passe par le `Banner` du DS ou un toast existant. |
| `components/prototype/ActionsHub.tsx` | L'ancien lanceur ⚡ (raccourci `A`) : plus importé nulle part depuis le retrait du ⚡. |
| `ViewSwitch` (contrôle segmenté) et `PageToolbar` de `components/prototype/ViewSwitch.tsx` | Utilisés seulement par les variantes écartées du Tableau (`ViewsBoard`, `prototype-board/parts.tsx`). Le module garde `OneLineToolbar` et ses pièces. |
| `TabMenuOff` / `TAB_MENU_FLAG` (`BoardPage.tsx`) | Le menu ▾ d'onglet de la variante `vues-onglet`, écartée. |
| `ProjectOverview` « lignes » / tris du portefeuille (`Overview.tsx:22-46`, `view` et `sort` figés en constantes) | Branches mortes : la variante retenue est en cartes, triée « ce qui attend d'abord ». |
| `simulatedSize()` (`prototype-code/data.ts:149`) | Taille de disque simulée : à remplacer par une donnée serveur (domaine Travail/Code, voir §3). |
| `DemoConversation.tsx` (redirection des sessions `demo-…`) | Démo. |

---

## 1. Inventaire du prototype

### 1.1 Coque commune — `components/prototype/PlaceShell.tsx`, `routes/ProjectLayout.tsx` (diff), `App.tsx` (diff)

Structure (identique pour un projet et pour le portefeuille) :

- **COQ-1** Trois étages empilés : bande (`HeaderBand`), rangée d'onglets (`nav`), contenu
  (`relative min-h-0 flex-1 overflow-clip`) qui héberge le calque des tiroirs
  (`DrawerLayer`).
- **COQ-2 Gouttière unique** : bande `pl-4 pr-4 md:pl-6 md:pr-6` ; rangée `px-3 md:px-5`
  (elle retranche le `px-1` de `tabItemClass` pour que l'icône du premier onglet tombe sur
  le bord de l'avatar) ; barre d'outils `px-4 md:px-6` ; contenu `p-4 md:p-6`. Les
  tiroirs et le panneau gardent leurs marges. Vérifiable à l'œil : avatar, icône
  d'Aperçu, loupe de la recherche et premier texte du contenu sur une même verticale.
- **COQ-3 Bande** : créneau d'icône 20 px (`size-5`) — avatar du projet ou icône du lieu
  —, titre `h1 text-sm font-medium` tronqué, puis les gestes à droite (`gap-2`), tous en
  `Button size="sm"` ou à sa hauteur. Au téléphone, le bouton de navigation mobile de
  `HeaderBand` précède l'icône (inchangé).
- **COQ-4 Bande d'un projet** : avatar, nom, **un seul geste** « + Conversation »
  (`Plus`, libellé masqué sous `sm`, `aria-label` conservé) → `/p/:id/c/new`.
  **Disparaissent** : la pastille de branche (`Badge GitBranch`), le `⋯` (Réglages +
  couleurs), le ⚡, « Découper en cartes », « + Carte » / « + Tâche ».
- **COQ-5 Rangée d'un projet**, dans cet ordre : Aperçu (`Target`, `end`) · Travail
  (`Layers`) · Tableau (`SquareKanban`) · Jalons (`Flag`) · Actions (`Zap`). Icônes 15 px
  `text-ink-faint`, `gap-5`, défilement horizontal au doigt (le dernier onglet coupé dit
  qu'il y en a d'autres), soulignement `tabItemClass`. Liens vers `/p/:id`,
  `/travail`, `/board`, `/timeline`, `/actions`.
- **COQ-6 Comptes d'onglet à trois tons** (règle : gris = inventaire, ambre = ce qui
  t'attend, vert = ce qui tourne) ; pas de pastille à zéro ; infobulle `title` qui dit ce
  que compte la pastille :
  - Travail : ambre, `askingCount(live, requests)` (sessions qui attendent + en erreur +
    demandes ouvertes) ;
  - Tableau : gris, cartes **feuilles** non fermées (`children.length === 0 &&
    !CARD_CLOSED_COLUMNS`) ;
  - Jalons : aucun compte ;
  - Actions : `actionsTabCount` — ambre « N à relire » d'abord, sinon vert « N en
    marche » (voir ACT-1).
- **COQ-7 Réglages au bout de la rangée** : poussé à droite (`ml-auto`), séparé par un
  filet vertical `h-5 w-px bg-line`, même style d'onglet ; icône `Settings` 15 px +
  libellé « Réglages » masqué sous `sm` ; `aria-label` = « Réglages du projet ». Un lien
  (projet → `/p/:id/settings`, souligné quand actif) ou un bouton (portefeuille → fenêtre
  des réglages de l'instance).
- **COQ-8 Réglages dans la coque** : la route `/p/:projectId/settings` passe **dans**
  `ProjectLayout` (elle était hors coque, plein écran). La page de réglages ne porte donc
  plus de bande à elle (contenu : domaine Réglages `page-gauche`).
- **COQ-9 Pleine largeur** : aucune vue ne plafonne sa colonne ni ne centre un couloir
  (décision « Largeur des pages ») ; seuls des textes dans une ligne peuvent être bornés.
- **COQ-10 Plus d'action de vue dans la rangée** : « + Carte » vit dans la barre d'outils
  du Tableau, « + Tâche » dans l'en-tête des Planifiées (domaines concernés). Le
  paramètre `?nouvelle=1` (`NEW_PARAM`) reste le moyen d'ouvrir le dialogue de création
  d'une vue.
- **COQ-11 Anciennes adresses** (le proto les laisse joignables sans les montrer ; la
  vraie version les redirige, `replace`) : `/p/:id/activity` → `/p/:id/travail` ;
  `/p/:id/journal` → `/p/:id/travail?vue=moment` ; `/p/:id/schedules` →
  `/p/:id/actions` ; `/p/:id/code` (onglet Code du proto, absorbé par Travail) →
  `/p/:id/travail` ; `/projects/activity` et `/projects/work` → `/projects/travail` ;
  `/projects/journal` → `/projects/travail?vue=moment`. Les liens internes qui visent
  encore ces adresses sont corrigés (voir §2.8).
- **COQ-12 Bande « seule »** (pages de lieu sans rangée : `/sessions`, `/schedules` v2) :
  même bande, même gouttière, même créneau d'icône, sans rangée — la page n'a qu'une vue,
  réglée par Affichage ▾ (`SessionsPage.tsx:257`, `PlannedPage.tsx:246`).

### 1.2 Tiroir commun et Échap par couches — `components/prototype/Drawer.tsx`

- **TIR-1** Le *tiroir* passe **par-dessus** le contenu ; le *panneau* (git, fichiers,
  terminal) est ancré et pousse. Même géométrie : sous la rangée d'onglets jusqu'en bas,
  bord gauche fin (`border-l`), sans coins arrondis ; le tiroir seul a une ombre légère
  (`shadow-[-12px_0_32px_-16px_rgb(0_0_0/0.35)]`).
- **TIR-2** Il se pose dans le calque `#…-drawer-layer` de la coque (`absolute inset-0
  z-30`, `pointer-events-none`, `empty:hidden`) ; hors coque (pas de calque dans le
  document), il retombe en `fixed` pleine hauteur `z-40`. Un `layerId` permet un autre
  calque (la conversation pose le sien à gauche de son panneau).
- **TIR-3** Largeurs : `normal` = `min(36rem, 100% − 3rem)`, `wide` = `min(48rem, 100% −
  3rem)` (éditeur d'action). Plein écran au téléphone (`w-full`, largeur seulement à
  partir de `md`). ⚠ La décision « Panneaux latéraux » dit « une seule largeur » : le
  proto en a deux. À trancher avec Tim (voir §7, carte 3).
- **TIR-4** Voile `bg-black/15` sous le tiroir ; **clic dehors ferme** (bouton voile
  `aria-label="Fermer"`, `tabIndex=-1`).
- **TIR-5** En-tête commun `DrawerHeader` : sous-titre méta facultatif au-dessus
  (`text-xs text-ink-faint`, wrap), titre `text-base font-semibold`, `✕` à droite
  (`IconButton size="sm"`, « Fermer »), filet bas, `px-5 py-3.5`. Sans `title`, le
  contenu porte son propre en-tête.
- **TIR-6** `role="dialog"`, `aria-label` ; à l'ouverture le focus entre dans le tiroir
  (sauf si un champ `autoFocus` l'y a déjà mis).
- **TIR-7 Échap ferme la couche la plus haute, et elle seule** : une seule écoute sur
  `window` en **capture** ; pile des couches (`useEscapeLayer(actif, fermer)`) où
  s'inscrivent les tiroirs et tout ce qui s'ouvre dedans sans être un menu Radix
  (autocomplétion `#`, champ de lien en ligne, confirmation sur place) ; si un menu Radix
  est ouvert (`menu`, `listbox`, `dialog` dans `[data-radix-popper-content-wrapper]`,
  ou `alertdialog` ouvert — pas une infobulle), l'écoute s'efface et le tiroir reste
  ouvert ; ignore `defaultPrevented` et la composition IME (`isComposing`).
- **TIR-8 Un seul comportement de panneau par page** : jamais deux panneaux à droite.
  - Page **avec** panneau (une conversation) : un détail s'ouvre **dans le panneau**, en
    pile (« ‹ Actions » pour revenir, Échap remonte d'un niveau — `ActionDrawer` en
    `inline`, `PanelStackHeader` de `panel/PanelTabFrame.tsx`), jamais dans un tiroir à
    côté.
  - Page **sans** panneau (onglets d'un projet, portefeuille, `/sessions`) : le détail
    s'ouvre dans le tiroir commun.
- **TIR-9 Hôte de panneau « appelé »** (`components/prototype/GitPanelHost.tsx`) : sur
  Travail (et l'ex-onglet Code), le panneau git n'a **pas de bouton** pour l'ouvrir ;
  il est monté paresseusement (`usePanelPresence`) quand un geste « Diff » le demande
  (branche par défaut, qui n'a pas de session où s'ouvrir). Plus de panneau ni de bouton
  de panneau sur le Tableau (diff `BoardPage.tsx`).

### 1.3 Barre d'outils sur une ligne — `components/prototype/ViewSwitch.tsx`

- **BAR-1 `OneLineToolbar`** : `h-12`, filet bas, gouttière `px-4 md:px-6`, tout sur
  **une ligne** : recherche · Filtrer ▾ · puces des filtres actifs (zone `flex-1` qui
  **défile horizontalement**, jamais à la ligne) · commandes discrètes (méta, bascule de
  portée) · Affichage ▾ · action principale seule.
- **BAR-2 `ToolbarSearch`** : étroite au repos (`w-36`), s'élargit au focus ou quand
  elle a du texte (`w-56`), transition de largeur ; loupe 16 px ; même rendu que
  « Rechercher » de la sidebar plus un filet ; `✕` « Effacer la recherche » quand non
  vide ; hauteur 44 px au doigt, 36 px à la souris (`h-11 md:h-9 pointer-coarse:h-11`).
- **BAR-3 Bouton de menu** (`toolbarButtonClass(active)`) : hauteur de `Button
  size="sm"` ; état actif (`border-line-strong bg-surface-high`) quand un filtre est posé.
- **BAR-4 Filtrer ▾** (recopié dans chaque page : `OneLineBoard`, `SessionsPage`,
  `PortfolioToolbar`) : popover `w-80`, `align=start`, défilement `max-h-[70vh]` ; icône
  `Filter` 13 + « Filtrer » + pastille accent du nombre de filtres actifs ; sections
  titrées (`MenuHeading`, petites capitales 11 px) ; lignes cochables (`MenuCheck`,
  `role=menuitemcheckbox`, case, compte en regard `aside`) ; choix exclusif
  (`MenuSegment`, `aria-pressed`) ; pied « Effacer tous les filtres » quand ≥ 1 filtre.
- **BAR-5 Puce de filtre** (`FilterChip`) : `h-7`, `max-w-56` tronquée, fond
  `surface-high`, `✕` « Retirer ce filtre ».
- **BAR-6 Affichage ▾** : popover `w-80`, `align=end` ; déclencheur = icône de la vue
  courante + « Affichage » (libellé masqué sous `sm`), infobulle « Affichage : <vue> » ;
  en tête les vues en **tuiles** (`ViewTiles` : grille d'autant de colonnes que de vues,
  icône + libellé, active en bord accent) ; dessous les réglages de présentation de la
  page (tri, couloirs, échelle, « Montrer … »).
- **BAR-7 Mémoire de vue** (`useView(scope, projectId, keys)`) : l'adresse `?vue=`
  d'abord (un lien partage la vue), sinon la dernière choisie dans ce projet
  (`localStorage`), sinon la première ; changer de vue remplace l'entrée d'historique.

### 1.4 « Ce qui t'attend » — `components/prototype/AskInbox.tsx`

Une seule liste pour toutes les sessions qui ont besoin de Tim, réponse sur place.
Consommée par l'Aperçu `combo`, Travail, la fiche de carte, le panneau Projet, le
portefeuille (Aperçu, Travail) et `/sessions`.

- **INB-1 Vide** : « Rien ne t'attend. » précédé d'un rond vert coché.
- **INB-2 En-tête repliable** (sauf `bare`) : « Ce qui t'attend » + résumé « N
  demande(s) · N à relire » (point ambre s'il y a au moins une demande) + chevron ;
  clic = replier/déplier (`aria-expanded`). Le bloc ne se teinte pas.
- **INB-3 Ordre** : les *lourdes* (demandent une réponse : `session`, `refine`, `draft`,
  `merge`) avant les *légères* (demandent un coup d'œil : `light`).
- **INB-4 Densité** : une ligne par demande ; 3 lignes visibles puis « N de plus » /
  « Montrer moins » ; une ligne dépliée au-delà des trois premières reste visible ; **une
  seule réponse dépliée à la fois**.
- **INB-5 Ligne lourde** (`min-h-10`, survol `bg-surface`, dépliée `bg-surface`) :
  icône (agent + point ambre « attend » ou rouge « arrêtée » ; `MessageCircleQuestion`
  ambre pour l'affinage ; `ListTree` accent pour un découpage ; `GitMerge` vert pour une
  PR de jalon) ; titre (`#N titre` si carte, max 18 rem tronqué) ; indice gris (à partir
  de `md`) ; étiquette « Jalon #N » (à partir de `sm`, lien vers le jalon, n'ouvre pas la
  ligne) ; âge (à partir de `sm`) ; geste « Répondre » / « Voir » (session arrêtée) /
  « Examiner » / « Fusionner », qui devient « Fermer » une fois déplié. Un clic sur le
  titre déplie aussi.
- **INB-6 Réponse d'une session** : le corps de demande existant (`SessionRequestBody` :
  question + champ, ou Autoriser/Refuser) puis « Ouvrir le fil → » ; la ligne disparaît
  d'elle-même quand la demande est levée. Session arrêtée ou demande introuvable :
  « La session s'est arrêtée. Ouvre-la pour la relancer. » / « Elle attend dans son fil. »
  (icône `TriangleAlert` rouge) + « Ouvrir le fil ».
- **INB-7 Indice d'une session** : arrêtée → « La session s'est arrêtée » ; démo → le
  texte de la question ; réelle → « Elle attend ta réponse ». La démo révèle le besoin :
  **montrer la question réelle** (résumé de la demande, voir §3).
- **INB-8 Affinage** (`refine`, jalons) : titre « N question(s) d'affinage », indice = la
  première question ; dépliée, chaque question a son champ ; la dernière répondue
  referme la ligne.
- **INB-9 Découpage** (`draft`, jalons) : « Découpage proposé : N cartes », indice = les
  titres ; dépliée, liste numérotée avec « après 1, 2 » ; « Valider » (`Check`) et
  « Corriger dans le jalon ».
- **INB-10 PR de jalon** (`merge`) : « PR du jalon prête », indice `branche → main` ;
  dépliée, phrase + « Fusionner dans main » (`GitMerge`).
- **INB-11 Champ de réponse** (`ReplyField`) : `textarea` d'une ligne qui grandit
  (`field-sizing-content`, max 8 rem), `autoFocus`, Entrée envoie, Maj+Entrée va à la
  ligne, « Envoyer » désactivé tant que vide.
- **INB-12 Ligne légère** : carte à relire (point accent, « Relire → ») ou PR prête
  (`GitPullRequest` vert, « Ouvrir la PR ↗ », nouvel onglet) ; titre, détail (à partir
  de `md`), âge ; toute la ligne est le lien.
- **INB-13 Ouverture à distance** : `openInboxItem(key)` (repère « 1 t'attend » d'un
  jalon) déplie la liste, montre tout si besoin, ouvre la ligne et la fait défiler au
  centre. Règle « une seule liste » : le jalon montre un repère, jamais une seconde boîte.
- **INB-14** `inboxMilestoneNumber(item)` : compte ce qui attend dans chaque jalon.

### 1.5 Compte des actions, retrait du ⚡ — `components/prototype/actionsCount.tsx`, diffs `ProjectLayout.tsx`, `ConversationPage.tsx`, `BoardPage.tsx`

- **ACT-1 `useActionsCount(projectId)`** → `{ running, toReview }` : *running* = services
  d'actions en marche (`actionView(action).live`) + processus lancés par les sessions du
  projet (`GET /api/services`, entrées `kind: 'command'` du projet — même clé de requête
  `['services']` que la page Services, aucune requête de plus) ; *toReview* = actions
  `status === 'proposed'`.
- **ACT-2 `actionsTabCount`** : ambre « N à relire » d'abord (une action à relire attend
  Tim), sinon vert « N en marche », sinon rien.
- **ACT-3 Bouton du panneau d'une conversation** : un point (ambre s'il y a à relire,
  sinon vert si quelque chose tourne) posé en haut à droite de l'icône `PanelRight`
  (`ring-2 ring-canvas`) ; le nom accessible devient « Ouvrir le panneau — 2 en marche ·
  1 à relire ».
- **ACT-4 `ActionsStatusMeta`** dans la ligne d'outils des deux onglets Actions (projet
  et panneau) : « ● N en marche » (vert, point qui pulse) et « ● N à relire » (ambre),
  chacun **cliquable** vers son groupe (`scrollToAnchor`, défilement doux) ; infobulles
  « Aller à ce qui tourne » / « Aller aux actions à relire ».
- **ACT-5 Retrait du ⚡** (`ActionsLauncher`) : de la bande du projet, de la barre du
  board, de l'en-tête d'une conversation. L'onglet Actions (du projet ou du panneau) est
  à un clic et tient tout.
- **ACT-6** Les signaux d'une conversation ouvrent l'onglet qui les tient : travaux de
  fond → onglet Actions du panneau, sous-agents → Agent (diff `ConversationPage.tsx`,
  domaine panneau, cité pour mémoire).

### 1.6 Sidebar — `components/sidebar/*`, `SidebarActivity.tsx`, `lib/sidebar.ts`, `lib/prototype-sidebar.ts`, `routes/AppearanceSection.tsx` (diffs)

Structure et alignement :

- **SID-1 Un seul bloc qui défile** : lieux, Activité, projets et leurs sessions
  défilent ensemble (comme la colonne de Claude). Restent fixes : la bande (logo,
  replier), le bloc « Rechercher / Nouvelle conversation », le menu du compte en bas.
- **SID-2 Gouttière de barre réservée** (`scrollbar-gutter: stable`) sur la bande, le
  bloc du haut et le bloc qui défile : rien ne se décale quand la barre paraît, les
  icônes de droite restent sur une même colonne.
- **SID-3 Colonne d'icônes** : toutes les lignes (lieux, en-tête et lignes de l'Activité,
  « pour toi », sessions, groupes de projet, fils libres, lignes de fin) posent leur
  icône dans un **créneau de 16 px centré** (`w-4 justify-center`), `gap-2.5 px-2.5` :
  les icônes forment une colonne unique.
- **SID-4** Boutons de la bande (fermer au téléphone, replier au large) en `size="sm"`
  (28 px) : centrés à 26 px du bord, comme le `⋯` d'un projet.
- **SID-5 Mode « un seul projet »** (`FocusedProject`) : un peu d'air sous le filet
  (`pt-2`) ; plus de fond au survol sur toute la ligne (chaque geste — ⇅, nom, +, ⋯ — a
  son propre survol, le nom a `rounded-md hover:bg-surface-high`) ; le ⇅ posé sur la
  colonne d'icônes (`pl-1`).

Nombre de sessions et lignes de fin :

- **SID-6 Réglage « Sessions dans la sidebar »** : `Ajuster à la hauteur` (défaut) / 10 /
  20 / 50. Dans tous les cas la session ouverte et celles qui t'attendent
  (`awaiting_input`, `error`) restent affichées ; elles comptent dans le budget et le
  reste se remplit dans l'ordre (`cutToBudget`, `mustShow`).
- **SID-7 « Ajuster à la hauteur »** (au large seulement) : le nombre de lignes de
  session **par liste** qui tient sans faire défiler la colonne, **mesuré** (et non
  calculé) : on retire `ceil(débord / hauteur de ligne)` lignes, ou on en rajoute
  `floor(place / hauteur / listes coupées)` si au moins une liste est coupée ; remesure à
  chaque redimensionnement ou changement de contenu (`ResizeObserver` sur la colonne et
  le contenu) ; hauteur de ligne lue sur la première (36 px, 44 au doigt). Au téléphone,
  « Ajuster » vaut 10.
- **SID-8 Repli de l'Activité** (« Ajuster » seulement) : l'Activité garde son quart de
  colonne tant qu'au moins **5 sessions** tiennent sous elle ; sinon elle se réduit à son
  en-tête (le rendu du téléphone) ; elle se redéplie quand la place gagnée laisserait
  encore 5 sessions (hystérésis entre les deux seuils, pas de clignotement).
  L'Activité mesure désormais la hauteur **visible** du bloc qui défile
  (`[data-sidebar-scroll]`), pas son contenu.
- **SID-9 Ligne de fin unique d'un groupe** : « Toutes les sessions du projet · N → »
  (icône `MessagesSquare`, compte = sessions **archivées comprises**, hors planifiées,
  flèche) → `/sessions?projet=<id>`, montrée quand le total dépasse ce qui est affiché.
  Fils libres : « Toutes les sessions sans projet · N → » → `/sessions?projet=none`,
  montrée s'il y a des archivées ou une coupe. **Disparaissent** : « N autres
  sessions… / Moins », la section repliée « Archivées (N) ».
- **SID-10 Lieu *Fils*** : coupé au budget (au plus 40) ; ligne de fin « Toutes les
  sessions · N → » (N seulement s'il y a une coupe) → `/sessions` ; remplace « Tout
  l'historique… » qui ouvrait la palette.
- **SID-11 *Fils* devient une destination** : sa ligne mène à `/sessions` (avec le « ↗ »
  au survol comme les autres lieux) ; `/sessions` allume le lieu *Fils*
  (`placeOfPath`).
- **SID-12 Réglage dans Apparence** : carte « Sessions dans la sidebar » (icône
  `PanelLeft`), description « Ajuster à la hauteur : pas de défilement, le reste est
  dans « Toutes les sessions ». », quatre boutons en grille (`aria-pressed`, actif en
  bord et fond accent). Préférence d'écran locale (pas un réglage de compte), comme
  `display-settings`.

Menu `⋯` d'un projet (et menu contextuel de sa ligne, qui partage `ProjectMenuEntries`) :

- **SID-13** Dans l'ordre de la rangée : Aperçu, Travail, Tableau, Jalons, Actions ;
  puis « Toutes les sessions du projet » (→ `/sessions?projet=<id>`) ; séparateur ;
  Réglages du projet ; Renommer. **Plus de couleurs** (elles vivent dans Réglages ›
  Général).

### 1.7 Page `/sessions` — `routes/prototype-sessions/SessionsPage.tsx`, `data.ts`

- **SES-1 Route** `/sessions`, hors coque de projet ; bande seule (COQ-12) : icône
  `MessageSquare`, « Sessions », bouton « + Conversation » (libellé masqué sous `sm`) →
  `/c/new`.
- **SES-2 Contenu** : toutes les conversations, de tous les projets et sans projet,
  **sauf** celles ouvertes par une tâche planifiée (`scheduleId`).
- **SES-3 État d'une session**, dans l'ordre où il réclame Tim : `t'attend` (ambre) ·
  `en erreur` (rouge) · `à relire` (sa carte est en colonne *review* ; point accent
  pâle) · `travaille` (point accent qui pulse) · `terminée` (gris). Calculé depuis les
  statuts vivants et la carte.
- **SES-4 Ligne** (`min-h-11`, `md:min-h-10`, survol, sélectionnée `bg-accent/10`) :
  case à cocher en mode sélection ; icône d'agent + point d'état (infobulle = l'état) ;
  titre (gras si t'attend/erreur) ; épingle si épinglée (`aria-label` « épinglée ») ;
  mot d'état si t'attend/erreur/à relire ; à partir de `lg` : pastille de projet (sauf en
  « Par projet »), branche en mono (max 12 rem), `#carte` ; date relative à droite
  (`w-20`). Clic → le fil (`/p/:id/c/:cid` ou `/c/:cid`), ou bascule la sélection.
- **SES-5 Recherche** « Chercher une session » : titre, nom de projet, branche, `#N` de
  carte. Pré-remplie par `?q=` (la palette).
- **SES-6 Filtrer ▾** : Projet (cases avec avatar + compte ; « Sans projet » s'il en
  existe) ; État (point + mot + compte) ; Agent (seulement s'il y en a plus d'un) ;
  Période (segment Tout / Aujourd'hui / 7 j / 30 j) ; « Épinglées seulement » ; « Effacer
  tous les filtres ». Puces correspondantes (« sans projet », mot d'état, nom d'agent,
  période, « épinglées »). `?projet=<id|none>` pré-coche le projet (sidebar, palette).
- **SES-7 Portée** Actives / Archivées : contrôle segmenté avec compte de chaque côté ;
  changer de portée vide la sélection. ⚠ masqué sous `md` dans le proto : au téléphone
  les archivées sont inatteignables (voir §2.6).
- **SES-8 Affichage ▾** : vues en tuiles **Liste** / **Par état** / **Par projet** ;
  Tri : Récentes (épinglées d'abord puis date) / Ce qui t'attend (rang d'état puis date)
  / Nom.
- **SES-9 Liste** triée par Récentes : tranches « Épinglées », « Aujourd'hui », « Hier »,
  « Cette semaine », « Plus ancien », chacune avec son compte (petites capitales) ;
  autre tri → une seule liste.
- **SES-10 Par projet** : un groupe par projet (en-tête avatar + nom lien + compte) et
  « Sans projet » ; un clic sur l'en-tête replie/déplie le groupe. ⚠ l'en-tête contient
  un lien dans un bouton (HTML invalide) : à séparer.
- **SES-11 Par état** : quatre colonnes (1, 2 puis 4 selon la largeur) — T'attend
  (attend + erreur) · Travaille · À relire · Terminées — avec compte, « Vide » ; lignes
  compactes (sans mot d'état ni méta) ; au plus 30 par colonne (⚠ sans « N de plus »).
- **SES-12 « Ce qui t'attend »** (AskInbox) en tête, seulement en Liste + Actives + hors
  sélection ; titre préfixé du projet (« Solera · titre »), sans étiquette de jalon dans
  le proto (à ajouter, §3).
- **SES-13 Sélection** : bouton « Sélectionner » / « Terminer » (`CheckSquare`, libellé
  masqué sous `sm`) ; barre `h-11` sous la barre d'outils : « N sélectionnée(s) »,
  « Tout » (toutes les lignes affichées), puis Épingler + Archiver (Actives) ou
  Désarchiver (Archivées), et Supprimer ; boutons désactivés à 0. **Simulés dans le
  proto.**
- **SES-14 États vides** : « Chargement… » ; « Aucune session ne correspond. » (filtre ou
  recherche) ; « Aucune session archivée. » ; « Aucune session. ».
- **SES-15** La page pose son propre calque de tiroir (`DrawerLayer`) sous la barre.

### 1.8 Portefeuille `/projects` v2 — `routes/prototype-portfolio/*`, `routes/PortfolioLayout.tsx` (diff)

Coque :

- **PF-1** Même coque qu'un projet (COQ-1 à COQ-3) : icône `FolderKanban` 16 px,
  titre « Projets » ; geste unique « + Projet » (`aria-label` « Nouveau projet », libellé
  masqué sous `sm`) → `/projects/new`. Disparaissent : « + Conversation » de la bande et
  « + Nouveau projet » de la rangée.
- **PF-2 Rangée** : Aperçu (`/projects`, `end`) · Travail · Tableau · Jalons · Actions ;
  comptes : Travail ambre (`usePortfolioAskingCount`), Tableau gris (cartes feuilles
  ouvertes de tous les projets), Jalons et Actions sans compte (⚠ voir §2.7 : la règle
  des trois tons voudrait un compte sur Actions comme dans un projet).
- **PF-3 Réglages** au bout : un **bouton** qui ouvre les réglages de l'instance en
  fenêtre (`openSettings(null)`), `aria-label` « Réglages de l'instance ».
- **PF-4** Disparaissent les onglets Projets (liste), Activité, Journal ; `PortfolioBoard`,
  `PortfolioTimeline` remplacés.

Barre d'outils commune (`PortfolioToolbar`, `parts.tsx`) — sur Travail, Tableau, Jalons,
Actions, **pas sur l'Aperçu** :

- **PF-5** La barre sur une ligne (BAR-1) avec la section **Projet** en tête de
  Filtrer ▾ (avatar + nom + compte par projet), puces avec avatar, méta neutre à droite
  (à partir de `lg`), « Effacer tous les filtres » qui vide aussi les filtres propres à
  la page.
- **PF-6 Pastille de projet** (`ProjectPip`) : avatar 14 px + nom tronqué (12 rem),
  lien vers le projet (n'ouvre pas la ligne), ou `plain` dans une ligne déjà cliquable.
- **PF-7 En-tête de groupe par projet** (`ProjectGroupHeader`) : avatar 16, nom lien
  vers le projet, compte, zone à droite.

Aperçu (`Overview.tsx`) — « où en sont mes projets ? » :

- **PF-8** Pas de barre recherche / Filtrer / Affichage (c'est une page qu'on lit).
- **PF-9** « Ce qui t'attend » de **tous les projets** (AskInbox) : sessions qui
  attendent ou en erreur (titre « Projet · session », jalon de la carte), cartes en
  *review* (« Carte #N à relire » → Tableau du projet), PR prêtes (« PR #N prête à
  fusionner » → la PR, nouvel onglet).
- **PF-10 Projets** (titre + compte) en **grille de cartes** (1/2/3/4 colonnes selon
  `sm`/`xl`/`2xl`), triées : plus de sessions qui attendent, puis plus de sessions
  vivantes, puis activité la plus récente. Une carte : avatar 20 + nom ; « ● N t'attend »
  ambre et bord ambre s'il y en a ; le **jalon en cours** (premier non livré) : `#N`,
  titre, barre de progression accent, « fait/total · échéance relative » ; sinon
  « Aucun jalon en cours. » ; pied : « N cartes ouvertes », « ● N session(s) » (point
  qui pulse) s'il y en a, ancienneté du dernier événement à droite. Clic → `/p/:id`.
- **PF-11 Code en cours** (titre + compte + lien « Tout le travail » → `/projects/travail`)
  : arbres actifs de tous les projets (worktree non fusionné/vide/introuvable ; racine
  s'il y a du non commité ou une session), au plus 12 ; ligne : point de verdict,
  pastille de projet, branche en mono, raison · `#N titre de carte`, icônes des agents
  vivants, `#PR` ; clic → `/p/:id/travail?arbre=<clé>`. Vide : « Rien ne tourne. ».
- **PF-12 Derniers événements** : les 8 derniers événements du journal, tous projets ;
  icône teintée par nature, titre, avatar du projet, ancienneté ; lien vers la
  destination de l'événement (`journalDestination`).
- **PF-13 Mise en page** : sections espacées de 32 px ; Code en cours et Derniers
  événements côte à côte à partir de `xl` (`1fr | 26rem`).

Travail (`Work.tsx`) :

- **PF-14** Recherche « Chercher, #12, une branche » (branche, raison, titre et `#N` de
  carte, nom de projet) ; Filtrer ▾ : Projet (compte = worktrees du projet), État
  (T'attend / Travaille / À relire / À nettoyer) ; méta « N arbres · taille totale ».
- **PF-15** Affichage ▾ : **Par projet** (défaut) / **Tableau** / **Par moment** ;
  « Montrer : Arbres fusionnés et à nettoyer » (sauf Par moment ; forcé par le filtre
  « À nettoyer »).
- **PF-16** « Ce qui t'attend » (filtré par projet) en tête de toutes les vues.
- **PF-17 Par projet** : un groupe par projet (en-tête + nombre de worktrees + « N
  branche(s) sans arbre ») ; table bordée des arbres ; repli « N arbres fusionnés · taille
  · rien à perdre — Nettoyer ».
- **PF-18 Tableau** : une seule table avec colonne Projet ; en-têtes (à partir de `md`)
  Projet · Branche · pourquoi elle est là · Sessions · PR · Base · Disque · Vu ; ligne :
  point de verdict, pastille, branche (`… · racine` pour la racine), mot de verdict
  coloré · raison · carte · « Jalon #N », icônes d'agents, `#PR` ou `—`, `●N` non commités
  (racine) ou `↑avance ↓retard`, taille, ancienneté courte (min / h / j). Au téléphone
  la ligne s'empile.
- **PF-19 Par moment** : les événements du journal de tous les projets par jour
  (« lundi 10 novembre », compte), heure, icône, titre, avatar + nom du projet (nom à
  partir de `sm`) ; vide « Rien sur la période. ».
- **PF-20 Nettoyer · N** (action de la barre, s'il y a des arbres nettoyables dans les
  projets filtrés) et « Nettoyer » des replis → dialogue de nettoyage (`CleanDialog` du
  domaine Travail/Code) ; **simulé** (« N arbres supprimés, X libérés »).
- **PF-21** Clic sur un arbre → `/p/:id/travail?arbre=<clé>`.

Tableau (`Board.tsx`) :

- **PF-22** Recherche « Chercher, ou #12 » ; Filtrer ▾ : Projet (compte = cartes non
  livrées), État (T'attend, En retard) ; Affichage ▾ : **Kanban** / **Liste** ; Couloirs
  : Aucun / **Par projet** (défaut) / Par jalon.
- **PF-23 Kanban** : quatre colonnes (À faire, En cours, À relire, Fait — la dernière
  plus étroite), fond creusé, en-tête mot + compte, « Vide » ; tuiles du Tableau d'un
  projet (`Tile`, non déplaçables) ; pastille de projet au-dessus de la tuile hors
  couloirs par projet ; jalon sur la tuile hors couloirs par jalon ; « Fait » limité aux
  5 plus récentes puis « Tout voir (N) ».
- **PF-24 Couloirs par jalon** : en-tête point de teinte (4 teintes tournantes) + `#N
  titre` + pastille de projet + `fait/total` ; couloir « Sans jalon » à la fin.
- **PF-25 Liste** (sans les cartes faites) : état (« t'attend » ambre ou mot de
  colonne), pastille, `#N titre`, « Jalon #N » ou `—`.
- **PF-26** Clic sur une carte → sa session (celle qui attend, sinon celle qui travaille,
  sinon la plus récente), ou un brouillon rattaché `/p/:id/c/new?card=` ; une carte qui
  t'attend ouvre sa fiche (`?fiche=`) — ⚠ le portefeuille n'a pas d'hôte de fiche
  (voir §2.7).
- **PF-27** « + Carte » (`Button size="sm"`) : **simulé** (« la carte se crée dans un
  projet : son Tableau, ou « idée : » dans une conversation »).

Jalons (`Milestones.tsx`) :

- **PF-28** Recherche « Chercher un jalon » ; Filtrer ▾ : Projet, Échéance (En retard) ;
  Affichage ▾ : **Horizon** / **Gantt** ; Échelle Semaine / Mois (Gantt) ; « Montrer :
  Jalons livrés » ; méta « N jalons ouverts » ; vide « Aucun jalon ne correspond. ».
- **PF-29 Horizon** : une bande par projet (en-tête + compte) ; grille de cartes de jalon
  : point + mot de phase, `#N`, titre (2 lignes), barre de progression, `fait/total`,
  échéance relative (rouge si en retard) ou « sans date » ; bord rouge si en retard ;
  tri par phase (en cours, à venir, idée, livré) puis échéance.
- **PF-30 Gantt** commun : liste figée à gauche (300 px, collante au défilement
  horizontal) avec une ligne d'en-tête par projet ; un axe ; une barre par jalon de sa
  création à son échéance (sans échéance : jusqu'à aujourd'hui, en pointillé ; en retard :
  bord rouge), remplie à hauteur de l'avancement avec « N % » ; ligne d'aujourd'hui.
- **PF-31** Clic → `/p/:id/timeline/:numéro`.

Actions (`Actions.tsx`) :

- **PF-32** Recherche « Chercher une action » (libellé, commande, prompt, projet) ;
  Filtrer ▾ : Projet, Quoi (Commandes / Agents), Quand (À la demande / Planifiées) ;
  Affichage ▾ : **Lanceur** / **Liste** / **Agenda** ; méta « N actions ».
- **PF-33 Tourne maintenant, tous projets** (hors Agenda) : compte + lien « Page
  Services ↗ » ; une pastille par élément vivant (point vert qui pulse, icône agent ou
  `Server`, libellé, texte d'état, pastille de projet) → l'onglet Actions du projet.
- **PF-34 Lanceur** : un groupe par projet (en-tête + compte) qui reprend la vue Lanceur
  d'un projet (`LauncherView`, domaine Actions) ; « éditer » mène à
  `/p/:id/actions?nouvelle=<commande|service|agent|planifier|1>`.
- **PF-35 Liste** : pastille, libellé + commande en mono (`$ …`) ou prompt, nature
  (Agent / Service / Commande), état (à relire ambre, texte vivant vert, planifiée, en
  pause, à la demande).
- **PF-36 Agenda** commun (`ActionsAgenda`, domaine Actions), clic → Actions du projet.
- **PF-37** « + Action » : **simulé** (« une action appartient à un projet »).

### 1.9 Palette — `components/CommandPalette.tsx` (diff)

- **PAL-1** Commande « Toutes les sessions » (`MessagesSquare`) → `/sessions`.
- **PAL-2** Avec un projet sous les yeux : « Sessions de <projet> » → `/sessions?projet=<id>`.
- **PAL-3** Quand la recherche trouve plus de sessions que la palette n'en montre, une
  dernière ligne « Voir les N résultats dans Sessions » → `/sessions?q=<terme>`.

---

## 2. État actuel sur `main` et écarts

### 2.1 Coque

| Sur `main` | Dans la v2 |
| --- | --- |
| `ProjectLayout` rend `HeaderBand` (gouttière `px-3`) + `ProjectTabs` (`px-4`) + `Outlet`. | `PlaceShell` (COQ-1/2/3) : gouttière 16/24 alignée sur tous les étages. |
| Bande : avatar, nom, **badge de branche**, « + Conversation », **`⋯`** (Réglages, couleurs du projet). | Avatar, nom, « + Conversation » (COQ-4). |
| Rangée : Aperçu · Activité (ambre) · Board (gris) · Planifiées (gris = nb de tâches) · Jalons · Journal, + **action de vue** au bout (« + Carte », « Découper en cartes », « + Tâche »). | Aperçu · Travail · Tableau · Jalons · Actions … Réglages (COQ-5/7), sans action de vue (COQ-10). |
| `TabCount` du DS à **deux** tons (`neutral`, `caution`). | Trois tons (`running` vert) — COQ-6. |
| `/p/:id/settings` hors coque (page plein écran). | Dans la coque (COQ-8). |
| `PortfolioLayout` : rangée Projets (compte de projets) · Activité · Board · Jalons · Journal ; bande « + Conversation » ; « + Nouveau projet » dans la rangée. | Coque v2 (PF-1 à PF-4). |

Fichiers qui disparaissent ou changent :

- `components/project/ProjectTabs.tsx` + `ProjectTabs.stories.tsx` → remplacés par la
  rangée de `PlaceShell` (ou `ProjectTabs` devient cette rangée : garder le nom
  `PlaceTabs` et sa story, voir §4).
- `routes/ProjectLayout.tsx` : `⋯`, `PROJECT_COLORS`, `useUpdateProject`, badge de
  branche, `split.action`, `useSchedules` (compte des Planifiées), `useMatch` des vues.
  `NEW_PARAM` reste mais quitte `ProjectLayout` (il est importé par `BoardPage` et
  `SchedulePage`) pour `lib/place.ts`.
- `routes/PortfolioLayout.tsx` réécrit ; `ProjectsPage.tsx`, `PortfolioActivityPage.tsx`,
  `PortfolioJournalPage.tsx`, `PortfolioBoardPage.tsx`, `PortfolioTimelinePage.tsx`
  supprimés ; `lib/portfolio.ts` : `usePortfolioActivityRows` et `PortfolioRow`
  deviennent morts (garder `usePortfolioAskingCount`).
- `components/places/DemandTile.tsx` (+ story) : utilisé seulement par `ProjectsPage` et
  `ProjectOverviewPage` ; disparaît quand l'Aperçu `combo` (autre domaine) remplace ce
  dernier.

### 2.2 Tiroir et panneaux

- `main` a un tiroir propre au board, `components/board/CardPanel.tsx` : glisse depuis
  la droite (`translate`), largeur redimensionnable mémorisée (`lib/board-panel`), focus
  géré par `PanelFocus` (modal au téléphone, focus rendu à la carte). Pas de calque
  partagé, pas de pile d'Échap.
- Le board de `main` porte un bouton de panneau et monte `SidePanel` ; la v2 le retire
  (domaine Tableau) et le panneau git ne s'ouvre plus que par « Diff » (TIR-9).
- **Nouveau** : `Drawer` commun + `DrawerLayer` dans la coque + `useEscapeLayer` +
  règle TIR-8. Le vrai tiroir doit **réutiliser `PanelFocus`** (focus rendu à
  l'élément d'origine, modal au téléphone) et garder l'entrée glissée de `CardPanel` ; le
  proto n'anime pas et ne rend pas le focus à la fermeture — écart à combler, pas à
  reproduire.

### 2.3 Barre d'outils

- `main` n'a pas de barre commune : chaque vue a la sienne (filtres du board en
  `Menu` + `MenuCheckboxItem`, `PortfolioBoardPage` idem, radiogroupe du journal).
- Le DS fournit `Popover`, `Menu`, `MenuCheckboxItem`, `MenuLabel`, `MenuRadioGroup`,
  `SegmentedControl`. Les pièces du proto (`MenuCheck`, `MenuHeading`, `MenuSegment`)
  dupliquent visuellement ces primitives **dans un `Popover`** (un `Menu` Radix se
  ferme à chaque coche, ce que le filtre ne veut pas). Voir §4 pour le partage DS/app.

### 2.4 « Ce qui t'attend »

- `main` a `SessionRequestPreview` / `SessionRequestBody` (réponse sur place dans
  l'Activité d'un projet) et `usePortfolioSessionRequests` / `useSessionRequests` : la
  réponse réelle existe. Ce qui est **nouveau** : la liste unique (`AskInbox`), sa
  densité, ses kinds, `openInboxItem`, et un constructeur d'éléments unique — le proto
  en a **quatre** copies (`prototype-overview/v2/data.ts:227`, `prototype-portfolio/data.ts:290`,
  `prototype-sessions/data.ts:112`, `panel/ProtoProjectPane.tsx:613`).

### 2.5 Sidebar

| Sur `main` | Dans la v2 |
| --- | --- |
| Lieux et Activité **fixes** au-dessus du bloc qui défile. | Tout défile ensemble (SID-1/2). |
| Icônes à `gap-2 px-1.5/px-2`, pas de créneau commun. | Colonne d'icônes 16 px (SID-3). |
| Sous un projet : 10 sessions (`SESSIONS_SHOWN`), puis « N autres sessions… / Moins » qui déplie sur place, puis « Archivées (N) » repliable (`ArchivedSection`). | Budget réglable (SID-6/7/8) et une seule ligne de fin vers `/sessions` (SID-9). |
| *Fils* : 40 plus récentes, « Tout l'historique… » ouvre la palette ; le lieu n'a pas de page (`page: null`). | Budget, ligne de fin vers `/sessions`, `page: '/sessions'` (SID-10/11). |
| `⋯` d'un projet : Aperçu, Board, Planifiées, Réglages, —, Renommer, **Couleur** (pastilles). | SID-13. La couleur part dans Réglages › Général (domaine Réglages). |
| Apparence : pas de réglage de nombre. | SID-12. |

Disparaissent : `ArchivedSection`, `SESSIONS_SHOWN`, l'état `showAll`, `onSearch` de
`PlaceThreads` (et sa prop dans `Sidebar`), les clés `shell.sessions.more`,
`shell.sessions.less`, `shell.conversations.archived`, `shell.threads.all`, `shell.color`
(après vérification qu'aucun autre appelant ne les lit), `shell.project.board`.

Le proto range le réglage dans **Apparence** ; `main` a une section **Affichage**
(`DisplaySection.tsx`, « ce que la colonne de gauche montre », magasin
`display-settings.ts` local) qui est sa place naturelle — les deux sont rendues côte à
côte par `AppearanceAndDisplaySection`. Reproduire le rendu du proto, mais **stocker
dans `display-settings`** (clé `solera.display.sessionLimit`) et placer la carte en tête
de la section Affichage ; si Tim tient à Apparence, ne change que l'emplacement de la
carte.

### 2.6 Page `/sessions`

- **Nouvelle**. Sur `main`, rien ne liste toutes les sessions (la palette cherche, le lieu
  *Fils* s'arrête à 40, les archivées sont dans une section repliée par projet).
- Tout existe côté serveur pour la lecture (`GET /api/conversations` rend les archivées,
  épinglage, carte avec colonne), les statuts vivants (`useLiveConversations`), les
  demandes (`usePortfolioSessionRequests`), les branches (`usePortfolioWorktreeStatuses`).
- Écarts du proto à **corriger** dans la vraie version (pas à reproduire) :
  - filtres et recherche lus **une seule fois** à l'ouverture (`useState(() =>
    params.get(...))`) : cliquer « Toutes les sessions du projet » dans la sidebar alors
    qu'on est déjà sur `/sessions` ne change rien. L'adresse doit être la source
    (`?projet=`, `?q=`, `?etat=`, `?vue=`, `?portee=archivees`) ;
  - portée Actives/Archivées masquée au téléphone (SES-7) : la mettre dans Filtrer ▾ sous
    `md` ;
  - lien dans un bouton (SES-10) ;
  - « Par état » coupé à 30 sans le dire (SES-11) : ajouter « N de plus » ;
  - gestes en masse simulés (SES-13) : voir §3.

### 2.7 Portefeuille

- Données : tous les crochets portefeuille existent (`useAllCards`,
  `usePortfolioWorktreeStatuses` → `GET /api/worktrees/status`, `usePortfolioPullRequests`
  → `GET /api/pull-requests`, `useJournal(undefined)` → `GET /api/journal`, `useActions`,
  `useSchedules`, `usePortfolioSessionRequests` → `GET /api/prompts`).
- Le portefeuille v2 **réutilise des pièces d'autres domaines** : `Tile`, `COLUMN_WORD`,
  `cardDestination` (Tableau), `GanttAxis`, `TodayLine`, `scaleOf` (Jalons),
  `TreeRow`/`verdictOf`/`VERDICT_TONE`/`CleanDialog`/`isCleanable` (Travail/Code),
  `LauncherView`, `ActionsAgenda`, `Automation`/`fromAction`/`fromTask` (Actions). Les
  cartes portefeuille viennent donc **après** celles qui extraient ces pièces.
- Écarts internes du proto à trancher ou corriger :
  - **compte de l'onglet Actions** absent au portefeuille alors que la règle des trois
    tons l'a posé sur le projet : proposer `useActionsCount(null)` (tous projets) — à
    confirmer avec Tim ;
  - **fiche de carte** : `cardDestination` rend `?fiche=N` pour une carte qui t'attend ;
    au portefeuille il n'y a ni hôte de fiche ni projet dans le paramètre → le clic ne
    fait rien. La vraie version pose l'hôte de fiche (domaine Tableau/Jalons) dans la
    coque du portefeuille avec `?fiche=<projet>:<N>`, ou mène au Tableau du projet ;
  - **phases des jalons** (Idée / À venir / En cours / Livré, calculées) ≠ maturité
    décidée (Idée → À affiner → Découpé → Prêt → Lancé → Livré). La phase « Idée »
    (`total === 0`) est inatteignable : `milestonesOf` ne voit que les parentes qui ont
    des enfants. Reprendre le modèle de maturité du domaine Jalons ;
  - **dépendances** (`blockedBy`) : la décision les veut « partout : Gantt et graphe » ;
    le Gantt du portefeuille ne les montre pas ;
  - « Tout voir (N) » des cartes faites agit sur **tous** les couloirs (un seul état) :
    par couloir dans la vraie version ;
  - « Par moment » formate les jours en `fr-FR` en dur : passer par la langue de l'app ;
  - textes qui mentionnent encore le ⚡ (« ⚡ dans sa bande », `ProjectActions.tsx`) ;
  - main : page Projets vide → `EmptyState` « créer un projet » (`home.empty.*`) ; le
    proto n'a **pas d'état vide** sans projet : à garder.

### 2.8 Palette et liens internes

- `main` : commandes « Planifier une tâche » → `/p/:id/schedules`, « Board » →
  `/p/:id/board`, « Découper en cartes » → `/p/:id/c/new?split=new` ; résultats de
  tâches → `/p/:id/schedules`. Le proto n'y touche pas. À aligner : planifier →
  `/p/:id/actions?nouvelle=planifier` ; tâches → `/p/:id/actions` ; libellé « Board » →
  « Tableau ». « Découper en cartes » disparaît du Tableau (décision « Board ») ; sa
  commande de palette et l'entrée du menu de `CardDetail` restent-elles ? **À trancher**
  (la décision vise le Tableau ; le découpage passe désormais par « idée : » et la page
  d'un jalon).
- Autres liens vers les anciennes vues : `components/sidebar/PlacePlanned.tsx:87,130`
  (`/p/:id/schedules`), `components/decisions/DecisionDialog.tsx:156`
  (`/p/:id/activity?groupe=worktree`). Les redirections COQ-11 les couvrent, mais les
  liens se corrigent à la source.

---

## 3. Ce que le prototype simule et qu'il faut rendre réel

| Geste / donnée simulé | Où | Ce qu'il faut | Existe déjà ? |
| --- | --- | --- | --- |
| Épingler / Archiver / Désarchiver / Supprimer en masse | `SessionsPage.tsx:247` | Boucle client sur `PATCH /api/conversations/:id` (`pinned`, `archived`) et `DELETE /api/conversations/:id`. Archiver passe par `useGuardedArchive(ids)` (demande de confirmation si des demandes sont ouvertes, `GET /api/conversations/pending-requests?ids=`). Supprimer demande un `ConfirmDialog` (« Supprimer N sessions ? », irréversible). Invalidation de `['conversations']`. | Oui, routes et crochets (`usePinConversation`, `useArchiveConversation`, `useDeleteConversation`, `useGuardedArchive`). Pas de route en masse à créer : la boucle suit le modèle de `useGuardedArchive`. |
| Étiquette « Jalon #N » d'une session qui attend, hors portefeuille | `prototype-sessions/data.ts:123` (`milestone: null`) | **Serveur** : ajouter à `ConversationDto` un `milestone: { id, number, title } \| null` — la parente de la carte de la conversation (`cards.parentId`), jointe dans `GET /api/conversations` comme l'est déjà la carte. Évite de charger les cartes de tous les projets (`useAllCards`, une requête par projet) sur `/sessions`, dans la sidebar et le panneau. | Non. |
| Question d'une demande dans l'indice de la ligne | `AskInbox.tsx:229-234` (la démo montre la question, le réel dit « Elle attend ta réponse ») | Client : tirer un résumé de `SessionRequest` (texte de la question, « Autoriser <outil> », titre du plan…), déjà chargé par `useSessionRequests` / `usePortfolioSessionRequests`. | Donnée oui ; fonction de résumé non. |
| Branche d'une session archivée | `prototype-sessions/data.ts:103` | La branche vient de l'état git des worktrees vivants ; une session dont le worktree est retiré n'en a plus. **Facultatif** : `ConversationDto.worktreeName` (jointure `worktrees.name`, le nom de branche à la création). | Non (facultatif, à confirmer). |
| Nettoyer des arbres de plusieurs projets | `Work.tsx:169` | Appel par projet de `POST /api/projects/:id/worktrees/cleanup` (plan : `GET …/cleanup`), selon le contrat posé par le domaine Travail/Code pour `CleanDialog`. | Routes oui ; contrat de sélection à confirmer avec le domaine Travail. |
| Taille sur disque d'un arbre (« Disque », « N arbres · X Go », « X libérés ») | `simulatedSize()` dans `data.ts:114,252,267` | **Serveur** (domaine Travail/Code) : `sizeBytes` par worktree dans `WorktreeStatusDto`, calculé en tâche de fond et mis en cache. | Non. Dépendance. |
| Verdict et raison d'un arbre (t'attend, travaille, à relire, à nettoyer…) | `verdictOf` (`prototype-code/data.ts`) | Calcul client du domaine Travail/Code, à reprendre tel quel. | Domaine Travail. |
| « + Carte » au portefeuille | `Board.tsx:169` | Le proto le simule. Proposition : un `Menu` des projets → `/p/:id/board?nouvelle=1`. **À confirmer avec Tim** (ou retirer le bouton). | Création dans un projet oui. |
| « + Action » au portefeuille | `Actions.tsx:332` | Même proposition : menu des projets → `/p/:id/actions?nouvelle=1`. À confirmer. | Oui côté projet (domaine Actions). |
| Ouvrir un arbre, un projet, une session, une action « de démo » | `Overview.tsx:79,181`, `Work.tsx:72`, `Board.tsx:98`, `Milestones.tsx:75`, `Actions.tsx:287`, `SessionsPage.tsx:243` | En réel, navigation directe (déjà codée dans le proto). `/p/:id/travail?arbre=<clé>` doit être compris par Travail (domaine Travail). | Oui. |
| Processus lancés par les sessions (compte vert) | `actionsCount.tsx:33` | `GET /api/services` (`kind: 'command'`, `projectId`), même clé `['services']`. | Oui. |
| Services d'actions en marche, actions à relire | `actionsCount.tsx:36-38` | `GET /api/actions` (`actionView(action).live`, `status === 'proposed'`). | Oui. |
| Préférence « Sessions dans la sidebar » | `lib/prototype-sidebar.ts` (`localStorage` `proto-sidebar-sessions`) | Magasin `display-settings` (clé `solera.display.sessionLimit`, défaut `fit`, valeur abîmée → `fit`). Local à l'écran, pas de serveur. | Le magasin oui. |
| Mémoire de vue | `useView` (`localStorage` `proto-vue:…`) | Clé `solera.view.<portée>:<projet>`. Local. | Non (petit). |
| Compte « en marche » de l'onglet Actions **au portefeuille** | absent | `useActionsCount(null)` = tous projets (si Tim valide §2.7). | Données oui. |

Rien d'autre dans ce périmètre n'appelle le serveur. Les kinds `refine`, `draft`,
`merge` d'`AskInbox` sont alimentés par le domaine Jalons (affinage = demandes d'une
session sur la carte du jalon, découpage = `card-drafts`, PR du jalon) : leurs besoins
serveur sont dans sa spec.

---

## 4. Composants génériques à extraire

### 4.1 Ce qui relève du design system (`~/projects/solera-ds`)

Règle (AGENTS.md de Solera) : les primitives ne savent rien du produit ; une valeur se
change dans `src/tokens.ts` ; une primitive ajoutée reçoit sa story ; on pousse le DS
puis on épingle le commit dans `apps/web/package.json` **et** `apps/catalog/package.json`.

| Élément | Changement | API |
| --- | --- | --- |
| `TabCount` | Troisième ton **`running`** (`bg-positive/10 text-positive`) ; `title` facultatif (infobulle). Le type `Tab.tone` suit. | `TabCount({ count, tone?: 'neutral' \| 'caution' \| 'running', title?: string })` |
| Pages de règles | `Tabs` (§2 des comptes : trois rôles — inventaire, demande, en cours) ; `GabaritLieu.mdx` (bande sans `⋯` ni branche, Réglages en onglet à droite après un filet, plus d'action de vue dans la rangée → barre d'outils, gouttière 16/24 commune, portefeuille en cartes à l'Aperçu, la barre d'outils sur une ligne) ; `GabaritBande.mdx` (gouttière) ; nouvelle page **« Panneau et tiroir »** (deux familles, géométrie, Échap par couches, un seul comportement par page). | — |
| `SegmentedControl` | Vérifier qu'il couvre `MenuSegment` (pleine largeur, `aria-pressed`) et la portée Actives/Archivées (compte en regard) ; sinon option `fill` et `count` par segment. | `Segment<T> & { count?: number }`, prop `layout?: 'fill' \| 'start'` |

Proposé **app** et non DS (à reconsidérer plus tard) : le tiroir dépend du calque posé
par la coque et de `PanelFocus` de l'app ; les menus de barre composent des primitives
existantes.

### 4.2 Composants d'application (avec story dans `apps/web`, vus dans le catalogue)

```ts
// components/place/PlaceShell.tsx
export interface PlaceTab {
  to: string; label: string; icon: ReactNode; end?: boolean
  count?: number; tone?: 'neutral' | 'caution' | 'running'; countTitle?: string
}
export type PlaceSettings = { to: string; label: string } | { onOpen: () => void; label: string }
export function PlaceBand(props: { icon: ReactNode; title: string; actions?: ReactNode }): JSX.Element
export function PlaceTabs(props: { label: string; tabs: PlaceTab[]; settings: PlaceSettings }): JSX.Element
export function PlaceShell(props: {
  icon: ReactNode; title: string; actions?: ReactNode
  tabs: PlaceTab[]; label: string; settings: PlaceSettings; children?: ReactNode
}): JSX.Element  // = PlaceBand + PlaceTabs + contenu relatif + DrawerLayer
```

`PlaceBand` sert seul à `/sessions` et `/schedules` (COQ-12). La gouttière passe par une
prop de `HeaderBand` (`gutter="place"`) plutôt que par les `pl-4!` du proto.

```ts
// components/shell/Drawer.tsx
export function DrawerLayer(): JSX.Element
export function Drawer(props: {
  open: boolean; onClose: () => void; label: string
  title?: ReactNode; subtitle?: ReactNode; width?: 'normal' | 'wide'; layerId?: string
  children: ReactNode
}): JSX.Element | null
export function DrawerHeader(props: { title: ReactNode; subtitle?: ReactNode; onClose: () => void }): JSX.Element
// lib/escape-layers.ts — logique pure + écoute unique en capture
export function useEscapeLayer(active: boolean, close: () => void): void
// lib/detail-surface.ts — TIR-8
export const DetailSurfaceContext: React.Context<'panel' | 'drawer'>
export function useDetailSurface(): 'panel' | 'drawer'
// components/shell/PanelHost.tsx — TIR-9 (ex-GitPanelHost)
export function PanelHost(props: { projectId: string }): JSX.Element | null
```

`DetailSurface` : la conversation fournit `'panel'`, la coque `'drawer'` ; un détail
(`ActionDrawer`, fiche de carte, tiroir de commit) lit le contexte pour se rendre en
pile dans le panneau ou dans le tiroir — c'est ce qui rend la règle « un seul
comportement » vérifiable au lieu d'être une discipline.

```ts
// components/toolbar/*
export function OneLineToolbar(props: { search: ReactNode; filter: ReactNode; chips?: ReactNode; extra?: ReactNode; display?: ReactNode; action?: ReactNode }): JSX.Element
export function ToolbarSearch(props: { value: string; onChange: (v: string) => void; placeholder?: string }): JSX.Element
export function FilterMenu(props: { active: number; onClearAll?: () => void; children: ReactNode }): JSX.Element   // le Filtrer ▾ recopié 4 fois
export function DisplayMenu<K extends string>(props: { views: ViewOption<K>[]; value: K; onChange: (k: K) => void; children?: ReactNode }): JSX.Element
export function FilterChip(props: { children: ReactNode; onClear: () => void; title?: string }): JSX.Element
export function MenuHeading(props: { children: ReactNode }): JSX.Element
export function MenuCheck(props: { checked: boolean; onChange: (n: boolean) => void; aside?: ReactNode; children: ReactNode }): JSX.Element
export function ViewTiles<K extends string>(props: { options: ViewOption<K>[]; value: K; onChange: (k: K) => void }): JSX.Element
export const toolbarButtonClass: (active: boolean) => string
// lib/view-pref.ts
export function resolveView<K extends string>(fromUrl: string | null, remembered: string | null, keys: readonly K[]): K
export function useView<K extends string>(scope: string, projectId: string | null, keys: readonly K[]): [K, (k: K) => void]
// lib/filters.ts
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T>
```

```ts
// components/inbox/AskInbox.tsx + lib/inbox.ts
export type InboxItem = /* session | refine | draft | merge | light, comme le proto */
export function AskInbox(props: { items: InboxItem[]; bare?: boolean; className?: string }): JSX.Element
export function openInboxItem(key: string): void
export function inboxMilestoneNumber(item: InboxItem): number | null
// Le constructeur unique, qui remplace les quatre copies du proto
export function useInbox(scope: { projectId: string } | { portfolio: true } | { sessions: true }): InboxItem[]
export function buildInbox(input: {
  live: LiveConversation[]; requests: ReadonlyMap<string, SessionRequest>
  projects: Map<string, ProjectDto>; reviewCards?: CardDto[]; readyPullRequests?: …
  prefixProject: boolean
}): InboxItem[]               // pur, testable
export function requestSummary(request: SessionRequest): string    // INB-7
```

Les kinds `refine` / `draft` / `merge` sont des points d'extension remplis par le
domaine Jalons (`useInbox` accepte des éléments supplémentaires).

```ts
// lib/actions-count.ts + components/actions/ActionsStatusMeta.tsx
export function useActionsCount(projectId: string | null): { running: number; toReview: number } // null = tous projets
export function actionsTabCount(c: ActionsCount): { count: number; tone: 'caution' | 'running'; title: string } | null
export function ActionsStatusMeta(props: { count: ActionsCount; onRunning?: () => void; onReview?: () => void }): JSX.Element | null
export function PanelToggle(props: { projectId: string | null; open: boolean }): JSX.Element  // ACT-3
```

```ts
// components/place/ProjectPip.tsx, ProjectGroupHeader.tsx (portefeuille, /sessions)
export function ProjectPip(props: { project: ProjectDto; to?: string; plain?: boolean; className?: string }): JSX.Element
export function ProjectGroupHeader(props: { project: ProjectDto; count?: number; aside?: ReactNode }): JSX.Element
export function SectionTitle(props: { children: ReactNode; count?: number; aside?: ReactNode }): JSX.Element
// lib/sidebar-budget.ts
export type SidebarSessionLimit = 'fit' | 10 | 20 | 50
export function mustShow(entry: ConversationDto, openId: string | null | undefined): boolean
export function cutToBudget<T extends ConversationDto>(entries: T[], budget: number, openId: string | null | undefined): T[]
export function fitStep(m: { overflow: number; rowHeight: number; budget: number; cutLists: number }): number   // pur
export function activityFold(m: { collapsed: boolean; budget: number; cutLists: number; overflow: number; gain: number; rowHeight: number }): boolean // pur, hystérésis
```

Pièces d'autres domaines que le portefeuille consomme (à extraire **chez eux**) :
`cardDestination` / `sessionOf` (règle « un clic sur une carte ouvre sa session »),
`Tile`, hôte de fiche de carte, `GanttAxis`/`TodayLine`/`scaleOf`, `verdictOf`/`TreeRow`/
`CleanDialog`, `LauncherView`, `ActionsAgenda`, `Automation`.

---

## 5. i18n

Toutes les chaînes du proto sont en dur ; la vraie version passe par `t('clé')`, fr et
en (`lib/i18n/catalog-fr.ts`, `catalog-en.ts`). Familles à créer (ou à modifier) :

- **`place.*`** — `place.settings` (« Réglages »), `place.settings.instance` (« Réglages
  de l'instance »), libellés d'onglet : réutiliser `project.view.overview`,
  `project.view.timeline` (« Jalons ») ; créer `project.view.travail` (« Travail » /
  « Work »), `project.view.actions` (« Actions ») ; **changer la valeur fr** de
  `project.board.title` en « Tableau » (en : « Board »). Titres de compte :
  `place.count.asking`, `place.count.openCards`.
- **`actions.count.*`** — `running` (« {count} en marche »), `review` (« {count} à
  relire »), `goRunning`, `goReview`, `panelToggle` (« {label} — {state} »).
- **`drawer.*`** — `close`.
- **`toolbar.*`** — `search` (« Chercher »), `search.clear`, `filter`, `filter.clearAll`,
  `chip.remove`, `display`, `display.current` (« Affichage : {view} »), `show`
  (« Montrer »), `sort` (« Tri »).
- **`inbox.*`** — `title`, `empty`, `summary.requests` (pluriel), `summary.review`,
  `more` (« {count} de plus »), `less`, `gesture.reply|see|examine|merge|close`,
  `hint.stopped`, `hint.awaiting`, `stopped.body`, `awaiting.body`, `openThread`,
  `reply.placeholder`, `reply.placeholderSession`, `send`, `refine.title` (pluriel),
  `draft.title`, `draft.after`, `draft.validate`, `draft.fix`, `merge.title`,
  `merge.body`, `merge.action`, `light.review`, `light.openPr`, `milestone`
  (« Jalon #{number} »), `card.review` (« Carte #{number} à relire »), `pr.ready`
  (« PR #{number} prête à fusionner »), résumés de demande (`request.question`,
  `request.permission` …).
- **`shell.sessions.*`** (sidebar) — `all` (« Toutes les sessions »), `all.count`,
  `all.project`, `all.loose` ; **`display.sessionLimit.*`** — `title`, `description`,
  `fit` (« Ajuster à la hauteur »).
- **`palette.sessions.*`** — `all`, `project` (« Sessions de {name} »), `results`
  (« Voir les {count} résultats dans Sessions »).
- **`sessions.*`** — `title`, `newConversation`, `search`, `filter.project`,
  `filter.noProject`, `filter.state`, `filter.agent`, `filter.period`,
  `filter.pinnedOnly`, `state.awaiting|error|review|running|done`,
  `period.all|day|week|month` (+ forme de puce), `scope.active|archived`,
  `view.list|byState|byProject`, `sort.recent|waiting|name`,
  `bucket.pinned|today|yesterday|week|older`, `column.waiting|running|review|done`,
  `empty.loading|noMatch|noArchived|none`, `empty.column` (« Vide »), `select`,
  `select.done`, `selected` (pluriel), `select.all`, `bulk.pin|archive|unarchive|delete`,
  `bulk.delete.confirm` (pluriel), `pinned`. Noms d'agent : `AGENT_LABELS` existant.
- **`portfolio.*`** — `title`, `newProject` (existe : `portfolio.action.newProject`),
  `views`, `overview.projects`, `overview.code`, `overview.allWork`, `overview.events`,
  `overview.nothingRunning`, `card.waiting` (« {count} t'attend »), `card.noMilestone`,
  `card.openCards` (pluriel), `card.sessions` (pluriel) ;
  `work.search`, `work.state.waiting|active|review|clean`, `work.showMerged`,
  `work.meta` (« {trees} arbres · {size} »), `work.clean` (« Nettoyer · {count} »),
  `work.folded` (pluriel), `work.branchesWithoutTree` (pluriel), `work.col.*`,
  `work.root` (« racine »), `work.view.byProject|table|moment`, `work.emptyPeriod` ;
  `board.search`, `board.waiting`, `board.late`, `board.lanes`,
  `board.lanes.none|project|milestone`, `board.noMilestone`, `board.showAll`,
  `board.view.kanban|list` ; `milestones.search`, `milestones.phase.*` (ou la maturité du
  domaine Jalons), `milestones.due`, `milestones.late`, `milestones.scale`,
  `milestones.scale.week|month`, `milestones.showDelivered`, `milestones.open`
  (pluriel), `milestones.noMatch`, `milestones.noDate` ; `actions.search`, `actions.what`,
  `actions.what.command|agent`, `actions.when`, `actions.when.demand|planned`,
  `actions.running`, `actions.servicesPage`, `actions.kind.agent|service|command`,
  `actions.state.review|planned|paused|demand`, `actions.count`,
  `actions.view.launcher|list|agenda`.
- **Clés à retirer** (après vérification des appelants) : `shell.sessions.more`,
  `shell.sessions.less`, `shell.conversations.archived`, `shell.threads.all`,
  `shell.color`, `shell.project.board`, `project.view.activity`, `project.view.journal`,
  `portfolio.view.journal`, `portfolio.filter.*` devenus morts avec
  `PortfolioBoardPage`, `split.action` si la palette le perd.
- Dates : jours et heures par `locale` de l'app, jamais `fr-FR` en dur ; anciennetés
  par `elapsed` / `relativeDate` existants (le `shortAgo` du proto se remplace).

---

## 6. Plan TDD

Outils du dépôt : **pas de vitest dans `apps/web`**. La logique pure du web se teste
depuis `apps/server/test/*.test.ts` (`node:test`, `tsx`), en important
`../../web/src/lib/<module>.js` comme le fait `tool-summary.test.ts` — d'où l'exigence
de sortir chaque calcul dans `apps/web/src/lib/*.ts` sans dépendance React. Le rendu se
vérifie par les suites Playwright `scripts/*-ui-check.mjs` (lancer **seulement** celle
qui concerne la carte : elles écrivent des captures ; Chromium par `launchBrowser()`,
`LD_LIBRARY_PATH=~/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu`). Chaque
composant d'application ajouté reçoit sa story (vérifiée par `pnpm typecheck` et
`pnpm build:catalog`).

| Comportement | Preuve |
| --- | --- |
| COQ-6 / ACT-2 : ton et titre d'un compte (`actionsTabCount` : ambre d'abord, vert sinon, rien à zéro) | `apps/server/test/place-counts.test.ts` |
| COQ-6 : Tableau compte les feuilles ouvertes ; Travail compte attente + erreur + demandes | même fichier (fonctions `openLeafCount`, `askingCount` existante) |
| COQ-1/2/5/7 : ordre de la rangée, Réglages au bout (lien actif sur `/settings`), pas de `⋯` ni de badge de branche, gouttière (mêmes `x` pour l'avatar, l'icône d'Aperçu, la loupe, le premier texte du contenu, à 1 px près, en 1280 et 390 px), libellé Réglages masqué au téléphone | `scripts/places-ui-check.mjs` (remplace l'assertion « réglages dans le ⋯ ») |
| COQ-6 : pastilles à trois tons (classes `text-positive`/`text-caution`), infobulle | `places-ui-check.mjs` + story `PlaceTabs` |
| COQ-8 / COQ-11 : `/p/:id/settings` sous la rangée ; redirections des anciennes adresses | `places-ui-check.mjs` |
| TIR-7 : pile des couches (dernière ouverte ferme d'abord, une couche retirée au milieu) | `apps/server/test/escape-layers.test.ts` (logique pure) |
| TIR-4/5/6/7 : clic dehors ferme, ✕ ferme, Échap avec un `Menu` Radix ouvert dans le tiroir ferme le menu **et pas** le tiroir, Échap dans une autocomplétion inscrite ferme l'autocomplétion, focus entre puis revient au déclencheur, plein écran à 390 px | nouvelle suite `scripts/shell-ui-check.mjs` (monte `Drawer` seul via `viteDependency()`) |
| TIR-8 : un détail ouvert depuis une conversation se rend dans le panneau (pas de `role=dialog` à côté) ; depuis un onglet projet, dans le tiroir | `shell-ui-check.mjs` |
| BAR-7 : `resolveView` (URL > mémoire > première ; valeur inconnue ignorée) | `apps/server/test/view-pref.test.ts` |
| BAR-1/2/4/5/6 : largeur de la recherche au focus, puces qui défilent sans passer à la ligne à 390 px, compte de Filtrer, « Effacer tous les filtres » | `shell-ui-check.mjs` (montage d'un `OneLineToolbar` de démonstration) |
| INB-3/4/14 : ordre lourd/léger, résumé, `inboxMilestoneNumber` | `apps/server/test/inbox.test.ts` (`buildInbox`) |
| INB-7 : résumé d'une demande par type | `inbox.test.ts` (`requestSummary`) |
| INB-1/2/4/5/6/11/13 : vide, repli, « N de plus », une seule dépliée, Entrée envoie, `openInboxItem` défile et déplie, réponse réelle à une question puis disparition de la ligne | `scripts/project-activity-ui-check.mjs` étendu (il a déjà un serveur avec une session qui attend) |
| Serveur : `ConversationDto.milestone` (parente de la carte, `null` sans carte ou sans parente, titre à jour après renommage du jalon) | `apps/server/test/api-conversations-milestone.test.ts` (sur le modèle de `api-projects.test.ts`) |
| ACT-1 : `useActionsCount` = services vivants + processus des sessions du projet ; `null` = tous projets | `apps/server/test/place-counts.test.ts` (fonction pure `countActions(actions, services, projectId)`) |
| ACT-3/5 : point du bouton du panneau (ambre / vert), nom accessible ; ⚡ absent de la bande, du board et de la conversation | `scripts/actions-ui-check.mjs` étendu |
| ACT-4 : « N en marche » mène au groupe | `actions-ui-check.mjs` |
| SID-6 : `cutToBudget` / `mustShow` (ouverte et en attente gardées, comptent dans le budget, ordre conservé) | `apps/server/test/sidebar-budget.test.ts` |
| SID-7/8 : `fitStep`, `activityFold` (seuil 5, hystérésis, pas d'oscillation sur une suite de mesures) | `sidebar-budget.test.ts` |
| SID-1/2/3/4 : la colonne défile d'un seul bloc (les lieux sortent de l'écran en défilant), haut et compte fixes, `x` des icônes identiques sur toutes les lignes, pas de décalage quand la barre paraît | `scripts/sidebar-ui-check.mjs` |
| SID-6/7/8/12 : réglage 10/20/50/Ajuster (nombre de lignes par liste, colonne qui ne défile pas en « Ajuster » à 1280×800, Activité repliée à 1280×600) | `sidebar-ui-check.mjs` + `settings-ui-check.mjs` (la carte du réglage) |
| SID-9/10/11 : lignes de fin et leurs adresses, plus d'« Archivées » ni de « N autres sessions », *Fils* → `/sessions` allume le lieu | `sidebar-ui-check.mjs` (remplace les assertions « Tout l'historique… » et « autres sessions… ») |
| SID-13 : entrées du `⋯` dans l'ordre, sans couleurs | `sidebar-ui-check.mjs` |
| SES-3 : état d'une session (attente, erreur, à relire par la carte, travaille, terminée) | `apps/server/test/sessions-view.test.ts` (`sessionState`) |
| SES-5/6/8/9 : recherche, filtres, périodes, tris, tranches datées (bornes de minuit, épinglées en tête) | `sessions-view.test.ts` (`filterSessions`, `sortSessions`, `bucketOf(at, now)`, `byDay`, `byProject`) |
| SES-1…15 : page complète, URL source (`?projet=` changé depuis la sidebar sans recharger), portée au téléphone, sélection et gestes en masse **réels** (vérifiés par l'API : épinglée, archivée, supprimée), confirmation de suppression, archivage gardé quand une demande est ouverte, états vides | nouvelle suite `scripts/sessions-ui-check.mjs` (+ `package.json` `test:sessions-ui`) |
| PAL-1/2/3 | `scripts/palette-ui-check.mjs` étendu |
| PF-1…4 : coque du portefeuille, Réglages ouvre la fenêtre d'instance, anciennes adresses redirigées | `places-ui-check.mjs` |
| PF-10 : résumé par projet (jalon courant, tri attente > vivant > activité) | `apps/server/test/portfolio.test.ts` (`projectSummaries`) |
| PF-8…13 : Aperçu sans barre, sections, liens | `places-ui-check.mjs` |
| PF-14…21 : filtres, vues, nettoyage réel multi-projets | `places-ui-check.mjs` ou `worktree-status-ui-check.mjs` (qui a déjà des worktrees) |
| PF-22…27 : couloirs (fonction pure `lanesOf` testée dans `portfolio.test.ts`), Kanban/Liste, clic → session | `portfolio.test.ts` + `board-ui-check.mjs` |
| PF-28…31 : jalons par projet, Gantt, retard | `portfolio.test.ts` + `places-ui-check.mjs` |
| PF-32…37 | `actions-ui-check.mjs` étendu |

Ordre TDD dans chaque carte : écrire le test pur (rouge), extraire la fonction du proto
(vert), puis la suite UI de la carte, puis la story.

---

## 7. Découpage en cartes

Dix-huit cartes. Les dépendances vers d'autres domaines sont nommées par leur contenu ;
la session qui pose les cartes les reliera par `relate_cards` / `blockedBy`.

### 1. DS : comptes d'onglet à trois tons et gabarit de lieu v2

*Dépôt `solera-ds`, puis épinglage dans Solera.* Ajouter le ton `running` à `TabCount`
(et à `Tab.tone`), une infobulle facultative ; mettre à jour la page `Tabs` (trois rôles
d'un compte), `GabaritLieu.mdx` (bande sans `⋯` ni branche, Réglages en onglet à
droite, plus d'action de vue dans la rangée, gouttière 16/24, barre d'outils sur une
ligne, Aperçu du portefeuille en cartes), `GabaritBande.mdx` (gouttière), et écrire la
page « Panneau et tiroir » (TIR-1 à TIR-8). Vérifier `SegmentedControl` pour la portée
avec compte. Story mise à jour. Pousser, épingler le commit dans
`apps/web/package.json` et `apps/catalog/package.json`, `pnpm install`.
Référence proto : `components/prototype/actionsCount.tsx` (`PlaceTabCount`),
`PlaceShell.tsx`. Critères : COQ-6 (rendu), docs à jour, `pnpm tokens:check &&
pnpm typecheck && pnpm lint && pnpm build` verts dans le DS. **Dépendances** : aucune.

### 2. Coque commune : PlaceShell, rangée v2, Réglages à droite

Créer `PlaceBand`, `PlaceTabs`, `PlaceShell` (§4.2) avec stories ; porter
`ProjectLayout` dessus : bande COQ-4, rangée COQ-5, comptes COQ-6 (Travail ambre,
Tableau gris feuilles ; Actions branché en carte 6), Réglages COQ-7, route settings dans
la coque COQ-8, pleine largeur COQ-9, plus d'action de vue COQ-10 (`NEW_PARAM` déplacé
dans `lib/place.ts`), redirections COQ-11. Tant que les vues Travail et Actions des
autres domaines ne sont pas livrées, `/travail` rend la page Activité actuelle et
`/actions` la page Planifiées du projet (alias de route, à retirer par ces domaines).
Supprimer `ProjectTabs` (+ story), le `⋯`, le badge, « Découper en cartes » de la
rangée. Gouttière par une prop de `HeaderBand`. i18n `place.*`, `project.view.*`,
« Tableau ». Référence proto : `components/prototype/PlaceShell.tsx`, diff
`routes/ProjectLayout.tsx`, diff `App.tsx`. Critères : COQ-1 à COQ-11. Tests :
`places-ui-check.mjs` mis à jour, `place-counts.test.ts`. **Dépendances** : après 1
(sinon le ton `running` attend : la carte peut partir avec deux tons et un `TODO`
retiré à l'épinglage).

### 3. Tiroir commun, Échap par couches, un seul comportement de panneau

Créer `Drawer`, `DrawerHeader`, `DrawerLayer` (posé par `PlaceShell` et `/sessions`),
`useEscapeLayer` (logique pure dans `lib/escape-layers.ts`), `DetailSurfaceContext`
(conversation = `panel`, coque = `drawer`) et `PanelHost` (ex-`GitPanelHost`, sans
bouton). Le tiroir réutilise `PanelFocus` (focus rendu, modal au téléphone) et l'entrée
glissée de `CardPanel`. Trancher avec Tim la largeur (une ou deux : TIR-3) et le cas du
panneau git ouvert sur Travail quand un tiroir s'ouvre (proposition : le tiroir le
recouvre ; Échap ferme le tiroir d'abord). Migrer `CardPanel` du board sur `Drawer` est
du ressort du domaine Tableau. Référence proto : `components/prototype/Drawer.tsx`,
`GitPanelHost.tsx`, `routes/prototype-automations/ActionDrawer.tsx` (mode `inline`),
`components/prototype/panel/PanelTabFrame.tsx` (`PanelStackHeader`). Critères : TIR-1 à
TIR-9. Tests : `escape-layers.test.ts`, nouvelle suite `shell-ui-check.mjs`, story
`Drawer`. **Dépendances** : après 2.

### 4. Barre d'outils sur une ligne et mémoire de vue

Extraire `OneLineToolbar`, `ToolbarSearch`, `FilterMenu` (le Filtrer ▾ recopié dans
quatre pages), `DisplayMenu` (Affichage ▾ + `ViewTiles`), `FilterChip`, `MenuHeading`,
`MenuCheck`, `toolbarButtonClass`, `useView` / `resolveView`, `toggled`. `MenuSegment`
se rend avec `SegmentedControl` du DS. Ne pas porter `ViewSwitch` ni `PageToolbar`.
Référence proto : `components/prototype/ViewSwitch.tsx`, les popovers de
`prototype-sessions/SessionsPage.tsx:128-221` et `prototype-portfolio/parts.tsx:120-262`.
Critères : BAR-1 à BAR-7. Tests : `view-pref.test.ts`, `shell-ui-check.mjs`, stories.
**Dépendances** : après 2 (gouttière) ; ensuite consommée par les domaines Tableau,
Travail, Jalons, Actions, Planifiées.

### 5. « Ce qui t'attend » : AskInbox, constructeur unique, jalon d'une session

Créer `AskInbox` (INB-1 à INB-13, kinds `session` et `light` complets ; `refine`,
`draft`, `merge` rendus mais alimentés par le domaine Jalons), `openInboxItem`,
`inboxMilestoneNumber`, `buildInbox` / `useInbox(scope)` qui remplacent les quatre
constructeurs du proto, `requestSummary` (INB-7). Serveur : `ConversationDto.milestone`
joint dans `GET /api/conversations` (et la route d'une conversation) ; protocole
`packages/protocol/src/api.ts`. Référence proto : `components/prototype/AskInbox.tsx`,
`prototype-portfolio/data.ts:290-324`, `prototype-sessions/data.ts:112-128`,
`prototype-overview/v2/data.ts:227-296`. Critères : INB-1 à INB-14. Tests :
`inbox.test.ts`, `api-conversations-milestone.test.ts`,
`project-activity-ui-check.mjs` étendu, story `AskInbox` (vide, 2 demandes, 5 lignes
dont une PR, une dépliée). **Dépendances** : aucune (consommée ensuite par Aperçu,
Travail, panneau, portefeuille, `/sessions`).

### 6. Compte de l'onglet Actions et retrait du ⚡

`useActionsCount(projectId | null)` (fonction pure `countActions` + crochet sur
`GET /api/actions` et `GET /api/services`), `actionsTabCount`, `ActionsStatusMeta`,
`PanelToggle` (point du bouton du panneau, ACT-3). Brancher le compte sur l'onglet
Actions de la rangée. Retirer `ActionsLauncher` (+ story) de la barre du board et de
l'en-tête d'une conversation, supprimer `ActionsHub`. Référence proto :
`components/prototype/actionsCount.tsx`, diff `routes/ConversationPage.tsx`
(`ProtoPanelToggle`), diff `routes/BoardPage.tsx`. Critères : ACT-1 à ACT-5, COQ-6
(Actions). Tests : `place-counts.test.ts`, `actions-ui-check.mjs`. **Dépendances** :
après 2 ; après la carte du domaine Actions qui livre l'onglet `/p/:id/actions` (le ⚡
ne part qu'une fois son remplaçant en place) et l'extraction de la lecture des
processus des sessions (`useSessionWorks`) — si elle n'est pas faite, cette carte en
extrait la partie lecture.

### 7. Sidebar : défilement unique et colonne d'icônes

Réorganiser `Sidebar.tsx` (SID-1 : lieux et Activité dans le bloc qui défile ; haut et
compte fixes), gouttière de barre stable (SID-2), créneau de 16 px sur toutes les lignes
(`ConversationLine`, `SidebarActivity` — `EntryMark`, en-tête, « pour toi », plus —,
`PlaceProjects`, `PlaceThreads`), boutons de bande en `sm` (SID-4), mode un seul projet
(SID-5). `SidebarActivity.useColumnHeight` mesure `[data-sidebar-scroll]`. Référence
proto : diffs `components/sidebar/Sidebar.tsx`, `ConversationLine.tsx`,
`PlaceProjects.tsx` (classes), `SidebarActivity.tsx`. Critères : SID-1 à SID-5. Tests :
`sidebar-ui-check.mjs` (alignement des icônes, défilement). **Dépendances** : aucune.

### 8. Page `/sessions` : lecture, filtres, vues

Route `/sessions` (lazy), `placeOfPath('/sessions') → 'threads'`, bande seule
(`PlaceBand`), `OneLineToolbar` avec recherche, Filtrer ▾ (projet, état, agent,
période, épinglées), portée Actives/Archivées (dans Filtrer ▾ sous `md`), Affichage ▾
(Liste / Par état / Par projet, tri), tranches datées, groupes repliables (sans lien
dans un bouton), colonnes par état avec « N de plus », ligne SES-4, « Ce qui t'attend »
(SES-12), états vides SES-14. **L'adresse est la source** des filtres
(`?projet=`, `?q=`, `?etat=`, `?vue=`, `?portee=`). Fonctions pures dans
`lib/sessions-view.ts`. Composants `ProjectPip`, `ProjectGroupHeader`, `SectionTitle`
créés ici (réutilisés par le portefeuille). Référence proto :
`routes/prototype-sessions/SessionsPage.tsx`, `data.ts`. Critères : SES-1 à SES-12,
SES-14, SES-15. Tests : `sessions-view.test.ts`, nouvelle suite
`sessions-ui-check.mjs`. **Dépendances** : après 3, 4, 5.

### 9. Page `/sessions` : sélection et gestes en masse

Mode sélection (SES-13) avec gestes **réels** : épingler, archiver (par
`useGuardedArchive`), désarchiver, supprimer (`ConfirmDialog`, irréversible, pluriel),
« Tout » ; retour d'erreur par `Banner` ; la sélection se vide au changement de portée.
Référence proto : `SessionsPage.tsx:86-87, 241-303`. Critères : SES-13. Tests :
`sessions-ui-check.mjs` (états vérifiés par l'API). **Dépendances** : après 8.

### 10. Sidebar : « Sessions dans la sidebar » et « Toutes les sessions »

Réglage SID-6 / SID-12 dans `display-settings` (`solera.display.sessionLimit`), carte
en tête de la section Affichage (ou Apparence si Tim le préfère) ; `cutToBudget`,
`mustShow`, mesure « Ajuster à la hauteur » (`fitStep`), repli de l'Activité
(`activityFold`, seuil 5, hystérésis) ; lignes de fin SID-9 / SID-10 ; *Fils* destination
SID-11 ; suppression d'`ArchivedSection`, « N autres sessions… », « Tout
l'historique… » et des clés i18n associées. Référence proto : `lib/prototype-sidebar.ts`,
diffs `Sidebar.tsx` (`useFitBudget`), `PlaceProjects.tsx`, `PlaceThreads.tsx`,
`AppearanceSection.tsx`, `lib/sidebar.ts`. Critères : SID-6 à SID-12. Tests :
`sidebar-budget.test.ts`, `sidebar-ui-check.mjs`, `settings-ui-check.mjs`.
**Dépendances** : après 7, après 8 (les liens ont une destination).

### 11. Sidebar : menu `⋯` d'un projet

`ProjectMenuEntries` : les cinq onglets dans l'ordre de la rangée, « Toutes les sessions
du projet », séparateur, Réglages, Renommer ; retrait des pastilles de couleur.
Référence proto : diff `PlaceProjects.tsx` (`ProjectMenuEntries`). Critères : SID-13.
Tests : `sidebar-ui-check.mjs`. **Dépendances** : après 2 (adresses `/travail`,
`/actions`), après 8, après la carte du domaine Réglages qui met la couleur dans
Réglages › Général (sinon la couleur devient inatteignable).

### 12. Palette : Sessions et anciennes vues

PAL-1 à PAL-3 ; aligner les commandes sur la rangée v2 (planifier →
`/p/:id/actions?nouvelle=planifier`, tâches → `/p/:id/actions`, « Board » → « Tableau ») ;
trancher avec Tim le sort de « Découper en cartes » (palette et menu de `CardDetail`) ;
corriger les liens `PlacePlanned` et `DecisionDialog`. Référence proto : diff
`components/CommandPalette.tsx`. Tests : `palette-ui-check.mjs`. **Dépendances** :
après 8 ; après 6 pour les adresses `/actions` si l'alias de la carte 2 a disparu.

### 13. Portefeuille v2 : coque et Aperçu

`PortfolioLayout` sur `PlaceShell` (PF-1 à PF-4 : « + Projet », Réglages de l'instance
en fenêtre, rangée v2, comptes), redirections `/projects/activity|work|journal`,
suppression de `ProjectsPage`, `PortfolioActivityPage`, `PortfolioJournalPage`,
`usePortfolioActivityRows`. Aperçu PF-8 à PF-13 avec `useInbox({ portfolio: true })`,
résumés par projet (`projectSummaries` pur), état vide sans projet (repris de
`ProjectsPage` : créer un projet). Tant que Travail/Tableau/Jalons/Actions du
portefeuille ne sont pas livrés (cartes 14-17), leurs onglets mènent aux pages
actuelles (`PortfolioBoardPage`, `PortfolioTimelinePage`) ou sont masqués. Trancher le
compte de l'onglet Actions (§2.7). Référence proto : `prototype-portfolio/Layout.tsx`,
`Overview.tsx`, `data.ts` (partie réelle `usePortfolioV2`, sans `demoData`), diff
`routes/PortfolioLayout.tsx`, diff `App.tsx`. Critères : PF-1 à PF-13. Tests :
`portfolio.test.ts`, `places-ui-check.mjs`. **Dépendances** : après 2, 5, 8
(`ProjectPip`) ; après la carte du domaine Travail qui extrait `verdictOf` /
`TreeRow` / `VERDICT_TONE` (bloc Code en cours) et accepte `?arbre=`.

### 14. Portefeuille v2 : Travail

`PortfolioToolbar` (section Projet en tête de Filtrer ▾, méta, puces), vues Par projet /
Tableau / Par moment, filtre d'état, « Montrer les fusionnés », replis, « Nettoyer · N »
réel par projet, « N branches sans arbre ». Référence proto :
`prototype-portfolio/Work.tsx`, `parts.tsx`. Critères : PF-5 à PF-7, PF-14 à PF-21.
Tests : `portfolio.test.ts`, `worktree-status-ui-check.mjs` ou `places-ui-check.mjs`.
**Dépendances** : après 4, 13 ; après les cartes Travail/Code qui livrent `CleanDialog`
et la taille sur disque côté serveur (sans elle, colonne Disque et méta de taille
absentes, pas simulées).

### 15. Portefeuille v2 : Tableau

Kanban / Liste, couloirs Aucun / Par projet / Par jalon (`lanesOf` pur), filtres
T'attend / En retard, cap des faites par couloir, tuiles du Tableau, clic → session
(`cardDestination`) et fiche de carte via un hôte posé dans la coque du portefeuille,
« + Carte » selon la décision de Tim (menu des projets → `/p/:id/board?nouvelle=1`, ou
pas de bouton). Supprimer `PortfolioBoardPage`. Référence proto :
`prototype-portfolio/Board.tsx`. Critères : PF-22 à PF-27. Tests :
`portfolio.test.ts`, `board-ui-check.mjs`. **Dépendances** : après 4, 13 ; après les
cartes du domaine Tableau (`Tile`, `cardDestination`, hôte de fiche de carte).

### 16. Portefeuille v2 : Jalons

Horizon par projet et Gantt commun, filtres, échelle, jalons livrés, sur le **modèle
de maturité** du domaine Jalons (pas les phases calculées du proto) et avec les
dépendances `blockedBy` dans le Gantt. Supprimer `PortfolioTimelinePage`. Référence
proto : `prototype-portfolio/Milestones.tsx`. Critères : PF-28 à PF-31. Tests :
`portfolio.test.ts`, `places-ui-check.mjs`. **Dépendances** : après 4, 13 ; après les
cartes du domaine Jalons (maturité, `GanttAxis`, `TodayLine`, `scaleOf`).

### 17. Portefeuille v2 : Actions

Lanceur par projet, Liste, Agenda, filtres Quoi / Quand, « Tourne maintenant, tous
projets » + lien Services, éditer → Actions du projet, « + Action » selon la décision de
Tim (menu des projets). Référence proto : `prototype-portfolio/Actions.tsx`. Critères :
PF-32 à PF-37. Tests : `actions-ui-check.mjs`. **Dépendances** : après 4, 13 ; après
les cartes du domaine Actions (`LauncherView`, `ActionsAgenda`, modèle `Automation`).

### 18. Nettoyage du prototype

Une fois toutes les cartes des domaines livrées : supprimer `prototype-*`,
`components/prototype/*`, `PrototypeSwitcher`, `PrototypeVerdict`, `DemoToggle`,
`lib/prototype-sidebar.ts`, les bascules `?variant=`, `?panel=actuel`, `?demo=1`, les
alias de route posés en cartes 2 et 13, les clés i18n mortes (§5), `DemandTile` si plus
appelé. Vérifier qu'aucun `PROTOTYPE` ne reste (`grep -rn "PROTOTYPE" apps/web/src`).
Tests : `pnpm typecheck && pnpm lint && pnpm build && pnpm build:catalog`, suites UI
touchées. **Dépendances** : après toutes les autres cartes de tous les domaines (cette
branche-ci n'est pas fusionnée : la carte nettoie ce qui aurait été recopié).

### Graphe des dépendances (ce document)

```
1 ─┐
   └─> 2 ─┬─> 3 ─┐
          ├─> 4 ─┼─> 8 ─┬─> 9
          │      │      ├─> 10 (après 7)
          │      │      ├─> 11 (+ Réglages › couleur)
          │      │      └─> 12
          ├─> 6 (+ onglet Actions)
          └──────┴─> 13 (après 5, 8, + Travail) ─┬─> 14 (+ Travail/Code)
5 ───────────────────^                           ├─> 15 (+ Tableau)
7 ─> 10                                          ├─> 16 (+ Jalons)
                                                 └─> 17 (+ Actions)
toutes ─> 18
```
