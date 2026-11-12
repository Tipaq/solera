# Recette de la page projet v2

Carte #246, le 2026-11-12. Les quatre specs du prototype — `coque`, `projet`, `jalons`,
`actions` — repassées point par point, sur `main` avec toutes les cartes des six jalons
(#157, #164, #182, #200, #221, #230), #228 comprise.

Les specs ne sont pas sur `main` : elles se lisent sur la branche du prototype,

```sh
git show 61a14a39:docs/specs/2026-11-page-projet-v2/{coque,projet,jalons,actions}.md
```

## Comment

Contre l'application **lancée** : le serveur et le web de cette branche, sur une instance
d'essai peuplée par `pnpm --filter @solera/server demo:seed` (projets Nimbus, Atlas API,
Docs), complétée par l'API de ce qu'il fallait pour voir chaque état : jalons à chaque
étape de maturité, un jalon lancé à la main, actions de chaque nature, tâches planifiées
de chaque portée, passages réussis et en échec. Aucun agent réel n'a été lancé. Chaque point
a été vu dans Chromium, au large (1440 px) et au téléphone (390 px) quand la spec en parle.
Les noms de capture cités dans les tableaux (`coque-…`, `jalons-tel-axe`…) sont ceux des
captures de travail : elles ne sont pas versionnées, aucun point ne demandant de preuve
visuelle au-delà de ce qui est écrit.

| État | Sens |
|---|---|
| ✅ | livré, vu à l'écran |
| ✅ code | livré, mais l'état ne se fabrique pas sans un vrai agent (sous-agents, conflits git, cycle de cartes…) : vérifié dans le code ou par la suite UI citée |
| 🟡 | livré avec un écart mineur, et la carte qui le reprend |
| ❌ | absent ou faux |

Un écart voulu — décidé en §2.6 d'une spec, dans une carte ou par le design system — est
compté ✅ et dit « décidé ».

## Synthèse

