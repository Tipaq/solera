# Page projet v2 — Actions, Planifiées, panneau de conversation

Analyse d'écarts entre le prototype de la branche `proto/page-projet` (worktree
`proto__page-projet`, fichiers non commités compris, état du 2026-11-11) et `main`
(`029af4ae`). Décisions de référence : `docs/audits/2026-11-09-page-projet-v2/DECISIONS.md`
(sections « Actions du projet », « Onglet Actions », « Le ⚡ est retiré ; comptes à trois
tons », « Un seul comportement de panneau par page », « Panneaux latéraux »).

**Périmètre de ce document** :
- l'onglet **Actions** du projet (`/p/:id/actions`) : actions et tâches planifiées fondues
  en un objet **Quoi × Quand**, vues Lanceur · Liste · Agenda, éditeur unifié,
  `ScheduleBuilder`, tiroir unifié, « Lancés par les sessions », « Ce qu'il sert » ;
- la page globale **Planifiées v2** (`/schedules`) : Lanceur · Agenda · Liste ;
- le **panneau de droite d'une conversation** (`ProtoSidePanel`) : onglets Actions, Agent,
  Projet, Git, Terminaux, Recherche, Web, et les bascules de `ConversationPage.tsx` ;
- le **serveur** qui rend tout cela réel.

**Hors périmètre, renvoyé** (cité comme dépendance) :
- `coque.md` : `PlaceShell`, rangée et comptes à trois tons (COQ-*), tiroir commun et
  Échap par couches (TIR-*), barre sur une ligne (BAR-*), « Ce qui t'attend » (INB-*),
  **compte de l'onglet Actions, point du bouton du panneau et retrait du ⚡** (ACT-1 à
  ACT-6, carte coque 6), portefeuille › Actions (carte coque 17), nettoyage final (carte
  coque 18).
- `projet.md` : Aperçu (bloc Actions A-5), Travail (`ServiceMark` T-4.3/T-7.2/T-11.1,
  modèle « Code » PP-04), Réglages (la catégorie Actions disparaît, R-11).
- Domaine Jalons : `useProtoData`, maturité, page d'un jalon (lus par l'onglet Projet du
  panneau), `?prompt=` de `DraftConversationPage.tsx`.

Conventions : `P:` = fichier du prototype (worktree `proto__page-projet`), `M:` = fichier
sur `main`. Chaque élément d'inventaire porte un identifiant ; les cartes du §7 s'y
réfèrent comme critères d'acceptation. Les cartes de ce document sont nommées `AC-NN` ;
celles des autres documents `coque N` et `PP-NN`.

---

## 0. À jeter, sans équivalent dans la vraie version

| Fichier / mécanisme | Raison |
| --- | --- |
| `P:routes/prototype-schedules/{ListVariant,AgendaVariant,HealthVariant}.tsx`, la bascule de `P:routes/SchedulePage.tsx` (`SCHEDULE_VARIANTS`, `PrototypeSchedules`) | Variantes écartées de l'ancien onglet Planifiées : l'onglet Actions les remplace. |
| `P:routes/prototype-actions/{ActionsSection,ActionEditor}.tsx` | Ancienne catégorie « Actions » des Réglages et son éditeur : remplacés par l'onglet et l'éditeur unifié (R-11 de `projet.md`). |
| `P:components/prototype/ActionsHub.tsx` | L'ancien lanceur ⚡ : plus importé (déjà listé par `coque.md` §0). |
| `PLANNED_VARIANTS` de `P:routes/SchedulesPage.tsx` (`v2` / `actuel`) ; `?panel=actuel` et le double montage `OriginalSidePanel` / `ProtoSidePanel` de `P:routes/ConversationPage.tsx` | La v2 devient la seule version. |
| `?demo=1` et tout ce qui le sert : `demoActions`, `DEMO_PREVIOUS_COMMAND` (`P:routes/prototype-actions/data.ts`), `demoScheduledCommands` (`P:routes/prototype-automations/model.ts`), `demoTasks` (`P:routes/prototype-schedules/data.ts`), `demoData` (`P:routes/prototype-planned/data.ts`), `demoWorks` (`SessionWorks.tsx`), `useDemoRuns`, `DEMO_TEST_OUTPUT`, `DEMO_TYPECHECK_OUTPUT`, `DEMO_LINT_LINES` (`commandOutput.ts`), `PANEL_DEMO` / `withDemoRun` (`ProtoActionsPane.tsx`), `DEMO_SERVED` (`served.tsx`), `DEMO_NOTES` et la carte prêtée en démo (`ProtoProjectPane.tsx`), le bouton « Démo » du panneau, `DemoToggle`, `DemoConversationRedirect` / `DemoConversationNotice` (`P:components/prototype/panel/DemoConversation.tsx`) et le découpage `ConversationPage` → `RealConversationPage` | Jeux fictifs. Les besoins serveur qu'ils révèlent sont au §3. **Garder** les sorties de démo de `commandOutput.ts` comme **fixtures de test** des parseurs (§6). |
| Étiquettes et bandeaux fuchsia « simulé », « démo », `SimTag`, `Chip tone="sim"`, le toast « Simulé : … » (`simulate`, `notice`) de chaque écran, `PanelNotice` utilisé pour « Simulé : … » | Remplacés par les vrais gestes ; un retour réel (erreur, succès notable) passe par `PanelNotice` (panneau) ou le `Banner` / toast existant (pages). |
| `REPO_TREE` (arborescence simulée), `SUGGESTIONS` (dépôt simulé), `fakeOutput` (« Essayer » simulé) | Remplacés par la vraie arborescence (`useTreeLevel`) et deux routes (AC-08). |
| `actionBridge.ts` (événement `window` + variable de module) | Remplacé par un état de panneau partagé (`lib/panel.ts` : `requestActionEdit(seed)` tenu dans le magasin du panneau, lu par l'onglet Actions). Le **comportement** est gardé (PAG-12). |
| Les textes qui renvoient encore au ⚡ (« un clic ici ou dans ⚡ » dans `ActionDetail`, « « Ouvrir » dans ⚡ mène là » et « Dans le lanceur » avec l'icône `Zap` dans `Editor.tsx`) | Le ⚡ est retiré (2026-11-11) : à réécrire (voir DET-9, EDI-14, EDI-19). |

---

## 1. Inventaire du prototype (checklist de recette)

### 1.A Le modèle Quoi × Quand — `P:routes/prototype-automations/model.ts`

- **MOD-1** Un seul objet `Automation` : `id`, `label`, `description`, `what`
  (`command` | `agent`), pour une commande `commandKind` (`task` | `service`),
  `command`, `subdir` ; pour un agent `agent` (CLI) et `prompt` ; `onDemand` ;
  `schedule` (`cadence`, `enabled`, `nextRunAt`, `serviceWindow?` pour un service
  planifié) ; `runs` (passages unifiés) ; `live` (`service` | `terminal` | `session`, son
  texte et son lien) ; `review` (pourquoi il attend Tim) ; `failStreak` ; les sources
  `action` / `task`.
- **MOD-2** `fromAction(ProjectActionDto)` : `live` d'un service = « service · :ports ·
  depuis X » + lien résolu ; d'une tâche dont le terminal vit = « en cours dans un
  terminal du panneau » ; `runs` = le seul `lastRun` fini ; `review` = « proposée dans
  « titre » » (ou « une session supprimée ») si `status === 'proposed'` ; `failStreak` = 1
  si service `failed` ou dernier code ≠ 0. Une action est toujours `onDemand`, jamais
  planifiée (côté serveur aujourd'hui).
- **MOD-3** `fromTask(ScheduledTaskDto)` : `what = 'agent'`, toujours `onDemand` (« Lancer
  maintenant »), `schedule` = cadence/enabled/nextRunAt ; `live` = passage `running` ou
  `checking` → « passage en cours depuis X » + lien vers sa session ; `review` = « script
  de vérification à valider » si `check.approved === false` ; `failStreak` = échecs ou
  dépassements d'affilée en tête des passages **jugés** (`verdictRuns` : hors `skipped`,
  `running`, `checking`).
- **MOD-4** `UnifiedRun` : `status` (`checking`, `running`, `succeeded`, `failed`,
  `timed_out`, `skipped`), `startedAt`, `finishedAt`, pour une commande `exitCode` et
  `excerpt` (lignes de sortie), pour un agent `conversationId` et `error`.
- **MOD-5** `useAutomations(projectId)` fond actions du projet + tâches du projet (et,
  en démo, deux **commandes planifiées** simulées : sauvegarde hebdo, purge quotidienne
  en échec ×2). L'agenda reçoit les commandes planifiées « habillées en tâches ».
- **MOD-6** `ago(ts)` : « N min », « N h », « N j ».

### 1.B Onglet Actions du projet — `P:routes/prototype-automations/ActionsPage.tsx`

Route `/p/:id/actions` (`P:App.tsx`), dans la coque (`PlaceShell`), onglet « Actions »
entre Jalons et Réglages, compte à trois tons (coque ACT-2).

**Barre sur une ligne** (`OneLineToolbar`, coque BAR-*)
- **AO-1** Recherche « Chercher une action » : filtre sur libellé, description, commande,
  prompt (insensible à la casse) ; s'applique aussi à « Lancés par les sessions »
  (libellé, commande, titre de la session).
- **AO-2** « Filtrer ▾ » (popover 18 rem, aligné à gauche) en trois groupes, chacun avec
  le compte à droite : **Quoi** (Commandes, Agents), **Quand** (À la demande, Planifiées),
  **État** (En cours, À relire, En échec). OU dans un groupe, ET entre groupes ; un
  groupe vide = tout. Pastille d'accent avec le nombre de filtres actifs sur le bouton ;
  « Effacer tous les filtres » en pied quand il y en a.
- **AO-3** Puces (`FilterChip`) d'un filtre actif, chacune avec son ✕.
- **AO-4** `ActionsStatusMeta` (coque ACT-4) : « ● N en marche » (vert, pulse) → filtre
  État = En cours ; « ● N à relire » (ambre) → filtre État = À relire. Masqué sous `sm`.
- **AO-5** « Affichage ▾ » (popover aligné à droite) : tuiles **Lanceur** (défaut) ·
  **Liste** · **Agenda** (`ViewTiles`) ; en Agenda, « Période » Semaine / Jour
  (`MenuSegment`) ; sinon une phrase d'aide (« Des boutons, rangés par nature : services,
  commandes, agents. » / « Par état : En cours, À relire, Planifiées, puis À la
  demande. »). Libellé « Affichage » masqué sous `sm` (icône de la vue seule, infobulle
  « Affichage : Lanceur »). La vue est retenue par projet (`useView('actions', projectId)`,
  `?vue=`).
- **AO-6** « + Action ▾ » (bouton principal, popover 18 rem aligné à droite) : « Nouvelle
  commande » (Un script qui se termine : tests, sauvegarde.), « Nouveau service » (Ce qui
  tourne en continu : serveur de dev.), « Nouvelle tâche d'agent » (Un prompt confié à un
  CLI.), séparateur, « Planifier une action existante… » (La choisir, puis lui donner une
  cadence.). Chaque entrée ouvre le tiroir en mode édition pré-réglé, ou en mode « pick ».