| Spec | Points | ✅ | ✅ code | 🟡 | ❌ |
|---|---|---|---|---|---|
| `coque.md` §1 (coque, tiroir, barre, Ce qui t'attend, sidebar, /sessions, portefeuille, palette) | 116 | 97 | 16 | 3 | 0 |
| `projet.md` §1 (Aperçu, Travail, Tableau, Réglages, variantes à jeter) | 199 | 159 | 38 | 2 | 0 |
| `jalons.md` §0, §1 et questions ouvertes | 161 | 129 | 26 | 6 | 0 |
| `actions.md` §1.A–1.J, §0 et §2.5 | 120 | 110 | 8 | 2 | 0 |
| `actions.md` §1.K (panneau d'une conversation) | 52 | 35 | 13 | 4 | 0 |
| **Total** | **648** | **530** | **101** | **17** | **0** |

Rien n'est absent. Les 17 écarts mineurs ont tous une carte :

| Carte | Écart | Jalon |
|---|---|---|
| #252 | graphe git : « GRAPHE » chevauche « MESSAGE » (T-7.1) | — |
| #253 | `PanelHost` encore monté sur le Tableau (TIR-9) | #230 |
| #261 | l'aperçu du mois gèle sur un cron « chaque minute » (PLA-11) | #200 |
| #269 | `/sessions` au téléphone : deux bandes (COQ-12, SES-1) | #230 |
| #270 | « 0 lignes » au lieu de « 0 ligne » (R-6.6) | #230 |
| #271 | échéances relatives arrondies en heures, pas en jours (JAL-3, HOR-11, FCH-3) — **corrigé dans la PR de #246**, il faisait échouer `places-ui-check` chaque après-midi | #157 |
| #272 | axe des jalons au téléphone : mois chevauchés sous « auj. » (HOR-3, GNT-3) | #182 |
| #273 | Gantt au téléphone : titre à gauche d'une barre sous la colonne collée (GNT-10) | #182 |
| #274 | processus des sessions : « 36min », « 21.5 Mo » (PRC-3) | #200 |
| #275 | bande « panneau étroit » affichée deux fois (PACT-9) | #221 |
| #276 | terminaux : pastille active hors champ (PTER-1) | #221 |
| #277 | recherche : erreur d'expression brute, en anglais (PSRC-2) | #221 |
| #278 | liens `:port` en `http://localhost` au Ctrl-clic et hors conversation (§2.5-5) | #200 |

Restes signalés par #228 en dehors de la recette : #279 (la couleur de « travaille » dans
`GabaritPanneau.mdx` du DS) et #280 (la route `GET …/edits/:toolCallId`, sans appelant).

### Décisions prises par cette recette

- `?carte=` et `?fiche=` : la fiche d'une carte garde `?carte=` pour « Voir dans le
  tableau », comme le prototype. Au tableau, `?fiche=` rouvrirait la même fiche ; on y va
  pour l'éditeur complet (#180).
- `/p/:id/code` (COQ-11) n'est pas redirigée : l'onglet Code n'a existé que dans le
  prototype, l'adresse n'a jamais circulé.

### Observations sans carte

- À l'ouverture d'un tiroir (« Nouveau jalon », « Ajouter au jalon ») sur le serveur de
  dev, le focus entre dans le champ puis revient au bouton : vraisemblablement le double
  passage des effets de `StrictMode` dans `PanelFocus.tsx:60-76`, qui ne joue pas en
  production. À confirmer sur un build avant d'en faire une carte.
- L'aperçu du bouton dans l'éditeur dit « jamais lancée » même pour une action déjà
  lancée : fidèle au prototype (EDI-16), mais trompeur.

## `coque.md`

#### 1.1 Coque commune
| Point | État | Preuve / carte |
|---|---|---|
| COQ-1 trois étages, contenu relatif + calque tiroirs | ✅ | `[data-place-content]` relative/overflow-clip + `DrawerLayer` (PlaceShell.tsx) ; capture coque-apercu |
| COQ-2 gouttière unique 16/24 | ✅ | 1440 : avatar, icône d'Aperçu, bord de la recherche, 1er texte de l'Aperçu à x=288 sur 5 vues (la loupe est dans le champ, comme au proto) |
| COQ-3 bande : créneau 20 px, h1 tronqué, gestes sm | ✅ | coque-bande ; au téléphone ☰ puis avatar (coque-tel-apercu) |
| COQ-4 bande projet : un seul geste « + Conversation » | ✅ | coque-bande : ni ⋯, ni branche, ni ⚡ ; libellé masqué au téléphone, aria-label gardé |
| COQ-5 rangée Aperçu·Travail·Tableau·Jalons·Actions | ✅ | coque-rangee : ordre, icônes 15 px ink-faint, gap-5 ; défile au doigt (666 px dans 390) |
| COQ-6 comptes à trois tons + infobulle | ✅ | Travail ambre « 2 t'attendent », Tableau gris « N cartes ouvertes », Jalons rien, Actions ambre « N à relire » |
| COQ-7 Réglages au bout, filet, aria-label | ✅ | coque-rangee ; « Réglages du projet », souligné sur /settings ; icône seule au téléphone |
| COQ-8 /p/:id/settings dans la coque | ✅ | coque-reglages : rangée présente, une seule bande |
| COQ-9 pleine largeur | ✅ | contenu 1176 px = 1440 − sidebar, sur les 5 vues |
| COQ-10 plus d'action de vue dans la rangée | ✅ | « + Carte » dans la barre du Tableau ; `?nouvelle=1` ouvre le dialogue (coque-nouvelle-carte) |
| COQ-11 anciennes adresses redirigées | ✅ | décidé : `/p/:id/code` n'a existé que dans le prototype, jamais sur `main` ; les autres anciennes adresses sont redirigées |
| COQ-12 bande seule /sessions, /schedules | 🟡 | même bande au large ; au téléphone /sessions a deux bandes (☰ Solera + ☰ Sessions) : `/sessions` absent de `contextualHeader` (AppShell.tsx:66)  — #269 |

#### 1.2 Tiroir commun et Échap par couches
| Point | État | Preuve / carte |
|---|---|---|
| TIR-1 tiroir par-dessus, sous la rangée, border-l, ombre | ✅ | coque-tiroir : top = bas de la rangée (97), radius 0, border-l 1 px, ombre -12px 0 32px -16px |
| TIR-2 calque de la coque absolute z-30, repli fixed | ✅ | tiroir dans `absolute inset-0 z-30 pointer-events-none empty:hidden` ; repli `fixed z-40` (Drawer.tsx:127,141) |
| TIR-3 largeurs normal / wide, plein écran au téléphone | ✅ | 576 px (36 rem) et 768 px (48 rem, éditeur d'action) ; 390 px au téléphone. Décidé (#161) : deux largeurs |
| TIR-4 voile black/15, clic dehors ferme | ✅ | voile `aria-label=Fermer` tabindex -1, oklch(0 0 0/0.15) ; clic dehors ferme |
| TIR-5 en-tête commun DrawerHeader | ✅ | `px-5 py-3.5`, filet, h2 base semibold, ✕ « Fermer », méta au-dessus (coque-tiroir) |
| TIR-6 role=dialog, aria-label, focus entre | ✅ | « Carte #2 », focus sur le tiroir à l'ouverture ; retour au déclencheur : shell-ui-check:179 |
| TIR-7 Échap : couche la plus haute seulement | ✅ code | Échap ferme la fiche (vu) ; menu Radix / autocomplétion d'abord : shell-ui-check.mjs:193-229 ; capture, IME, defaultPrevented : escape-layers.ts:55,70-74 |
| TIR-8 un seul comportement de panneau par page | ✅ | onglets de projet → tiroir ; conversation → pile dans le panneau (voir capture coque-panel-detail) |
| TIR-9 hôte de panneau appelé, sans bouton | 🟡 | aucun bouton de panneau sur Travail ni Tableau ; mais `PanelHost` encore monté sur le Tableau (BoardPage.tsx:366) — #253 |

#### 1.3 Barre d'outils sur une ligne
| Point | État | Preuve / carte |
|---|---|---|
| BAR-1 OneLineToolbar h-12, une ligne, puces qui défilent | ✅ | 48 px, `px-4 md:px-6`, zone de puces `flex-1 overflow-x-auto` (coque-barre-puces) ; à 390 px : shell-ui-check |
| BAR-2 ToolbarSearch w-36 → w-56, ✕, 36/44 px | ✅ | 144 → 224 px au focus ; « Effacer la recherche » ; 36 px au large, 44 au téléphone |
| BAR-3 bouton de menu, état actif | ✅ | `border-line-strong bg-surface-high` dès qu'un filtre est posé |
| BAR-4 Filtrer ▾ : popover, sections, cases, pied | ✅ | coque-filtrer : 320 px aligné au début, petites capitales, comptes, pastille « 2 », reste ouvert à la coche, « Effacer tous les filtres » |
| BAR-5 FilterChip h-7, max-w-56, ✕ | ✅ | « Retirer ce filtre » (coque-barre-puces) |
| BAR-6 Affichage ▾ : tuiles de vues + réglages | ✅ | coque-affichage : 320 px aligné à la fin, grille 3 colonnes, active marquée ; infobulle « Affichage : Kanban » |
| BAR-7 mémoire de vue (URL > mémoire > première) | ✅ | `?vue=fil` lu ; choix mémorisé (`solera.view.travail.<id>`) et retrouvé ; `?vue=zzz` ignoré ; pas d'entrée d'historique |

#### 1.4 « Ce qui t'attend »
| Point | État | Preuve / carte |
|---|---|---|
| INB-1 vide : « Rien ne t'attend. » + rond vert | ✅ code | AskInbox.tsx ; story `AskInbox` (vide) ; la démo a toujours des demandes |
| INB-2 en-tête repliable + résumé, sans teinte | ✅ | « 2 demandes · 1 à relire », point ambre, `aria-expanded` bascule (coque-inbox) |
| INB-3 lourdes avant légères | ✅ | deux sessions puis la carte à relire ; inbox.test.ts |
| INB-4 3 lignes puis « N de plus », une seule dépliée | ✅ | une seule réponse ouverte à la fois vu ; « N de plus » : `SHOWN = 3` (AskInbox.tsx:31), story (5 lignes) |
| INB-5 ligne lourde : icône, titre, indice, âge, geste | ✅ | coque-inbox : 40 px, « Répondre » / « Voir » → « Fermer » ; « Jalon #N » : aucune session en attente sur une carte de jalon (inbox.test.ts) |
| INB-6 réponse d'une session / session arrêtée | ✅ | coque-inbox-ouverte (Autoriser/Refuser + « Ouvrir le fil ») ; coque-inbox-arretee (triangle rouge + texte) |
| INB-7 indice = la question réelle | ✅ | « Bash : node scripts/migrate-settings.mjs --dry-run » (requestSummary) |
| INB-8 affinage (refine) | ✅ code | `useMilestoneInbox` (lib/milestone-inbox.ts), milestone-inbox.test.ts ; pas de cas dans la démo |
| INB-9 découpage (draft) | ✅ code | idem, AskInbox.tsx:238,363 |
| INB-10 PR de jalon (merge) | ✅ code | idem, AskInbox.tsx:248,399 |
| INB-11 ReplyField : grandit, Entrée envoie | ✅ code | AskInbox.tsx:436-461 (`field-sizing-content max-h-32`, Entrée sans Maj, IME) |
| INB-12 ligne légère : relire / PR ↗ | ✅ | « Carte #4 à relire · Relire → » lien entier ; PR (nouvel onglet) : AskInbox.tsx:497 |
| INB-13 openInboxItem depuis le repère d'un jalon | ✅ code | `WaitingMark` (MilestoneBeacon.tsx:182) ; aucun jalon en attente dans la démo |
| INB-14 inboxMilestoneNumber | ✅ code | lib/inbox.ts:226, inbox.test.ts |

#### 1.5 Compte des actions, retrait du ⚡
| Point | État | Preuve / carte |
|---|---|---|
| ACT-1 running / toReview | ✅ | onglet, méta et bouton du panneau d'accord (4 à relire, 3-4 en marche) ; `useActionsStatus` (automations-query.ts:64) |
| ACT-2 ambre « à relire » d'abord, sinon vert | ✅ | onglet Actions ambre « 4 à relire » ; `actionsTabBadge` (actions-tab.ts:62), place-counts.test.ts |
| ACT-3 point sur le bouton du panneau + nom | ✅ | coque-conversation : point ambre ; « Ouvrir le panneau — 3 en marche · 4 à relire » |
| ACT-4 ActionsStatusMeta cliquable | ✅ | méta verte qui pulse + ambre, sur l'onglet et le panneau ; décidé (actions AO-4) : dans l'onglet le clic filtre, dans le panneau il défile |
| ACT-5 retrait du ⚡ | ✅ | ni dans la bande, ni dans la barre du Tableau, ni dans l'en-tête d'une conversation |
| ACT-6 signaux → onglet Actions / Agent | ✅ code | `signalTab` (actions-pane.ts:86), ConversationPage.tsx:1485 |

#### 1.6 Sidebar
| Point | État | Preuve / carte |
|---|---|---|
| SID-1 un seul bloc qui défile | ✅ | lieux, Activité, projets dans `[data-sidebar-scroll]` ; Rechercher et compte dehors (coque-sidebar) |
| SID-2 gouttière de barre réservée | ✅ code | `[scrollbar-gutter:stable]` sur bande, haut, bloc (Sidebar.tsx:149,170,213) ; sidebar-ui-check |
| SID-3 colonne d'icônes 16 px | ✅ | lieux, Activité, projets, « Nouveau projet… » à 26 px ; sessions de l'arbre sur leur colonne (sous le filet, comme prévu par la suite) |
| SID-4 boutons de bande en sm | ✅ code | repli 28 px ; centrage : sidebar-ui-check.mjs:491 |
| SID-5 mode « un seul projet » | ✅ code | PlaceProjects.tsx:695-699 (`pt-2`, `pl-1`, survol par geste) ; sidebar-ui-check.mjs:483 |
| SID-6 réglage Ajuster / 10 / 20 / 50 | ✅ | carte vue, 10 stocké dans `solera.display.sessionLimit` ; budget : sidebar-budget.test.ts, sidebar-ui-check:323 |
| SID-7 « Ajuster à la hauteur » mesuré | ✅ code | `fitStep`/`fitNext` (sidebar-budget.ts) ; sidebar-ui-check:710 ; boucle corrigée par #262 |
| SID-8 repli de l'Activité (seuil 5, hystérésis) | ✅ code | `activityFold` (sidebar-budget.ts:191) ; sidebar-ui-check:710 |
| SID-9 ligne de fin « Toutes les sessions du projet · N → » | ✅ | → `/sessions?projet=<id>` ; plus d'« Archivées » ni de « N autres sessions » ; fils libres : pas de cas dans la démo |
| SID-10 *Fils* : budget + « Toutes les sessions · N → » | ✅ | « Toutes les sessions · 13 » sous la liste coupée |
| SID-11 *Fils* mène à /sessions, ↗ au survol | ✅ | clic → `/sessions`, lieu *Fils* allumé ; ↗ au survol (coque-sidebar-fils-survol) |
| SID-12 carte « Sessions dans la sidebar » | ✅ | icône PanelLeft, description, 4 boutons `aria-pressed` (coque-reglage-sessions) |
| SID-13 menu ⋯ : onglets, Toutes les sessions, Réglages | ✅ | ordre exact, sans couleurs ; même menu au clic droit (« N'afficher que ce projet » en tête, entrée du mode SID-5) |

#### 1.7 Page /sessions
| Point | État | Preuve / carte |
|---|---|---|
| SES-1 route, bande seule, « + Conversation » | 🟡 | au large OK (MessageSquare, « Sessions », « Nouvelle conversation ») ; au téléphone deux bandes — voir COQ-12 — #269 |
| SES-2 toutes sauf les planifiées | ✅ | 13 sessions listées sur 15 conversations (les 2 de tâches planifiées exclues) |
| SES-3 cinq états, dans l'ordre | ✅ | Par état et Filtrer : t'attend, en erreur, à relire, travaille, terminée ; sessions-view.test.ts |
| SES-4 ligne : agent + point, titre, mot, projet, branche, #carte, date | ✅ | coque-sessions-liste : 40 px, point titré, pastille, branche mono, `#2`, date relative |
| SES-5 recherche, `?q=` | ✅ | `?q=Refactor` pré-rempli, une ligne |
| SES-6 Filtrer ▾ : projet, état, agent, période, épinglées | ✅ | coque-sessions-filtrer ; puces « Nimbus », « t'attend » ; `?projet=` change sans recharger |
| SES-7 portée Actives / Archivées + comptes | ✅ | segment « Actives 13 / Archivées 0 » ; au téléphone dans Filtrer ▾ (corrigé, coque-tel-sessions-filtrer) |
| SES-8 Affichage ▾ : Liste / Par état / Par projet ; tri | ✅ | coque-sessions-affichage ; tri Nom → `?tri=nom` |
| SES-9 tranches datées avec compte | ✅ | Aujourd'hui 3, Hier 2, Cette semaine 7, Plus ancien 1 |
| SES-10 Par projet, groupes repliables | ✅ | coque-sessions-par-projet ; repli par un bouton à côté du lien (corrigé) |
| SES-11 Par état, quatre colonnes | ✅ | coque-sessions-par-etat ; « N de plus » ajouté (`sessionsPage.more`, SessionsPage.tsx:571) |
| SES-12 « Ce qui t'attend » en tête, préfixé du projet | ✅ | « Nimbus · Refactor settings storage » ; étiquette de jalon : `ConversationDto.milestone` (API) |
| SES-13 sélection et gestes en masse | ✅ | barre « 0/1 sélectionnée », Tout, Épingler, Archiver, Supprimer désactivés à 0 ; gestes réels : #233, sessions-ui-check |
| SES-14 états vides | ✅ | « Aucune session ne correspond. », « Aucune session archivée. » ; les deux autres : SessionsPage.tsx:255,260 |
| SES-15 calque de tiroir propre | ✅ | `DrawerLayer` sous la barre (SessionsPage.tsx:354) |

#### 1.8 Portefeuille /projects
| Point | État | Preuve / carte |
|---|---|---|
| PF-1 bande « Projets » + « + Projet » | ✅ | FolderKanban 16 px, aria « Nouveau projet » (coque-portefeuille) |
| PF-2 rangée et comptes | ✅ | Travail ambre, Tableau gris, Jalons rien ; Actions « N à relire » — décidé (#241) : compte comme au projet |
| PF-3 Réglages = bouton, fenêtre de l'instance | ✅ | « Réglages de l'instance » ouvre la fenêtre (coque-pf-reglages) |
| PF-4 plus de Projets/Activité/Journal | ✅ | anciennes adresses → `/projects/travail` (`?vue=moment` pour le journal) |
| PF-5 barre commune, section Projet en tête | ✅ | Projet en tête de Filtrer ▾ sur les 4 vues, puce avec avatar, méta à droite |
| PF-6 ProjectPip | ✅ | avatar + nom dans les listes (coque-pf-tableau-1) |
| PF-7 ProjectGroupHeader | ✅ | « Nimbus 2 » sur Travail, « Nimbus 19 » sur le Tableau |
| PF-8 Aperçu sans barre | ✅ | aucune `[data-toolbar]` |
| PF-9 « Ce qui t'attend » de tous les projets | ✅ | « Nimbus · … », carte à relire ; PR prêtes : pas de cas dans la démo |
| PF-10 projets en grille triée | ✅ | coque-pf-apercu : 3 colonnes à 1440, Nimbus (bord ambre, « 2 t'attendent ») d'abord, jalon en cours + barre, pied |
| PF-11 Code en cours | ✅ | 3 arbres, raison · #carte, agents, liens `?arbre=` ; vide « Rien ne tourne. » (PortfolioCode.tsx:29) |
| PF-12 Derniers événements (8) | ✅ | icône, titre, avatar, ancienneté |
| PF-13 mise en page xl `1fr \| 26rem` | ✅ | grille `680px 416px` à 1440 |
| PF-14 Travail : recherche, Filtrer, méta | ✅ | « Chercher, #12, une branche » ; Projet (worktrees), État ×4 ; « 2 arbres · 1 Mo » |
| PF-15 Affichage : Par projet / Tableau / Par moment | ✅ | + « Montrer : Arbres fusionnés et à nettoyer » |
| PF-16 « Ce qui t'attend » en tête des vues | ✅ | présent sur les trois vues |
| PF-17 Par projet : groupes, table, repli fusionnés | ✅ | coque-pf-travail ; repli des fusionnés : pas de cas dans la démo (#238) |
| PF-18 Tableau : colonnes, Disque réel | ✅ | Projet · Branche · Sessions · PR · Base · Disque · Vu ; tailles réelles (788 ko…) |
| PF-19 Par moment | ✅ | « Jeudi 12 novembre 22 », heure, titre, projet |
| PF-20 Nettoyer · N | ✅ | « Nettoyer · 1 » dans la barre (dialogue non lancé, réel par #238) |
| PF-21 clic arbre → `/p/:id/travail?arbre=` | ✅ | liens vérifiés |
| PF-22 Tableau : recherche, Filtrer, Affichage, couloirs | ✅ | « Chercher, ou #12 » ; T'attend / En retard ; Kanban / Liste ; Aucun / Par projet (défaut) / Par jalon |
| PF-23 Kanban : 4 colonnes, Vide, cap des faites | ✅ | coque-pf-tableau ; libellés « À vérifier » / « Terminé » du Tableau projet |
| PF-24 couloirs par jalon | ✅ code | `lanesOf` (portfolio-board.test.ts) ; non affiché |
| PF-25 Liste | ✅ | état, pastille, `#N titre`, « Jalon #N » ou — |
| PF-26 clic carte → session / fiche | ✅ code | fiche `?fiche=<projet>:<N>` (PortfolioCardSheetHost, #239), board-ui-check |
| PF-27 « + Carte » | ✅ | décidé (#239) : menu « Dans quel projet ? » |
| PF-28 Jalons : recherche, Filtrer, Affichage, méta | ✅ | « Chercher un jalon » ; Projet, Maturité (décidé : modèle de maturité), En retard ; « 8 jalons ouverts » |
| PF-29 Horizon par projet | ✅ | coque-pf-jalons : maturité, `#N`, titre, `0/3`, échéance relative |
| PF-30 Gantt commun | ✅ | coque-pf-jalons-1 : liste figée, axe semaines, barres « 0 % », « auj. » |
| PF-31 clic → `/p/:id/timeline/:n` | ✅ | liens vérifiés |
| PF-32 Actions : recherche, Filtrer, Affichage, méta | ✅ | Projet, Quoi, Quand ; Lanceur / Liste / Agenda ; « 20 actions » |
| PF-33 Tourne maintenant, tous projets | ✅ | 4 éléments vivants + « Page Services » |
| PF-34 Lanceur par projet | ✅ | `LauncherView` par projet |
| PF-35 Liste | ✅ | pastille, `$ commande`, nature, état |
| PF-36 Agenda commun | ✅ | coque-pf-actions-2 |
| PF-37 « + Action » | ✅ | décidé (#241) : « Nouvelle action » mène à l'éditeur du projet |

#### 1.9 Palette
| Point | État | Preuve / carte |
|---|---|---|
| PAL-1 « Toutes les sessions » | ✅ | coque-palette-sessions |
| PAL-2 « Sessions de <projet> » | ✅ | « Sessions de Nimbus » depuis le projet |
| PAL-3 « Voir les N résultats dans Sessions » | ✅ | « for » : « Voir les 4 résultats dans Sessions » → `/sessions?q=for` |

## `projet.md`

#### 1.A Aperçu — variante combo
| Point | État | Preuve / carte |
|---|---|---|
| A-1.1 colonne qui défile, p-4 md:p-6, gap-10, pleine largeur | ✅ | capture projet-a-w-full (largeur 1176 px, pas de plafond) |
| A-1.2 ordre : t'attend → phare → grille code / Actions+Évén. | ✅ | projet-a-w-full ; grille mesurée 704 px + 384 px (24 rem) |
| A-1.3 une seule surface teintée : le phare | ✅ | une seule `bg-surface p-6` ; décidé : `rounded-xl` (DS Rayons.mdx : pas de pas 2xl) |
| A-1.4 rien tant que ça charge | ✅ code | ProjectOverviewPage.tsx:35, CodeInProgress.tsx:17 |
| A-2.1 vide : ✓ vert + « Rien ne t'attend. » | ✅ | Atlas API et Docs (projet-a-w-atlasapi, projet-a-w-docs) |
| A-2.2 en-tête bouton, résumé, point ambre, repli | ✅ | « 2 demandes · 1 à relire », aria-expanded true→false au clic |
| A-2.3 lourdes puis légères | ✅ | 2 sessions puis « Carte #4 à relire » |
| A-2.4 3 lignes, « N de plus » / « Montrer moins » | ✅ code | AskInbox.tsx:31,104 ; travail-ui-check.mjs:173-179 (démo : 3 lignes) |
| A-2.5 ligne lourde : icône+point, titre, indice, puce, âge, geste | ✅ | projet-a-w-inbox-reply ; décidé (#179) : seuils en container queries @sm/@xl |
| A-2.6 une seule réponse dépliée, sur la ligne | ✅ | Répondre puis Voir : la 1re se referme ; projet-a-w-inbox-voir |
| A-2.7 SessionRequestBody / « session s'est arrêtée » + fil | ✅ | Autoriser/Refuser + « Ouvrir le fil → » ; « ⚠ La session s'est arrêtée… » |
| A-2.8 champ : s'agrandit, autofocus, Entrée envoie, Maj+Entrée | ✅ code | AskInbox.tsx:436-470 (field-sizing-content, max-h-32, envoi désactivé si vide) |
| A-2.9 affinage, brouillon, PR de jalon | ✅ code | AskInbox.tsx:341-420 ; checks/milestone-inbox.mjs (#255) |
| A-2.10 ligne légère : point/PR, titre, détail, âge, Relire → | ✅ | « Radar map performance · Carte #4 à relire · 4h · Relire → » |
| A-2.11 openInboxItem : déplie, agrandit, centre | ✅ code | AskInbox.tsx:40-75 ; travail-ui-check.mjs:211 |
| A-2.12 sources réelles, tri des légères | ✅ code | lib/inbox.ts ; apps/server/test/inbox.test.ts |
| A-3.1 sans jalon : « Aucun jalon ouvert… » | ✅ | Docs (projet-a-w-docs) |
| A-3.2 grille 1fr + 17rem, filet à gauche de la colonne | ✅ | projet-a-w-full ; MilestoneBeacon.tsx:90,99 |
| A-3.3 jalon courant par maturité puis numéro | ✅ | « Lancé » #26 passe avant les « Prêt » ; milestone-beacon.test.ts |
| A-3.4 anneau 88 px trait 8, « NN % » et fait/total | ✅ | svg width 88, stroke-width 8 ; « 0 % · 0/3 » |
| A-3.5 « Jalon en cours », maturité, titre lien, échéance, +N | ✅ | « #26 · échéance il y a 3 jours · +1 depuis le lancement » |
| A-3.6 sessions vivantes : compte, pastilles, « +N » / aucune | ✅ | smoke-apercu « 1 session · Offline caching… » ; « Aucune session ne tourne. » |
| A-3.7 vagues : résumé, boîtes, courante, pastilles, flèches | ✅ | « 2 vagues · 2 cartes à la fois au plus », « Vague 1 · 0/2 en cours » ; title « #27 … — À faire » |
| A-3.8 geste suivant ou « ● N t'attend » | ✅ | « → Suivre » + détail ; repère couvert par checks/milestone-inbox.mjs:197 |
| A-3.9 Ensuite / Plus tard, 4 lignes, « Tous les jalons · N livrés » | ✅ | « Ensuite · 4 », « Plus tard · 1 », « Tous les jalons · 1 livré ↗ » |
| A-4.1 vide : « Pas de dépôt git, ou rien en cours. » | ✅ code | CodeGraph.tsx:80 (démo : 3 projets git) |
| A-4.2 lignes 56 px, tronc, rameaux SVG, point par statut | ✅ | hauteur mesurée 56 px ; projet-a-w-bottom |
| A-4.3 statut le plus urgent l'emporte | ✅ | main « session en erreur » (erreur > t'attend) ; code-model.test.ts |
| A-4.4 colonnes fixes, branche, carte+jalon, pile, dérive, PR, ⋯ | ✅ | gabarit 44·1fr·72·88·64·20 px ; « #2 … ⚑ Jalon #11 », « ↑1 ●2 » |
| A-4.5 ordre : racine, avec session, plus récent | ✅ | main, feat/offline-cache (tourne), feat/radar-prefetch |
| A-4.6 vivants seulement ; « + N arbres fusionnés à nettoyer » | ✅ code | CodeGraph.tsx:101-108 → Travail `?etat=cleanup` (démo : 0) |
| A-4.7 clic/Entrée/Espace : gestes, pied | ✅ | Entrée et Espace basculent ; décidé (#173) : diff racine sur place, Nettoyer si sessions au repos |
| A-5.1 « ACTIONS », ce qui vit ou attend | ✅ | service, tâche, 4 à relire |
| A-5.2 ligne : point, libellé, détail, Ouvrir ↗ / Relire / Panneau | ✅ | « service · :5419 · depuis 12 min · Ouvrir ↗ », « Panneau », « Relire » ambre |
| A-5.3 vide « Aucune action… » / « Rien ne tourne. » ; « N autres » | ✅ | Docs, Atlas API ; « 12 autres au repos ↗ » |
| A-5.4 renvois vers l'onglet Actions, `?action=` | ✅ | Relire → /actions?action=a-… |
| A-6.1 titre + lien « Par moment » → Travail ?vue=fil | ✅ | lien « Par moment ↗ » |
| A-6.2 5 lignes 36 px, icône teintée, nature, âge, lien | ✅ | h-9 mesuré 36 px ; décidé (#180) : carte → `?carte=` (éditeur complet) |
| A-6.3 vide « Rien ces quinze derniers jours. » | ✅ code | RecentEvents.tsx:61 (« Rien ces 15 derniers jours. ») |
| A-7 téléphone : une colonne, empilés, colonnes masquées | ✅ | projet-a-p-full, projet-a-p-code-open (dérive au pied), pas de débordement |

#### 1.B Travail — variante une-ligne

##### T-1 La barre sur une ligne
| Point | État | Preuve / carte |
|---|---|---|
| T-1.1 recherche w-36→w-56, ✕, placeholder | ✅ | 144→224 px au focus, « Chercher, #12, branche », « Effacer la recherche » ; filtre le vivant et l'historique (capture projet-t-rien, « Aucune session vivante ne correspond. ») |
| T-1.2 Filtrer : Quoi, État, Jalon, Agent, Période | ✅ | capture projet-t-filtrer (w-80, 8 états, jalons `#n` + `0/3`, Claude Code, Tout·Aujourd'hui·7 j·30 j, « Effacer tous les filtres ») |
| T-1.3 puces actives, ✕, « Arbre : … » (infobulle) | ✅ | capture projet-t-puces, projet-t-fil-arbre (« Arbre : offline-cache », `title` = chemin) |
| T-1.4 bilan « N arbres · X » (≥ xl) | ✅ | « 2 arbres · 560 ko », `hidden xl:inline-flex` |
| T-1.5 « 🗑 Nettoyer · N » → dialogue T-12 | ✅ | décidé (§2.6-7) : le total arbres + branches (`cleanOffer`) ; « Nettoyer · 1 » |
| T-1.6 Affichage : 6 tuiles, index, regrouper, trier, montrer | ✅ | capture projet-t-affichage ; « Affichage : Par arbre » en nom accessible |
| T-1.7 + Session : racine, arbres utilisables, nouveau | ✅ | capture projet-t-session ; radar-prefetch → `/c/new?worktree=<id>` |
| T-1.8 `?vue=`, souvenir par projet, `?arbre=` | ✅ | Frise choisie par tuile → `/travail` rouvre Frise ; filtres et index retenus au rechargement (localStorage `solera.view.travail.*`) |
| T-1.9 défauts d'affichage | ✅ | index, Aucun, Ce qui t'attend, 3 cases cochées (projet-t-affichage) |

##### T-2 Ligne de base
| Point | État | Preuve / carte |
|---|---|---|
| T-2.1 « ⎇ Base main · ✓ la racine y est » | ✅ | toutes les vues ; masquée quand un arbre est choisi (projet-t-fil-arbre) |
| T-2.2 racine sur une autre branche, en ambre | ✅ code | `components/code/BaseLine.tsx`, clés `code.base.rootOff*` ; racine de démo sur main |

##### T-3 L'index
| Point | État | Preuve / carte |
|---|---|---|
| T-3.1 « ○ Tous » (en haut / tout le fil) | ✅ | « Tous · en haut » (Par arbre), « tout le fil » (Par moment) |
| T-3.2 ligne par arbre : point, nom, raison, taille | ✅ | capture projet-t-couloirs-full (racine `main` en gras, `feat/` retiré) |
| T-3.3 « BRANCHES » et `IndexBranch` | ✅ code | `TravailIndex.tsx:66-111` ; démo sans branche non fusionnée |
| T-3.4 « Projet — ce qui ne vit dans aucun arbre » | ✅ | Par arbre seulement, absent du fil |
| T-3.5 défile + anneau 1,6 s / filtre `?arbre=` | ✅ | `ring-2 ring-accent` relevé (projet-t-index-flash) ; fil : `?arbre=…`, ligne surlignée (projet-t-fil-arbre) |

##### T-4 Vue Par arbre
| Point | État | Preuve / carte |
|---|---|---|
| T-4.1 couloirs, sections de regroupement | ✅ | « Jalon #11 · v1.2 — offline et radar 2 », « Sans jalon 1 » ; par état « Branche par défaut / En cours / En suspens » |
| T-4.2 ordre des couloirs | ✅ | racine, arbre vivant, puis le plus récent ; tris dans `laneLayout` (`travail-lanes.test.ts`) |
| T-4.3 en-tête : point, branche, raison, faits, carte, ⋯ | ✅ | capture projet-t-lane ; ⋯ « Session · Diff · Rebaser · Nettoyer » ; `ServiceMark` « ⚡ :37825 » |
| T-4.4 corps : sessions, 3 événements, Plus/Moins | ✅ | « Plus · 4 autres » sur la racine |
| T-4.5 couloir de branche sans arbre et ses gestes | ✅ code | `BranchLane.tsx` (anneau PR, ☁, 3 commits, 5 gestes en ligne) ; `travail-table.mjs` T-6.3 |
| T-4.6 couloir « Projet », 4 lignes + Plus | ✅ | « Plus · 11 autres » |
| T-4.7 « À nettoyer » replié, déplié si filtré | ✅ code | `CouloirsView.tsx`, `travail-ui-check.mjs` étape « À nettoyer » (t10) ; aucun arbre fusionné en démo |
| T-4.8 « Branches fusionnées » + Supprimer | ✅ | capture projet-t-merged (« 1 branche fusionnée · sans arbre, rien à perdre ») |

##### T-5 Vue Par moment
| Point | État | Preuve / carte |
|---|---|---|
| T-5.1 pas de barre propre, marges, jours collés | ✅ | en-têtes de jour `sticky top-0` |
| T-5.2 ligne de base en tête | ✅ | capture projet-t-fil |
| T-5.3 rail, Maintenant : bandeau, demandes, En cours | ✅ | bandeau « #26 … lancé », « En cours 2 » + jalon + puce d'arbre |
| T-5.4 jours, heure, pastilles par famille | ✅ | « Aujourd'hui », « Lundi 2 novembre », heures à gauche ; losange de jalon livré en code (`ActivityRail.tsx:218`) |
| T-5.5 regroupement < 3 h « N événements depuis » | ✅ code | `ActivityRail.tsx:297`, clé `activityRail.cluster` ; démo sans grappe |
| T-5.6 ligne : titre, méta, puce d'arbre qui filtre | ✅ | puce active surlignée, filtre `?arbre=` (projet-t-fil-arbre) |
| T-5.7 chargement auto de l'historique, fin du fil | ✅ | défilement → « Début du fil : un an d'historique. » ; « Plus ancien · au-delà de 14 jours » |
| T-5.8 vides | ✅ | « Aucune session vivante ne correspond. », « Rien dans l'historique ne correspond. » |

##### T-6 Vue Tableau
| Point | État | Preuve / carte |
|---|---|---|
| T-6.1 en-tête en capitales, grille `GRID` | ✅ | capture projet-t-tableau ; `TABLE_GRID` = 1fr 9rem 8rem 5.5rem 5rem 5.5rem 2.5rem |
| T-6.2 ligne d'arbre, ⋯, geste principal au téléphone | ✅ | ligne → tiroir ; Fusionner la PR réelle avec confirmation (décidé §2.6-5), `travail-table.mjs` ; badges externe/conflit en code |
| T-6.3 ligne de branche | ✅ code | `TableView.tsx` `BranchRowLine` ; `travail-table.mjs` T-6.3 |
| T-6.4 regroupements, À nettoyer, fusionnées | ✅ | « 1 branche fusionnée … Supprimer » en pied |
| T-6.5 téléphone : carte bordée par ligne | ✅ | capture projet-t-tel-tableau |

##### T-7 Vue Graphe
| Point | État | Preuve / carte |
|---|---|---|
| T-7.1 graphe GitKraken, tout le dépôt, pagination | 🟡 | capture projet-t-graphe ; « GRAPHE » chevauche « MESSAGE » dans l'en-tête — #252 |
| T-7.2 colonne « Dans Solera » | ✅ | verdict, sessions, `#2`, « Jalon #11 », « ⚡ :37825 » ; « Branche par défaut » |
| T-7.3 choisi net, autres à 35 % | ✅ | `opacity-35 hover:opacity-100` (projet-t-graphe-choisi) |
| T-7.4 période → `since` ; fusionnées sans étiquette | ✅ | `feat/city-search` absente, revient sous « Fusionné » |
| T-7.5 menus d'écriture éteints | ✅ | menu contextuel : gestes `disabled` (`menus.tsx`, `locked`), « Copier le sha » actif |
| T-7.6 clic commit → tiroir large | ✅ | 48 rem, sessions puis `CommitDetail` (projet-t-tiroir-commit) |
| T-7.7 `CommitSessions` : ordre, provenance, réponse | ✅ | « a écrit ce commit · d'après sa branche », « déduit des dates », « a travaillé sur la branche », Répondre sur place |
| T-7.8 puces carte, jalon, PR, 📁 branche | ✅ | « #2 … · Jalon #11 · feat/offline-cache » ; 📁 → tiroir de l'arbre (`travail-graph.mjs`) |
| T-7.9 états : lecture, erreur, pas de dépôt, vide | ✅ code | clés `travail.graph.{loading,noRepo,empty}` |

##### T-8 Vue Par état
| Point | État | Preuve / carte |
|---|---|---|
| T-8.1 quatre colonnes | ✅ | capture projet-t-etat (T'attend 3, Travaille 1, À relire 1, Terminées récemment 3) |
| T-8.2 carte : icône, titre, âge, puce, carte, jalon | ✅ | capture projet-t-etat |
| T-8.3 vides | ✅ code | clés `travail.state.empty.*` |

##### T-9 Vue Frise
| Point | État | Preuve / carte |
|---|---|---|
| T-9.1 axe collant, graduations, « maintenant » | ✅ | 6 nov.–11 nov. + « maintenant » (projet-t-frise) |
| T-9.2 rangée par arbre : barres, points, trait | ✅ | barre ambre sur main, points d'événements |
| T-9.3 rangée par branche sans arbre | ✅ code | `ActivityTimeline.tsx` ; démo sans branche non fusionnée |
| T-9.4 clic sur l'étiquette choisit l'arbre | ✅ | → `?arbre=…feat-radar-prefetch` |
| T-9.5 légende | ✅ | six entrées |

##### T-10 Les verdicts et les genres
| Point | État | Preuve / carte |
|---|---|---|
| T-10.1 verdicts et leurs raisons, ordre | ✅ code | `verdictOf` + `code-model.test.ts` ; vus : racine, en cours, en suspens |
| T-10.2 pastilles | ✅ code | `VERDICT_DOT` (`VerdictDot.tsx`) |
| T-10.3 genres de branche, ordre | ✅ code | `BRANCH_DOT`, clés `code.branchKind.*` |
| T-10.4 états de PR | ✅ code | clés `code.pr.*`, `PR_TONE` |

##### T-11 Tiroir d'un arbre
| Point | État | Preuve / carte |
|---|---|---|
| T-11.1 36 rem, Échap / dehors, titre, sous-titre | ✅ | 576 px ; Échap et clic dehors ferment ; « En cours ⚡ :37825 », « Racine du projet » |
| T-11.2 raison, rangée de gestes | ✅ | Session · Diff · Rebaser · Nettoyer (rouge) |
| T-11.3 faits | ✅ | capture projet-t-tiroir-arbre |
| T-11.4 sessions et derniers événements | ✅ | deux colonnes ; « Rien ces 14 derniers jours. » |

##### T-12 Le dialogue « Nettoyer »
| Point | État | Preuve / carte |
|---|---|---|
| T-12.1 sections cochables, aperçu de 4 noms | ✅ | capture projet-t-nettoyer (section branches seule : aucun arbre à nettoyer en démo) |
| T-12.2 avertissement de perte, ou rien ne se perd | ✅ | « Tout est déjà dans main : rien ne se perd. » ; archives / services d'après le plan réel |
| T-12.3 bouton « Supprimer … », « Rien de coché » | ✅ | décidé (#177) : « jusqu'à X » dans le corps, hors du bouton ; « Supprimer 1 branche » |
| T-12.4 retour « N arbres et M branches supprimés » | ✅ code | clés `travail.clean.removed.*` / `doneFreed` ; pas confirmé (démo) |

##### T-13 Les gestes
| Point | État | Preuve / carte |
|---|---|---|
| T-13.1 gestes d'un arbre ; racine : Session, Diff | ✅ | Diff → session de l'arbre, panneau git ouvert à l'arrivée (projet-t-diff) |
| T-13.2 gestes d'une branche | ✅ code | `useBranchActions` (`BranchLane.tsx:37-62`) |
| T-13.3 retour au même endroit, sous la barre | ✅ code | `TravailNoticeHost` ; rebase vérifié par `travail-table.mjs` |

##### T-14 Divers
| Point | État | Preuve / carte |
|---|---|---|
| T-14.1 « Rien ne correspond… » + Effacer | ✅ | capture projet-t-rien (cadre pointillé) |
| T-14.2 projet sans dépôt | ✅ code | `WITHOUT_GIT` = fil, état ; pas d'index ni de base sans `project.git` |
| T-14.3 tiroir de carte et panneau git montés | ✅ code | `CardSheetHost`, `PanelHost` dans `ProjectTravailPage.tsx`, aucun bouton |
| T-14.4 `overflow-y-auto`, `pb-28`, `scroll-mt-4` | ✅ | classes relevées ; téléphone sans débordement (6 vues) |

#### 1.C Tableau — variante une-ligne
| Point | État | Preuve / carte |
|---|---|---|
| B-1.1 recherche « Chercher, ou #12 », `#12` en préfixe | ✅ | placeholder vu ; « #1 » ne garde que #1, #10, #13, #16–18 |
| B-1.2 Filtrer : Jalon (+ Sans jalon), État, Échéance, Agent | ✅ | projet-b-w-filtrer : « #26 Recette 0/3 … Sans jalon 4 … Claude Code » |
| B-1.3 puces : jalon (infobulle), états, échéance, agent | ✅ | projet-b-w-chips : « #26 Recette » (title « Jalon #26 — … »), « t'attend » |
| B-1.4 Affichage : tuiles, regroupement, Fait, abandonnées, tri | ✅ | projet-b-w-affichage ; Liste : « Le tri de la liste se règle… » |
| B-1.5 « + Carte » au bout → NewCardDialog | ✅ | dialogue « Nouvelle carte » |
| B-1.6 `?vue=` + dernière vue par projet ; filtres non retenus | ✅ | Liste choisie, retour sur /board → « Affichage : Liste » ; BoardPage.tsx:69 |
| B-2.1 feuilles seules ; idée de jalon exclue | ✅ | « Recette — une idée de jalon » (#14) absente des tuiles |
| B-2.2 jalon = ancêtre de haut niveau ; avancement | ✅ code | lib/board-model.ts ; test/board-model.test.ts |
| B-2.3 une teinte par jalon | ✅ | étiquettes teintées ; décidé (#180) : couloirs `--sg-lane-N` du DS |
| B-2.4 sous-tâches, t'attend, sessions vivantes, en retard | ✅ | « avant-hier » en rouge, agent vivant sur #2 ; board-model.test.ts |
| B-3.1 bouton → fiche, bord ambre si t'attend, 60 % si close | ✅ | `?fiche=13` au clic ; Terminé atténué ; BoardTile.tsx:103-104 |
| B-3.2 étiquette de jalon sauf dans les couloirs | ✅ | projet-b-w-kanban vs projet-b-w-lanes |
| B-3.3 titre 2 lignes, drapeaux | ✅ | « à accepter », « à préciser » vus ; `line-clamp-2` |
| B-3.4 pied : #n, sous-tâches, échéance, agents (3 max) | ✅ | « #2 · demain · agent » ; BoardTile.tsx:34,48 |
| B-4.1 colonnes w-72, Fait/Abandonné selon l'affichage | ✅ | 288 px ×3, Terminé 240 px ; libellés de colonnes de l'app (À vérifier, Terminé) |
| B-4.2 tri « Ce qui t'attend » | ✅ | la non acceptée #13 en tête d'À faire |
| B-4.3 Fait étroite, repli en bande verticale 40 px | ✅ | projet-b-w-fait-replie ; KanbanView.tsx:154-163 |
| B-4.4 « Tout voir (N) » → filtre colonne + Liste | ✅ code | board-ui-check.mjs:455-467 (démo : 2 faites) |
| B-4.5 colonne vide « Vide » | ✅ | cellules de couloirs vides ; KanbanView.tsx:196 |
| B-4.6 glisser : colonne éclairée, PATCH réel | ✅ code | KanbanView.tsx:129 ; board-ui-check « glisser persisté » |
| B-4.7 couloirs par jalon, en-têtes collants, Ouvrir le jalon | ✅ | projet-b-w-lanes |
| B-4.8 défilement dans la zone | ✅ | projet-b-w-kanban, projet-b-p-kanban |
| B-5.1 table dense, en-tête collant, tri par en-têtes | ✅ | projet-b-w-liste (« État ↑ ») ; ListView.tsx:117-118 |
| B-5.2 groupes par jalon puis Sans jalon, repliables | ✅ | « v1.1 — la mise en route 2/2 faites »… |
| B-5.3 ligne 40 px, close barrée, sélection, t'attend | ✅ | projet-b-w-liste ; ListView.tsx:189 |
| B-5.4 clavier ↑↓ j/k, Entrée, 1–4 | ✅ | j j Entrée → `?fiche=5` ; 1–4 : board-ui-check (non joué ici) |
| B-5.5 closes selon l'affichage, vide, aide | ✅ code | ListView.tsx:173 ; board-ui-check |
| B-6.1 cinq sections, Lancer, « après #a » | ✅ | projet-b-w-geste (« après #27 », « Lancer ») |
| B-6.2 une seule fois, grille 16 rem, « Rien ici. » | ✅ | GestureView ; board-model.test.ts (gestureSections) |
| B-7 fiche sur place `?fiche=` | ✅ | clic tuile → `?fiche=13`, tableau derrière |
| B-8 téléphone : barre une ligne, Kanban horizontal, geste 1 col. | ✅ | projet-b-p-{kanban,liste,geste}, barre 48 px, rien ne déborde |

#### 1.D Réglages — variante page-gauche
| Point | État | Preuve / carte |
|---|---|---|
| R-1.1 menu 16 rem + contenu ; téléphone : select + loupe | ✅ | nav 256 px ; projet-r-p-top (optgroups Catégorie › Groupe) |
| R-1.2 en-tête « RÉGLAGES » + loupe | ✅ | projet-r-w-top |
| R-1.3 catégories, Zone de danger en bas, pilule, point modifié | ✅ | projet-r-w-draft (point sur Général) |
| R-1.4 défilement suivi, clic fixe, catégorie → 1er groupe | ✅ | clic Agents → « Ce que les agents savent » allumé ; project-settings-ui-check:221-230 |
| R-1.5 contenu max 72 rem, 60vh, titres de catégorie | ✅ code | SettingsPage.tsx:192-203 |
| R-1.6 groupe : titre + une surface légère | ✅ | projet-r-w-draft |
| R-1.7 rangée libellé/aide 22 rem, contrôle ≤ 36 rem, blocs | ✅ | projet-r-w-draft, projet-r-w-agents |
| R-1.8 partagé : bannière lecture seule, Agents réduits | ✅ code | project-settings-ui-check.mjs:534-570 |
| R-2.1 loupe ou `/`, voile, autofocus | ✅ | `/` ouvre « Rechercher un réglage » |
| R-2.2 sans accents, 10 résultats, vide, aide | ✅ | « couleur » → Couleur, Image ; « Aucun réglage pour « … ». » ; settings-search.test.ts |
| R-2.3 choisir → défile et surligne | ✅ | projet-r-w-draft : rangée Couleur surlignée après Entrée |
| R-3.1 brouillon, point par rangée et catégorie | ✅ | Nom modifié : point sur la rangée et sur Général |
| R-3.2 barre flottante « N modification(s) » Annuler/Enregistrer | ✅ | « 1 modification non enregistrée » ; Annuler rétablit « Nimbus » |
| R-3.3 hors brouillon : image, consignes, mémoire, skills… | ✅ code | project-settings-ui-check (« ne passent pas par la barre ») |
| R-4.1 Nom | ✅ | aide « Affiché dans la bande, la sidebar et le portefeuille. » |
| R-4.2 Dossier + Parcourir, bannière si changé | ✅ | rangée vue ; bannière : ProjectSettingsPage.tsx |
| R-4.3 Visibilité Privé · Partagé | ✅ | segment vu |
| R-4.4 Cap | ✅ | « Une phrase, facultative : où va le projet… » |
| R-4.5 Couleur : pastilles, défaut en accent, anneau | ✅ | 9 pastilles ; les couleurs de la démo ne sont pas dans la palette |
| R-4.6 Image : avatar, Changer, Retirer | ✅ | « Changer » (Retirer absent faute d'image) |
| R-4.7 Environnement d'exécution | ✅ | liste « Hôte » |
| R-4.8 Sessions autonomes confinées | ✅ | rangée vue |
| R-4.9 Services des sessions confinées | ✅ code | ProjectSettingsPage.tsx:226 (montrée si le dev container a un compose) |
| R-4.10 Points de reprise : interrupteur | ✅ | rangée vue ; Switch ProjectSettingsPage.tsx:257 |
| R-5.1 « Ce que l'agent demande à Solera » | ✅ | Décisions, Brouillons de cartes, Rangement de carte |
| R-5.2 « Ce que Solera lui prête » | ✅ | Bibliothèque de skills, Mémoire, Serveurs MCP |
| R-5.3 Permissions du CLI : CLI puis rangées du CLI | ✅ | décidé (#243) : avancés montrés seulement s'ils sont déjà changés |
| R-5.4 Modèle par défaut : CLI, modèle, effort, compte, file | ✅ | Modèle + Envoi vus ; effort/compte selon le CLI (LayeredSettings MODEL_KEYS) |
| R-5.5 segment ≤ 3 options courtes, sinon liste ; 🛡 | ✅ | décidé (#243) : seuil 26 caractères ; AgentSettingRows.tsx:37-52 |
| R-5.6 « hérité du compte » / « modifié ici ↺ » | ✅ | « hérité du compte » vu ; ↺ : project-settings-ui-check:261-308 |
| R-6.1 où vivent les consignes, deux cartes radio | ✅ | projet-r-w-agents |
| R-6.2 fichiers à la racine, méta | ✅ | « AGENTS.md absent », « CLAUDE.md absent » |
| R-6.3 ce que lit chaque CLI | ✅ | tableau 4 CLI ; décidé (#244) : OpenCode lit le premier trouvé |
| R-6.4 alertes ambre | ✅ | « Claude Code, Codex, Grok Build et OpenCode n'auront pas les consignes du projet. » |
| R-6.5 partie globale, « La modifier » | ✅ | lien vu |
| R-6.6 édition : titre, lignes · date, rendu, Modifier | 🟡 | textarea 14 lignes vu ; « 0 lignes » au lieu de « 0 ligne »  — #270 |
| R-7.1 phrase d'explication | ✅ | texte vu |
| R-7.2 recherche, filtres par type avec comptes, Nouvelle note | ✅ | « Toutes 2 · Retour 1 · Projet 1 · Nouvelle note » (Docs, notes créées) |
| R-7.3 ligne d'index | ✅ | « 1 note indexée · 1 absente de l'index · 1 ligne sans note · Réparer l'index » |
| R-7.4 notes : type, description, hors index, date, liens | ✅ | projet-r-w-memoire : « Liée à recette-hors · recette-inconnue · à écrire » |
| R-7.5 Supprimer : bandeau + case index | ✅ code | project-settings-ui-check.mjs:452-463 |
| R-7.6 éditeur, création, nom validé | ✅ code | project-settings-ui-check.mjs:466-478 |
| R-7.7 Réparer l'index | ✅ code | project-settings-ui-check.mjs:441-446 ; memory-index.test.ts |
| R-7.8 vides, chargement | ✅ | « Aucune note pour l'instant. » (Nimbus) |
| R-8 skills propres / instance / Ajouter | ✅ | « Aucun skill propre au projet. », « + 0 skill de l'instance… », « Ajouter un skill » |
| R-9.1 Forge › Dépôt des issues | ✅ | « Aucun dépôt relié » + Brancher (éditable, §2.5) |
| R-9.2 Design › Design system | ✅ | « Aucun Storybook lié » + Lier |
| R-10 Zone de danger › Retirer le projet | ✅ | rangée et aide vues ; retrait : project-settings-ui-check:524-532 |
| R-11 disparus : cartes-liens, en-tête, catégorie Actions | ✅ | ni Board, ni Worktrees, ni Actions dans la page |
| §2.5 à garder : dev container dans Exécution | ✅ | rangée « Dev container » (décidé #245) |

#### 1.E Variantes à jeter
| Point | État | Preuve / carte |
|---|---|---|
| Aperçu : VariantA/B/C, widgets, Tiles/Visual/Dense, switcher | ✅ | absents de apps/web/src (git ls-files : aucun fichier prototype) |
| Travail : Empile, Rail, Hybride, Couloirs page, Bascule… | ✅ | absents ; pas de route `/code` (App.tsx:289-300) |
| Tableau : ViewsBoard, TabViewMenu, barre `vues`, menu ▾ | ✅ | absents ; pas de ▾ dans l'onglet Tableau |
| Réglages : variantes, SettingsSections proto, catégorie Actions | ✅ | absents (SettingsSections restant = réglages globaux) |
| Fuchsia : DemoToggle, simulé, `?demo=1`, PrototypeSwitcher | ✅ | aucune occurrence dans apps/web/src |

## `jalons.md`

#### §0 À jeter
| Point | État | Preuve / carte |
|---|---|---|
| Variantes, démo, `Simulé`, `flags.ts`, `?variant=`, `?proto-carte=` | ✅ | aucun `routes/prototype-*`, aucune chaîne trouvée dans `apps/web/src` |
| Anciennes pages Timeline / ProjectMilestonePage / Timeline.tsx | ✅ | fichiers absents |

#### 1.1 Onglet Jalons, barre sur une ligne
| Point | État | Preuve / carte |
|---|---|---|
| BAR-1 barre : recherche, Filtrer, puces, Affichage, + Jalon | ✅ | capture jalons-horizon2 |
| BAR-2 recherche `#11` / `11` sur « numéro titre » | ✅ | jalons-search (`#11` → seul #11) ; suite milestones « BAR-2 » |
| BAR-3 Filtrer : 6 maturités comptées sur tout, retard, effacer | ✅ | jalons-filtre-ouvert (comptes inchangés une fois filtré, « Effacer tous les filtres ») |
| BAR-4 puces par maturité et « en retard », ✕ | ✅ | jalons-filtre-retard (puces « Prêt », « en retard ») |
| BAR-5 Affichage : Horizon/Gantt, échelle Semaine/Mois | ✅ | jalons-affichage ; infobulle « Affichage : Horizon » ; Mois par défaut |
| BAR-6 mémoire de vue (`?vue=`, puis projet) | ✅ | Gantt choisi → `/timeline` nu rouvre le Gantt (`e.out`) |
| BAR-7 « + Jalon » repasse en Horizon et ouvre le tiroir | ✅ | depuis `?vue=gantt` → `?vue=horizon` + tiroir |
| BAR-8 filtre et échelle valent pour le Gantt | ✅ | jalons-gantt-semaine ; suite milestones « BAR-8 » |

#### 1.2 Horizon
| Point | État | Preuve / carte |
|---|---|---|
| CAP-1 cap affiché, sur-titre CAP, crayon | ✅ | jalons-cap ; suite « CAP-1..3 » |
| CAP-2 « + Ajouter un cap » | ✅ | jalons-horizon2 |
| CAP-3 édition en place, focus, espaces coupés, vide = retrait | ✅ | jalons-cap-edition (focus auto, placeholder) ; « Une météo… » enregistré sans espaces ; vider : suite |
| HOR-1 chaîne de 6 cases, 3 col. au tél., comptes filtrés | ✅ | jalons-horizon2, jalons-tel-horizon, jalons-filtre-retard (tout à 0) |
| HOR-2 Maintenant : en mouvement, non livrés d'abord, vide | ✅ | #11, #26 puis #12 livré ; vide vu sous filtre |
| HOR-3 axe daté : colonne 280/150 px, 52 px, aujourd'hui centré | 🟡 | au téléphone les mois se chevauchent et « auj. » les couvre (jalons-tel-axe)  — #272 |
| HOR-4 ligne : #N, titre, ℹ, pastille, « +N depuis le lancement » | ✅ | jalons-horizon2 ; infobulle « #29 Recette L3 — ajoutée après » |
| HOR-5 barre : part faite, bord accent, fait/total, %, vivantes | ✅ | « 0/3 0 % • 1 » (#11) ; « N t'attend » : suite « HOR-4..7 » |
| HOR-6 trait du lancement | ✅ | `[data-launch]` sur #26 |
| HOR-7 losange rouge/vert/gris, hachures de retard | ✅ | #26 rouge + hachures, #12 vert (jalons-horizon2) |
| HOR-8 survol : surlignage, 40 %, infobulle complète | ✅ | jalons-horizon-survol-lance (Lancé, « 2 j de retard », +1) |
| HOR-9 Ensuite : À régler/Prêt par position, vide | ✅ | #15, #19, #22 ; indice « prêts ou à régler » (décidé : À régler = ex-Découpé) |
| HOR-10 Plus tard : Idée/À affiner, vide | ✅ | #14 (puis #30) ; « Pas d'idée en réserve. » |
| HOR-11 tuile de vague : rang, pastille, échéance, traits, action | 🟡 | « échéance dans 19 jours » pour le 2 déc. (20 j au calendrier) : arrondi de `relativeDate`  — #271 |
| HOR-12 une idée a sa page, l'affinage part de là | ✅ | tuile #14 → `/timeline/14` (jalons-page-14) |
| HOR-13 téléphone : une colonne, seul l'axe défile | ✅ | `scrollWidth` 390 = largeur (jalons-tel-horizon) |

#### 1.3 Vue Gantt détaillé
| Point | État | Preuve / carte |
|---|---|---|
| GNT-1 défilant 2 sens, colonne 296/170 px, en-tête collé | ✅ | jalons-gantt2, jalons-tel-gantt |
| GNT-2 échelle calée sur lundis, Semaine 30 px/j, Mois ajusté | ✅ | jalons-gantt2, jalons-gantt-semaine ; test milestone-gantt |
| GNT-3 axe deux étages, S{n} quantième, jours, « auj. » | 🟡 | ok au large ; au téléphone « Octobre » chevauche le mois suivant sous « auj. » (jalons-tel-gantt)  — #272 |
| GNT-4 grille : week-ends, lundis, trait d'aujourd'hui | ✅ | jalons-gantt-semaine |
| GNT-5 groupes par échéance, idées exclues, « Hors jalon » | ✅ | ordre #12, #26, #11, #15, #22, #19 puis Hors jalon (#1, #3) |
| GNT-6 défilement initial centré sur aujourd'hui | ✅ | jalons-gantt-semaine |
| GNT-7 en-tête : chevron, drapeau, titre lien, « lancé », livré replié | ✅ | v1.1 replié, badge « lancé » (jalons-gantt2) ; suite « GNT-7 » |
| GNT-8 barre de jalon : états, retard, pointillé, halo, % | ✅ | jalons-gantt2 ; suite « GNT-8 » |
| GNT-9 ligne de carte : pastille, #N, ℹ, repères, échéance | ✅ | #4 « 11 nov. » en rouge ; destinations : suite « GNT-9 » |
| GNT-10 barre de carte, titre dedans/à côté, jamais tronqué | 🟡 | au téléphone le titre posé à gauche passe sous la colonne collée (« — premier », jalons-tel-gantt)  — #273 |
| GNT-11 survol : chaîne, 30 %, infobulle « Clic : ouvrir… » | ✅ | jalons-gantt-semaine (infobulle #27) |
| GNT-12 flèches « bloque » en coudes | ✅ | #27→#28, #16→#17→#18 (jalons-gantt2) |
| GNT-13 vide « Aucun jalon ni carte datée » | ✅ code | suite milestones « GNT-13 » |

#### 1.4 Modèle : maturité, prochaine action, raisons
| Point | État | Preuve / carte |
|---|---|---|
| MAT-1 six étapes, « À régler » (clé `split`), tons | ✅ | chaîne et pastilles ; test milestone-model « MAT-1 » |
| MAT-2 règle dans l'ordre | ✅ | #14 Idée, #15/#19 À régler, #22 Prêt, #26 Lancé, #12 Livré ; tests « MAT-2 » |
| MAT-3 idée : drapeau, sans parente ni enfant | ✅ | #14, #30 ; test « MAT-3 » |
| MAT-4 cycle interne au jalon | ✅ code | tests « MAT-4 » (le serveur refuse un cycle direct : 409 `card_block_cycle`) |
| MAT-5 analyse (toClarify, notAccepted, startable…) | ✅ code | test « MAT-5 » |
| MAT-6 prochaine action, libellé + détail | ✅ | « Préciser / 1 carte à préciser », « 1 à accepter », « Lancer / 2 cartes… », « Suivre / 0/3 fusionnées · +1… », « 2 cartes livrées. » |
| MAT-7 raisons et règles | ✅ | popover « 1 carte est à préciser : #18. » + règle de sortie |
| MAT-8 pastille + infobulle « étape — raison » | ✅ | infobulle « Prêt — 3 cartes peuvent partir… » (jalons-horizon-survol) ; test « MAT-8 » |
| MAT-9 six traits, aria « Maturité : {étape} » | ✅ | tuiles (jalons-horizon2) ; clé `milestones.maturity.aria` |
| MAT-10 état d'une carte, Bloquée si bloqueur ouvert | ✅ | #17, #24, #28 « Bloquée » ; test card-state |
| MAT-11 repère ambre `awaitsMe` | ✅ code | test « MAT-11 » ; aucune carte de jalon n'attend dans la démo |
| MAT-12 demandes de jalon pour « Ce qui t'attend » | ✅ code | tests « MAT-12 » (décidé : la session bloquée reste dans la liste, étiquetée) ; #255 |

#### 1.5 Tiroir « Nouveau jalon »
| Point | État | Preuve / carte |
|---|---|---|
| CMP-1 tiroir commun large, Échap ferme | ✅ | largeur 768 px (jalons-composer-pieces), Échap ferme |
| CMP-2 en-tête, titre tiré du texte, indices, ✕ | ✅ | « Sans titre » puis « Mode hors-ligne complet » + « Titre tiré de ton texte… » |
| CMP-3 zone 12 lignes, placeholder-exemple, échéance à droite | ✅ | jalons-composer-vide |
| CMP-4 pièces jointes avec Réf./Inclure | ✅ | jalons-composer-pieces |
| CMP-5 échéance : date courte + ✕ « Retirer l'échéance » | ✅ | « 12 déc. 2026 » + ✕ |
| CMP-6 pied : Entre en + pastille + phrase, Repéré | ✅ | « objectif, 3 étapes, 1 hors champ, 1 point ouvert, 3 liens, 2 fichiers » |
| CMP-7 trois gestes, principal selon le brief, `Ctrl↵` | ✅ | Ctrl sur « Affiner » (phrase) puis sur « Découper » (brief) |
| CMP-8 désactivations et leurs infobulles | ✅ | trois désactivés à vide ; infobulles : suite « CMP-8 » |
| CMP-9 aperçu au survol d'un geste | ✅ | survol « Noter » → Idée + « Aucune session ne part… » (jalons-composer-survol-noter) |
| CMP-10 phrase de l'agent | ✅ | les trois variantes vues, dont « …après une question sur ce qui reste ouvert » |
| CMP-11 `Ctrl+Entrée` = geste principal | ✅ code | suite « CMP-11 » et brief-field « CMP-11 » |
| CMP-12 Réf./Inclure dans la puce | ✅ | jalons-composer-pieces ; suite « CMP-12 » |
| CMP-13 Noter l'idée : carte drapeautée, message | ✅ | « Idée notée : #30, dans « Plus tard »… » (jalons-idee-notee) |
| CMP-14 Affiner/Découper ouvrent la session d'affinage | ✅ code | suite « CMP-11, CMP-14, CMP-15 » ; `lib/refinement.ts:38` (`/affiner-un-jalon #N --decouper`, décidé : skill) |
| CMP-15 ce que la création écrit | ✅ code | suite (drapeau, échéance, relation, enfant, pièce) |
| CMP-16 brouillon gardé à la fermeture | ✅ | décidé (Q5) : texte retrouvé après Échap et réouverture |

#### 1.6 Zone d'écriture commune
| Point | État | Preuve / carte |
|---|---|---|
| WRT-1 un seul cadre, texte puis barre | ✅ | jalons-composer-pieces |
| WRT-2 surlignage `#N` connu | ✅ | `#29` sur fond d'accent |
| WRT-3 hauteur jusqu'à 384 px puis défile | ✅ code | suite brief-field « WRT-3 » |
| WRT-4 autocomplétion `#` : 6, ordre, colonne, pied, aria | ✅ | jalons-composer-diese ; `aria-autocomplete=list` |
| WRT-5 clavier ; Échap retire le `#` seul, sans fermer | ✅ | « …#29 et # » → « …#29 et », tiroir ouvert |
| WRT-6 coller : URL seule → puce, rien dans le texte | ✅ | « Issue #77 » ajoutée, texte inchangé |
| WRT-7 déposer, voile « Dépose pour joindre » | ✅ code | suite brief-field « WRT-7 » |
| WRT-8 barre : #, lien, trombone + infobulles | ✅ | jalons-composer-pieces ; infobulles : suite brief-field |
| WRT-9 champ de lien en place, `https://` ajouté | ✅ | placeholder « Colle ou tape une adresse, puis Entrée » ; `github.com/…` → PR #212 |
| WRT-10 retirer la puce retire la mention | ✅ code | suite brief-field « PJ-2, WRT-10 » |

#### 1.7 Pièces jointes
| Point | État | Preuve / carte |
|---|---|---|
| PJ-1 « Joint · N », invisible à 0 | ✅ | « Joint · 6 », absent à vide |
| PJ-2 puce : ✕, « Retirer … », ⌫/Suppr | ✅ | libellés « Retirer #29 », « Retirer PR #212 »… ; ⌫ : suite |
| PJ-3 carte : # numéro titre, infobulle, Réf./Inclure | ✅ | jalons-composer-pieces |
| PJ-4 lien : « PR #212 acme/nimbus », « Offline first guide » | ✅ | idem, + « Issue #77 » |
| PJ-5 fichier : vignette ou icône, taille « 66 o », « 12 Ko » | ✅ | idem |

#### 1.8 Lecture du brief
| Point | État | Preuve / carte |
|---|---|---|
| BRF-1 étapes, contraintes, hors champ, objectif, points ouverts | ✅ | Repéré du brief d'essai ; test brief |
| BRF-2 mots comptés | ✅ code | test brief « les mots se comptent » |
| BRF-3 suffisant : 2 étapes ou objectif + 60 mots | ✅ | « Découper » activé par le brief, pas par la phrase ; test brief |
| BRF-4 `titleFromBrief`, `announce` | ✅ | titre « Mode hors-ligne complet » ; tests « titre : … » |

#### 1.9 Page d'un jalon
| Point | État | Preuve / carte |
|---|---|---|
| JAL-1 `/timeline/:n`, sinon « #N n'est pas un jalon » | ✅ | #13 (enfant) et #999 (jalons-page-13, -999) |
| JAL-2 « ← Jalons » vers la vue mémorisée | ✅ | retour depuis #22 → Gantt retenu |
| JAL-3 en-tête : drapeau, titre, ℹ, pastille, échéance, +N | 🟡 | « échéance 10 nov. · il y a 3 jours » quand l'infobulle dit « 2 j de retard » (arrondi de `relativeDate`)  — #271 |
| JAL-4 bande « PROCHAINE ACTION », bouton (absent si Livré) | ✅ | jalons-page-15 ; #12 sans bouton |
| JAL-5 étapes expliquées, popover, téléphone « pourquoi ? » | ✅ | jalons-page-15-etape (3/6, raisons, règle, bouton) ; « Il y sera quand » ; jalons-tel-etape |
| JAL-6 geste de la prochaine action | ✅ | « Préciser » fait défiler vers `#affinage` ; test « JAL-6 » |
| JAL-7 mise en page : téléphone ordonné, Lancer collé à droite | ✅ | tél. #15 : affinage, vagues, Lancer ; #26 : vagues, Lancer, affinage ; large : 2 colonnes |
| JAL-8 l'affinage en tête quand il attend | ✅ | #15/#19 en tête, #22/#26 en bas ; test « JAL-8 » |

#### 1.10 Vagues
| Point | État | Preuve / carte |
|---|---|---|
| VAG-1 titre + « N à la fois » (pilotage, sinon Lancer) | ✅ | « 3 », « 2 » (pilotage #26), « 5 » après choix dans Lancer |
| VAG-2 vide « Pas encore découpé… » | ✅ | jalons-page-14 |
| VAG-3 étages, abandonnées exclues | ✅ | #16 / #17 / #18 en 3 vagues |
| VAG-4 colonnes égales, ouvertes puis numéro | ✅ | jalons-page-15 ; test « VAG-3, VAG-4 » |
| VAG-5 en-tête « VAGUE N », passes/en parallèle, barrettes | ✅ | « 1 ouverte · en parallèle », « terminée » (#12) |
| VAG-6 nœud : état, « par #N », « ajoutée », échéance, teintes | ✅ | « Bloquée par #16 » (ambre, comme le proto), « ajoutée » (#29) |
| VAG-7 arêtes en coudes, pointillé, cycle rouge | ✅ | jalons-page-15 ; cycle : suite « page » |
| VAG-8 survol : chaîne en accent, reste pâli | ✅ | chaîne #16→#18 éclairée (jalons-vagues-survol) ; pâli : suite |
| VAG-9 étroit : vagues empilées | ✅ | jalons-tel-vagues |
| VAG-10 « Ajoutées depuis le lancement : #29 » | ✅ | jalons-page-26 |

#### 1.11 Session d'affinage en place
| Point | État | Preuve / carte |
|---|---|---|
| AFF-1 en-tête, état (t'attend/travaille/terminée/pas lancée), mode | ✅ | « pas encore lancée » (#14), « terminée » (#15) ; autres : suite « affinage » |
| AFF-2 pas lancée : deux gestes, texte du skill | ✅ | jalons-page-14 (décidé : skill `/affiner-un-jalon`) |
| AFF-3 lancée : « Ouvrir la session ↗ » | ✅ code | suite « affinage » |
| AFF-4 terminée sans brouillon : texte | ✅ | « Le jalon est découpé. « Ajouter au jalon »… » |
| AFF-5 dernière activité, questions, « Répondre ici » | ✅ code | suite (réponses gardées puis envoyées ensemble) |
| AFF-6 brouillon éditable puis validé | ✅ code | suite (renommer, monter, lier, ajouter, retirer, valider) |
| AFF-7 ajout proposé : sous-tâche ou cartes | ✅ code | suite « à régler et ajout » |

#### 1.12 « À régler avant de partir »
| Point | État | Preuve / carte |
|---|---|---|
| RGL-1 titre + « N point en attente », absent si vide | ✅ | #15, #19 ; absent sur #22 |
| RGL-2 session bloquée recopiée | ✅ | décidé §2.6-1 : non reproduite (aucune chaîne) ; repère ambre + « Ce qui t'attend » |
| RGL-3 carte à préciser : champ « La précision attendue » | ✅ | #18 « à préciser depuis 8min » (jalons-page-15) |
| RGL-4 carte non acceptée : « Accepter » | ✅ | #13 (jalons-page-19) |
| RGL-5 cycle : « #a bloque #b », « retirer ce lien » | ✅ code | suite « rompre le cycle » |
| RGL-6 après réponse : ce qui est parti, puis disparaît | ✅ code | suite (« Envoyée à la session », « Ajoutée à la description ») |

#### 1.13 Tiroir « Ajouter au jalon »
| Point | État | Preuve / carte |
|---|---|---|
| ADD-1 tiroir normal, sur-titre, « #22 titre », ✕ | ✅ | jalons-ajouter |
| ADD-2 zone 8 lignes, placeholder, sans Réf./Inclure | ✅ | placeholder exact ; puce #23 sans segment |
| ADD-3 pied : phrases, Repéré, Annuler / Proposer `Ctrl↵` | ✅ | jalons-ajouter-texte |
| ADD-4 envoi à la session d'affinage | ✅ code | suite (session, sinon brouillon pré-rempli) |

#### 1.14 Panneau Lancer
| Point | État | Preuve / carte |
|---|---|---|
| LCH-1 Livré : cadre vert, « N cartes fusionnées » | ✅ | #12 ; « PR du jalon fusionnée. » ajouté quand il y a une PR (clé `deliveredPr`) |
| LCH-2 pas de cartes : « Rien à lancer… » | ✅ | #14 |
| LCH-3 en-tête « Lancer · à la main ou autonome… » | ✅ | jalons-page-15 |
| LCH-4 mode : À la main (défaut) / Autonome | ✅ | radiogroupe, À la main coché |
| LCH-5 environnement | ✅ | décidé §2.6-2 : Hôte / Hôte confiné seulement, « L'emplacement suit le projet. Réglages » |
| LCH-6 Autonome confine d'office | ✅ | « Hôte confiné » coché au passage en Autonome |
| LCH-7 à la main : texte, cartes, « Lancer » / « attend » | ✅ | #23 Lancer, #24 attend |
| LCH-8 lancer une carte à la main | ✅ code | suite « lancer » ; `milestone-runs.ts` `launchByHand` (non tiré : il ouvrirait une session) |
| LCH-9 autonome : concurrence, branche, CLI, services | ✅ | jalons-lancer-auto (décidé §2.9 : CLI du projet ; services en lecture, code) |
| LCH-10 avertissement non confiné | ✅ code | suite « avertissement » |
| LCH-11 vérifications, échecs d'abord | ✅ | « Prêt à partir », 5 lignes ; échecs : suite |
| LCH-12 « Lancer en autonome », désactivé si échec | ✅ | vu ; quota « 5 sessions à la fois… » (décidé §2.9) |

#### 1.15 Suivi d'un jalon lancé, PR finale
| Point | État | Preuve / carte |
|---|---|---|
| RUN-1 cadre, point, « Lancé à la main », « depuis » | ✅ | jalons-suivi |
| RUN-2 bascule de mode en cours de route | ✅ | segment À la main / Autonome (jalons-suivi) |
| RUN-3 ligne d'état, branche | ✅ | « Tu lances les cartes… · branche jalon/26-… » ; places modifiables : suite (décidé §2.9) |
| RUN-4 case de confinement | ✅ | jalons-suivi |
| RUN-5 cartes : statut, lien, ℹ, « Lancer » à la main | ✅ | #27/#29 Lancer, #28 « attend ses bloqueurs » ; raison en infobulle : suite |
| RUN-6 ajouter une carte | ✅ | champ + « Ajouter » désactivé vide ; #29 ajoutée par l'API → « +1 depuis le lancement » |
| RUN-7 Pause / Reprendre, Arrêter | ✅ | « Pause », « Arrêter » (jalons-suivi) ; confirmation : suite |
| RUN-8 « Seuls les blocages te reviennent… » | ✅ | jalons-suivi |
| RUN-9 PR finale : « Fusionner dans main », « Ouvrir la PR » | ✅ code | suite « PR finale ouverte » (décidé §2.6-4) |
| RUN-10 blocages dans « Ce qui t'attend » étiquetés « Jalon #N » | ✅ code | #255 ; test « MAT-12 » |
| RUN-11 carte ajoutée entre dans la file | ✅ | #29 « en file » dans `GET /api/cards/:id/milestone` |
| RUN-12 fusionner → Livré | ✅ code | test « MAT-2 … PR » ; suite (aucune vraie fusion) |

#### 1.16 Fiche de carte sur place et drapeau
| Point | État | Preuve / carte |
|---|---|---|
| FCH-1 ℹ sur chaque carte, n'ouvre pas la session | ✅ | tuile #22 → `?fiche=22`, ligne Gantt #16 → `?fiche=16`, sans navigation |
| FCH-2 `?fiche=N` partageable | ✅ | `/timeline/22?fiche=23` rouvre la fiche |
| FCH-3 en-tête : #N, état, « Jalon #P », échéance | 🟡 | jalons-fiche-2 : « demain » pour le 14 nov. (arrondi de `relativeDate`)  — #271 |
| FCH-4 la demande et la réponse sur place | ✅ code | suite « fiche » |
| FCH-5 sessions : agent, titre, branche, état en mots | ✅ | « Add offline caching… feat/offline-cache tourne » ; vide « Aucune session… » |
| FCH-6 sous-tâches x / y | ✅ code | suite « sous-tâches » |
| FCH-7 liens qui changent de fiche | ✅ | « Bloque #24 » (jalons-fiche-23) ; changement : suite |
| FCH-8 description, notes récentes | ✅ | jalons-fiche-2 ; « 3 sur N » : suite |
| FCH-9 pied : Ouvrir la session / Lancer, tableau, case | ✅ | fiches 2 et 23 |
| FLG-1 case « C'est un jalon » : d'office, grisée, cochable | ✅ | #22 cochée grisée, #23 grisée, #7 cochée → Plus tard, décochée |
| FCH-10 destination d'un clic sur une carte | ✅ | vagues #11 : #2/#4 → leur session, #10 → `/c/new?card=` ; test « FCH-10 » |

#### Questions ouvertes pour Tim
| Point | État | Preuve / carte |
|---|---|---|
| Q1 §2.6 : pas de recopie, env. du projet, services, fusion | ✅ | tranché comme proposé (voir RGL-2, LCH-5, LCH-9, RUN-9) |
| Q2 §2.9 : CLI, concurrence en cours, quota, raison, pied | ✅ | tranché comme proposé (LCH-9, RUN-3, LCH-12, RUN-5 ; pas de pied) |
| Q3 skill ou briefing serveur | ✅ | décidé : skill `/affiner-un-jalon` (#182, #184) |
| Q4 carte drapeautée rangée sous une parente | ✅ | le drapeau se lève (#31 → `milestone: false`) |
| Q5 garder le brouillon du composer | ✅ | gardé par projet (CMP-16) |

## `actions.md` — 1.A à 1.J

#### 1.A Le modèle Quoi × Quand
| Point | État | Preuve / carte |
|---|---|---|
| MOD-1 un seul objet Automation (Quoi × Quand, runs, live…) | ✅ | actions et tâches mêlées dans Lanceur, Liste, Agenda ; `lib/automations.ts` (ids `a-` / `t-`) ; capture actions-lanceur-full |
| MOD-2 fromAction : live service, review, failStreak | ✅ | « En marche · :5419 », « proposée dans « Add offline… » », « 2 échecs d'affilée » ; capture actions-liste |
| MOD-3 fromTask : live, review du script, failStreak jugé | ✅ | « script de vérification à valider », « Sautée » hors du compte d'échecs ; « 2 échecs d'affilée » sur Rapport d'instance (failed + timed_out) |
| MOD-4 UnifiedRun (statut, code, extrait, session) | ✅ | détails Purge (code 2 + extrait), CLI release watch (« réussi » + Session) ; actions-det-purge, actions-det-cli |
| MOD-5 actions + tâches du projet (démo retirée) | ✅ | décidé §0 : commandes planifiées de démo jetées, les vraies (Sauvegarde, Purge) passent par AC-03 |
| MOD-6 ago : « N min », « N h », « N j » | ✅ | « il y a 3 min », « il y a 1 j », « depuis 15 min » |

#### 1.B Onglet Actions du projet
| Point | État | Preuve / carte |
|---|---|---|
| Route /p/:id/actions dans la coque, entre Jalons et Réglages | ✅ | capture actions-lanceur ; compte ambre « 3 à relire » |
| AO-1 recherche : libellé, commande, prompt, sessions | ✅ | « python » → 4 tuiles + 1 processus ; « changelog » (prompt) → CLI release watch ; titre de session trouvé |
| AO-2 Filtrer ▾ : Quoi / Quand / État, comptes, OU/ET | ✅ | capture actions-filtre-actif ; Agents+Commandes ET En échec → 3 tuiles ; pastille « 1 » ; « Effacer tous les filtres » |
| AO-3 puces de filtre avec ✕ | ✅ | ✕ d'une puce retire ce seul filtre |
| AO-4 « ● N en marche » / « ● N à relire » cliquables | ✅ | clic → puce En cours / À relire ; pulse `motion-safe:animate-pulse` (ActionsStatusMeta.tsx:44) ; masqué au téléphone |
| AO-5 Affichage ▾ Lanceur · Liste · Agenda, Période, aide | ✅ | captures actions-affichage, actions-affichage-agenda ; vue retenue par projet ; icône seule au téléphone (« Affichage : Lanceur ») |
| AO-6 « + Action ▾ » : 4 entrées + aides, 18 rem | ✅ | capture actions-nouvelle-menu (288 px) |
| AO-7 ?action= / ?nouvelle= dans les deux sens | ✅ | ?action=a-<id> ouvre, Échap retire ; ?nouvelle=service ouvre l'éditeur, fermer retire ; ?nouvelle=planifier → choix |
| AO-8 pleine largeur, gouttière 16/24 | ✅ | x = 24 px au large, 16 px au téléphone |
| LAN-1 groupes Sessions, Services, Commandes, Agents | ✅ | capture actions-lanceur-full ; en-têtes sobres, groupes vides gardés avec leur tuile d'ajout |
| LAN-2 tuiles égales 16,5 rem, 9,5 rem, gap 12, 1 col tél. | ✅ | 18 tuiles 273×152 px, gap 12 px ; 1 colonne à 390 px ; 18 rem en 2xl (LauncherGroup.tsx:12) |
| LAN-3 tuile d'ajout pointillée → éditeur pré-réglé | ✅ | « + Nouveau service / commande / tâche d'agent » |
| LAN-4 StateIcon, point d'état, libellé, phrase colorée, ⋯ | ✅ | vert / gris / rouge / ambre vus ; capture actions-lanceur |
| LAN-5 actionState, une phrase partout | ✅ | « À relire — … », « En marche · :5419 · depuis 3 min », « Arrêté », « 2 échecs d'affilée », « Jamais lancée », « Réussie · il y a 3 min » |
| LAN-6 corps : « sert … », prompt ou $ commande, cadence | ✅ | « sert la racine (main) @ b090558 », « ⏰ À 03:00, uniquement le dimanche » |
| LAN-7 un seul geste en bas à gauche selon l'état | ✅ | Relire (ambre), interrupteur « Arrêter « Serveur de dev » », Servir…, Ouvrir ↗, Terminal, Lancer ▾ ; liserés accent et ambre |
| LAN-8 menu ⋯ (pas de Modifier si à relire) | ✅ | Sauvegarde : Modifier la planification ; Déployer : Voir / Dupliquer / Supprimer ; service : + Redémarrer, Suivre le journal (Q1) |
| LAN-9 Lancer ▾ : racine + worktrees ; 44/36 px | ✅ | capture actions-lancer-dans (racine, feat/offline-cache, feat/radar-prefetch) ; 36 px au large, 44 px au téléphone ; décidé Q6 : pas de chevron pour un agent |
| LST-1 sections En cours · Sessions · À relire · Planif. · Demande | ✅ | capture actions-liste ; aides présentes, sections vides masquées |
| LST-2 ligne : icône, libellé, KindChip, détail, « sert » | ✅ | « Commande · service » + « à la demande + planifiée » ; ligne ≥ 56 px (77 px au tél.) |
| LST-3 gestes à droite selon la section | ✅ | Ouvrir + Arrêter, Terminal, Relire, Planifier + Lancer ▾ |
| LST-4 ScheduleFacts : échecs, cadence, échéance, 10 pastilles | ✅ | « ⚠ 3 échecs d'affilée », « dans 3 j », pastilles colorées ; capture actions-liste |
| LST-5 état vide sans mention de démo | ✅ code | `actionsTab.empty` (catalog-fr.ts:4402) ; projet non vide ici |

#### 1.C Le tiroir unifié d'une action
| Point | État | Preuve / carte |
|---|---|---|
| TIRA-1 un tiroir, 3 modes, large, libellé selon le mode | ✅ | aria-label « Tests », « Modifier « Tests » », « Nouvelle action », « Planifier une action existante » |
| TIRA-2 Modifier bascule le même tiroir ; Annuler y revient | ✅ | Modifier → éditeur, Annuler → détail « Tests » ; Dupliquer → Annuler → détail |
| TIRA-3 mode inline du panneau, Échap d'un niveau | ✅ code | `ActionChromeProvider inline` (ActionDrawer.tsx, story « Dans le panneau ») ; recette du panneau en 1.K |
| TIRA-4 mises en page selon le conteneur | ✅ code | `@container/action` (ActionDrawer.tsx:92, ActionEditor.tsx:242) |
| TIRA-5 en-tête : icône, libellé, puces nature/quand/extras | ✅ | « Commande · tâche · À 03:00 (en pause) », « à relire », « nouvelle » / « modification » |
| TIRA-6 corps en blocs titrés, pied collant | ✅ | captures actions-det-* (Dupliquer / Supprimer à gauche, principal à droite) |
| TIRA-7 mode pick : liste, ⏰ Planifier, vide, Annuler | ✅ | texte actions-pick (« Pas encore planifiées · 10 ») ; vide `actionDrawer.pick.empty` |

#### 1.D Le détail d'une action
| Point | État | Preuve / carte |
|---|---|---|
| DET-1 état en une phrase sur fond teinté | ✅ | ambre (Build), rouge (Purge), neutre ; « Le service est arrêté. », « Planification en pause… », « Jamais lancée. » |
| DET-2 geste principal (Ouvrir+Arrêter, Démarrer, Terminal…) | ✅ | actions-det-dev, -story, -watch ; « Lancer » direct depuis une conversation : ✅ code (`launchWhere`) |
| DET-3 ouvert par Relire : placé sur la relecture | ✅ code | `scrollIntoView` (ActionDetail.tsx:142) ; bloc en tête de toute façon |
| DET-4 relecture : texte, diff −/+, Valider / Refuser | ✅ | capture actions-relire-build ; décidé Q3 : Valider sans lancer (vérifié), Refuser supprime une neuve (vérifié) |
| DET-5 Ce qu'il sert (service en marche) | ✅ | capture actions-srv-block |
| DET-6 Quoi : prompt + CLI, vérification, $, Dossier, Lien, Note | ✅ | actions-det-nightly (« à valider »), actions-det-dev (Lien), actions-det-tests (Note) |
| DET-7 Quand : 2 lignes à point, cadence, 3 prochains | ✅ | actions-det-purge (« Pas à la demande… », 3 dimanches) |
| DET-8 Passages : frise, liste, extrait déplié d'office | ✅ | actions-det-purge ; vide « Aucun passage pour l'instant. » sans mention serveur |
| DET-9 Origine : proposée par un agent / créée par toi | ✅ | lien vers « Add offline caching for forecasts » ; « Créée par toi · jeu. 12 nov. » |
| DET-10 Dupliquer « (copie) », Supprimer confirmé sur place | ✅ | « Tests (copie) » ; capture actions-det-suppr |
| DET-11 pause / reprise reflétées tout de suite | ✅ | capture actions-det-backup-pause (puce, phrase, « — en pause », prochains passages retirés) |

#### 1.E L'éditeur unifié
| Point | État | Preuve / carte |
|---|---|---|
| EDI-1 graines from / schedule / preset / prefill | ✅ | Modifier, Planifier (Planifiée cochée), ?nouvelle=service, « En faire une action » |
| EDI-2 en-tête vivant, « Nouvelle action », nouvelle/modif | ✅ | titre « Recette éditeur » en direct |
| EDI-3 1 · Quoi : cartes Commande / Agent | ✅ | capture actions-edi-service ; décidé Q5 : nature figée en modification (« Dupliquer pour en changer ») |
| EDI-4 « Trouvé dans le dépôt » : un clic remplit tout | ✅ | npm run dev → commande, lien, libellé, nature Service ; infobulle `Tooltip` (ActionEditor.tsx:676) ; #207 à vérifier |
| EDI-5 Nature : Tâche / Service en petites cartes | ✅ | capture actions-edi-service |
| EDI-6 Commande $ 1–4 lignes, « ex. pnpm test », erreur | ✅ | textarea, erreur « La commande à lancer. » au blur |
| EDI-7 Dossier : arborescence réelle, 18 rem, aide | ✅ | capture actions-edi-dossier (docs, src) ; aide « <worktree>/src » |
| EDI-8 Service : « Où tourne-t-il » | ✅ | 4 cartes ; décidé : l'aide simulée du proto (« une seule unité… ») cède aux aides des cartes |
| EDI-9 Lien du service : aide résolue, erreur, alerte distant | ✅ | « …le lien sera http://localhost:5173/app », erreur ftp ; alerte : ✅ code (`data-link-remote`) |
| EDI-10 Essayer : désactivé, sortie, effacée à la modif | ✅ | capture actions-edi-essai (« essai-recette », [exit 0]) ; disparaît à la modification |
| EDI-11 Agent : CLI, Modèle, Effort | ✅ | 4 CLI ; Effort ✅ code (ActionEditor.tsx:354) : liste des modèles indisponible sur l'instance d'essai |
| EDI-12 Prompt 6 lignes, aide, erreur | ✅ | capture actions-edi-agent ; `rows={6}` (ActionEditor.tsx:377) |
| EDI-13 Où il tourne : Racine / Nouveau worktree + confin. | ✅ | décidé Q4 : 2 cartes + « Sessions autonomes » ; rangement des worktrees : #249 |
| EDI-14 vérification repliable, phrase corrigée | ✅ | `CheckSection` de main : « Sortir en 10 veut dire « rien à faire » » ; Options (Q2) : permissions, durée, chevauchement |
| EDI-15 Libellé n/60 + Description côte à côte | ✅ | 0/60, « ex. Sauvegarde de la base », erreur au blur ; agent 0/120 (limite serveur) |
| EDI-16 Aperçu du bouton | ✅ | « Libellé du bouton » pâle, « arrêté » / « jamais lancée », faux « Lancer » |
| EDI-17 2 · Quand : cartes cochables, erreur, Démarrer | ✅ | « Au moins un des deux… » ; libellé Démarrer ✅ code (ActionEditor.tsx:482) |
| EDI-18 service planifié : encart + « Arrêter » 19 h | ✅ | capture actions-edi-service-planifie (jours ouvrés, 19:00) |
| EDI-19 Planifier / Modifier la planif. → défile sur Quand | ✅ | capture actions-planifier-lint |
| EDI-20 pied : résumé, Enregistrer grisé + « À compléter » | ✅ | « Enregistrer — À compléter : Au moins un des deux… » |
| EDI-21 panneau étroit : bande « Agrandir le panneau » | ✅ code | ActionEditor.tsx:231 ; vue en 1.K |

#### 1.F La planification lisible
| Point | État | Preuve / carte |
|---|---|---|
| PLA-1 phrase de contrôles de 36 px, pliée au téléphone | ✅ | hauteurs 36/36/36 ; capture actions-tel-pla |
| PLA-2 fréquences en trois groupes | ✅ | Une seule fois · N heures, jour, semaine, mois · Personnalisé (cron) |
| PLA-3 une fois : date dans un mois, jours passés off | ✅ | capture actions-pla-date (11 jours désactivés, 12 cerclé) |
| PLA-4 toutes les N h + plage horaire / toute la journée | ✅ | « Toutes les 6 heures, entre 8 h et 20 h » |
| PLA-5 chaque jour + « jours ouvrés seulement » | ✅ | « Chaque jour ouvré (lundi à vendredi) à 9 h 30 » |
| PLA-6 chaque semaine : pastilles L…D, au moins un jour | ✅ | « Choisis au moins un jour. » ; « Chaque lundi et mercredi » |
| PLA-7 chaque mois : grille 1–31, Dernier jour, aide > 28 | ✅ | « Les mois sans 30, rien ne part… » |
| PLA-8 cron : bord rouge, aide, cron équivalent gardé | ✅ | « 30 9 * * 1-5 » gardé ; capture actions-pla-cron |
| PLA-9 heure : champ « Taper l'heure », grille, quarts | ✅ | « 0930 » + Entrée → 09:30 ; capture actions-pla-heure |
| PLA-10 relit une cadence existante | ✅ | Purge relue « chaque semaine, dimanche, 03:00 » |
| PLA-11 aperçu : phrase, mois, 5 prochains, fuseau serveur | 🟡 | « Fuseau du serveur : Europe/Paris », badges « 12 » ; gel sur un cron « chaque minute » : #261 |

#### 1.G L'Agenda
| Point | État | Preuve / carte |
|---|---|---|
| AGD-1 en-tête : mois/date, ‹ Aujourd'hui ›, portée, ⚠, légende | ✅ | capture actions-agenda (« ⚠ 3 chevauchements ») ; Jour → « Jeudi 12 novembre 2026 » |
| AGD-2 passages passés et à venir (pointillés) | ✅ | 13 blocs succeeded / failed / planned ; `border-dashed` |
| AGD-3 couleur de nature, liseré verdict, infobulle, clic | ✅ | infobulle « Sauvegarde… · prévu · Commande · tâche · chevauche… » ; clic → tiroir |
| AGD-4 chevauchements côte à côte, anneau ambre | ✅ | dimanche 03:00 : 4 blocs côte à côte, 8 anneaux |
| AGD-5 heures vides resserrées, bandes ⋯, « Resserrer » | ✅ | 3 bandes « Déplier » ; capture actions-agd-deplie |
| AGD-6 ligne « maintenant », colonne et pastille du jour | ✅ | capture actions-agenda |
| AGD-7 bandeau des services en marche, cliquable | ✅ | pastille « Serveur de dev » → son tiroir |
| AGD-8 36 rem qui défile ; état vide | ✅ code | `max-h-144` (ActionsAgenda.tsx:186) ; `agenda.empty` |
| AGD-9 sous 44 rem : liste par jour | ✅ | capture actions-tel-agenda (« Rien. », heure · nature · nom · verdict) |
| AGD-10 « Maintenant » avance chaque minute | ✅ code | `setInterval(…, 60_000)` (ActionsAgenda.tsx:292) |

#### 1.H « Ce qu'il sert »
| Point | État | Preuve / carte |
|---|---|---|
| SRV-1 ServedLine : « sert la racine (main) @ sha », cwd | ✅ | tuile et ligne ; title = cwd ; 28 car. (served.ts:262) ; ●N ambre ✅ code |
| SRV-2 index : arbre le plus profond, branche, commit, ↑↓ | ✅ | racine b090558, 0 en avance / 0 en retard |
| SRV-3 ServedBlock : Arbre (lien Travail), Branche, Commit… | ✅ | capture actions-srv-block ; lien `/travail?arbre=root` ; « Servir une autre branche… » |
| SRV-4 refus du « déjà en marche » silencieux | ✅ | capture actions-srv-dialog (« sert déjà la racine (main) », « Ouvrir plutôt celui qui tourne », « Basculer sur… ») |
| SRV-5 « Servir… » sur une tuile en marche | ✅ | capture actions-srv-menu (Basculer sur : 2 arbres) |
| SRV-6 PlacementField : 4 cartes, branche, avertissements | ✅ | « La racine est sur cette branche… », « Coût : un processus et un port… », « Le lien doit contenir {port} » |
| SRV-7 ServiceMark « ⚡ :5419 » dans Travail → ?action= | ✅ | lien → onglet Actions, tiroir « Serveur de dev » |

#### 1.I Lancés par les sessions
| Point | État | Preuve / carte |
|---|---|---|
| PRC-1 source /api/services (5 s), repli travaux de fond | ✅ | processus réel :5421 de « Add offline caching… » ; repli ✅ code (session-works-query.ts) |
| PRC-2 humanLabel, portIn, familyOf | ✅ | « Script python », :5421, « commande de fond » |
| PRC-3 tuile : point, libellé, état, session, Ouvrir, ⋯ | 🟡 | ⋯ : En faire une action · Aller à la session · Arrêter · « 0 % · 21.5 Mo » ; « depuis 36min » collé (actions : « 3 min ») et point décimal — #274 |
| PRC-4 ligne : faits, Ouvrir, En faire une action, ■ | ✅ | capture actions-liste ; aide de section présente |
| PRC-5 « En faire une action » : éditeur pré-rempli | ✅ | capture actions-prc-seed (service, http://localhost:{port}, « Repris de « … » ») |
| PRC-6 section masquée selon les filtres | ✅ | filtre Agents → 0 processus |

#### 1.J La page globale Planifiées v2
| Point | État | Preuve / carte |
|---|---|---|
| PLF-1 bande sans onglets, « + Tâche ▾ », Planifiée cochée | ✅ | capture actions-plf-lanceur ; 3 entrées ; Planifiée cochée (correction §2.5-2 faite) |
| PLF-2 recherche, Filtrer Portée/Quoi/État/Prochain | ✅ | capture actions-plf-filtre ; échéances exclusives ; Atlas → 1 tuile ; « 8 tâches · 4 portées » |
| PLF-3 Affichage Lanceur · Agenda · Liste + Regrouper | ✅ | Par échéance / Par portée, Par état en Liste, Période en Agenda |
| PLF-4 Lanceur par échéance ou portée, tuiles d'ajout | ✅ | captures actions-plf-lanceur, -portee ; décidé (#219) : groupe « À la demande » en plus |
| PLF-5 tuile : phrase, cadence + portée, ⋯, geste unique | ✅ | « Prochain dans 14 h · dernier ✓ il y a 1 j », « Lancer maintenant » (Play), Reprendre, Relire ; ⋯ sans Modifier si à relire |
| PLF-6 Agenda sur les tâches filtrées | ✅ | capture actions-plf-agenda (15 blocs) |
| PLF-7 Liste : 4 chiffres, À regarder / Bonne santé / Pause | ✅ | capture actions-plf-liste ; 2 colonnes au tél. (actions-tel-plf-liste) ; « — » de coût pour une commande |
| PLF-8 état vide de la page | ✅ code | `planned.empty.title` / `.body` (catalog-fr.ts:4443) |
| PLF-9 tiroir commun ; lancer « à la racine / sur l'instance / hors projet » | ✅ | libellés des boutons « …, sur l'instance », « …, hors projet » ; « dans le vault » ✅ code (aucun vault configuré) |
| PLF-10 champ Portée dans l'éditeur | ✅ | capture actions-plf-editeur (« Portée : Atlas API, un lancement part à la racine… ») |

#### §0 et §2.5 — à jeter et écarts à corriger
| Point | État | Preuve / carte |
|---|---|---|
| §0 prototype, démo, SimTag, actionBridge, textes ⚡ | ✅ | aucune trace dans apps/web/src (grep) |
| §2.5-1 ?action= retiré à la fermeture | ✅ | Échap → `?vue=lanceur` seul |
| §2.5-2 Planifiées : Planifiée cochée, champ Portée | ✅ | voir PLF-1, PLF-10 |
| §2.5-3 phrase du script de vérification | ✅ | voir EDI-14 |
| §2.5-4 fuseau serveur, pas de 'fr-FR' en dur | ✅ | « Fuseau du serveur » ; grep sans 'fr-FR' |
| §2.5-5 liens localhost des processus | ✅ | décidé : même règle que les liens d'action, relais du panneau Web dans une conversation (parts.tsx:80) |
| §2.5-7 couleurs de terminal en dur | ✅ | grep sans `#0b0d12` / `bg-black/80` |
| §2.5-8 chevron « Lancer dans… » d'un agent | ✅ | décidé Q6 : absent |

## `actions.md` — 1.K, le panneau

#### 1.K Le panneau de droite — coque (`SidePanel`)
| Point | État | Preuve / carte |
|---|---|---|
| PAN-1 ordre des onglets, Web seulement avec une page | ✅ | capture panneau-ouvert ; Web apparaît après ↗ d'un service (panneau-web) |
| PAN-2 compte Actions à trois tons | ✅ | ambre « Actions, 4 à relire » vu (panneau-actions-lanceur) ; ton vert `running` : ✅ code SidePanel.tsx:682, actions-ui-check |
| PAN-3 ombre : ancré sans, par-dessus `shadow-lg` | ✅ | ancré 1440 : `box-shadow: none` ; téléphone : ombre du tiroir (panneau-tel-rangee) |
| PAN-4 cadre commun (48 px, lignes 36, pile, retours) | ✅ | lignes d'outils mesurées à 48 px (Actions, Git, Recherche, Web), lignes 36 px, `PanelNotice` (panneau-recherche-regex), détails en pile |

#### 1.K — onglet Actions (`ActionsPane`)
| Point | État | Preuve / carte |
|---|---|---|
| PACT-1 ligne d'outils (méta, Chercher > 8, Affichage, ↗) | ✅ | panneau-actions-lanceur, -affichage, -affichage-agenda, -nouvelle ; recherche à 18 actions, absente à 0 (panneau-actions-vide) ; vue en localStorage (décidé #227) |
| PACT-2 Lanceur : en cours, processus, services… | ✅ | panneau-actions-lanceur |
| PACT-3 ligne 36 px, état, geste à droite | ✅ | interrupteur, ↗, ▷, icône terminal, « Relire » qui ouvre la relecture (panneau-actions-service, panneau-actions-relire) |
| PACT-4 Liste avec ancres en marche / à relire | ✅ | « 4 à relire » → Liste au groupe (panneau-actions-liste-relire) ; commande lancée ici reste dans sa section (décidé #227) |
| PACT-5 Agenda en liste par jour | ✅ | panneau-actions-agenda |
| PACT-6 état vide + suggestions du dépôt | ✅ | Docs : « Aucune action enregistrée. » + 2 puces → éditeur pré-rempli (panneau-actions-vide, -vide-suggestion) |
| PACT-7 détail, édition en pile ; Lancer sans menu | ✅ | panneau-actions-detail (`data-action-stack`, aucun dialogue) ; Lancer ouvre le passage en pile, retour sur l'action |
| PACT-8 « En faire une action » venu d'Agent | ✅ code | `useActionEditRequest` ActionsPane.tsx:93 ; panel-agent-ui-check (PAG-12) |
| PACT-9 panneau < 360 px : « Agrandir le panneau » | 🟡 | la bande s'affiche **deux fois** (ActionsPane.tsx:170 et ActionEditor.tsx:232), panneau-etroit-editeur ; absente au téléphone ✅  — #275 |
| PACT-10 signaux → onglet qui les tient | ✅ code | `signalTab` lib/actions-pane.ts:86, actions-pane.test.ts:139 ; aucun signal dans la démo |
| PRC-7 Processus des sessions | ✅ | survol ■ et ⋯ (En faire une action, Voir la sortie), dépli : commande, « Lancé par cette session », charge, phrase sur la sortie (panneau-prc-survol, -deplie, -menu) |

#### 1.K — commandes lancées ici (`CommandRuns`)
| Point | État | Preuve / carte |
|---|---|---|
| RUN-1 terminaux d'action de cette conversation, triés | ✅ | en cours d'abord, puis finies (panneau-actions-service) |
| RUN-2 groupe En cours / Dernières, lignes et gestes | ✅ | durée qui avance « 39 s · tick 40 », « Échec (code 1) · 0 s · 2 tests en échec », « Arrêtée · 45 s », ■ Arrêter, Écarter au survol (panneau-runs-survol) |
| RUN-3 détail : état, commande, gestes | ✅ | « ‹ Actions » depuis la liste ; « Relancer seulement les échecs » (infobulle `--test-name-pattern=…`) ; panneau-runs-detail-echec, -encours |
| RUN-4 tests en échec, lint, typage | ✅ | suite › cas, fichier:ligne, attendu / reçu (vrai `node --test`) ; lint et tsc : ✅ code command-output.test.ts |
| RUN-5 Sortie (en direct), lecture seule | ✅ | « Sortie · en direct » (panneau-runs-detail-encours) ; lecture seule : ✅ code lib/terminal-output.ts |
| RUN-6 parseurs tolérants ; Échap remonte | ✅ | Échap revient à la liste (vu) ; parseurs : ✅ code command-output.ts:201, command-output.test.ts |

#### 1.K — onglet Agent (`AgentsPane`, #228 fusionnée)
| Point | État | Preuve / carte |
|---|---|---|
| PAG-1 sans ligne d'outils ; « Rien ne tourne. » | ✅ | panneau-agent ; groupe En cours : ✅ code, capture 228-agent/impl-1280-liste |
| PAG-2 ligne de sous-agent | ✅ code | aucun sous-agent dans la démo ; panel-agent-ui-check, impl-1280-liste |
| PAG-3 ligne de travail de fond, « Ouvrir :port » | ✅ code | panel-agent-ui-check, impl-1280-en-cours-survol |
| PAG-4 « N terminés » replié | ✅ code | panel-agent-ui-check, impl-1280-termines |
| PAG-5 pied « Modifié par la session · N fichiers » | ✅ | 3 fichiers, « agent principal », « 1 passe », diff → Git au survol (panneau-agent-pied) |
| PAG-6 détail d'un sous-agent | ✅ code | panel-agent-ui-check, impl-1280-sous-agent(-fichiers, -resultat) |
| PAG-7 détail d'un travail de fond | ✅ code | Arrêter, Ouvrir :port, En faire une action : impl-1280-travail(-sans-arret) |
| PAG-12 « En faire une action » → Actions | ✅ code | panel-agent-ui-check ; `requestActionEdit` lib/panel.ts |

#### 1.K — onglet Projet (`ProjectPane`)
| Point | État | Preuve / carte |
|---|---|---|
| PPR-1 « Projet #N » + segments | ✅ | panneau-projet-session |
| PPR-2 Cette session : activité, carte, branche, PR | ✅ | panneau-projet-session ; sans carte : Rattacher / Créer, « À la racine du projet » + Git (panneau-root-projet) ; plan masqué, fini au tour précédent (règle lib/project-pane.ts:77) |
| PPR-3 Projet : attend, jalon, sessions, prêtes, liens | ✅ | panneau-projet-projet |
| PPR-4 carte à plat, Colonne ▾, sous-tâches… | ✅ | décidé #229 : détail = fiche `CardSheet` ; Colonne ▾ (panneau-projet-colonne) ; sous-tâches et dépendances : ✅ code panel-project-ui-check (carte #2 sans) |
| PPR-5 autre carte en pile « ‹ Projet » | ✅ | panneau-projet-fiche (aucun dialogue) |

#### 1.K — onglet Git (`GitLine`)
| Point | État | Preuve / carte |
|---|---|---|
| PGIT-1 une ligne : Git, branche, Affichage ▾ | ✅ | six destinations avec aide et compte (panneau-git-affichage) ; 320 px et téléphone tiennent (panneau-etroit-git, panneau-tel-git) ; décidé #222 : paliers revus (GitLine.tsx:44) |
| PGIT-2 « ⚠ N conflits » ambre | ✅ code | pas de conflit en démo ; git-ui-check |
| PGIT-3 gestes du dépôt, pousser en accent | ✅ | gestes vus (Annuler… Relire, ⋯) ; accent : ✅ code GitLine.tsx:234 (pas d'amont en démo) |

#### 1.K — onglet Terminaux
| Point | État | Preuve / carte |
|---|---|---|
| PTER-1 pastilles, ✕, « + » au plafond | 🟡 | pastilles et « + » désarmé, infobulle « Maximum 6 terminaux par projet » ✅ ; la pastille active n'est pas ramenée dans la vue (panneau-terminaux-actif)  — #276 |
| PTER-2 aucun terminal : état centré | ✅ | panneau-terminaux-vide (« … à la racine du projet. ») |
| PTER-3 interrompu : bande ambre + Relancer | ✅ code | TerminalsPane.tsx:97 ; terminals-ui-check |

#### 1.K — onglet Recherche
| Point | État | Preuve / carte |
|---|---|---|
| PSRC-1 champ, Filtrer ▾, Remplacer | ✅ | compte de filtre en accent, bord rouge, Échap vide (panneau-recherche-filtrer, -regex, -remplacer) |
| PSRC-2 retours en PanelNotice, lignes 36/44 | 🟡 | message du moteur brut en anglais (« Invalid regular expression: … ») et « Aucun résultat. » en dessous (panneau-recherche-regex)  — #277 |

#### 1.K — onglet Web
| Point | État | Preuve / carte |
|---|---|---|
| PWEB-1 ligne 48 px : ←, →, recharger, adresse… | ✅ | panneau-web (Direct en un seul bouton, ↗, ✕) |
| PWEB-2 bande « port relayé » | ✅ code | WebPane.tsx:158 ; port local en démo |

#### 1.K — conversation (`ConversationPage`)
| Point | État | Preuve / carte |
|---|---|---|
| CNV-1 pas de ⚡ ; point sur le bouton du panneau | ✅ | « Fermer le panneau — 3 en marche · 4 à relire » avec point |
| CNV-2 signaux → onglet | ✅ code | voir PACT-10 |
| CNV-3 repli `?? HOST_ENVIRONMENT` | ✅ | décidé : non porté (ConversationPage.tsx:1096) |

#### 2.5 / 2.6 — décisions qui touchent le panneau
| Point | État | Preuve / carte |
|---|---|---|
| 2.5-5 liens :port par le relais | 🟡 | clic simple → onglet Web ✅ ; Ctrl-clic : `http://localhost:<port>` en dur (`PortLink`, session-works/parts.tsx:86), relevé par #228  — #278 |
| 2.5-6 / Q7 processus du projet, cette session d'abord | ✅ | décidé ; session-works-query.ts:15 |
| 2.5-7 couleurs du terminal en jetons | ✅ code | aucune couleur en dur sous apps/web/src |
| Q8 `AgentWritings` remplacé | ✅ | décidé, supprimé par #228 |
| Q10 « Écarter » ferme le terminal | ✅ | décidé ; « Écarter « … » et fermer son terminal » vu |