- **AO-7** Adresse : `?action=<id>` ouvre le détail de cette action au chargement (lien
  depuis `ServiceMark`, l'Aperçu, le portefeuille) ; `?nouvelle=1|commande|service|agent|planifier`
  ouvre l'éditeur pré-réglé ou le choix d'une action à planifier ; fermer le tiroir
  retire `?nouvelle=`. (À corriger : `?action=` n'est pas retiré à la fermeture → le
  synchroniser dans les deux sens.)
- **AO-8** Pleine largeur, gouttière 16/24 (`p-4 md:p-6`), contenu qui défile sous la barre.

**Vue Lanceur** — `P:routes/prototype-automations/Launcher.tsx`, `LaunchButton.tsx`
- **LAN-1** Groupes dans l'ordre : « Lancés par les sessions » (s'il y en a, PRC-*),
  **Services**, **Commandes**, **Agents** ; en-tête sobre (icône grise, titre `text-sm`,
  compte gris). Les trois derniers se montrent même vides (leur tuile d'ajout reste).
- **LAN-2** Grille de **tuiles de taille égale** : colonnes `auto-fill minmax(16.5rem,1fr)`
  (18 rem à partir de `2xl`), gap 12 px ; hauteur fixe 9,5 rem, rien ne déborde (chaque
  rangée tronque, la boîte coupe). Une colonne au téléphone.
- **LAN-3** Tuile d'ajout en fin de chaque groupe (bordure pointillée, « + Nouveau
  service » / « + Nouvelle commande » / « + Nouvelle tâche d'agent ») → éditeur pré-réglé.
- **LAN-4** Tuile : en-tête = `StateIcon` (icône de nature 32 px — CLI pour un agent,
  `Server` pour un service, `SquareTerminal` pour une commande — et **point d'état** dans
  le coin : vert qui pulse = tourne, gris = repos, rouge = échec, ambre = à relire) ;
  libellé (souligné au survol, ouvre le détail) ; **phrase d'état** (`actionState`, LAN-5)
  en gris, ambre si à relire, rouge si échec ; menu `⋯` (LAN-8).
- **LAN-5** `actionState` — une phrase, la même partout : « À relire — … » ; « En marche ·
  :5173 · depuis 2 h » ; « En cours · … » ; « Arrêté » (service au repos) ; « N échecs
  d'affilée » (≥ 2) ; « Jamais lancée » ; « Réussie · il y a 3 min », « Échec (code 1) ·
  il y a … », « Trop longue · … », « Sautée · … ».
- **LAN-6** Corps : la ligne **« sert … »** (SRV-1) pour un service en marche, sinon le
  contexte — prompt tronqué pour un agent, `$ commande` en mono 11 px pour une commande ;
  puis la cadence (`AlarmClock` + « Chaque jour à 03:00 », « (en pause) » si elle l'est).
- **LAN-7** Pied, **un seul geste principal, toujours en bas à gauche** :
  - à relire → « Relire » (bord ambre, `ShieldQuestion`) → détail placé sur la relecture ;
  - service → interrupteur « En marche » / « Arrêté » (`role="switch"`, nom accessible
    « Arrêter « X » » / « Démarrer « X » ») ; en marche : « Servir… » (SRV-5) si d'autres
    arbres existent, et « Ouvrir ↗ » à droite si le lien est connu ;
  - commande qui tourne dans un terminal → « Terminal » ;
  - agent dont un passage tourne → « Session ↗ » ;
  - sinon « **Lancer ▾** » (LAN-9).
  Tuile qui tourne : liseré d'accent (`border-accent/40 bg-accent/5`) ; à relire :
  bordure ambre ; sinon bordure qui fonce au survol.
- **LAN-8** Menu `⋯` (« Plus pour « X » ») : Voir le détail ; Modifier et « Planifier » /
  « Modifier la planification » (absents d'une action à relire) ; Dupliquer ; séparateur ;
  Supprimer.
- **LAN-9** « Lancer ▾ » : bouton scindé ; la partie gauche lance **à la racine du projet**
  (agent : « dans une nouvelle session ») ; le chevron (« Lancer dans… ») ouvre
  « Lancer dans » : la racine du projet, puis jusqu'à six worktrees (`useWorktrees`).
  Hauteur 44 px au doigt, 36 px à partir de `md`. ⚠ Pour un agent, le chevron propose des
  worktrees qu'un passage ne sait pas viser : le masquer, ou lui donner « Racine /
  Nouveau worktree » (question Q6).

**Vue Liste** (`ActionsPage.tsx`, `Section`, `Row`)
- **LST-1** Sections dans l'ordre, chaque action dans **une seule** : **En cours** (« Ce
  qui tourne maintenant : services, commandes dans un terminal, passages d'agent. »),
  **Lancés par les sessions** (PRC-4), **À relire** (titre ambre ; « Écrites ou modifiées
  par un agent : elles ne partent pas d'un clic avant ta relecture. »), **Planifiées**
  (« Elles partent seules, à leur cadence. »), **À la demande** (« Un clic, ou un agent
  par run_action. « Planifier » leur donne une cadence. »). Titre + compte + aide (aide
  masquée sous `md`) ; section vide masquée.
- **LST-2** Ligne (≥ 56 px) : icône de nature dans un carré, libellé, `KindChip`
  (« Commande · tâche » / « Commande · service » / « Agent » encadré + « à la demande »,
  « planifiée », « à la demande + planifiée » ; masqué sous `sm`), dessous le détail
  (texte de `live`, sinon la raison de relecture, sinon prompt / commande en mono), puis
  la ligne « sert … » (SRV-1). Clic sur le bloc texte → détail.
- **LST-3** Gestes à droite selon la section : En cours → service : « Ouvrir ↗ » +
  « Arrêter » ; agent : « Session ↗ » ; commande en terminal : « Terminal » ; À relire →
  « Relire » ; Planifiées → `ScheduleFacts` (LST-4) ; À la demande → « Planifier »
  (`AlarmClock`, ouvre l'éditeur sur Quand) + « Lancer ▾ ».
- **LST-4** `ScheduleFacts` : « ⚠ N échecs d'affilée » rouge (≥ 2, à partir de `lg`),
  cadence en clair (à partir de `lg`), prochaine échéance courte (« dans 3 h », « en
  pause », « — »), et **les dix derniers passages en pastilles** (`Pips`, le plus récent à
  droite, cases vides en tête, infobulle date · verdict · code ; masquées sous `md`).
- **LST-5** État vide : « Aucune action ni tâche planifiée. « + Action » pour en créer
  une. » (la mention de démo saute).

**Vue Agenda** — `P:routes/prototype-automations/ActionsAgenda.tsx` (AGD-*, §1.F).

### 1.C Le tiroir unifié d'une action — `ActionDrawer.tsx`, `DrawerParts.tsx`

- **TIRA-1** **Un seul tiroir** pour une action, trois modes (`ActionPanel`) : `detail`
  (avec `review?` : ouvert par « Relire »), `edit` (graine + `back` : l'action d'où l'on
  vient), `pick` (« Planifier une action existante »). Tiroir commun (coque TIR-*), largeur
  `wide`, libellé accessible selon le mode (« Modifier « X » », « Nouvelle action »,
  « Planifier une action existante », ou le libellé).
- **TIRA-2** « Modifier » depuis le détail bascule le **même** tiroir en édition ;
  « Annuler » revient au détail d'où l'on vient (sinon ferme) ; « Enregistrer » aussi.
- **TIRA-3** Mode **`inline`** (panneau d'une conversation, coque TIR-8) : le contenu
  remplace la liste du panneau ; l'en-tête porte « ‹ Actions » à la place du ✕ ; marges
  `px-3` au lieu de `px-5` ; **Échap remonte d'un niveau** (édition → détail d'origine,
  sinon liste), sauf si l'événement vient d'un menu, d'une liste ou d'un dialogue ouvert.
- **TIRA-4** Les mises en page suivent la largeur **du conteneur** (`@container/action`),
  pas celle de l'écran.
- **TIRA-5** En-tête commun (`ActionHeader`) : icône de nature (36 px en tiroir, 32 px en
  panneau), libellé (tronqué), puces « nature » + « quand » (« À la demande »,
  « Chaque jour à 03:00 (en pause) ») + extras (« à relire » ambre, « nouvelle » /
  « modification ») ; ✕ « Fermer » en tiroir.
- **TIRA-6** Corps qui défile (`ActionBody`, gap 28 px en tiroir, 24 px en panneau) ; blocs
  titrés en petites capitales grises (`ActionBlock`, geste facultatif à droite) ; pied
  collant (`ActionFooter`) : secondaires à gauche, principal à droite.
- **TIRA-7** Mode `pick` : en-tête « Planifier une action existante » / « Choisis
  l'action, puis sa cadence » ; bloc « Pas encore planifiées · N » : lignes (icône, libellé,
  `$ commande` ou prompt en mono, « ⏰ Planifier ») → éditeur sur Quand ; vide : « Toutes
  les actions sont déjà planifiées. » ; pied « Annuler ».

### 1.D Le détail d'une action — `P:routes/prototype-automations/ActionDetail.tsx`

- **DET-1** En tête, **l'état en une phrase et le geste principal** sur fond teinté
  (ambre à relire, rouge à partir de 2 échecs, neutre sinon), point d'état. Phrases :
  « À relire avant son premier lancement : … » ; « Le service tourne — :5173 · depuis
  2 h. » ; « Un passage est en cours : depuis … » ; « La commande tourne dans un terminal
  du panneau. » ; « N échecs d'affilée — dernier il y a … » ; « Le service est arrêté. » ;
  « Planification en pause : elle ne part qu'à la main. » ; « Dernier passage réussi il y
  a … (code 0). » ; « Jamais lancée. »
- **DET-2** Geste principal (aussi à droite du pied) : à relire → « Relire » (défile
  jusqu'au bloc) ; service en marche → « Ouvrir ↗ » + « Arrêter » ; passage d'agent en
  cours → « Session ↗ » ; commande en terminal → « Terminal » ; service arrêté →
  « Démarrer » ; depuis une conversation (`launchWhere`) → « Lancer » direct (dans son
  worktree, ou nouvelle session pour un agent) ; sinon « Lancer ▾ » (LAN-9).
- **DET-3** Ouvert par « Relire » : le tiroir se place sur le bloc de relecture
  (`#relecture`).
- **DET-4** **Relecture** (bordure ambre) : « Relecture » ; texte selon la nature (« Un
  agent a écrit cette commande. Elle ne part pas d'un clic tant que tu ne l'as pas
  validée. » / « Ce script tourne avant chaque passage, sans agent : relis-le avant de le
  laisser partir seul. ») ; **ce qui a changé** quand une commande déjà validée a été
  modifiée (« − ancienne » rouge barrée, « + nouvelle » verte), sinon la commande ou le
  script en mono ; « Valider » / « Refuser ».
- **DET-5** **Ce qu'il sert** (service en marche, SRV-3).
- **DET-6** **Quoi** (geste « Modifier ») : agent → « <CLI> reçoit ce prompt, dans une
  session neuve : » + le prompt dans un encart, « Vérification » (script en mono, puce
  « à valider ») ; commande → `$ commande` (retour à la ligne), « Dossier »
  `<worktree>/sous-dossier` « celui d'où on la lance », « Lien » (service), « Note »
  (description).
- **DET-7** **Quand** (gestes : « Mettre en pause » / « Reprendre » et « Modifier » si
  planifiée, sinon « Planifier ») : deux lignes à point vert/gris — « À la demande : … » /
  « Pas à la demande : elle ne part qu'à sa cadence. » ; la cadence (« — en pause ») et
  les **trois prochains passages** (« Prochain passage : … », « puis … »), ou « Pas
  planifiée. »
- **DET-8** **Passages** (« N connus ») : **frise** des 20 derniers (le plus récent à
  droite ; seulement les 10 derniers quand le conteneur fait moins de 28 rem ; « le plus
  récent à droite » au large) ; liste des 12 derniers : chevron si dépliable, point,
  date-heure, durée, verdict (« code 1 » ou mot), « Session ↗ » pour un agent ; une ligne
  dépliée montre l'erreur et l'**extrait de sortie** (le premier passage avec extrait est
  déplié d'office). Vide : « Aucun passage pour l'instant. » (le texte « le serveur ne
  garde que le dernier » disparaît avec AC-02).
- **DET-9** **Origine** : « Proposée par un agent dans « titre » » (lien vers la session)
  · date, ou « Créée par toi · date ».
- **DET-10** Pied : « Dupliquer » (éditeur pré-rempli, libellé « (copie) ») et
  « Supprimer » à gauche ; Supprimer se confirme **sur place** (« Supprimer « X » ? »
  Annuler / Supprimer rouge), puis ferme.
- **DET-11** Pause / reprise reflétées tout de suite (puces, phrase, prochains passages).

### 1.E L'éditeur unifié — `P:routes/prototype-automations/Editor.tsx`

Règles de forme (Tim) : un exemple de saisie se lit comme un exemple (« ex. … », pâle,
italique) ; une erreur s'affiche **sous son champ, quand on le quitte** ; deux étapes
numérotées, chacune avec son choix principal en cartes.

- **EDI-1** Graine (`EditorSeed`) : `from` (modifier), `schedule` (arriver sur Quand,
  « Planifiée » cochée), `preset` (nature choisie d'avance), `prefill` (« En faire une
  action » : libellé, commande, lien, description). L'éditeur est remonté à neuf quand la
  graine change.
- **EDI-2** En-tête : icône et puces mises à jour en direct ; titre = libellé saisi, sinon
  « Nouvelle action » ; puce « nouvelle » / « modification ».
- **EDI-3** **1 · Quoi** (« Ce que le bouton lance. ») : deux grandes cartes « Une
  commande » (Un script du dépôt. Pas d'agent, pas de jetons.) / « Un agent » (Un prompt
  confié à un CLI, dans une session que tu relis.) ; deux colonnes à partir de 30 rem de
  conteneur.
- **EDI-4** Commande — « **Trouvé dans le dépôt** · un clic remplit tout » : puces des
  scripts détectés (icône service/tâche, libellé, commande en mono ; infobulle « source —
  pourquoi ») ; la puce choisie est accentuée ; un clic remplit libellé, nature, commande,
  dossier, lien.
- **EDI-5** « Nature » : petites cartes « Tâche » (se termine, avec un code de sortie) /
  « Service » (tourne en continu, a un port).
- **EDI-6** « Commande » : champ `$` multi-lignes (1 à 4 lignes), mono, « ex. pnpm test » ;
  erreur « La commande à lancer. »
- **EDI-7** « Dossier » : sélecteur d'arborescence (popover 18 rem, liste indentée,
  « Racine du worktree », coche sur le choix) ; aide « s'exécutera dans
  `<worktree>/sous-dossier`, celui de la conversation d'où l'on clique, sinon la racine du
  projet » ; erreurs « Un chemin relatif au worktree… », « Sans « .. » : on reste dans le
  projet. »
- **EDI-8** Service : « **Où tourne-t-il** » (SRV-6, `PlacementField`) ; aide « une seule
  unité par action ; … ».
- **EDI-9** Service : « Lien du service » (facultatif) : « ex. http://localhost:{port} » ;
  aide dynamique (« quand il écoute sur :5173, le lien sera … » via `resolveActionUrl`) ;
  erreur « Une adresse http(s), avec {port} si tu veux. » ; **avertissement** ambre si
  Solera est ouvert depuis une autre machine et que le lien contient `localhost`.
- **EDI-10** « **Essayer** » (désactivé sans commande ; « Lance une fois, sans
  enregistrer. » / « Une commande d'abord. ») ; la sortie s'affiche dessous (fond sombre,
  48 max) ; toute modification de la commande l'efface.
- **EDI-11** Agent — « CLI » : quatre boutons pressés (Claude, Codex, Grok, OpenCode, avec
  icône) ; « Modèle » (liste du CLI, « Par défaut du projet » en tête) et « Effort »
  (segmenté) ; deux colonnes à partir de 30 rem.
- **EDI-12** « Prompt » (6 lignes) : aide « Ce qu'on écrirait à l'agent en ouvrant la
  session. Il ne connaîtra rien d'autre. » ; erreur « Ce que l'agent doit faire. »
- **EDI-13** « Où il tourne » : Racine (le dossier du projet) / Nouveau worktree (une
  branche à lui) / Confiné (sans demandes d'autorisation) ; trois colonnes à partir de
  34 rem. ⚠ Le modèle réel sépare *où* (racine / nouveau worktree) et *confinement*
  (`confined`, #146) : voir Q4.
- **EDI-14** « Script de vérification » repliable (« facultatif — s'il sort en 0, le
  passage n'a pas lieu ») : champ mono. ⚠ La phrase est **fausse** : le contrat réel est
  « 0 lance, 10 (`CHECK_SKIP_EXIT_CODE`) écarte, autre = erreur ». Reprendre
  `CheckSection` de main (essai du script, délai) — voir §2.
- **EDI-15** « Libellé » (compteur `n/60`, « ex. Sauvegarde de la base » / « ex. Revue des
  dépendances » ; erreurs « Un libellé court : c'est le texte du bouton. », « 60
  caractères au plus. ») et « Description » (facultatif) côte à côte à partir de 30 rem.
- **EDI-16** **Aperçu du bouton** tel qu'il apparaîtra (icône, libellé ou « Libellé du
  bouton » pâle, description ou « arrêté » / « jamais lancée », faux « ▷ Lancer »).
- **EDI-17** **2 · Quand** : deux cartes à cocher « À la demande » (Un clic, ou un agent) /
  « Planifiée » (Part seule, à sa cadence) ; erreur « Au moins un des deux… » ; Planifiée
  cochée → `ScheduleBuilder` (PLA-*), étiqueté « Démarrer » pour un service.
- **EDI-18** Service planifié (cas limite) : encart ambre « Cas limite : un service
  planifié » + second `ScheduleBuilder` « Arrêter » (pré-réglé 19 h en semaine).
- **EDI-19** Ouvert par « Planifier » / « Modifier la planification » : défile directement
  jusqu'à Quand.
- **EDI-20** Pied collant : résumé à gauche (« Commande · tâche · à la demande + Chaque
  jour à 03:00 ») ; « Annuler » ; « Enregistrer » désactivé tant qu'un problème bloque,
  avec l'infobulle « À compléter : … ». Enregistrer marque tous les champs comme touchés
  et affiche leurs erreurs.
- **EDI-21** Dans le panneau d'une conversation trop étroit (< 360 px) en édition ou en
  choix : bande « Le panneau est étroit pour éditer. » + « Agrandir le panneau » (plein
  écran du panneau) — PACT-9.

### 1.F La planification lisible — `P:routes/prototype-automations/ScheduleBuilder.tsx`

- **PLA-1** Une **phrase** dont chaque morceau est un contrôle de même hauteur (36 px),
  qui se plie au téléphone : « Répéter [chaque semaine ▾] le [L M M J V S D] à [03:00 ▾] ».
- **PLA-2** Fréquences (menu en trois groupes) : Une seule fois · Toutes les N heures,
  chaque jour, chaque semaine, chaque mois · Personnalisé (cron).
- **PLA-3** Une fois : « le [date ▾] à [heure ▾] » ; la date se choisit dans un mois
  (jours passés désactivés, aujourd'hui cerclé, mois précédent/suivant).
- **PLA-4** Toutes les N heures : [1, 2, 3, 4, 6, 8, 12 h] ; « + sur une plage horaire » →
  « entre [8 h] et [20 h] » (fin toujours > début) + « toute la journée » pour revenir.
- **PLA-5** Chaque jour : « à [heure] » + bascule « jours ouvrés seulement ».
- **PLA-6** Chaque semaine : pastilles L…D (lundi d'abord, au moins un jour : « Choisis au
  moins un jour. »).
- **PLA-7** Chaque mois : « le [1er ▾] » (grille 1–31, au-delà de 28 en pâle, « Dernier
  jour ») ; au-delà de 28, l'aide « Les mois sans N, rien ne part : « dernier jour » suit
  la longueur du mois. »
- **PLA-8** Personnalisé : champ cron mono, bord rouge si invalide ; aide « minute · heure ·
  jour du mois · mois · jour de la semaine » ou erreur « Il faut 5 champs… » ; passer en
  Personnalisé **garde le cron équivalent** de ce qu'on voyait.
- **PLA-9** L'heure : bouton « 03:00 » → popover avec un champ « Taper l'heure » (« 9 »,
  « 9:30 », « 0930 », Entrée valide) + grille 00–23 + quarts d'heure.
- **PLA-10** Relit une cadence existante (`stateFromCadence`) ; ce qu'il ne sait pas
  relire passe en Personnalisé, le cron tel quel ; produit `ScheduleCadence` (cron,
  intervalle, une fois) (`cadenceFromState`).
- **PLA-11** **Aperçu** toujours affiché : la phrase en clair (ou « Règle incomplète. ») ;
  un **mois** où les jours de passage sont pleins (badge du nombre quand > 1 dans la
  journée) ; « Prochains passages » (5 : « dans 5 h », « demain », « dans 3 j » + date
  complète) ; « Fuseau … ». ⚠ Le proto montre le fuseau **du navigateur** ; un cron se
  lit à l'heure **du serveur** (`schedule.form.serverClock` sur main) : afficher et
  calculer avec le fuseau du serveur (AC-04).

### 1.G L'Agenda — `P:routes/prototype-automations/ActionsAgenda.tsx`

- **AGD-1** En-tête : le mois (semaine) ou la date complète (jour) ; ‹ Aujourd'hui › ;
  portée Semaine / Jour ; « ⚠ N chevauchement(s) » ambre ; légende (agent, commande,
  prévu, verdict).
- **AGD-2** Passages **passés** (les vrais) et **à venir** (calculés jusqu'à la fin de la
  période, d'une durée = médiane des passages finis, à défaut 20 min) des actions
  planifiées ; un passage à venir est en **pointillé**.
- **AGD-3** Bloc coloré par **nature** (agent accent, commande gris, service vert), liseré
  gauche = **verdict** (réussi vert, échec rouge, trop long ambre, en cours accent qui
  pulse, sauté gris) ; hauteur minimale 20 px ; en grand : nom + heure sur deux lignes.
  Infobulle : nom, date, verdict, nature, « chevauche une autre action ». Clic → tiroir.
- **AGD-4** Chevauchements : les passages d'une même journée qui se recouvrent se rangent
  côte à côte ; anneau ambre quand **deux actions différentes** se chevauchent (une même
  action ne compte pas).
- **AGD-5** **Heures vides resserrées** : on montre les heures qui portent quelque chose
  ± 1 h, et l'heure courante ; le reste se replie en bandes `⋯` (22 px) qui déplient tout ;
  « Resserrer les heures vides » pour revenir ; sans rien, 8 h–19 h.
- **AGD-6** Ligne « maintenant » (accent, point) dans la colonne du jour ; colonne du jour
  teintée ; numéro du jour en pastille accent.
- **AGD-7** Bandeau du jour : **ce qui tourne en continu** (services en marche) en
  pastilles vertes cliquables.
- **AGD-8** Hauteur max 36 rem qui défile ; « Rien de planifié pour l'instant. « + Action »
  pour en planifier une. »
- **AGD-9** Sous **44 rem de conteneur** (téléphone, panneau) : une **liste par jour**
  (« Rien. » ou lignes heure · nature · nom · verdict ou « prévu »).
- **AGD-10** « Maintenant » avance chaque minute.

### 1.H « Ce qu'il sert » — `P:routes/prototype-automations/served.tsx`

- **SRV-1** `ServedLine` (tuile, ligne, panneau) : « ⎇ sert `feat/905-vue-horizon` @
  a1b2c3d · ↓3 · ●2 » — la racine se dit « la racine (main) » ; branche tronquée à 28
  caractères ; ●N ambre (« Fichiers non commités : c'est l'arbre de travail qui est
  servi ») ; infobulle = le `cwd`.
- **SRV-2** Index (`useServedIndex`) : pour chaque service en marche, l'arbre **le plus
  profond** qui contient son `cwd` (un sous-dossier compte ; `~` développé), sa branche,
  son commit, ↑ en avance / ↓ en retard, non commités ; par action et par arbre.
- **SRV-3** `ServedBlock` (détail) : Arbre (lien → `/p/:id/travail?arbre=<clé>`, « Racine
  du projet » ou nom ; chemin en mono dessous), Branche, Commit (sinon « non lu »), « Sur
  <base> » (↑ N en avance, ↓ N en retard), Non commités (« N fichiers — servis tels quels
  (HMR) » ambre, ou « aucun »), Carte (« #n titre · Jalon #m ») ; « Servir une autre
  branche… » (menu « Basculer sur » : jusqu'à 8 arbres, ni disparus ni fusionnés).
- **SRV-4** **Refus du « déjà en marche » silencieux** : lancer un service qui tourne
  depuis un autre arbre ouvre un dialogue « « X » sert déjà <branche> » : « Il tourne
  depuis … sur :ports. Le basculer sur … le **redémarre** dans ce worktree : ce que tu as
  ouvert dans le navigateur se recharge. » ; « Ouvrir plutôt celui qui tourne ↗ » ;
  confirmer « Basculer sur <branche> ».
- **SRV-5** « Servir… » sur une tuile en marche (menu « Basculer sur ») → même dialogue.
- **SRV-6** `PlacementField` « Où tourne-t-il » (radio en cartes) : **Une seule instance,
  qu'on bascule** (conseillé : « … Solera demande s'il faut le basculer au lieu de garder
  l'ancien en silence ») · **Toujours la racine du projet** · **Toujours une branche**
  (liste des branches ; « La racine est sur cette branche : il y tournera. » ou « … il
  faudra un worktree dédié à X, que Solera garde à jour ») · **Une instance par worktree**
  (avertissement ambre : un processus et un port par arbre, la commande doit accepter un
  port libre, « et le lien doit contenir {port} »).
- **SRV-7** `ServiceMark` « ⚡ :5173 » sur un arbre servi, dans Travail → l'action dans
  l'onglet Actions (`?action=`). **Rendu par le domaine Travail** (`projet.md`), données
  fournies ici (`useServedIndex`).

### 1.I Lancés par les sessions — `P:routes/prototype-automations/SessionWorks.tsx`

- **PRC-1** Source : `GET /api/services` (même clé de requête `['services']` que la page
  Services, rafraîchie toutes les 5 s), entrées `kind: 'command'` du projet, triées par
  départ ; à défaut (scan non supporté), les travaux de fond de la conversation ouverte
  (journal) et, pour les autres sessions, **leur seul nombre** (`liveBackground`).
- **PRC-2** `humanLabel` : ce que le processus **est**, déduit de la commande sans
  enrobage (`shortCommand` retire `env A=1`, `npx`, `pnpm exec`, `npm exec`, `dlx`…) :
  « Serveur vite », « Tests vitest en surveillance », « Typecheck », « Serveur de dev »,
  avec le paquet filtré (« (server) ») ; sinon l'exécutable capitalisé ; sinon la
  description du CLI. `portIn` devine un port (`--port 5418`, `:5173`). `familyOf` range
  un `kind` du CLI (commande de fond, workflow, surveillance, sous-agent, autre).
- **PRC-3** **Tuile** (Lanceur) au gabarit exact d'une tuile d'action : icône de famille
  avec point vert qui pulse, libellé humain, « En marche · :5418 · depuis 47 min » ;
  détail : `$ commande courte` + pastille de la session d'origine (icône du CLI, titre,
  lien) ; pied : « Ouvrir :5418 ↗ » s'il écoute, sinon « ■ Arrêter » ; `⋯` : En faire une
  action · Aller à la session · Arrêter · la charge (« 3 % · 120 Mo »). Une session dont
  on ne connaît que le nombre : « En cours · N travaux de fond », « On n'en connaît que le
  nombre : la session dit le reste. », « Session ↗ ».
- **PRC-4** **Ligne** (Liste) : point vert, icône de famille, libellé, `$ commande`,
  faits (session d'origine en lien, famille, depuis, :port) ; gestes « Ouvrir ↗ »,
  « En faire une action » (`Wand2`), « ■ » Arrêter ; clic → sortie dépliée quand on la
  connaît. En-tête « Lancés par les sessions » + aide « Ce qu'une session a laissé tourner
  en fond : un serveur, des tests en surveillance. « En faire une action » le garde. »
- **PRC-5** **« En faire une action »** (`seedFromWork`) : éditeur pré-rempli —
  service si un port est connu (lien `http://localhost:{port}`), sinon tâche ; libellé,
  commande, description « Repris de « titre », où une session l'avait lancé en fond. »
- **PRC-6** Filtres de l'onglet : la section disparaît si « Agents », « Planifiées »,
  « À relire » ou « En échec » sont seuls cochés.

### 1.J La page globale Planifiées v2 — `P:routes/prototype-planned/{PlannedPage,data}.tsx`

Route `/schedules` (lieu « Planifiées » de la sidebar).

- **PLF-1** Bande des pages de lieu, même gouttière que `PlaceShell` (16/24), **sans
  rangée d'onglets** : icône `CalendarClock`, « Planifiées », « **+ Tâche ▾** » à droite :
  Tâche d'agent (Un prompt confié à un CLI, à sa cadence.) · Commande planifiée (Un script
  qui se termine : sauvegarde, nettoyage.) · séparateur · Planifier une action existante…
  ⚠ Les deux premières ouvrent l'éditeur **sans cocher « Planifiée »** : à corriger
  (graine `schedule: true` d'office sur cette page).
- **PLF-2** Barre : « Chercher une tâche » (libellé, prompt, commande, nom de la portée),
  « Filtrer ▾ » (popover défilant, 70 vh) : **Portée** (chaque projet avec sa pastille de
  couleur, Savoir `BookOpen`, Instance `Server`, Sans projet `FolderX`, et son compte) ·
  **Quoi** (Tâches d'agent, Commandes) · **État** (Actives, En pause, En échec, À relire) ·
  **Prochain passage** (Passe aujourd'hui, Passe sous 7 jours — exclusifs) ; puces ;
  « Effacer tous les filtres » ; à droite « N tâches · N portées » (à partir de `lg`).
- **PLF-3** « Affichage ▾ » : **Lanceur** (défaut) · **Agenda** · **Liste** (= l'ancienne
  Santé) ; en Agenda « Période » Semaine / Jour ; sinon « Regrouper » **Par échéance** (ou
  **Par état** en Liste) / **Par portée**. Retenu (`useView('planifiees-v2', 'all')`).
- **PLF-4** **Lanceur** : groupes Par échéance (Aujourd'hui ⏰, Cette semaine 📅, Plus tard,
  En pause ⏸ ; triés par prochain passage) ou Par portée (dans l'ordre projets, Savoir,
  Instance, Sans projet) ; tuile d'ajout « + Tâche » dans chaque groupe ; groupe vide
  masqué ; « Aucune tâche ne correspond aux filtres. »
- **PLF-5** **Tuile planifiée** (gabarit du Lanceur) : `StateIcon`, libellé (estompé en
  pause), phrase (« À relire — … », « En cours · … », « N échecs d'affilée · dernier ✗ il
  y a … », « En pause · dernier ✓ il y a … », « Prochain dans 3 h · dernier ✓ il y a 6 h »,
  « jamais lancée ») ; détail : cadence (`AlarmClock`) + **pastille de portée**
  (`ScopePip` : `ProjectPip` d'un projet, ou icône + nom) ; `⋯` : Voir le détail,
  Modifier (sauf à relire), Mettre en pause / Reprendre, Dupliquer, Supprimer ; pied :
  « Relire » / « Session ↗ » (passage en cours) / « ▷ Reprendre » (en pause) / « ▷ **Lancer
  maintenant** » (icône `Play` : l'éclair est celui des actions, décision).
- **PLF-6** **Agenda** : `ActionsAgenda` sur les tâches filtrées.
- **PLF-7** **Liste** (ex-Santé) : quatre chiffres (2 colonnes au téléphone, 4 à partir de
  `md`) — Réussite sur 30 j (pondérée par passages jugés), En échec (rouge si > 0), Coût
  sur 30 j (somme des `costUsd` des sessions des passages ; « < 0,01 $ »), Prochain
  passage ; sections **À regarder** (rouge : échecs ou à relire) · **En bonne santé** · **En
  pause**, ou par portée (triées par échecs) ; ligne : icône, libellé, motif sous le nom
  (« Script de vérification à relire : les passages sont écartés. » / « N échecs
  d'affilée — <dernière erreur> »), portée, taux, coût (agents ; « — » pour une commande),
  dix pastilles. Clic → tiroir.
- **PLF-8** État vide de la page : icône, « Aucune tâche planifiée », « Une tâche part
  seule, à sa cadence : une revue nocturne, un rapport, une sauvegarde. Elle peut viser un
  projet, le Savoir ou toute l'instance. », « + Tâche ».
- **PLF-9** Tiroir commun des actions (TIRA-*) ; lancer à la main part « à la racine de
  <projet> » / « dans le vault » / « sur l'instance » / « hors projet ».
- **PLF-10** ⚠ Création depuis cette page : l'éditeur n'a **pas de champ Portée** — il en
  faut un (projet / Savoir / Instance / Sans projet), sinon on ne sait pas où créer
  (EDI-22, ajouté par AC-20).

### 1.K Le panneau de droite d'une conversation — `P:components/prototype/panel/*`

**Coque du panneau** — `ProtoSidePanel.tsx` (copie de `M:components/panel/SidePanel.tsx`)
- **PAN-1** Rangée des onglets inchangée dans son ordre : Fichiers, Recherche, Git,
  Terminaux, **Actions** (`Zap`) | Agent, Projet | Web (seulement quand une page est
  ouverte).
- **PAN-2** Compte de l'onglet Actions à trois tons (coque ACT-2) : ambre « N à relire »
  d'abord (`panel.tab.actions.badge`), sinon **vert** « N en marche » (nom accessible
  « Actions — N en marche ») ; ton `running` ajouté à `Tab` (`bg-positive/12
  text-positive`).
- **PAN-3** Ombre selon la règle des deux familles : **ancré** (pousse le fil) → aucune
  ombre ; **par-dessus** (feuille, téléphone, plein écran) → `shadow-lg`.
- **PAN-4** Chaque onglet suit le **cadre commun** (`PanelTabFrame.tsx`) : ligne d'outils
  48 px, filet bas, `px-3`, titre court + compte gris à gauche, outils à droite à la
  hauteur de `Button size="sm"` ; en-têtes de groupe en petites capitales + compte ;
  lignes 36 px (44 au doigt), icône de nature avec point d'état, méta grise, un geste au
  survol ; **détail en pile** (« ‹ Onglet ») jamais un second tiroir ; état vide = une
  ligne + le geste utile ; **retour** (erreur, information) = bande fine sous la ligne
  d'outils, au même endroit partout (`PanelNotice`, ton neutre/ambre/rouge, ✕) ; pas de
  cartes bordées ; la couleur ne sert qu'aux points d'état.

**Onglet Actions** — `ProtoActionsPane.tsx` (le Lanceur compact)
- **PACT-1** Ligne d'outils : « Actions » + compte gris ; `ActionsStatusMeta` (« N en
  marche » → passe en **Liste** et défile jusqu'à `#pane-actions-running` ; « N à
  relire » → `#pane-actions-review`) ; recherche « Chercher » **seulement au-delà de huit
  actions** ; « Affichage » en icône seule (Lanceur · Liste · Agenda, choisir ferme le
  menu ; Agenda : Période **Jour** (défaut) / Semaine ; sinon une phrase d'aide) ;
  « + Nouvelle ▾ » (Nouvelle commande, Nouveau service, Nouvelle tâche d'agent, Planifier
  une action…) ; **↗** « Ouvrir dans l'onglet Actions du projet ». Vue retenue par projet
  (`useView('panneau-actions', projectId)`).
- **PACT-2** **Lanceur** : « En cours / Dernières commandes » (RUN-*), « Processus des
  sessions » (PRC-7), puis **Services**, **Commandes**, **Agents** en lignes.
- **PACT-3** Ligne d'action (≈36 px) : `StateIcon` petit avec point, libellé, phrase
  d'état (`actionState`, ambre/rouge), geste à droite ; la ligne entière ouvre le
  détail **en pile**. Service : « ↗ » si en marche avec lien + interrupteur sans texte
  (« Démarrer « X » dans le worktree de cette conversation ») ; commande : ▷ « Lancer dans
  le worktree de cette conversation », ou icône terminal si elle tourne (→ son terminal
  dans l'onglet Terminaux) ; agent : ▷ « Lancer dans une nouvelle session », ou ↗ sa
  session ; à relire : « Relire » (ouvre le détail sur la relecture).
- **PACT-4** **Liste** : En cours (commandes lancées ici), **Services en marche**,
  Processus des sessions (ancre `pane-actions-running`), **À relire** (ancre
  `pane-actions-review`), **Planifiées**, **À la demande**. Une commande qui tourne dans un
  terminal n'est pas redite dans « Services en marche ».
- **PACT-5** **Agenda** : `ActionsAgenda` (liste par jour quand le panneau est étroit).
- **PACT-6** État vide : « Aucune action enregistrée. » + trois puces de suggestions du
  dépôt (« + Serveur de dev `pnpm dev` »…) → éditeur pré-rempli.
- **PACT-7** **Détail, édition, choix en pile** (`ActionDrawer inline`, TIRA-3) ;
  `launchWhere` = « dans le worktree de cette conversation » : « Lancer » / « Démarrer »
  y partent sans menu.
- **PACT-8** « En faire une action » venu de l'onglet Agent (PAG-12) ouvre ici l'éditeur
  pré-rempli, même si l'onglet n'était pas monté au moment de la demande.
- **PACT-9** Panneau < 360 px en édition ou en choix : « Le panneau est étroit pour
  éditer. » + « ⤢ Agrandir le panneau » (plein écran) — absent quand il couvre déjà
  l'écran.
- **PACT-10** Les signaux de la conversation ouvrent l'onglet qui les tient : **travaux
  de fond → Actions**, **sous-agents → Agent** (`SignalRow onSelect(kind)` +
  `setPanelTab`) — diff `P:routes/ConversationPage.tsx`.
- **PRC-7** « Processus des sessions N » (`SessionWorkLine`) : icône de famille avec point
  vert, libellé humain, pastille de la session d'origine **seulement si ce n'est pas
  celle-ci** ; à droite « :port ↗ » et la durée ; au survol « ■ Arrêter » et `⋯` (En
  faire une action, Voir la sortie, Aller à la session) ; un clic déplie la commande
  exacte, « Lancé par cette session » / « Lancé par « titre » », depuis, la charge, la
  sortie (sinon « La sortie ne remonte pas jusqu'ici : elle est dans la session qui l'a
  lancé. »). Une session connue par son seul nombre : une ligne-lien.

**Commandes lancées ici** — `CommandRuns.tsx`, `commandOutput.ts`
- **RUN-1** Source : les terminaux du projet ouverts par une action (`actionId`) **depuis
  cette conversation** (hors conversation : ceux de la racine) ; libellé et commande de
  l'action ; statut : en cours / réussie / échec / interrompue (redémarrage) ; triés en
  cours d'abord puis plus récents.
- **RUN-2** Groupe « **En cours** N » (s'il y en a qui tournent), sinon « **Dernières
  commandes** N ». Ligne : icône (spinner accent, ✓ vert, ✗ rouge, ■ gris), libellé,
  méta — en cours : durée **qui avance chaque seconde** + dernière ligne de sortie en
  mono ; finie : « Réussie · 9 s », « Interrompue », « Échec (code 1) · 18 s · 3 tests en
  échec » / « · 12 erreurs » ; à droite : « ■ Arrêter » (en cours) ou ✕ « Écarter » au
  survol + chevron. Clic → détail en pile.
- **RUN-3** Détail (« ‹ Actions », icône, libellé) : phrase d'état colorée (« En cours
  depuis 38 s », « Réussie en 9 s · il y a 12 min », « Interrompue : le terminal a été
  emporté par un redémarrage. », « Échec (code 1) en 18 s · Tests 3 failed | 41 passed
  (44) ») ; `$ commande` ; gestes : « Arrêter » (rouge) ou « Relancer » ; « Relancer
  seulement les échecs » (si l'outil le sait ; infobulle = la commande) ; « Ouvrir le
  terminal » (→ onglet Terminaux sur ce terminal).
- **RUN-4** « **Tests en échec · N** » : chemin du test (« suite › » en gris, cas en
  noir), lien fichier:ligne (→ onglet Fichiers, ligne révélée), message, encart
  « attendu / reçu ». « **Lint · N dans M fichiers** » / « **Erreurs de typage** · … » :
  fichier (lien), puis `ligne:col`, point rouge/ambre, message, règle. Réussie sans rien :
  « Rien à signaler — <bilan>. »
- **RUN-5** « **Sortie** » (« · en direct » tant qu'elle tourne) : les 200 dernières
  lignes, sans codes ANSI, collées en bas tant qu'on ne remonte pas, 20 rem max, fond
  sombre ; « Lecture du terminal… » ; « Pas de sortie connue. » ; erreur de socket
  « … Ouvre son terminal pour la voir. ». La sortie vient de la socket du terminal, **en
  lecture seule** (rien n'est envoyé, pas même la taille).
- **RUN-6** Parseurs tolérants (`summarize`) : vitest, jest, node:test, pytest, eslint,
  tsc ; détection par la commande puis par la sortie ; ligne de bilan ; 40 dernières
  lignes ; commande de relance des seuls échecs (`-t "a|b"`, `--lf`,
  `--test-name-pattern=`). Échap remonte à la liste.

**Onglet Agent** — `ProtoAgentPane.tsx`, `agentFiles.ts`
- **PAG-1** Pas de ligne d'outils : groupe **En cours** (sous-agents qui travaillent et
  travaux de fond, mêlés, du plus ancien au plus récent) ; vide : « Rien ne tourne. »
- **PAG-2** Ligne de sous-agent : `Bot` avec point (accent qui pulse = travaille, vert =
  terminé, rouge = arrêté), libellé (`subAgentLabel`), méta (« 2 min · 14 outils »,
  « arrêté ») → détail en pile.
- **PAG-3** Ligne de travail de fond : icône de famille, description, au survol « Ouvrir
  :port » (si un port se devine), sinon « N outils » ou la famille → détail en pile.
- **PAG-4** « **N terminés** » replié en une ligne (chevron), déplie les sous-agents finis.
- **PAG-5** Pied dépliable « **Modifié par la session · N fichiers** » (45 % de hauteur
  max) : nom du fichier (ouvre le fichier), qui l'a écrit (« agent principal », noms des
  sous-agents), `+a −r` (connu pour les sous-agents seuls) ou « N passes », icône diff au
  survol → onglet Git.
- **PAG-6** Détail d'un sous-agent : « ← Agent », type · « travaille depuis… / terminé
  en… / arrêté » · outils · tokens ; blocs **Fichiers modifiés** (N), **Résultat** (3
  lignes, « Tout lire » / « Replier »), **Son fil** (le fil rendu par `ChatThread`) ; pied
  « Copier le résultat » (désactivé sans résultat ; refus du presse-papiers expliqué),
  « Dans le fil principal » (défile jusqu'à l'appel et le fait clignoter ; sinon une
  explication), « ■ Interrompre la session » (seulement s'il travaille ; infobulle « Le
  CLI n'arrête pas un sous-agent seul : c'est toute la session qui s'interrompt »). Échap
  remonte.
- **PAG-7** Détail d'un travail de fond : Nature, À l'instant, Outils, Tokens, Port ;
  « Sa sortie ne remonte pas jusqu'à Solera. » ; pied « ■ Arrêter », « Ouvrir :port »,
  « En faire une action » (→ PAG-12).
- **PAG-12** « En faire une action » : bascule sur l'onglet Actions avec l'éditeur
  pré-rempli (PACT-8).

**Onglet Projet** — `ProtoProjectPane.tsx`
- **PPR-1** Ligne d'outils « Projet » + « #N » de la carte ; segments « ● Cette session »
  (point qui pulse quand elle travaille) / « Projet ».
- **PPR-2** Cette session : bande d'activité (« Travaille · <ce qu'elle fait> » ou « Au
  repos », modèle · contexte N %) ; la **carte** (PPR-4) ou « Pas de carte. » + «
  Rattacher » (choix de carte) + « Créer depuis la session », et la **suggestion** (« #n
  titre · citée N× · Rattacher #n ») ; « Lecture du tableau… » / « Le tableau n'a pas pu
  être lu. » + « Réessayer » ; le **plan de l'agent** (étapes cochées, « tour précédent ·
  a/b ») ; la **branche** (worktree : branche mono, ↑↓, non commités, conflit, « Git → »
  au survol → onglet Git ; « À la racine du projet. » + « Git ») et sa **PR** (n°, titre,
  « brouillon / CI en cours / CI rouge / prête / fusionnée · réussis/total », ↗) ou « Pas
  de PR pour cette branche. »
- **PPR-3** Projet : **Ce qui t'attend** (`AskInbox bare`, coque INB-*) ; **Jalon en
  cours** (titre → page du jalon, barre d'avancement, « Vague N · a/b », « cette session y
  travaille (#n) » / « n'en fait pas partie », sinon « Aucun jalon en cours. ») ; **Autres
  sessions actives** (celles qui attendent d'abord, 6 max, #carte, « t'attend » /
  « travaille ») ; **Prêtes à partir** (à faire, acceptées, rien à préciser, bloqueurs
  fermés, sans session vivante ; 3 ; « ▷ Lancer une session » au survol →
  `/c/new?card=`) ; liens Tableau · Jalons · Travail.
- **PPR-4** Une carte, à plat : (titre cliquable pour la carte de la session) ; colonne
  (point), jalon parent (lien), échéance (rouge en retard), « à préciser » ; gestes
  « Ouvrir la fiche » (carte de la session → en pile) / « Dans le tableau » (autre carte),
  « Colonne ▾ » (coche sur l'actuelle), « Détacher » (carte de la session) ; **Sous-tâches
  a/b** (barre verte, cases cochables) ; **Dépendances** (« bloquée par » / « bloque »,
  barrées si fermées, → en pile) ; **Sessions** de la carte (état, → session) ;
  **Description** (en pile seulement) ; **Notes** (3, « Tout voir » ; auteur agent ou
  personne, âge).
- **PPR-5** Détail d'une autre carte **en pile** : « ‹ Projet », « #n titre », colonne.

**Onglet Git** — `ProtoGitPane.tsx`, `GitLine.tsx`
- **PGIT-1** Le rail vertical (Graphe, En cours, Branches, Remises, Recherche, Historique)
  et la barre au-dessus deviennent **une seule ligne** : « Git » + branche en mono (à
  partir de 26 rem) ; « **Affichage ▾** » (icône + nom de la destination à partir de
  20 rem) : six destinations avec leur aide (« Les commits et leurs branches », « Ce qui
  n'est pas commité », « Locales, distantes, worktrees », « Le travail mis de côté »,
  « Dans les messages et les auteurs », « Ses versions et son blâme ») et leur compte.
- **PGIT-2** « ⚠ N conflits » ambre sur la ligne pendant un conflit (mène à Conflits).
- **PGIT-3** Gestes du dépôt **réels et inchangés** (`useGitActions`) : annuler, refaire |
  tirer (compte ↓, libellé à partir de 36 rem), pousser (compte ↑, **accent** quand il y a
  à pousser), récupérer | brancher (dialogue de nom), remiser, dépiler (à partir de
  30 rem) | rafraîchir (tourne pendant la lecture) ; tous figés pendant un verrou.

**Onglet Terminaux** — `ProtoTerminalsPane.tsx`
- **PTER-1** Les terminaux en **pastilles** dans la ligne d'outils « Terminaux N » : point
  (vivant vert, sortie en erreur rouge, fini gris), titre (8 rem max), dossier ; ✕ au
  survol (toujours au doigt) ; « + » au bout (désactivé au plafond, infobulle).
- **PTER-2** Aucun terminal : état **centré** (icône ronde, « Aucun terminal ouvert », « Il
  s'ouvre dans le worktree de cette conversation. » / « … à la racine du projet. »,
  « + Nouveau terminal »).
- **PTER-3** Interrompu par un redémarrage : bande ambre `PanelNotice` + lien « Relancer » ;
  erreurs en bande rouge.

**Onglet Recherche** — `ProtoSearchPane.tsx`
- **PSRC-1** Une ligne : le champ (le titre de la vue, bord rouge si regex invalide, Échap
  vide) ; « **Filtrer ▾** » (compte des filtres actifs en accent ; libellé à partir de
  22 rem) : Correspondance (casse, mot entier, regex) · Fichiers (inclure, exclure) ;
  bouton « Remplacer » pressé qui déplie sa ligne (champ + « Tout remplacer », désarmé sans
  résultat, même confirmation qu'aujourd'hui).
- **PSRC-2** Regex invalide et compte rendu de remplacement en `PanelNotice` ; lignes de
  résultat 44/36 px ; titres de section au format des groupes.

**Onglet Web** — `ProtoWebPane.tsx`
- **PWEB-1** Ligne d'outils 48 px : ← (désactivé au début), → (à partir de 24 rem),
  recharger (spinner), adresse dans un champ à icône `Globe` (mono), **un seul bouton**
  Lecture / Direct (l'icône dit le mode ; libellé à partir de 30 rem), ↗ navigateur, ✕.
- **PWEB-2** Bande « port relayé » en `text-xs text-ink-soft`, `py-2`.

**Conversation** — diff `P:routes/ConversationPage.tsx`
- **CNV-1** Le ⚡ quitte l'en-tête ; le bouton du panneau porte un point (coque ACT-3,
  `PanelToggle`).
- **CNV-2** Signaux → onglet (PACT-10).
- **CNV-3** `conversation.environment ?? HOST_ENVIRONMENT` pour la pastille d'environnement
  et le panneau : garde défensive (le DTO garantit le champ ; elle protégeait les
  conversations de démo). À ne porter que si un cas réel est prouvé (§2.6).

---

## 2. État actuel sur `main`, et écarts

### 2.1 Actions et tâches planifiées (deux mondes séparés)

| Existe sur `main` | Ce qui change |
| --- | --- |
| `M:lib/actions.ts` (`useActions`, `useCreateAction`, `useUpdateAction`, `useApproveAction`, `useDeleteAction`, `useRunAction` qui montre le terminal, `actionView`, `describeActionState`) | **Gardé, étendu** : `worktreeId` au lancement, `reject`, `switch` d'un service, `runs`, `schedule`, `onDemand`. `describeActionState` cède la place à `actionState` (une phrase pour tout, LAN-5). |
| `M:lib/schedules.ts` (`useSchedules`, `useCreateSchedule(projectId)`, `useUpdateSchedule`, `useDeleteSchedule`, `useRunSchedule`, `useTestScheduleCheck`, `useApproveScheduleCheck`, `scheduleState`, `RUN_*`, `formatDateTime`, `describeCadence`) | **Gardé**, `useCreateSchedule` accepte une portée ; `RUN_FILL` / `RUN_WORD` du proto rejoignent `RUN_DOTS` / `RUN_LABELS` (une seule table). |
| `M:components/actions/ActionList.tsx`, `ActionDialog.tsx` (+ story), `action-fixtures.tsx` | **Remplacés** par le Lanceur/Liste et l'éditeur unifié. `action-fixtures` est réécrit pour les nouvelles stories. |
| `M:components/actions/ActionsLauncher.tsx` (+ story), dans `BoardPage` et `ConversationPage` | **Retiré** par coque carte 6. |
| `M:components/panel/ActionsPane.tsx` (+ story) | **Remplacé** par l'onglet Actions du panneau (AC-23). |
| `M:components/schedule/ScheduleDialog.tsx` | **Remplacé** par l'éditeur unifié. `CheckSection.tsx` et `ScriptEditor.tsx` **réutilisés** dans l'éditeur (vérification, essai du script, délai) ; `useAgentSettings` (modèle, effort, **permissions**) et `AutonomousConfinementSelect` aussi. |
| `M:routes/SchedulePage.tsx` (onglet Planifiées d'un projet) | **Supprimé** ; `/p/:id/schedules` → `/p/:id/actions` (alias posé par coque carte 2, redirection définitive ici). |
| `M:routes/SchedulesPage.tsx` (tableau global) | **Remplacé** par Planifiées v2. |
| `M:routes/ServicesPage.tsx` | Inchangé ; cible des liens « Services ». |
| `M:lib/cron.ts` (`cronToHuman`, `cronNextRuns`) | Gardé ; `ScheduleBuilder` s'appuie dessus. |

**Ce qui manque sur `main`** : une vue où les actions et les tâches sont **un seul objet** ;
le Lanceur en tuiles ; l'Agenda ; la Liste par état ; « Lancer dans <worktree> » hors
conversation ; le détail riche (passages, relecture avec diff, ce qu'il sert) ; la
planification lisible (le formulaire actuel a trois onglets intervalle / cron / une fois) ;
« Lancés par les sessions » dans les Actions (aujourd'hui seulement sur la page Services) ;
« En faire une action ».

**Ce que le proto perd par rapport à `main`, à garder quand même** (questions Q1–Q3) :
- le **journal d'un service** (`op: 'logs'`, `journalctl -f` dans un terminal) et
  **Redémarrer** (`op: 'restart'`) : absents du proto → proposés dans le `⋯` de la tuile et
  dans le détail d'un service en marche ;
- dans l'éditeur d'agent : **permissions** (mode d'autorisation de `AgentConfig`),
  **chevauchement** (`overlapPolicy` skip/wait), **durée maximale**, **délai et essai** du
  script de vérification, sélecteur de **confinement** — le proto ne les montre pas ;
- `main` **lance l'action juste après « Valider »** (`approve` puis `run`) ; le proto
  valide seulement.

### 2.2 Panneau

| Existe sur `main` | Ce qui change |
| --- | --- |
| `M:components/panel/SidePanel.tsx` | Badge Actions à trois tons (ton `running` sur `Tab`), règle d'ombre (PAN-3), branchement des nouveaux onglets. Pas de copie : on modifie l'original. |
| `M:components/panel/GitPane.tsx` + `git/rail.tsx` + `git/toolbar.tsx` | Le rail et la barre deviennent `GitLine` (une ligne, `Affichage ▾`) ; `rail.tsx` garde le type `Destination` et les comptes, perd son composant ; `toolbar.tsx` supprimé (ses gestes passent dans `GitLine`). |
| `M:components/panel/TerminalsPane.tsx`, `SearchPane.tsx`, `WebPane.tsx` | Réécrits sur le cadre commun (diffs §1.K). Le composant `Flag` de la recherche disparaît. |
| `M:components/panel/AgentsPane.tsx` + `AgentWritings.tsx` | `AgentsPane` réécrit (PAG-*). **`AgentWritings`** (« Ses écritures » : diff par tour et par fichier, reprises manuelles) est remplacé par le pied « Modifié par la session » — ⚠ on perd le diff par tour **dans l'onglet** (il reste dans Git › tour, `TurnChangesView`). Question Q8. Le **vrai arrêt** d'un travail de fond (`stopBackgroundTask`, selon `AGENT_CAPABILITIES[agent].stopBackgroundTask`) existe et doit être gardé (le proto le simule). |
| `M:components/panel/ProjectPane.tsx` (+ story) | Réécrit (PPR-*) ; **tous ses gestes existent** (`useAttachCard`, `useCreateCard`, `useMoveCard`, `useToggleSubtask`, `useCardNotes`) ; la carte empilée était `CardDetail` (éditeur complet), le proto montre un `CardBody` à plat plus léger (« Dans le tableau » pour éditer). |
| `M:routes/ConversationPage.tsx` | `SignalRow onSelect` ouvre toujours le panneau sans choisir l'onglet → choisit Agent ou Actions (PACT-10). Point du bouton : coque carte 6. |

### 2.3 Serveur — ce qui existe déjà (ne pas redemander)

- Actions : `GET /api/actions`, `POST /api/projects/:id/actions`, `PATCH /api/actions/:id`,
  `POST /api/actions/:id/approve`, `DELETE /api/actions/:id`, `POST /api/actions/:id/run
  { conversationId? }` (rend `alreadyRunning`), `POST /api/actions/:id/service/stop|restart|logs` ;
  `ProjectActionServiceState.cwd` **existe** (lu de l'unité systemd).
- Tâches : `GET /api/schedules`, `POST /api/projects/:id/schedules`, `PATCH /api/schedules/:id`
  (pause = `enabled`), `DELETE`, `POST /api/schedules/:id/run { skipCheck }`,
  `POST /api/projects/:id/schedules/check-test`, `POST /api/schedules/:id/check/approve` ;
  `ScheduledTaskDto.projectId` **peut être null** (tâche sans projet, lancée comme un fil
  libre dans `<data>/threads/<id>`), passages `scheduled_runs` avec statut, erreur,
  vérification.
- Services : `GET /api/services` (`kind: 'command'` = ce qu'un agent ou un terminal a lancé,
  avec `projectId`, `conversationId`, `command`, `ports`, `startedAt`, `cpu`,
  `memoryBytes`, `canStop`), `POST /api/services/:id/stop`.
- Terminaux : liste (`actionId`, `alive`, `exitCode`, `interrupted`, `createdAt`, `cwd`,
  `conversationId`), socket avec `ready.replay` (128 Ko), `output`, `exit` ;
  `TerminalManager.kill(id)` existe mais **aucune route** ne l'expose pour un terminal de
  projet.
- Travaux de fond : `POST /api/conversations/:id/background/:taskId/stop`,
  `EventLog.openBackgroundTasks(conversationId)`, `conversations.background_count`.
- Conversation : `POST /api/conversations/:id/interrupt`.
- Worktrees : `WorktreeStatusDto` porte `path`, `branch`, `ahead`, `behind`, `modified`,
  `untracked`, `conflicts`, **`head`** (le commit) — le commit servi est donc lisible
  pour un worktree ; pas pour la racine (`ProjectDto.git` n'a pas `head`).
- Arborescence : `GET …/tree` (`useTreeLevel(scope, path)`) — de quoi faire le vrai
  sélecteur de dossier.
- Instance : `GET /api/system/instance` (`InstanceInfo`) — sans fuseau horaire.

### 2.4 Ce qui disparaît (récapitulatif)

`ActionList`, `ActionDialog` (+ story), `ActionsPane` (+ story), `ScheduleDialog`,
`SchedulePage`, l'actuel `SchedulesPage`, `git/toolbar.tsx` et le composant `Rail`,
`AgentWritings` (si Q8 confirme), `Flag` de la recherche, `describeActionState`, les clés
i18n devenues mortes (`actions.form.*`, `actions.state.*`, `schedule.form.kind.*`,
`schedule.form.every`, `schedule.form.unit.*`, `place.schedules.*` à revoir…) — chaque
carte supprime ce qu'elle remplace, dans sa PR.

### 2.5 Écarts du prototype à corriger en le portant

1. `?action=` jamais retiré de l'adresse (AO-7).
2. Planifiées : « + Tâche » et la tuile d'ajout ouvrent l'éditeur sans « Planifiée »
   cochée (PLF-1) ; pas de champ Portée (PLF-10).
3. Phrase fausse du script de vérification (EDI-14).
4. Fuseau du navigateur au lieu de celui du serveur (PLA-11), et `toLocaleDateString('fr-FR')`
   en dur (ScheduleBuilder, Agenda) → `locale()`.
5. Liens `http://localhost:<port>` en dur (PRC-3, PRC-7, PAG-3, PAG-7) : faux quand Solera
   est ouvert à distance (Tailscale) → passer par le relais du panneau Web
   (`openWebPage(scope, url)`, `isLocal` / `isRelayed`) dans une conversation, et par la
   même règle d'hôte que les liens d'action ailleurs.
6. Panneau : `useSessionWorks` réel ne garde **que les processus de cette conversation**
   alors que la démo et la pastille de session (`here`) en prévoient d'autres → montrer
   ceux du projet, ceux de cette session d'abord (Q7).
7. Couleurs en dur du terminal (`bg-[#0b0d12]`, `text-[#d6dae3]`, `bg-black/80`) →
   jeton du DS.
8. Le chevron « Lancer dans… » d'un agent (LAN-9, Q6).

### 2.6 Questions à trancher avec Tim (avant la carte concernée)

- **Q1** Journal d'un service et « Redémarrer » : les garder (proposition : `⋯` de la
  tuile + détail) ? — AC-15, AC-19.
- **Q2** Éditeur d'agent : remettre permissions, chevauchement, durée max, délai/essai de
  la vérification, confinement (proposition : bloc repliable « Options » sous le prompt,
  repris de `ScheduleDialog`) ? — AC-14.
- **Q3** « Valider » une action proposée : valider seulement (proto) ou valider **et
  lancer** (main) ? « Refuser » : supprimer une action neuve, rétablir la commande
  validée d'une action modifiée (proposition) ; pour un script de vérification : retirer
  le script et mettre la tâche en pause (proposition) ? — AC-02, AC-15.
- **Q4** « Où il tourne » d'un agent : trois cartes (Racine / Nouveau worktree / Confiné)
  comme le proto, ou *où* (2 cartes) + *confinement* (sélecteur existant, #146) ?
  Proposition : la seconde, le confinement étant orthogonal. — AC-04, AC-14.
- **Q5** Modifier la **nature** d'une action existante (commande ↔ agent) : le proto le
  permet ; côté serveur ce sont deux tables. Proposition : interdit en modification (les
  grandes cartes Quoi sont figées, « Dupliquer » pour changer). — AC-11, AC-14.
- **Q6** Chevron « Lancer dans… » d'un agent : masqué, ou « Racine / Nouveau worktree » ?
- **Q7** Processus des sessions dans le panneau : ceux de cette session seulement, ou ceux
  du projet (cette session d'abord) ? Et le signal « travaux de fond » mène à Actions,
  où le réel montre des **processus** (`/api/services`) : un workflow ou une surveillance
  sans processus n'y apparaît pas. Proposition : fusionner processus et travaux de fond
  du journal (AC-07), dédoublonnés par conversation.
- **Q8** `AgentWritings` (diff par tour dans l'onglet Agent) : remplacé par « Modifié par
  la session » + icône diff vers Git (proto), ou gardé en détail en pile ?
- **Q9** Portées **Savoir** et **Instance** (démo seulement aujourd'hui) : les créer ? Où
  tourne une tâche « Savoir » (dans le vault ?) et une tâche « Instance » (dossier de
  données ? home ?) ; une **commande** sans projet (la démo en a deux) ? — AC-09.
- **Q10** « Écarter » une commande finie (RUN-2) : retenu localement (proto), ou ferme
  son terminal fini (proposition : ferme, un terminal d'action fini n'a plus d'autre
  usage et le plafond de 6 terminaux par projet est vite atteint) ?
- **Q11** Cas limites du serveur : « Une instance par worktree » et « service planifié »
  (démarrer/arrêter) — les faire maintenant (AC-06) ou montrer les options désactivées ?
- **Q12** Largeur du tiroir (`wide` pour l'éditeur) : rejoint TIR-3 de `coque.md`.

---

## 3. Ce que le prototype simule, et ce qu'il faut rendre réel

### 3.1 Gestes « Simulé »

| Geste (fichier) | Réel | Existe ? |
| --- | --- | --- |
| Lancer une commande à la racine (`LaunchButton`) | `POST /api/actions/:id/run {}` | oui |
| **Lancer dans <worktree>** hors conversation (`LaunchButton` chevron) | `POST /api/actions/:id/run { worktreeId }` (le worktree doit appartenir au projet) | **non** → AC-02 |
| Lancer depuis une conversation (panneau, `launchWhere`) | `POST /api/actions/:id/run { conversationId }` | oui |
| Lancer un agent / « Lancer maintenant » | `POST /api/schedules/:id/run` | oui |
| Démarrer / arrêter un service (interrupteur, détail) | `run` / `service/stop` | oui |
| **Basculer un service** sur un autre arbre (dialogue, « Servir… ») | `POST /api/actions/:id/run { conversationId | worktreeId, switch: true }` ; sans `switch`, un service en marche ailleurs répond **409 `service_running_elsewhere`** avec ce qu'il sert | **non** → AC-05 |
| « Terminal » d'une commande qui tourne (onglet du projet, sans panneau) | ouvrir le **détail du passage** dans le tiroir (sortie en lecture seule par la socket, Arrêter) | socket oui ; arrêt **non** |
| **Arrêter une commande** (RUN-2/3) | `POST /api/projects/:id/terminals/:terminalId/interrupt` (Ctrl-C au groupe de premier plan du pty ; le terminal reste, son écran aussi) | **non** → AC-01 |
| **Relancer** (RUN-3) | `POST /api/actions/:id/run { conversationId }` ; le serveur **recycle** le terminal fini de la même action et du même lieu au lieu d'en ouvrir un de plus | run oui ; recyclage **non** → AC-01 |
| **Relancer seulement les échecs** | `POST /api/actions/:id/run { conversationId, args }` (`args` ajoutés à la commande validée ; refusé par MCP) | **non** → AC-02 |
| Ouvrir le terminal (onglet Terminaux) | `showTerminal(id)` + `setPanelTab('terminals')` | oui |
| Dupliquer | création avec les mêmes champs | oui (action, tâche) |
| Supprimer | `DELETE /api/actions/:id` / `/api/schedules/:id` | oui |
| Pause / reprise d'une **tâche d'agent** | `PATCH /api/schedules/:id { enabled }` | oui |
| Pause / reprise d'une **commande planifiée** | `PATCH /api/actions/:id { schedule: { enabled } }` | **non** → AC-03 |
| Valider une action / un script | `POST /api/actions/:id/approve` / `POST /api/schedules/:id/check/approve { script }` | oui |
| **Refuser** une action proposée | `POST /api/actions/:id/reject` (supprime une action neuve, rétablit la commande validée d'une action modifiée) | **non** → AC-02 |
| Refuser un script de vérification | `PATCH /api/schedules/:id { checkScript: null, enabled: false }` (selon Q3) | oui |
| Enregistrer (éditeur) — commande | `POST /api/projects/:id/actions` / `PATCH /api/actions/:id` + `schedule`, `onDemand`, `placement` | champs de base oui ; **schedule, onDemand, placement non** → AC-03, AC-05 |
| Enregistrer (éditeur) — agent | `POST /api/projects/:id/schedules` / `PATCH` + `cadence: null` (à la demande seulement), `onDemand`, `worktreeMode` | base oui ; **le reste non** → AC-04 |
| Créer une tâche **sans projet** (page Planifiées) | `POST /api/schedules { scope, … }` | **non** (seul MCP `schedule_task` crée hors projet) → AC-09 |
| **Essayer** une commande (éditeur) | `POST /api/projects/:id/actions/try { command, subdir, kind, conversationId? }` → un terminal d'essai (titre « Essai · … », sans `actionId`), sortie lue par la socket | **non** → AC-08 |
| Suggestions « Trouvé dans le dépôt » | `GET /api/projects/:id/actions/suggestions` (scripts de `package.json` racine et des espaces de travail, cibles `Makefile`, `justfile`, `scripts/*.sh` ; nature devinée : `dev`/`start`/`serve`/`storybook` → service) | **non** → AC-08 |
| Sélecteur de dossier | `useTreeLevel(projectScope(projectId), path)`, dossiers seulement, dépliage paresseux | oui |
| Arrêter un processus d'une session (PRC-3/4/7) | `POST /api/services/:id/stop` | oui |
| Arrêter un travail de fond (PAG-7) | `POST /api/conversations/:id/background/:taskId/stop` (si le CLI le sait, sinon geste absent) | oui |
| Interrompre la session (PAG-6) | `POST /api/conversations/:id/interrupt` | oui |
| Copier le résultat d'un sous-agent | `navigator.clipboard` (réel, avec repli expliqué) | oui |
| Onglet Projet : rattacher, créer depuis la session, détacher, colonne, sous-tâche | `useAttachCard`, `useCreateCard`, `useMoveCard`, `useToggleSubtask` | oui |
| Lancer une session sur une carte prête | `/p/:id/c/new?card=` | oui |

### 3.2 Données simulées ou devinées

| Donnée (fichier) | Réel |
| --- | --- |
| **Passages d'une commande** (code, durée, extrait — `demoScheduledCommands`, « le serveur ne garde que le dernier ») | Table `action_runs` (AC-02) : chaque lancement (clic, `run_action`, cadence) écrit un passage ; fin, code, **extrait** (dernières lignes, ~4 Ko) écrits à la sortie du terminal ou du processus. `ProjectActionDto.runs` (20 derniers). |
| **Commandes planifiées** (sauvegarde, purge — démo seulement) | Colonnes de cadence sur `project_actions` + balayage du `TaskScheduler` (AC-03). Une commande planifiée tourne **sans terminal** (pas de plafond de 6, personne pour la regarder) : processus détaché comme `runCheck`, sortie capturée dans le passage. |
| Durée d'une commande finie (`finishedAt` inconnu) | `TerminalDto.finishedAt` (AC-01), `ActionRunDto.finishedAt` (AC-02). |
| Commit servi (`DEMO_SERVED`, « le serveur ne le donne pas encore ») | `ProjectActionServiceState.served = { path, worktreeId, root, branch, head, dirtyFiles }` calculé dans le `cwd` de l'unité (AC-05). Pour un worktree, `WorktreeStatusDto.head` suffirait, mais la racine n'a pas de `head` : un seul calcul côté serveur sert les deux. ↑/↓ restent lus de `WorktreeStatusDto`. |
| « Où tourne-t-il » (placement) | Colonnes `placement` (`follow` | `root` | `branch` | `per-worktree`) et `pinned_branch` (AC-05, AC-06). |
| Service planifié (fenêtre démarrer/arrêter) | `stop_cadence` (AC-06, cas limite). |
| Agent « à la demande » sans cadence ; « Nouveau worktree » | `scheduled_tasks.cadence` nullable, `on_demand`, `worktree_mode` (AC-04). |
| Modèles par CLI en dur (`AGENTS`), efforts « Bas / Moyen / Élevé » | `useAgentSettings` (main) : vrais modèles, efforts, permissions. |
| Commande d'avant pour le diff de relecture (`DEMO_PREVIOUS_COMMAND`) | `project_actions.approved_command` (+ `approved_subdir`, `approved_url`) recopiés à chaque validation ; `ProjectActionDto.approved: { command, subdir, url } | null` (AC-02). |
| Portées Savoir / Instance (`demoData`) | `scheduled_tasks.scope` (AC-09, selon Q9). Hors démo, `projectId: null` s'affiche « Sans projet ». |
| Coût d'un passage | `ConversationDto.costUsd` de sa session (réel, déjà lu par le proto). |
| Processus des sessions : commande, port, sortie (`demoWorks`) | Commande, ports, départ, charge : **réels** par `/api/services`. Sortie : pas de source (dit tel quel). Pour les **travaux de fond** d'autres sessions (seul leur nombre est connu) : `GET /api/projects/:id/background` (AC-07). |
| Sorties de tests / lint / tsc (démo) | Réelles par la socket du terminal ; les sorties de démo deviennent les **fixtures** de `test/command-output.test.ts`. |
| Notes de carte, carte prêtée, branche/PR (onglet Projet en démo) | Réelles (`useCardNotes`, carte de la session, `useWorktreeStatuses`, `usePullRequests`). |
| Fuseau horaire de l'aperçu | `InstanceInfo.timeZone` (AC-04). |

### 3.3 Routes et champs serveur à créer (récapitulatif)

| # | Quoi | Carte |
| --- | --- | --- |
| S1 | `TerminalDto.finishedAt` (posé à la sortie, persisté avec le terminal) ; `POST /api/projects/:id/terminals/:terminalId/interrupt` (écrit `\x03` dans le pty — marche aussi dans un conteneur ; 409 si fini) ; `ActionRunner.run` recycle le terminal **fini** de la même action et du même lieu | AC-01 |
| S2 | Table `action_runs` (`id`, `action_id` FK cascade, `project_id`, `trigger` `manual`|`agent`|`schedule`, `conversation_id`, `terminal_id`, `cwd`, `status` `running`|`succeeded`|`failed`|`stopped`, `exit_code`, `started_at`, `finished_at`, `excerpt`) ; `ActionRunDto` ; `ProjectActionDto.runs` (20) ; `lastRun` gardé pour la compatibilité ; écrit par `ActionRunner.run` et le `onExit` du terminal | AC-02 |
| S3 | `runProjectActionBodySchema` + `worktreeId` (exclusif de `conversationId`) et `args` (interdit par MCP `run_action`) | AC-02 |
| S4 | `approved_command`, `approved_subdir`, `approved_url` ; `ProjectActionDto.approved` ; `POST /api/actions/:id/reject` | AC-02 |
| S5 | `project_actions` + `cadence` (JSON, null), `schedule_enabled`, `on_demand` (défaut vrai), `last_scheduled_at`, `next_run_at` ; `ProjectActionDto.schedule`, `.onDemand` ; schémas create/update (au moins un des deux) ; balayage des commandes planifiées (exécution détachée, délai max, passage `trigger: 'schedule'`) ; une commande non `onDemand` est refusée par `run_action` et absente de la palette | AC-03 |
| S6 | `scheduled_tasks.cadence` nullable + `on_demand` + `worktree_mode` (`root` | `new`) ; `openSession` crée un worktree quand `new` ; `InstanceInfo.timeZone` (`Intl.DateTimeFormat().resolvedOptions().timeZone` du serveur) | AC-04 |
| S7 | `ProjectActionServiceState.served` ; 409 `service_running_elsewhere` (corps : `served`, `ports`, `href`) quand on lance un service actif depuis un autre arbre ; `switch: true` redémarre l'unité dans le nouveau `cwd` ; `placement` `follow`|`root`|`branch` + `pinned_branch` (`branch` : la racine si elle y est, sinon refus explicite tant que le worktree dédié n'existe pas) | AC-05 |
| S8 | `placement: 'per-worktree'` (une unité par `(action, arbre)`, `actionUnit(id, key)`, port libre injecté `PORT`) ; `stop_cadence` d'un service planifié | AC-06 |
| S9 | `GET /api/projects/:id/background` → `{ conversationId, title, agent, tasks: BackgroundTask[] }[]` (conversations du projet dont `background_count > 0`, `openBackgroundTasks`) | AC-07 |
| S10 | `GET /api/projects/:id/actions/suggestions` ; `POST /api/projects/:id/actions/try` | AC-08 |
| S11 | `scheduled_tasks.scope` (`project` | `vault` | `instance` | `none`) ; `POST /api/schedules` (création hors projet, droits = son créateur) ; cwd d'un tir selon la portée | AC-09 |

Chaque champ ajouté au protocole l'est dans `packages/protocol/src/{actions,schedules,terminal,api}.ts`,
avec la migration dans `packages/db/migrations` (une par carte) et les outils MCP
concernés (`register_action`, `schedule_task`, `list_actions`, `run_action`) qui doivent
« refuser la même chose que la route ».

---

## 4. Composants génériques à extraire

### 4.1 Design system (`~/projects/solera-ds`, épinglé ensuite dans les deux `package.json`)

Règle : rien du produit (ni CLI, ni action, ni projet) ; libellés fournis par l'app.

| Primitive | API proposée | Remplace |
| --- | --- | --- |
| `ChoiceCards` (extension de `ChoiceList` ou nouvelle) | `<ChoiceCards label value options={{ value, label, hint?, icon?, badge? }[]} onChange size="lg" | "sm" columns={{ min: '30rem', count: 2 }} selectedExtra?={(value) => ReactNode} />` ; sémantique radio ; colonnes par **requête de conteneur** | `BigChoice`, `SmallChoice` (`Editor.tsx`), `PlacementField` (« conseillé », contenu sous l'option choisie) |
| `CheckCards` | `<CheckCards label values options onChange columns />` ; sémantique case à cocher | `CheckCard` (À la demande / Planifiée) |
| `SwitchTrack` (existe) + `Switch` avec libellé optionnel | réutiliser `SwitchTrack` ; `size="row" | "tile"` | `ServiceSwitch` (le rendu de la piste) |
| `TerminalOutput` (ou jeton `--color-terminal-bg` / `-fg`) | `<TerminalOutput text follow maxHeight />` ; collée en bas tant qu'on ne remonte pas | `OutputTail`, les `pre` sombres d'`Editor`/`ActionDetail` (couleurs en dur) |
| Cadre de panneau | `PanelToolbar { title, meta?, children }`, `PanelGroup { title, count?, aside? }`, classes `panelRow` / `panelGesture`, `PanelStatusIcon { icon, dot? }`, `StackHeader { back, onBack, title, meta?, aside? }`, `PanelEmpty { children, action? }`, `PanelNotice { tone, onClose?, children }` — page « Panneau et tiroir » (coque carte 1) complétée | `PanelTabFrame.tsx`, les en-têtes recopiés dans `ProtoAgentPane`, `CommandRuns`, `ProtoActionsPane`, `ProtoProjectPane` |
| `MonthGrid` (calendrier mensuel) | `<MonthGrid month onMonth pick? onPick? marked?: Map<dayStart, count> weekStartsOn labels />` | `MonthGrid` de `ScheduleBuilder` (choix d'une date + aperçu des passages) |
| `TimeGrid` / `TimePicker` | `<TimePicker hour minute hoursOnly? onChange quarters />` (champ tapé + grille) | `TimeButton` |
| `RunStrip` (pastilles de passages) | `<RunStrip runs={{ id, tone, title }[]} slots={10} size="sm" | "md" />` ; tons via jetons | `Pips`, `RunPips`, la frise de `ActionDetail` |

Si une session DS n'est pas disponible au moment d'une carte d'écran, le composant naît
dans l'app (`components/ui-pending/`) avec un `TODO(ds)` et sa story, et la carte AC-10 le
promeut. Les tons de **compte d'onglet** (`TabCount` vert) sont dans coque carte 1.

### 4.2 Application (`apps/web/src`, story dans le même commit)

| Module / composant | API | Sert à |
| --- | --- | --- |
| `lib/automations.ts` (pur) | `type Automation`, `UnifiedRun`, `fromAction(dto, t)`, `fromTask(dto, t)`, `actionState(a, now, t)`, `stateSentence`, `cadenceText`, `whenWords`, `natureOf`, `failStreak`, `verdictRuns`, `healthOf(a, costOf, now)`, `dueOf(a, now)`, `matchesFilters(a, filters)`, `sectionOf(a)` (`live`|`review`|`scheduled`|`demand`), `launcherGroupOf(a)` | onglet Actions, panneau, Planifiées, portefeuille › Actions, Aperçu (A-5) |
| `lib/automations-query.ts` | `useAutomations({ projectId } | { all: true })` → `{ items, isPending }` (actions + tâches, `scope` en global) ; `useAutomationMutations()` → `save(draft)`, `remove(a)`, `duplicate(a)`, `setPaused(a, b)`, `run(a, where)`, `approve(a)`, `reject(a)` qui aiguillent vers `/api/actions` ou `/api/schedules` | idem |
| `lib/schedule-rule.ts` (pur) | `BuilderState`, `defaultState(now)`, `stateFromCadence`, `cadenceFromState`, `sentenceOf(state, cadence, t, locale)`, `upcoming(cadence, count, { after, horizon, timeZone })`, `relativeDay(at, now)` | `ScheduleBuilder`, détail (« Prochain passage »), Agenda |
| `lib/agenda-layout.ts` (pur) | `shotsOf(items, from, to, now)`, `typicalDuration(a)`, `layoutDay(shots)` (couloirs, chevauchements), `shownHours(columns, now, unfolded)`, `rowsOf(hours)`, `yOf(ts, dayStart, rows)` | `ActionsAgenda` |
| `lib/served.ts` (pur) + `useServedIndex(projectId)` | `treeOf(cwd, trees, rootPath, home)`, `servedOf(action, trees)` → `ServedVersion` ; index par action et par arbre | `ServedLine`, `ServedBlock`, `ServiceMark` (Travail), panneau |
| `lib/session-works.ts` (pur) + `useSessionWorks(projectId, { conversationId? })` | `shortCommand`, `humanLabel(work, t)`, `familyOf`, `portIn`, `loadText`, `seedFromWork(work, t)`, `mergeWorks(services, background, conversations)` | Lanceur, Liste, panneau, coque ACT-1 (`useActionsCount` lit le même crochet) |
| `lib/command-output.ts` (pur) | `stripAnsi`, `detectTool`, `summarize(command, raw)`, `relativePath`, `lastLine` | `CommandRuns` |
| `lib/agent-files.ts` (pur) | `filesOf(subAgent)`, `resultOf(subAgent)`, `sessionFiles(turns, agents)` ; `revealToolCall(id)` reste dans un composant (DOM) | onglet Agent |
| `components/automations/StateIcon`, `ServiceSwitch`, `LaunchButton` (`size="tile"|"row"`, `where`, `worktrees`), `ReviewButton`, `NatureIcon`, `KindChip`, `quietGestureClass` | | toutes les surfaces |
| `components/automations/ActionSheet` (ex-`DrawerParts`) | `ActionChromeProvider { inline, backLabel, onBack }`, `ActionHeader`, `ActionBody`, `ActionBlock`, `ActionFooter`, `Chip` | tiroir et pile |
| `components/automations/ActionDrawer` | `{ projectId | null, items, panel: ActionPanel | null, onPanel, onClose, launchWhere?, inline?, backLabel? }` ; `newActionPanel(kind)`, `actionPanelOf(param)` ; lit `useDetailSurface()` (coque) pour choisir tiroir ou pile | onglet, Planifiées, panneau, portefeuille |
| `components/automations/ActionDetail`, `ActionEditor`, `ScheduleBuilder`, `ActionsAgenda`, `LauncherView` + `LauncherGroup` + `TILE_GRID`/`TILE_BOX`, `ActionTile`, `PlannedTile`, `ActionRow`, `ScheduleFacts` | | écrans |
| `components/automations/served/*` | `ServedLine`, `ServedBlock`, `SwitchServiceDialog` + `useServiceSwitch()`, `PlacementField`, `ServiceMark` (exporté pour Travail) | |
| `components/automations/session-works/*` | `SessionWorksSection { works, variant: 'tiles'|'rows'|'compact', currentConversationId?, onMakeAction }`, `SessionWorkTile`, `SessionWorkRow`, `SessionWorkLine` | |
| `components/panel/CommandRuns` | `useCommandRuns(projectId, conversationId?)`, `CommandRunsGroup`, `CommandRunDetail` (surface `panel` ou `drawer`) | panneau ; onglet Actions (« Terminal ») |
| `components/planned/ScopePip`, `ScopeMark` | `{ scope }` | Planifiées, portefeuille |
| `lib/panel.ts` + `requestActionEdit(seed)` / `useActionEditRequest()` | état partagé du panneau | PAG-12 / PACT-8 |

---

## 5. i18n

Aucune chaîne en dur : `t('clé')` en fr **et** en en (`lib/i18n/catalog-fr.ts`,
`catalog-en.ts`). Pluriels en `.one` / `.other`. Dates et heures par `Intl` avec
`locale()` (jamais `'fr-FR'`), jours de la semaine par `Intl.DateTimeFormat(locale, { weekday: 'narrow' | 'long' })`,
semaine qui commence le lundi (ISO, à confirmer pour l'anglais).

- `automation.*` — nature.{command,task,service,agent}, kindChip.{task,service,agent},
  when.{demand,scheduled,both,never,paused}, state.{review,running,runningPorts,since,stopped,failStreak.one/other,neverRun,succeeded,failed,failedCode,timedOut,skipped,ago},
  sentence.{review,service,session,terminal,failStreak,serviceStopped,paused,last,lastCode,never},
  live.{service,terminal,session}, review.{proposedIn,proposedGone,checkScript},
  run.{checking,running,succeeded,failed,timed_out,skipped,stopped}, run.title, run.code.
- `actionsTab.*` — search.placeholder, filter.{what,when,state,clear}, filter.what.{commands,agents},
  filter.when.{demand,scheduled}, filter.state.{live,review,failing}, view.{launcher,list,agenda},
  view.hint.{launcher,list}, period.{week,day}, new.{button,command,commandHint,service,serviceHint,agent,agentHint,plan,planHint},
  section.{live,liveHint,review,reviewHint,scheduled,scheduledHint,demand,demandHint},
  empty, gesture.{open,stop,session,terminal,review,plan}, facts.{failStreak,paused,none}, pips.label.
- `launcher.*` — group.{services,commands,agents,sessionWorks}, add.{service,command,agent},
  menu.{more,detail,edit,plan,editPlan,duplicate,delete,logs,restart}, launch.{button,in,root,newSession,title},
  switch.{on,off,start,stop}, serve.{button,title,switchTo}.
- `actionDrawer.*` — label.{edit,new,pick}, back, pick.{title,subtitle,list,empty,plan}, close.
- `actionDetail.*` — block.{what,when,runs,origin,served,review}, what.{agentReceives,check,checkToApprove,folder,folderHint,link,note},
  when.{demand,notDemand,notScheduled,pause,resume,edit,plan,next,then},
  runs.{known.one/other,empty,stripHint,session}, origin.{agent,you},
  review.{title,commandBody,scriptBody,approve,reject},
  delete.{ask,cancel,confirm}, duplicate, copySuffix, gesture.{start,launch,open,stop,session,terminal,review}.
- `actionEditor.*` — step.{what,whatHint,when}, what.{command,commandHint,agent,agentHint},
  found.{title,hint}, kind.{label,task,taskHint,service,serviceHint},
  field.{command,commandPlaceholder,folder,folderRoot,folderHint,link,linkPlaceholder,linkHint,linkResolved,linkRemote,cli,model,modelDefault,effort,prompt,promptPlaceholder,promptHint,where,label,labelPlaceholderCommand,labelPlaceholderAgent,description,descriptionPlaceholder,optional,scope},
  where.{root,rootHint,worktree,worktreeHint}, check.{toggle,hint},
  try.{button,hint,needCommand}, preview.{title,labelPlaceholder,stopped,neverRun,launch},
  when.{demand,demandHint,scheduled,scheduledHint,serviceStart,serviceStop,serviceLimit,serviceLimitHint},
  error.{label,labelMax,command,prompt,subdirAbsolute,subdirParent,url,when,cadence},
  footer.{summary,cancel,save,missing}, badge.{new,edit}, narrow.{text,expand}.
- `scheduleRule.*` — repeat, frequency.{once,hours,hoursMenu,daily,weekly,monthly,custom},
  word.{on,at,between,and}, range.{add,allDay}, workdays, everyHours.one/other,
  monthDay.{first,last,lastShort}, monthDay.missing, weekdays.required,
  custom.{placeholder,fields,invalid}, time.{typePlaceholder,typeLabel,hoursPlaceholder},
  date.label, month.{previous,next}, preview.{incomplete,next,none,timeZone,passes.one/other},
  sentence.{once,hours,hoursRange,daily,workdays,weekly,monthly,monthlyLast},
  relative.{minutes,hours,tomorrow,days}.
- `agenda.*` — previous, today, next, scope.{week,day}, overlaps.one/other,
  legend.{agent,command,planned,verdict}, empty, unfold, fold, nothing, planned,
  nature.{agent,command,service}, overlapsTitle, verdict.{checking,running,succeeded,failed,timed_out,skipped}.
- `served.*` — line.{serves,root,unknown,uncommitted}, block.{tree,root,unrecognized,branch,commit,commitUnknown,onBase,ahead,behind,uncommitted.one/other,uncommittedNone,card,milestone,switch},
  switchTo, dialog.{title,body,open,confirm}, mark.title,
  placement.{label,follow,followHint,recommended,root,rootHint,branch,branchHint,branchOnRoot,branchNeedsTree,perWorktree,perWorktreeHint,perWorktreeCost,perWorktreeLink}.
- `sessionWorks.*` — family.{shell,workflow,monitor,subagent,other}, human.{vite,next,astro,storybook,vitest,jest,playwright,tsc,tsx,node,python,docker,dev,test,lint,build,watching},
  state.{running,port,since,countOnly}, countOnly.{label.one/other,hint}, origin.{in,thisSession,by,terminal,session},
  gesture.{open,openPort,stop,makeAction,makeActionShort,goToSession,showOutput},
  section.{title,hint,panelTitle}, output.{none}, seed.description, load.
- `planned.*` — title, new.{button,agent,agentHint,command,commandHint,plan,planHint},
  search.placeholder, filter.{scope,what,state,next,clear}, filter.what.{agents,commands},
  filter.state.{active,paused,failing,review}, filter.next.{today,week},
  summary.{tasks.one/other,scopes.one/other}, group.{label,due,state,scope},
  due.{today,week,later,idle}, scope.{knowledge,instance,none},
  tile.{review,running,failStreak,paused,next,noNext,lastOk,lastFail,never,launchNow,resume},
  health.{rate,failing,cost,next,watch,healthy,paused,reviewHint,failHint,seeLastRun},
  empty.{title,body,cta}, noMatch, where.{project,knowledge,instance,none}.
- `panel.frame.*` — notice.close, stack.back.
- `panel.actions.*` — title, search, display, new.{button,command,service,agent,plan},
  openTab, empty, suggestion, group.{services,commands,agents,servicesRunning,review,scheduled,demand},
  launchHere, launchSession, openTerminal, openSession, hint.{launcher,list}.
- `panel.runs.*` — group.{running,recent}, status.{running,succeeded,failed,failedCode,stopped},
  took, testsFailed.one/other, errors.one/other, stop, dismiss, rerun, rerunFailed,
  openTerminal, sentence.{running,succeeded,stopped,failed}, block.{tests,lint,types,inFiles.one/other,output,live},
  nothing, expected, received, openFile, reading, noOutput, unreadable.
- `panel.agent.*` — running, nothingRunning, done.one/other, written.one/other, by.main,
  passes.one/other, diff, back, sub.{working,doneIn,stopped,tools.one/other,tokens},
  block.{files,result,thread}, files.{none,noneYet}, result.{none,noneYet,more,less},
  thread.{starting,silent}, copy, copied, clipboardRefused, reveal, revealMissing,
  interrupt, interruptHint, work.{nature,now,nowNone,tools,tokens,port,noOutput,stop,openPort,makeAction}.
- `panel.project.*` — reprendre les clés de `ProjectPane` (main) et ajouter
  segment.{session,project}, activity.{working,idle,context}, card.{none,attach,create,suggestion,cited,attachN,openCard,inBoard,column,detach,due,toClarify},
  subtasks, deps.{blockedBy,blocks}, sessions, description, notes.{seeAll},
  branch.{title,root,git,uncommitted.one/other,conflict}, pr.{none,draft,checks,failing,ready,merged},
  inbox.empty, milestone.{title,none,wave,allWaves,inIt,notIn}, others.{title,none,awaiting,working},
  ready.{title,none,launch}, links.{board,milestones,work}, loading, loadError, retry.
- `git.view.*` — destination.{graph,working,branches,stashes,search,history,conflicts} et
  leurs `.hint`, display, conflicts.one/other.
- `terminal.*` — empty.{title,inConversation,atRoot}, new (existe).
- `panel.search.filter`, `panel.search.section.{match,files}`.
- `web.*` — existant ; `web.mode` sert d'infobulle au bouton unique.

Clés à supprimer : voir §2.4 (chaque carte retire celles qu'elle rend mortes).

---

## 6. Plan TDD

Outils du dépôt (pas de vitest dans `apps/web`) :
- **Unitaire et route** : `apps/server/test/*.test.ts` (`node:test` + `tsx`) ; la logique
  pure du web s'y importe (`await import('../../web/src/lib/x.js')`, comme
  `tool-summary.test.ts`) — d'où l'exigence de modules **purs** (§4.2). Un fichier :
  `cd apps/server && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null npx tsx --test test/x.test.ts`.
- **Parcours et composants** : suites `scripts/*-ui-check.mjs` (Chromium par
  `launchBrowser()`, fournisseurs par `viteDependency()`,
  `LD_LIBRARY_PATH=$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu`). **N'en lancer
  qu'une, celle de la carte** : elles écrivent des captures.
- **Stories** : chaque composant d'application ajouté ; `pnpm typecheck && pnpm build:catalog`.

| Comportement | Preuve | Où |
| --- | --- | --- |
| S1 : `finishedAt` posé à la sortie, persisté, relu après redémarrage ; `interrupt` envoie Ctrl-C et laisse le terminal ; 409 sur un terminal fini ; relancer recycle le terminal fini (le nombre de terminaux ne monte pas) | route + `TerminalManager` sur un vrai pty (`sleep 30`, `sh -c 'exit 3'`) | `apps/server/test/terminals-interrupt.test.ts` (nouveau) |
| S2 : un lancement écrit un passage `running` ; la sortie le clôt (`succeeded`/`failed`, code, `finishedAt`, extrait des dernières lignes, borné) ; `trigger` `manual`/`agent` (MCP) ; 20 derniers dans le DTO ; suppression en cascade | route | `apps/server/test/project-actions.test.ts` (étendre) |
| S3 : `worktreeId` d'un autre projet → 404 ; `worktreeId` + `conversationId` → 400 ; `args` refusé par `run_action` MCP, accepté par la route et ajouté à la commande | route + MCP | `project-actions.test.ts`, `worktree-mcp.test.ts` (modèle) |
| S4 : modifier par MCP une action validée garde `approved` ; `reject` rétablit la commande validée ; `reject` d'une action jamais validée la supprime ; un humain qui modifie revalide | route | `project-actions.test.ts` |
| S5 : création avec `schedule` sans `onDemand` ; refus sans aucun des deux ; balayage : tir à l'heure, passage `schedule`, sortie capturée, délai max → `failed`, pause respectée, `run_action` refuse une commande non `onDemand` | horloge injectée (comme `scheduled-tasks.test.ts`) | `apps/server/test/scheduled-commands.test.ts` (nouveau) |
| S6 : tâche `cadence: null` jamais tirée par le balayage, lançable à la main ; `worktree_mode: 'new'` crée un worktree pour le tir ; `InstanceInfo.timeZone` | route | `scheduled-tasks.test.ts` (étendre) |
| S7 : `served` (racine, worktree, sous-dossier, branche, `head`, non commités) ; 409 `service_running_elsewhere` depuis un autre arbre, 200 `alreadyRunning` depuis le même ; `switch: true` redémarre dans le nouveau cwd ; placement `root` ignore l'arbre d'origine ; `branch` refuse explicitement sans arbre | unités systemd simulées (comme `services.test.ts`) | `apps/server/test/action-served.test.ts` (nouveau) |
| S9 : travaux de fond par projet (vide, une conversation à 2 tâches, `session.ended` les efface, projet invisible → 404) | route | `apps/server/test/project-background.test.ts` (nouveau) |
| S10 : suggestions (package.json racine + espaces de travail, Makefile, nature devinée, dédoublonnage) ; `try` ouvre un terminal sans `actionId`, refusé hors des droits terminal | route sur dépôt temporaire | `apps/server/test/action-suggestions.test.ts` (nouveau) |
| S11 : création hors projet, droits (créateur seul), cwd du tir par portée | route | `scheduled-tasks.test.ts` |
| MOD-2/3, LAN-5, DET-1 : `fromAction`, `fromTask`, `actionState`, `stateSentence` (table de cas : service actif/échec/arrêté, tâche vivante/finie/interrompue, proposée, script à valider, échecs d'affilée, sautés ignorés) | pur | `apps/server/test/automations.test.ts` (nouveau) |
| AO-2, PLF-2 : filtres (OU dans un groupe, ET entre groupes, vide = tout), sections (une action dans une seule), groupes du Lanceur, « Lancés par les sessions » masqués par les filtres (PRC-6) | pur | `automations.test.ts` |
| PLF-4/7 : `dueOf` (fin de journée locale, 7 jours, pause), `healthOf` (taux sur 30 j, jugés, coût, dernière erreur d'une commande lue dans l'extrait) | pur | `automations.test.ts` |
| PLA-2…10 : `stateFromCadence` ↔ `cadenceFromState` aller-retour pour chaque fréquence ; non relisible → Personnalisé ; passage en Personnalisé garde le cron ; plage horaire ; jours ouvrés ; dernier jour du mois ; `sentenceOf` fr et en ; `upcoming` dans un fuseau donné | pur | `apps/server/test/schedule-rule.test.ts` (nouveau) |
| AGD-2…5 : passages de la période, durée typique, couloirs, chevauchement seulement entre actions différentes, heures montrées ± 1 h, replis | pur | `apps/server/test/agenda-layout.test.ts` (nouveau) |
| SRV-2 : `treeOf` (le plus profond, sous-dossier, `~`, racine) | pur | `apps/server/test/served.test.ts` (nouveau) |
| PRC-2/5 : `shortCommand`, `humanLabel` (fr/en), `portIn`, `familyOf`, `seedFromWork`, fusion processus + travaux de fond | pur | `apps/server/test/session-works.test.ts` (nouveau) |
| RUN-6 : `summarize` sur les sorties réelles de vitest, jest, node:test, pytest, eslint, tsc (fixtures = anciennes sorties de démo + captures réelles), `rerunFailed`, `relativePath`, ANSI | pur | `apps/server/test/command-output.test.ts` (nouveau) |
| PAG-5/6 : `filesOf`, `resultOf`, `sessionFiles` (attribution principal/sous-agent, +/− connus seulement pour les sous-agents) | pur | `apps/server/test/agent-files.test.ts` (nouveau) |
| Onglet Actions : Lanceur (groupes, tuiles de hauteur égale, geste unique en bas), lancer à la racine / dans un worktree, service démarré puis arrêté (vraie unité), Relire → Valider, Liste, filtres et puces, `?action=` / `?nouvelle=`, éditeur (erreurs sous le champ au blur, Enregistrer désactivé, création réelle d'une commande et d'une tâche d'agent planifiée), téléphone 390 px | parcours | `scripts/actions-ui-check.mjs` (réécrire) |
| Planification lisible : chaque fréquence produit la bonne cadence enregistrée (lue par l'API), aperçu (mois, prochains passages, fuseau du serveur), cron invalide | parcours | `scripts/schedule-ui-check.mjs` (réécrire ; l'ajouter à `package.json`) |
| Vérification d'un agent (essai, validation) dans l'éditeur | parcours | `scripts/schedule-check-ui-check.mjs` (adapter au nouvel éditeur) |
| Agenda : blocs, chevauchement, replis, liste sous 44 rem | composant monté (`viteDependency`) | `scripts/actions-ui-check.mjs` (étape dédiée) |
| Ce qu'il sert : ligne, bloc, 409 → dialogue → bascule réelle | parcours | `scripts/actions-ui-check.mjs` |
| Lancés par les sessions : un processus lancé par un terminal de session apparaît, « En faire une action » pré-remplit, « Arrêter » l'arrête (vu par `/api/services`) | parcours | `scripts/services-ui-check.mjs` (étendre) |
| Planifiées v2 : vues, regroupements, filtres de portée, Liste (chiffres), tiroir, création planifiée par défaut | parcours | `scripts/schedule-ui-check.mjs` |
| Panneau : cadre commun (hauteur 48 px des lignes d'outils de chaque onglet, détail en pile, Échap remonte), Git en une ligne (destinations, conflits), Terminaux en pastilles, Recherche « Filtrer », Web | parcours | `scripts/git-ui-check.mjs`, `scripts/web-ui-check.mjs` (étendre) ; nouvelle étape panneau dans `scripts/viewport-ui-check.mjs` (largeurs étroites) |
| Panneau › Actions : Lanceur compact, lancer dans le worktree de la conversation, commande lancée → « En cours » → détail → sortie en direct → Arrêter (réel) → « Relancer seulement les échecs » sur une vraie suite qui échoue, signal « travaux de fond » → onglet Actions, « Agrandir le panneau » | parcours | `scripts/actions-ui-check.mjs` (étape conversation) |
| Panneau › Agent : sous-agent en pile, « Modifié par la session », arrêt réel d'un travail de fond (CLI qui le sait) | parcours avec un journal semé | nouvelle `scripts/panel-agent-ui-check.mjs` |
| Panneau › Projet : rattacher, détacher, colonne, sous-tâche (réels, vérifiés par l'API) | parcours | `scripts/board-ui-check.mjs` (étape panneau) ou nouvelle `scripts/panel-project-ui-check.mjs` |

---

## 7. Découpage en cartes

Chaque carte = une session, une PR, faite en TDD (le test d'abord). « Proto » = fichiers de
référence à reproduire 1:1 (dans le worktree `proto__page-projet`, à lire, jamais à
fusionner). Les dépendances vers les autres documents sont nommées (« coque N »,
« PP-NN ») ; la session qui pose les cartes les reliera par `blockedBy`. Vingt-cinq cartes.

### Serveur

**AC-01 Terminaux : fin datée, interruption, relance qui recycle**
- À faire : S1 (§3.3) — `ManagedTerminal.finishedAt` posé dans `onExit` et persisté ;
  `TerminalDto.finishedAt` ; `POST /api/projects/:id/terminals/:terminalId/interrupt`
  (Ctrl-C par le pty ; 409 si fini) ; `ActionRunner.run` ferme le terminal **fini** de la
  même action et du même lieu (conversation ou racine) avant d'en ouvrir un. `lib/terminals.ts` :
  `useInterruptTerminal`.
- Proto : `P:components/prototype/panel/CommandRuns.tsx` (en-tête : ce qui est simulé).
- Acceptation : RUN-2 (durée d'une commande finie, Arrêter), RUN-3 (Relancer sans
  accumuler de terminaux).
- Tests : `terminals-interrupt.test.ts`.
- Dépendances : aucune.

**AC-02 Passages d'une commande, lancement dans un worktree, relecture avec diff**
- À faire : S2, S3, S4 — table `action_runs` + migration ; `ActionRunDto`,
  `ProjectActionDto.runs`, `.approved` ; `run { worktreeId, args }` ; `POST
  /api/actions/:id/reject` ; `run_action` (MCP) écrit `trigger: 'agent'` et refuse `args`.
  `lib/actions.ts` : `useRunAction({ worktreeId, args })`, `useRejectAction`. Trancher Q3.
- Proto : `P:routes/prototype-automations/ActionDetail.tsx` (`Runs`, `RunLine`,
  `ReviewBlock`), `LaunchButton.tsx`, `model.ts` (`UnifiedRun`).
- Acceptation : DET-4 (diff), DET-8 (passages réels d'une commande à la demande), LAN-9
  (Lancer dans <worktree>), RUN-3 (« Relancer seulement les échecs »).
- Tests : `project-actions.test.ts` (S2, S3, S4).
- Dépendances : après AC-01 (fin du terminal → clôture du passage).

**AC-03 Commande planifiée : le Quand d'une commande**
- À faire : S5 — colonnes de cadence sur `project_actions` ; `schedule` et `onDemand` dans
  le protocole et les schémas (au moins un des deux) ; balayage des commandes dans le
  `TaskScheduler` (même passe que les tâches, même règle de rattrapage) ; exécution
  **détachée** (processus, cwd = racine + sous-dossier, délai max, sortie capturée dans le
  passage) ; `trigger: 'schedule'` ; pause par `PATCH { schedule: { enabled } }` ;
  `register_action` (MCP) accepte `schedule` ; palette et `run_action` ignorent une
  commande non `onDemand`. Un **service** planifié reste hors de cette carte (AC-06).
- Proto : `P:routes/prototype-automations/model.ts` (`demoScheduledCommands`,
  `asScheduledTask`), `Editor.tsx` (Quand d'une commande).
- Acceptation : MOD-1 (`schedule` d'une commande), DET-7 (pause d'une commande),
  DET-8 (passages planifiés), AGD-2 (commandes dans l'agenda), LST-4.
- Tests : `scheduled-commands.test.ts`.
- Dépendances : après AC-02.

**AC-04 Tâche d'agent : à la demande seule, où elle tourne, fuseau du serveur**
- À faire : S6 — `scheduled_tasks.cadence` nullable (reconstruction de table SQLite),
  `on_demand`, `worktree_mode` ; `openSession` crée le worktree d'un tir `new` (via
  `worktrees/create.ts`, nom dérivé de la tâche et de l'heure) ; `schedule_task` (MCP)
  suit ; `InstanceInfo.timeZone` ; `lib/schedules.ts` en tient compte. Trancher Q4.
- Proto : `P:routes/prototype-automations/Editor.tsx` (« Où il tourne », Quand),
  `ScheduleBuilder.tsx` (`TIMEZONE`).
- Acceptation : EDI-13, EDI-17 (agent seulement à la demande), PLA-11 (fuseau du serveur).
- Tests : `scheduled-tasks.test.ts` (étendre).
- Dépendances : aucune.

**AC-05 « Ce qu'il sert » : version servie, refus du « déjà en marche », placement**
- À faire : S7 — `served` dans `ProjectActionServiceState` (git lu dans le `cwd` de
  l'unité, mis en cache comme l'état des unités) ; 409 `service_running_elsewhere` ;
  `run { switch: true }` (arrêt puis démarrage dans le nouveau cwd) ; colonnes `placement`
  (`follow` par défaut, `root`, `branch`) et `pinned_branch` ; message d'erreur traduisible
  côté client. `per-worktree` refusé (400) tant que AC-06 n'est pas fait.
- Proto : `P:routes/prototype-automations/served.tsx` (en-tête, `SwitchServiceDialog`,
  `PlacementField`).
- Acceptation : SRV-1/2 (données), SRV-4 (côté serveur), SRV-6 (trois premières options).
- Tests : `action-served.test.ts`.
- Dépendances : après AC-02 (`worktreeId` au lancement).

**AC-06 Cas limites des services : une instance par worktree, service planifié**
- À faire (selon Q11) : S8 — `placement: 'per-worktree'` (une unité par action et par
  arbre, `actionUnit(id, treeKey)`, port libre passé en `PORT`, lien `{port}` exigé) ;
  `stop_cadence` (le balayage arrête l'unité) ; activer les deux options dans l'éditeur
  (EDI-18, SRV-6 quatrième option) et lister toutes les instances dans le détail.
- Proto : `served.tsx` (`per-worktree`), `Editor.tsx` (encart « Cas limite »).
- Acceptation : SRV-6 (« Une instance par worktree »), EDI-18.
- Tests : `action-served.test.ts`, `scheduled-commands.test.ts`.
- Dépendances : après AC-03, AC-05, AC-14, AC-16.

**AC-07 Travaux de fond d'un projet**
- À faire : S9 — `GET /api/projects/:id/background` ; `lib/conversations.ts` :
  `useProjectBackground(projectId)` (invalidé par le flux des statuts quand un
  `background_count` change).
- Proto : `P:routes/prototype-automations/SessionWorks.tsx` (en-tête : « aucune route ne
  liste les travaux de fond d'un projet »).
- Acceptation : PRC-1 (les autres sessions ne sont plus « connues par leur seul
  nombre »), Q7.
- Tests : `project-background.test.ts`.
- Dépendances : aucune.

**AC-08 Aides de l'éditeur : suggestions du dépôt et « Essayer »**
- À faire : S10 — `GET /api/projects/:id/actions/suggestions` (lecteurs purs par source,
  dédoublonnés contre les actions existantes) ; `POST /api/projects/:id/actions/try`
  (terminal d'essai, mêmes droits qu'un terminal, environnement de la conversation si
  donnée) ; `lib/actions.ts` : `useActionSuggestions`, `useTryAction` (rend le terminal ;
  la sortie se lit par la socket comme RUN-5).
- Proto : `P:routes/prototype-actions/data.ts` (`SUGGESTIONS`, `fakeOutput`),
  `Editor.tsx` (puces, « Essayer »), `ProtoActionsPane.tsx` (état vide).
- Acceptation : EDI-4, EDI-10, PACT-6 (données).
- Tests : `action-suggestions.test.ts`.
- Dépendances : aucune.

**AC-09 Portée des tâches : Savoir, Instance, création hors projet**
- À faire (après Q9) : S11 — `scheduled_tasks.scope`, cwd d'un tir selon la portée,
  `POST /api/schedules` ; si Tim veut des **commandes** hors projet, `project_actions.project_id`
  nullable + même `scope` (sinon les commandes restent liées à un projet et le champ
  Portée de l'éditeur ne les propose pas).
- Proto : `P:routes/prototype-planned/data.ts` (`Scope`, `scopeLabel`, `demoData`).
- Acceptation : PLF-2 (portées réelles), PLF-9, PLF-10.
- Tests : `scheduled-tasks.test.ts`.
- Dépendances : aucune (trancher Q9 d'abord).

### Design system

**AC-10 DS : cartes de choix, piste d'interrupteur, sortie de terminal, calendrier, cadre de panneau**
- À faire (dépôt `solera-ds`) : `ChoiceCards`, `CheckCards`, `Switch`/`SwitchTrack` en
  tailles ligne/tuile, `TerminalOutput` (ou jetons terminal), `MonthGrid`, `TimePicker`,
  `RunStrip`, et le cadre de panneau (`PanelToolbar`, `PanelGroup`, `PanelStatusIcon`,
  `StackHeader`, `PanelEmpty`, `PanelNotice`, classes de ligne et de geste) ; stories ;
  pages `GabaritLieu.mdx` / « Panneau et tiroir » (avec coque carte 1). Pousser, épingler
  dans `apps/web/package.json` et `apps/catalog/package.json`, `pnpm install`.
- Proto : `Editor.tsx` (`BigChoice`, `SmallChoice`, `CheckCard`), `served.tsx`
  (`PlacementField`), `LaunchButton.tsx` (`ServiceSwitch`), `ScheduleBuilder.tsx`
  (`MonthGrid`, `TimeButton`), `ActionDetail.tsx` / `ActionsPage.tsx` (`Pips`, frise),
  `CommandRuns.tsx` (`OutputTail`), `panel/PanelTabFrame.tsx`.
- Acceptation : rendus identiques au proto (captures des stories), requêtes de
  conteneur, nom accessible, 44 px au doigt ; `pnpm tokens:check && pnpm typecheck &&
  pnpm lint && pnpm build` verts dans le DS.
- Tests : stories du DS ; `pnpm build:catalog` dans Solera.
- Dépendances : avec coque 1 (même PR DS si possible).

### Socle web

**AC-11 Modèle unifié Quoi × Quand**
- À faire : `lib/automations.ts` (pur, §4.2), `lib/automations-query.ts`
  (`useAutomations`, `useAutomationMutations`), tables de verdict uniques (fusion de
  `RUN_FILL`/`RUN_WORD` avec `RUN_DOTS`/`RUN_LABELS`) ; i18n `automation.*`. Trancher Q5.
  Les champs serveur pas encore livrés (`runs`, `schedule` d'une commande, `onDemand`)
  sont optionnels dans le modèle : leurs cartes les allument sans toucher aux écrans.
- Proto : `P:routes/prototype-automations/model.ts`, `LaunchButton.tsx` (`actionState`,
  `cadenceText`), `DrawerParts.tsx` (`natureOf`, `whenWords`, `cadenceWord`),
  `P:routes/prototype-schedules/data.ts` (`verdictRuns`, `inShort`, `formatDuration`,
  `formatCost`), `P:routes/prototype-planned/data.ts` (`healthOf`, `dueOf`).
- Acceptation : MOD-1 à MOD-6, LAN-5, DET-1 (texte), AO-2 (logique), PLF-4/7 (calculs).
- Tests : `automations.test.ts`.
- Dépendances : aucune (AC-02, AC-03, AC-04 enrichissent ensuite).

**AC-12 Pièces d'une action : état, gestes, en-tête de tiroir**
- À faire : `components/automations/` — `StateIcon`, `NatureIcon`, `KindChip`,
  `ServiceSwitch`, `LaunchButton` (racine + six worktrees ; agent selon Q6), `ReviewButton`,
  `quietGestureClass`, `ActionSheet` (`ActionChromeProvider`, `ActionHeader`, `ActionBody`,
  `ActionBlock`, `ActionFooter`, `Chip`) ; stories (états : en marche, arrêté, échec, à
  relire, jamais lancée ; tiroir et `inline`) ; i18n `launcher.*` (gestes).
- Proto : `P:routes/prototype-automations/LaunchButton.tsx`, `DrawerParts.tsx`.
- Acceptation : LAN-4, LAN-7, LAN-9, TIRA-5, TIRA-6.
- Tests : stories ; étape « pièces » dans `actions-ui-check.mjs` (hauteurs 44/36 px, nom
  accessible des interrupteurs).
- Dépendances : après AC-10, AC-11.

**AC-13 La planification lisible (`ScheduleBuilder`)**
- À faire : `lib/schedule-rule.ts` (pur) et `components/automations/ScheduleBuilder`
  (phrase, menus, heure tapée, mois, aperçu) ; fuseau et calculs du serveur
  (`InstanceInfo.timeZone`, croner avec `timezone`) ; dates par `locale()` ; i18n
  `scheduleRule.*`.
- Proto : `P:routes/prototype-automations/ScheduleBuilder.tsx`.
- Acceptation : PLA-1 à PLA-11.
- Tests : `schedule-rule.test.ts` ; story (chaque fréquence, invalide) ;
  `schedule-ui-check.mjs` (via l'éditeur, carte AC-14).
- Dépendances : après AC-10 (`MonthGrid`, `TimePicker`), AC-04 (fuseau).

**AC-14 L'éditeur unifié Quoi × Quand**
- À faire : `components/automations/ActionEditor` — étapes, champs, erreurs au blur,
  aperçu du bouton, suggestions et « Essayer » (AC-08), **vrai** sélecteur de dossier
  (`useTreeLevel`), placement (AC-05), lien + avertissement à distance, agent avec
  `useAgentSettings` (modèle, effort, permissions), « Où il tourne » (selon Q4), vérification
  par `CheckSection` (phrase juste : 0 lance, 10 écarte), options de Q2, Quand + `ScheduleBuilder`,
  graines (`preset`, `from`, `schedule`, `prefill`), enregistrement par
  `useAutomationMutations.save`. Textes sans ⚡. i18n `actionEditor.*`. Supprimer
  `ScheduleDialog` et `ActionDialog` (+ story) dès qu'ils n'ont plus d'appelant.
- Proto : `P:routes/prototype-automations/Editor.tsx`, `served.tsx` (`PlacementField`),
  `P:routes/prototype-actions/data.ts` (`soleraIsRemote`, règles de `problemsOf`).
- Acceptation : EDI-1 à EDI-21 (EDI-18 et la 4e option de SRV-6 désactivées jusqu'à
  AC-06), EDI-22 (champ Portée, porté par AC-20).
- Tests : `schedule-ui-check.mjs` et `actions-ui-check.mjs` (création réelle commande /
  agent planifié / commande planifiée, erreurs), `schedule-check-ui-check.mjs` adapté ;
  story (nouvelle commande, service, agent, modification, étroit).
- Dépendances : après AC-12, AC-13, AC-08, AC-05 ; AC-03 et AC-04 pour enregistrer la
  planification d'une commande et l'agent à la demande (sans eux, ces combinaisons sont
  refusées avec un message clair).

**AC-15 Le tiroir unifié et le détail d'une action**
- À faire : `ActionDrawer` (modes detail / edit / pick, tiroir commun ou pile selon
  `useDetailSurface()`, Échap remonte en pile), `ActionDetail` (DET-1 à DET-11 : relecture
  réelle avec diff et Refuser, passages réels, pause réelle, Dupliquer, Supprimer sur
  place, journal et Redémarrer selon Q1), « Terminal » d'une commande qui tourne → détail
  du passage (`CommandRunDetail` en surface tiroir, AC-22) ; `newActionPanel`,
  `actionPanelOf` ; i18n `actionDrawer.*`, `actionDetail.*`.
- Proto : `P:routes/prototype-automations/ActionDrawer.tsx`, `ActionDetail.tsx`.
- Acceptation : TIRA-1 à TIRA-7, DET-1 à DET-11.
- Tests : `actions-ui-check.mjs` (Relire → Valider/Refuser vérifiés par l'API, pause,
  suppression, Dupliquer, Échap) ; stories.
- Dépendances : après AC-12, AC-14, AC-02 ; coque 3 (`Drawer`, `DetailSurfaceContext`).

**AC-16 « Ce qu'il sert » côté web**
- À faire : `lib/served.ts`, `useServedIndex`, `ServedLine`, `ServedBlock`,
  `SwitchServiceDialog` + `useServiceSwitch` (409 → dialogue → `switch: true`),
  « Servir… » sur la tuile, `ServiceMark` exporté pour Travail ; i18n `served.*`.
- Proto : `P:routes/prototype-automations/served.tsx`, `Launcher.tsx` (`SwitchMenu`).
- Acceptation : SRV-1 à SRV-5 ; SRV-7 (données prêtes pour PP-15/16/17).
- Tests : `served.test.ts`, `actions-ui-check.mjs` (bascule réelle d'un service entre la
  racine et un worktree).
- Dépendances : après AC-05, AC-12 ; PP-04 (`useCodeData`, arbres et clés `?arbre=`).

**AC-17 Lancés par les sessions**
- À faire : `lib/session-works.ts`, `useSessionWorks` (processus de `/api/services` +
  travaux de fond par projet d'AC-07, fusionnés ; selon Q7 dans le panneau),
  `SessionWorksSection` (tuiles, lignes, compact), Arrêter réel (`/api/services/:id/stop`,
  travail de fond par sa route), « En faire une action » (`seedFromWork`), liens de port
  par le relais (§2.5-5) ; i18n `sessionWorks.*`. `useActionsCount` (coque 6) lit ce
  crochet.
- Proto : `P:routes/prototype-automations/SessionWorks.tsx`.
- Acceptation : PRC-1 à PRC-7.
- Tests : `session-works.test.ts`, `services-ui-check.mjs` (étendre).
- Dépendances : après AC-07, AC-12 ; AC-14 pour la cible d'« En faire une action ».

**AC-18 L'Agenda des actions**
- À faire : `lib/agenda-layout.ts` (pur), `components/automations/ActionsAgenda`
  (semaine/jour, replis, chevauchements, maintenant, bandeau des services, légende, liste
  sous 44 rem) ; i18n `agenda.*`.
- Proto : `P:routes/prototype-automations/ActionsAgenda.tsx`.
- Acceptation : AGD-1 à AGD-10.
- Tests : `agenda-layout.test.ts` ; story (semaine chargée avec chevauchement, jour,
  étroit) ; étape Agenda de `actions-ui-check.mjs`.
- Dépendances : après AC-11, AC-13 (`upcoming`).

### Écrans

**AC-19 L'onglet Actions du projet**
- À faire : `routes/ProjectActionsPage.tsx` sur `/p/:id/actions` dans la coque ; barre
  (AO-1 à AO-6 avec `OneLineToolbar`, `FilterMenu`, `DisplayMenu`, `useView` de coque 4) ;
  `LauncherView` (LAN-1 à LAN-9, tuile, menu `⋯` avec journal/redémarrer selon Q1) ; Liste
  (LST-1 à LST-5) ; Agenda (AC-18) ; tiroir (AC-15) ; `?action=` et `?nouvelle=`
  synchronisés ; redirection définitive `/p/:id/schedules` → `/p/:id/actions` ;
  supprimer `SchedulePage`, `ActionList` ; i18n `actionsTab.*`, `launcher.*`.
- Proto : `P:routes/prototype-automations/ActionsPage.tsx`, `Launcher.tsx`.
- Acceptation : AO-1 à AO-8, LAN-1 à LAN-9, LST-1 à LST-5.
- Tests : `actions-ui-check.mjs` (réécrite : parcours complet, 1280 et 390 px) ;
  `places-ui-check.mjs` (onglet et redirection).
- Dépendances : après AC-15, AC-16, AC-17, AC-18 ; coque 2, 3, 4, 6.

**AC-20 La page globale Planifiées v2**
- À faire : `routes/SchedulesPage.tsx` réécrite (PLF-1 à PLF-10) : bande, « + Tâche ▾ »
  (planifiée d'office), barre (Portée, Quoi, État, Prochain passage), Lanceur par
  échéance / portée (`PlannedTile`), Agenda, Liste ex-Santé, tiroir ; **champ Portée** dans
  l'éditeur quand il est ouvert hors projet (EDI-22) ; `ScopePip`, `ScopeMark` ; i18n
  `planned.*`. Sans AC-09, les portées sont « projet » et « Sans projet » (lecture), et la
  création hors projet est masquée.
- Proto : `P:routes/prototype-planned/PlannedPage.tsx`, `data.ts`.
- Acceptation : PLF-1 à PLF-10.
- Tests : `schedule-ui-check.mjs` ; `automations.test.ts` (filtres de portée, `dueOf`).
- Dépendances : après AC-18, AC-19 (tuiles, tiroir) ; coque 8 (`ProjectPip`) ; AC-09 pour
  Savoir / Instance / création hors projet.

**AC-21 Panneau : cadre commun, Git, Terminaux, Recherche, Web**
- À faire : appliquer le cadre (AC-10) aux onglets ; `GitLine` (PGIT-1 à 3) à la place du
  rail et de `toolbar.tsx` ; Terminaux en pastilles (PTER-1 à 3) ; Recherche « Filtrer ▾ »
  (PSRC-1, 2) ; Web en une ligne (PWEB-1, 2) ; `SidePanel` : ombre (PAN-3), ton `running`
  du compte d'Actions (PAN-2, avec coque 6) ; vérifier CNV-3 (ne porter le repli
  d'environnement que s'il est prouvé) ; i18n `git.view.*`, `terminal.empty.*`,
  `panel.search.*`.
- Proto : `P:components/prototype/panel/ProtoSidePanel.tsx`, `PanelTabFrame.tsx`,
  `ProtoGitPane.tsx`, `GitLine.tsx`, `ProtoTerminalsPane.tsx`, `ProtoSearchPane.tsx`,
  `ProtoWebPane.tsx`.
- Acceptation : PAN-1 à PAN-4, PGIT-1 à 3, PTER-1 à 3, PSRC-1 à 2, PWEB-1 à 2.
- Tests : `git-ui-check.mjs`, `web-ui-check.mjs`, `viewport-ui-check.mjs` (panneau étroit).
- Dépendances : après AC-10 ; coque 6 (ton du compte).

**AC-22 Panneau : les commandes lancées ici**
- À faire : `lib/command-output.ts` (pur), `useCommandRuns`, `CommandRunsGroup`,
  `CommandRunDetail` (surfaces pile et tiroir), sortie en direct en lecture seule,
  Arrêter (AC-01), Relancer (recyclage), Relancer seulement les échecs (`args`, AC-02),
  Ouvrir le terminal, liens fichier:ligne, Écarter (selon Q10) ; i18n `panel.runs.*`.
- Proto : `P:components/prototype/panel/CommandRuns.tsx`, `commandOutput.ts`.
- Acceptation : RUN-1 à RUN-6.
- Tests : `command-output.test.ts` (fixtures), étape « commande lancée ici » de
  `actions-ui-check.mjs` (une vraie suite qui échoue).
- Dépendances : après AC-01, AC-02, AC-21.

**AC-23 Panneau : l'onglet Actions**
- À faire : `components/panel/ActionsPane.tsx` réécrit (PACT-1 à PACT-9) : lanceur
  compact, Liste avec ancres, Agenda (Jour), Affichage, « + Nouvelle ▾ », ↗ vers l'onglet
  du projet, recherche au-delà de 8, état vide avec suggestions, détail/édition/choix en
  pile (`ActionDrawer inline`), « Agrandir le panneau » ; `requestActionEdit` dans
  `lib/panel.ts` (PACT-8) ; signaux → onglet dans `ConversationPage` (PACT-10) ;
  supprimer l'ancien `ActionsPane` (+ story), `ActionList`, `useActionDialogs` ;
  i18n `panel.actions.*`.
- Proto : `P:components/prototype/panel/ProtoActionsPane.tsx`, `actionBridge.ts`,
  diff `P:routes/ConversationPage.tsx` (`SignalRow onSelect`).
- Acceptation : PACT-1 à PACT-10, PRC-7.
- Tests : `actions-ui-check.mjs` (étape conversation) ; story (lanceur, liste, vide,
  étroit).
- Dépendances : après AC-15, AC-17, AC-18, AC-21, AC-22 ; coque 6.

**AC-24 Panneau : l'onglet Agent**
- À faire : `lib/agent-files.ts` (pur), `AgentsPane` réécrit (PAG-1 à PAG-7, PAG-12) :
  En cours mêlé, Terminés replié, pied « Modifié par la session », détail d'un
  sous-agent (fichiers, résultat, fil, copier, dans le fil principal, **interrompre la
  session réelle**), détail d'un travail de fond (arrêt **réel** si le CLI le sait,
  sinon pas de bouton ; port par le relais) ; selon Q8, supprimer `AgentWritings` ;
  i18n `panel.agent.*`.
- Proto : `P:components/prototype/panel/ProtoAgentPane.tsx`, `agentFiles.ts`.
- Acceptation : PAG-1 à PAG-7, PAG-12.
- Tests : `agent-files.test.ts` ; `panel-agent-ui-check.mjs` (nouvelle).
- Dépendances : après AC-21 ; AC-23 pour PAG-12.

**AC-25 Panneau : l'onglet Projet**
- À faire : `ProjectPane` réécrit sur le cadre (PPR-1 à PPR-5) avec les gestes réels
  existants ; « Ce qui t'attend » par `AskInbox` (coque 5) ; jalon en cours par le modèle
  du domaine Jalons ; « Dans le tableau » vers le paramètre de fiche du Tableau
  (`projet.md`) ; i18n `panel.project.*`.
- Proto : `P:components/prototype/panel/ProtoProjectPane.tsx`.
- Acceptation : PPR-1 à PPR-5.
- Tests : `panel-project-ui-check.mjs` (nouvelle) ou étape dans `board-ui-check.mjs`.
- Dépendances : après AC-21 ; coque 5 ; carte du domaine Jalons qui livre la maturité et
  le jalon courant ; PP du Tableau qui fixe le paramètre de fiche.

### Récapitulatif des dépendances

```
AC-01 ─> AC-02 ─┬─> AC-03 ──────────────┐
                ├─> AC-05 ─> AC-16 ─┐   ├─> AC-06 (après AC-14, AC-16 ; selon Q11)
                │                   │   │
AC-04 ─> AC-13 ─┼─> AC-14 <─ AC-08  │   │
AC-10 ─┬─> AC-12 <─ AC-11           │   │
       │    ├─> AC-14 ─> AC-15 ─────┼───┴─> AC-19 (+ coque 2,3,4,6) ─> AC-20 (+ AC-09, coque 8)
       │    └─> AC-17 <─ AC-07 ─────┘
       │         AC-11 + AC-13 ─> AC-18 ─> AC-19, AC-20, AC-23
       └─> AC-21 ─┬─> AC-22 (après AC-01, AC-02) ─> AC-23 ─> AC-24 (PAG-12)
                  ├─> AC-24
                  └─> AC-25 (+ coque 5, Jalons)
```

Externes : coque 1 (avec AC-10), coque 2/3/4/6 (avant AC-19 et AC-23), coque 5 (AC-25),
coque 8 (AC-20), coque 17 (portefeuille › Actions, après AC-18 et AC-19), coque 18
(nettoyage final, après tout) ; PP-04 (avant AC-16) ; PP-15/16/17 (`ServiceMark`, après
AC-16) ; PP-11 (bloc Actions de l'Aperçu, liens vers `?action=`, après AC-19).
