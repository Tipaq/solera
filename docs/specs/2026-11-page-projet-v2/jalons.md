# Page projet v2 — Jalons : horizon, Gantt, page d'un jalon, composer, affinage, lancement

Analyse d'écarts entre le prototype de la branche `proto/page-projet` (worktree
`proto__page-projet`, fichiers non commités compris, état du 2026-11-11) et `main`
(`029af4ae`). Décisions de référence : `docs/audits/2026-11-09-page-projet-v2/DECISIONS.md`.

**Périmètre** : l'onglet Jalons en variante `flux-v2` (barre sur une ligne, vues Horizon
et Gantt, composer « + Jalon »), la page d'un jalon en variante `jalon-v3` (maturité
expliquée, vagues, session d'affinage en place, « Ajouter au jalon », « À régler avant
de partir », panneau Lancer, suivi d'un jalon lancé, PR finale), le modèle de maturité,
le cap du projet, le drapeau « C'est un jalon », la fiche de carte sur place (`ℹ`), et
tout le côté serveur qu'ils supposent.

**Hors périmètre, cité comme dépendance** : la coque (`PlaceShell`, rangée, gouttière,
tiroir commun `Drawer` et Échap par couches, barre `OneLineToolbar`, mémoire de vue
`useView`, « Ce qui t'attend » `AskInbox`) — `coque.md` ; l'Aperçu `combo`, le panneau
de droite et le portefeuille, qui **consomment** le modèle de maturité défini ici ; la
page Réglages (`page-gauche`), qui porte le champ « Cap » dont le serveur est défini
ici ; le skill `ranger-une-idee` (carte #156).

Convention : chaque élément d'inventaire porte un identifiant (`HOR-3`, `JAL-12`…). Les
cartes du §7 s'y réfèrent comme critères d'acceptation.

Fichiers du prototype (tous sous `apps/web/src/routes/prototype-milestones/`) :

| Fichier | Retenu ? | Rôle |
| --- | --- | --- |
| `HorizonVariant.tsx` (`mode="vues" flux="v2"`) | **oui** | L'onglet : barre, horizon, cap, bascule vers le Gantt |
| `TimelineVariants.tsx` → `GanttClassic` (`bare`) | **oui** | La vue Gantt détaillé |
| `gantt.tsx` | **oui** (sauf `ZoomToggle`, `Legend`, `DemoNotice`) | Échelle, axe, grille, barres, flèches, infobulle |
| `MilestoneComposer.tsx` | **oui** | Tiroirs « Nouveau jalon » et « Ajouter au jalon », zone d'écriture, pièces jointes |
| `brief.ts` | **en partie** (`readBrief`, `titleFromBrief`, `announce`) | Lecture du brief pour le pied du composer |
| `MilestoneV2.tsx` (`flux="v3"`) | **oui** (sauf `Journey`, `DraftBlock`, `Refine` non `rest`) | La page d'un jalon |
| `RefineThread.tsx` | **oui** | La session d'affinage en place, brouillon éditable, ajout proposé |
| `MaturityExplain.tsx` | **oui** | Les six étapes expliquées |
| `maturity.ts` | **oui** (la logique, pas les chaînes) | Maturité, prochaine action, raisons, règles |
| `waves.tsx` | **oui** | Le graphe en vagues |
| `model.ts` | **en partie** (`stateOf`, `isOpen`, `isLate`, `liveSessions`, `awaitsMe`, tables de tons) | État d'une carte |
| `destination.ts` | **oui** | Où mène un clic sur une carte |
| `CardDrawer.tsx` | **oui** | `ℹ`, fiche de carte sur place, drapeau « C'est un jalon » |
| `flags.ts` | non (simulé) → serveur | Drapeau « jalon » en `localStorage` |
| `refineSession.ts` | en partie (`refinePrompt`) | Premier message de la session d'affinage |
| `demo-store.ts` | non (démo) → révèle le flux réel (§3) | Magasin à états |
| `DemoControls.tsx`, `MilestoneVariants.tsx`, `graph.tsx` | **non** | Démo ; variantes `couches` / `etats` écartées |

---

## 0. À jeter, sans équivalent dans la vraie version

| Élément | Raison |
| --- | --- |
| Variantes `vues`, `horizon`, `gantt`, `gantt-graphe`, `roadmap`, `actuel` de l'onglet ; `jalon-v2`, `couches`, `etats`, `actuel` de la page d'un jalon (`ProjectTimelinePage.tsx`, `ProjectMilestonePage.tsx` diffs) | Seules `flux-v2` et `jalon-v3` sont retenues (DECISIONS, 2026-11-11). |
| `GanttWithGraph`, `GanttRoadmap`, `Toolbar`, `DemoToggle`/`Empty` locaux de `TimelineVariants.tsx` ; `graph.tsx` (`DependencyGraph`) ; `MilestoneVariants.tsx` | Utilisés seulement par les variantes écartées. |
| Mode non-`vues` de `HorizonVariant` : `ViewToggle` (« Horizon / Gantt détaillé »), `ZoomToggle` dans « Maintenant », `NewMilestoneForm` (« Créer comme idée », badge `stub`), `stubIdeas`/`fakeCard`, `addIdea` | Remplacés par la barre sur une ligne et le composer v2. |
| `MilestoneV2` sans `flux="v3"` : `Refine` complet (non `rest`), `DraftBlock`, `startRefine` (v1), `MaturityBand` sans `explain` | Le flux v3 porte questions et brouillon dans `RefineThread`. |
| `Journey` (« Parcours de démo »), `DemoControls` (défilement auto, « Avancer d'un pas », « Réinitialiser la démo », « #N attend ta réponse : la suite est figée »), `DemoToggle`, `DemoNotice`, `?demo=1`, `useProtoData`/`useProtoHref`, `demoCards()`, `DEMO_CAP`, `demo-store.ts` entier | Démo. Ce que la démo joue est le flux réel à implémenter (§3). |
| Bandeaux fuchsia « Simulé : … » (`notice` / `onSimulate`), libellés `SIMULÉ`, `(stub)`, `alert('Stub')` | Remplacés par les vrais gestes ; un retour réel passe par un toast (`lib/toasts.ts`) ou un `Banner`. |
| `?proto-carte=` dans `DraftConversationPage` et `refineSession.ts`, `newMilestoneSessionPath` | Un jalon réel existe toujours avant sa session. |
| `questionsForPhrase`, `draftFromSteps`, `draftFromAnswers`, `keywords`, `STOP` (`brief.ts`) ; `proposeAddition`, `acceptAddition` heuristiques (`demo-store.ts`) | L'agent pose les questions, découpe et range l'ajout ; ces heuristiques jouaient son rôle. |
| `flags.ts` (`localStorage proto-milestone-flags`), `CapBlock` en `localStorage proto-cap-*` | Deviennent des champs serveur (§3). |
| `Legend` (`gantt.tsx`) | N'apparaît pas dans la vue Gantt retenue (`bare`). |
| `?variant=couches` dans `GanttClassic.openMilestone`, `?variant=jalon-v2` partout | Le lien mène à `/p/:id/timeline/:n`, sans variante. |

---

## 1. Inventaire du prototype (checklist de recette)

### 1.1 Onglet Jalons — barre sur une ligne (`HorizonVariant.tsx:88-204`)

- **BAR-1** `OneLineToolbar` (coque) : recherche, Filtrer ▾, puces de filtre, Affichage ▾, action à droite.
- **BAR-2 Recherche** « Chercher un jalon » : filtre sur `"{numéro} {titre}"` en minuscules, `#` de tête ignoré (`#901` et `901` trouvent le même jalon).
- **BAR-3 Filtrer ▾** (popover `w-72`, aligné à gauche) : bouton « Filtrer » (icône `Filter`) avec pastille d'accent = nombre de filtres actifs ; titre « Maturité » puis six cases (Idée, À affiner, À régler, Prêt, Lancé, Livré) chacune avec, à droite, le **nombre de jalons à cette étape** (compté sur tous les jalons, pas sur la liste filtrée) ; titre « Échéance » puis « En retard » (échéance passée et pas livré) ; « Effacer tous les filtres » en pied quand un filtre est actif.
- **BAR-4 Puces** : une par maturité cochée (libellé de l'étape) et « en retard », chacune avec ✕ qui retire ce filtre.
- **BAR-5 Affichage ▾** (popover `w-72`, aligné à droite) : déclencheur = icône de la vue courante + « Affichage » (texte caché sous `sm`), infobulle « Affichage : Horizon|Gantt » ; dedans : tuiles de vue **Horizon** (`Compass`) / **Gantt** (`ChartGantt`), titre « Échelle du temps », segment **Semaine / Mois** (défaut **Mois**, non mémorisé).
- **BAR-6 Mémoire de vue** : `useView('jalons', projectId, ['horizon','gantt'])` (coque BAR-7) — `?vue=` d'abord, sinon la dernière vue du projet, sinon Horizon.
- **BAR-7 « + Jalon »** (bouton `sm`, icône `Plus`) : repasse en vue Horizon et ouvre le tiroir « Nouveau jalon » (§1.5).
- **BAR-8** En vue Gantt, la même barre reste ; le filtre (recherche, maturités, retard) s'applique aux groupes de jalons du Gantt ; l'échelle de la barre pilote le Gantt.

### 1.2 Horizon (`HorizonVariant.tsx:236-362, 432-776`)

Page défilante, gouttière `p-4 md:p-6`, blocs espacés de 24 px, dans cet ordre :

- **CAP-1 Cap affiché** (`CapBlock`) : trait vertical d'accent, sur-titre « CAP » (petites capitales grises), la phrase en `text-lg` ; un crayon (« Modifier le cap ») apparaît au survol ou au focus.
- **CAP-2 Cap absent** : bouton discret « + Ajouter un cap ».
- **CAP-3 Édition en place** : cadre, `textarea` 2 lignes, focus automatique, placeholder « Où va ce projet, en une phrase ? », « Annuler » (ghost) / « Enregistrer ». Enregistrer coupe les espaces ; vide = plus de cap (retour CAP-2).
- **HOR-1 Chaîne de maturité** : bande de six cases (3 colonnes au téléphone, 6 dès `sm`), chacune « {n°} {étape} » puis le nombre de jalons (grisé à 0), comptés sur la liste **filtrée**.
- **HOR-2 Section « Maintenant »** — indice « sur l'axe : création → échéance » ; vide : « Aucun jalon en mouvement. Lance celui qui est prêt. » (cadre en pointillé). Y vont les jalons **en mouvement** : lancés, livrés, ou dont une carte est en cours ou à relire. Tri : non livrés d'abord, puis par date de création.
- **HOR-3 Axe daté** (`DatedAxis`) : cadre arrondi défilant horizontalement ; colonne des noms collée à gauche (280 px, **150 px sous 640 px**), en-tête « Jalon » ; ligne de 52 px par jalon ; axe à deux étages (GNT-3) ; grille (GNT-4) ; trait d'aujourd'hui au-dessus des barres ; défilement initial centré sur aujourd'hui (GNT-6).
- **HOR-4 Ligne de nom** (lien vers la page du jalon) : `#N` gris, titre tronqué, `ℹ` (FCH-1) ; dessous la pastille de maturité (MAT-8, infobulle « {étape} — {raison principale} ») et, s'il y a lieu, « +N depuis le lancement » ambre (infobulle : la liste `#N titre` des cartes ajoutées).
- **HOR-5 Barre d'un jalon** (`MilestoneBar`) : de la plus ancienne création (jalon ou carte) à l'échéance ; sans échéance jusqu'à aujourd'hui (au moins un jour) avec **bord en pointillé** ; largeur ≥ 8 px ; remplie de gauche à droite de la part faite (`fait / cartes non abandonnées`) ; bord d'accent si lancé ; tons verts si livré. Texte dedans : « fait/total », « NN % » si la barre fait plus de 90 px, puis **« N t'attend(ent) »** ambre avec point (cartes dont une session attend Tim) **ou** point d'accent pulsant + nombre de sessions vivantes.
- **HOR-6 Trait du lancement** : un trait vertical d'accent posé sur la barre à la date de lancement ; ce qui est ajouté ensuite est à sa droite.
- **HOR-7 Échéance** : losange de 12 px sur le bout de la barre ; rouge si en retard, vert si livré, gris sinon. Retard : prolongement hachuré rouge fin de l'échéance à aujourd'hui (pas de barre rouge).
- **HOR-8 Survol** : la ligne (nom + fond sur toute la largeur) se surligne, la barre prend un anneau d'accent, les autres barres passent à 40 % d'opacité ; quitter le cadre efface le survol. Infobulle flottante (portail, sous la barre ou au-dessus faute de place, tenue dans la fenêtre) : `#N titre` ; « Maturité » ; « Cartes » `fait/total faites` (+ « · +N depuis le lancement ») ; « Créé » ; « Lancé » (si lancé) ; « Échéance » (`aucune` ou date, en rouge « · N j de retard ») ; « Sessions » « N vivante(s) » en accent.
- **HOR-9 Section « Ensuite »** — indice « prêts ou découpés, dans l'ordre du tableau — sans dates inventées » ; jalons À régler ou Prêt hors axe, triés par `position` ; vide : « Rien de découpé en attente. »
- **HOR-10 Section « Plus tard »** — indice « idées et jalons à affiner » ; jalons Idée ou À affiner hors axe, triés par `position` ; vide : « Pas d'idée en réserve. »
- **HOR-11 Tuile de vague** (`Wave`) : grille 1 / 2 (`sm`) / 3 (`xl`) colonnes ; toute la tuile est un lien vers la page du jalon (bord renforcé au survol). Contenu : « N. » (rang), pastille de maturité, « ● t'attend » ambre si une carte du jalon attend Tim, « échéance {relative} » à droite ; « #N titre » + `ℹ` ; les six traits de maturité (MAT-9) ; « N cartes ouvertes » ou « Pas encore découpé » ; pied séparé : **prochaine action** en accent (MAT-6) + son détail tronqué + `→`.
- **HOR-12** Une idée (drapeau, sans enfant) a sa page : la tuile y mène, c'est de là qu'on lance l'affinage.
- **HOR-13 Téléphone** : tout tient en une colonne ; seule l'axe défile en largeur.

### 1.3 Vue Gantt détaillé (`TimelineVariants.tsx:180-405`, `gantt.tsx`)

- **GNT-1 Structure** : un seul conteneur défilant dans les deux sens ; colonne des libellés collée à gauche (296 px, **170 px sous 640 px**), qui part de la gouttière de page (16 px, 24 px dès `md`) ; en-tête collé en haut « Jalon / carte » + « échéance ».
- **GNT-2 Échelle** (`scaleOf`) : de la plus ancienne création au lundi suivant la plus lointaine échéance (+2 j en semaine, +4 j en mois) + une semaine, aujourd'hui compris ; calée sur des lundis. Semaine = 30 px/jour (défile si long) ; Mois = ajusté pour tenir dans la largeur (≥ 3 px/jour). S'étire pour remplir la largeur disponible (`useAxisWidth`, suivi au redimensionnement).
- **GNT-3 Axe** (`GanttAxis`) à deux étages : mois en haut (nom long « novembre 2026 » si la bande fait > 110 px, sinon court ; nom collé à gauche pendant le défilement) ; en bas, en zoom semaine, chaque jour (initiale + quantième, week-ends grisés, aujourd'hui en gras accent) ; en zoom mois, chaque lundi « S{semaine ISO} {quantième} ». Pastille « auj. » posée sur l'axe. Les jours se comptent par le calendrier (passage à l'heure d'hiver sans jour en trop).
- **GNT-4 Grille** : week-ends teintés (semaine), lundis tracés fins, premiers du mois plus marqués ; trait d'aujourd'hui en surcouche, sous la colonne collée.
- **GNT-5 Groupes** : un groupe par jalon **qui a des cartes** (les idées n'y sont pas), dans l'ordre d'échéance (sans date à la fin), filtrés par la barre (BAR-8) ; puis un groupe « Hors jalon » pour les cartes datées sans parente, non abandonnées, qui ne sont pas elles-mêmes des jalons. Chaque groupe a un fond léger.
- **GNT-6** Défilement initial : aujourd'hui au milieu de la zone de l'axe, recalculé à chaque changement d'échelle.
- **GNT-7 En-tête de groupe** (40 px, collé sous l'axe pendant qu'on lit ses cartes) : chevron replier/déplier (« Replier » / « Déplier »), drapeau (accent si lancé), **titre cliquable → page du jalon**, badge « lancé », « fait/total ». Les jalons **livrés sont repliés** au départ.
- **GNT-8 Barre de jalon** (dans l'en-tête, 12 px de haut, arrondie) : étendue de la plus ancienne création à l'échéance (ou à la fin de sa dernière carte) ; remplie par la **répartition des états** (faites, à relire, en cours, bloquées, à faire) ; bord rouge si en retard, pointillé sans échéance, halo d'accent si lancé ; losange d'échéance (rouge si retard) ; « NN % » (ou « — ») à droite. Clic → page du jalon. Infobulle native « titre — fait/total ».
- **GNT-9 Ligne de carte** (32 px, retrait de 20 px) : bouton qui ouvre la destination de la carte (FCH-10) : pastille d'état, `#N`, titre tronqué, `ℹ`, point ambre « t'attend » ou point d'accent pulsant si une session vit, échéance (rouge si en retard, « — » sans date). Cartes abandonnées exclues ; tri par début de barre.
- **GNT-10 Barre de carte** (`CardBar`, 20 px) : de la création à l'échéance (au moins un jour avant l'échéance) ; sans échéance jusqu'à aujourd'hui, **en pointillé**, estompée vers la droite ; teinte de l'état (À faire, Bloquée, En cours, À relire, Faite) ; anneau ambre si une session attend ; point pulsant si vivante. Titre **dans** la barre s'il y tient entier (mesuré au canvas), sinon **à droite** (ou à gauche si ça sortait de l'axe) ; jamais tronqué en « … ». Retard : cran rouge sur l'échéance + prolongement hachuré.
- **GNT-11 Survol d'une ligne** (liste ou barre) : fond d'accent léger sur toute la largeur, chaîne de dépendances éclairée (ses bloqueurs en amont, ce qu'elle bloque en aval), le reste à 30 %, infobulle de carte : `#N titre`, « État », « Créée », « Échéance » (+ « N j de retard »), « Sessions » (icône d'agent + « t'attend » / « tourne »), pied « Clic : ouvrir sa session ».
- **GNT-12 Flèches « bloque »** : en coudes arrondis, de la fin de la bloquante au début de la bloquée ; contournement par l'interligne si la bloquée commence avant la fin de la bloquante ; discrètes au repos, accent et plus épaisses sur la chaîne survolée, les autres à 12 %.
- **GNT-13 Vide** : aucun jalon ni carte datée → état vide « Aucun jalon ni carte datée » (icône drapeau).

### 1.4 Modèle : maturité, prochaine action, raisons (`maturity.ts`, `model.ts`, `MaturityExplain.tsx`)

- **MAT-1 Étapes** : Idée → À affiner → **À régler** (clé `split`, l'ancien « Découpé ») → Prêt → Lancé → Livré. Tons : Idée gris, À affiner ambre, À régler neutre, Prêt vert léger, Lancé accent, Livré vert.
- **MAT-2 Règle** (`analyse`), dans cet ordre : pilotage actif → **Lancé** ; pas d'enfants → **À affiner** si questions ou brouillon en attente, sinon **Idée** ; aucune enfant ouverte → **Livré** ; questions ou brouillon en attente → **À affiner** ; une enfant ouverte « à préciser », non acceptée, prise dans un cycle, ou **aucune** enfant ouverte sans bloqueur ouvert → **À régler** ; sinon **Prêt**.
- **MAT-3 Idée** : carte sans parente, sans enfant, avec le drapeau « jalon » (FLG).
- **MAT-4 Cycle** (`cycleOf`) : les enfants ouvertes prises dans une boucle de `blockedBy` internes au jalon.
- **MAT-5 Analyse d'un jalon** : `toClarify`, `notAccepted`, `cycle`, `startable` (ouvertes dont tous les bloqueurs sont faits ou abandonnés), `addedSinceLaunch` (créées après le début du pilotage), `launchedAt`, `done` (enfants faites).
- **MAT-6 Prochaine action** (`nextAction`, libellé + détail) : Idée → « Affiner » / « Lancer une session d'affinage : l'agent pose ses questions, puis propose un découpage. » ; À affiner avec brouillon → « Valider le découpage » / « L'agent propose N cartes : corrige-les, puis valide. » ; À affiner sans brouillon → « Répondre » / « N question(s) de l'agent en attente » ; À régler → « Préciser » (ou « Défaire le cycle » s'il n'y a que le cycle) / « N carte(s) à préciser · N à accepter · un cycle entre #a, #b », ou « Revoir les dépendances » / « Aucune carte ne peut partir : toutes attendent une carte hors du jalon. » ; Prêt → « Lancer » / « N carte(s) peuvent partir tout de suite. » ; Lancé → PR ouverte : « Fusionner » / « Toutes les cartes sont fusionnées : la PR du jalon vers main est ouverte. » ; session bloquée : « Répondre » / « Une session t'attend : {question} » ; sinon « Suivre » / « fait/total fusionnées · +N depuis le lancement · en pause » ; Livré → « Relire le bilan » / « N cartes livrées. »
- **MAT-7 Raisons et règles** (`maturityReasons`, `MATURITY_RULE`) : pour chaque étape, « quand on y est » et « ce qui en fait sortir », et pour un jalon, ses raisons concrètes (listes `#N`, pluriels) — texte exact au §5.
- **MAT-8 Pastille** (`MaturityPill`) : `rounded-full`, `text-meta`, ton de l'étape ; avec un jalon, infobulle « {étape} — {première raison} ».
- **MAT-9 Traits** (`MaturitySteps`) : six traits fins ; franchis accent 50 %, courant accent, à venir gris ; `aria-label` « Maturité : {étape} », infobulle par trait.
- **MAT-10 État d'une carte** (`stateOf`) : Faite, Abandonnée, À relire, puis **Bloquée** si un bloqueur est ouvert, En cours, À faire ; tables de tons pour barres, nœuds, pastilles, traits SVG.
- **MAT-11 Repère ambre** (`awaitsMe`) : une session non archivée de la carte est `awaiting_input`. La demande elle-même vit dans « Ce qui t'attend » ; le jalon ne fait que la montrer du doigt (DECISIONS « une seule liste »).
- **MAT-12 Demandes de jalon** (`milestoneAsks`) : questions d'affinage, brouillon à valider, PR de jalon à fusionner, session bloquée d'un jalon lancé — consommées par « Ce qui t'attend » (coque INB-8 à INB-10).

### 1.5 Tiroir « Nouveau jalon » (`MilestoneComposer.tsx:652-822`)

- **CMP-1** Tiroir commun (coque), largeur **large**, libellé « Nouveau jalon » ; Échap ou clic dehors ferme (sauf si une couche intérieure est ouverte : CMP-17, CMP-20).
- **CMP-2 En-tête** : sur-titre « Nouveau jalon », champ titre en `text-xl` gras sans bordure, placeholder = **titre tiré du texte** (`titleFromBrief` : premier titre ou première phrase, 70 caractères au plus, « … ») rendu en encre pleine, sinon « Sans titre » estompé ; dessous : « Titre tiré de ton texte, modifiable. » quand il est dérivé, sinon « Une phrase suffit, ou colle ton brief : l'agent s'adapte. » ; ✕ « Fermer (Échap) ».
- **CMP-3 Zone d'écriture** (WRT, 12 lignes) avec le placeholder-exemple (un titre seul, puis un brief « ## Objectif / ## Étapes / ## Hors champ ») ; à droite de sa barre, le champ **Échéance** (CMP-5).
- **CMP-4 Pièces jointes** (`Joined`, avec Réf./Inclure : CMP-12).
- **CMP-5 Échéance** (`DueField`) : bouton discret « 📅 Échéance » ; rempli, la date courte (« 12 déc. 2026 ») et un ✕ « Retirer l'échéance » ; un `input type=date` invisible couvre le bouton.
- **CMP-6 Pied collant** : à gauche « Entre en » + **pastille de l'étape d'arrivée** + une ligne sur ce que fera l'agent (tronquée, infobulle complète avec la suite), dessous « Repéré » + les puces (objectif, N étape(s), N contrainte(s), N hors champ, N point(s) ouvert(s), N carte(s), N lien(s), N fichier(s)) ; à droite trois gestes.
- **CMP-7 Trois gestes** : « Noter l'idée » (ghost), « Affiner avec un agent », « Découper directement ». Le **geste principal** (bouton plein, raccourci affiché `⌘↵`/`Ctrl↵` dès `md`) est « Découper directement » si le brief suffit (BRF-3), sinon « Affiner avec un agent » ; l'autre est secondaire.
- **CMP-8 Désactivations** : texte vide → les trois désactivés (infobulle « Écris d'abord le jalon. ») ; « Découper directement » désactivé tant que le brief ne suffit pas (« Il faut au moins deux étapes, ou un objectif et un peu de matière. »).
- **CMP-9 Aperçu au survol** : survoler ou focaliser un geste montre dans le pied **son** étape d'arrivée et sa phrase (Noter → Idée « Aucune session ne part : tu l'affineras plus tard. » ; Affiner → À affiner ; Découper → À affiner) ; la suite (infobulle) : « Il attend dans « Plus tard » ; rien ne part. » / « L'agent lit le projet et pose ses questions ; tu réponds dans la page du jalon. » / « L'agent propose tout de suite un brouillon ; à la validation, il passe À régler ou Prêt. »
- **CMP-10 Phrase de l'agent** (`announce`) : vide « Écris une phrase, ou colle ton brief. » ; brief suffisant « l'agent proposera directement un découpage » (+ « après une question sur ce qui reste ouvert » s'il y a des points ouverts) ; phrase « l'agent lira le projet, puis te posera d'abord quelques questions ».
- **CMP-11 `⌘/Ctrl+Entrée`** dans la zone = le geste principal.
- **CMP-12 Carte jointe : Réf. / Inclure** — segment dans la puce ; Réf. (défaut) « Référence : un lien informatif, la carte reste où elle est. » ; Inclure « Inclure : la carte devient une carte du jalon. »
- **CMP-13 Noter l'idée** : crée le jalon (drapeau posé), aucune session ; la page reste sur l'horizon, le jalon apparaît dans « Plus tard » ; message « Idée notée : #N, dans « Plus tard ». Tu l'affineras quand tu voudras. »
- **CMP-14 Affiner / Découper** : crée le jalon puis ouvre la **session d'affinage** (brouillon de conversation rattaché à la carte, premier message pré-rempli : `refinePrompt`) ; « Découper » demande un découpage direct.
- **CMP-15 Ce que la création écrit** : titre (retouché ou dérivé) ; description = le texte sans sa première ligne si c'est un titre `#`, + section « **Liens** » ; échéance ; cartes en Réf. → lien « liée à » dans les deux sens ; cartes en Inclure → **deviennent enfants** du jalon ; fichiers → pièces jointes de la carte.
- **CMP-16** Fermer remet tout à zéro (texte, titre, échéance, pièces) après un envoi ; une fermeture sans envoi garde-t-elle le brouillon ? Le proto ne le garde pas (l'état vit dans le composant, démonté à la fermeture) — voir §2.4.

### 1.6 Zone d'écriture commune (`MilestoneComposer.tsx:146-464`)

- **WRT-1 Un seul cadre** : le texte puis sa barre (comme le champ de commentaire de GitHub) ; bord renforcé au focus ; bord d'accent pendant un glisser.
- **WRT-2 Surlignage** : calque derrière un `textarea` transparent ; `#N` d'une carte connue sur fond d'accent, `#N` inconnu en encre normale, URL en accent soulignée ; défilement synchronisé.
- **WRT-3 Hauteur** : grandit avec le texte depuis `rows × 24 + 20` px jusqu'à 384 px, puis défile ; pas de poignée.
- **WRT-4 Autocomplétion `#`** : le mot `#…` avant le curseur ouvre une liste (au plus 6) des cartes non abandonnées dont le numéro commence par la saisie ou le titre la contient, ouvertes d'abord puis faites, numéro décroissant ; ligne = `#N`, titre, colonne en mots (à faire, en cours, à relire, faite) ; pied « ↑↓ choisir · Entrée joindre · Échap fermer ». Sous le cadre, ou **au-dessus** s'il manque de place. `aria-autocomplete="list"`, `role=listbox/option`.
- **WRT-5 Clavier** : ↑/↓ circulent, Entrée ou Tab insèrent `#N ` ; Échap ou perte de focus ferment — un `#` resté seul est **retiré**, une recherche entamée reste (le menu ne se rouvre pas pour ce `#`). Échap est une couche : il ne ferme pas le tiroir.
- **WRT-6 Coller** : des fichiers → pièces jointes ; **une URL seule** → puce de lien, rien n'est inséré dans le texte ; un texte contenant des URL → le texte reste, chaque URL devient aussi une puce.
- **WRT-7 Déposer** : fichiers → pièces ; une URL (`text/uri-list`) → puce ; voile « Dépose pour joindre » pendant le survol.
- **WRT-8 Barre** : trois icônes avec infobulles — `#` « Joindre une carte — tape # » (insère `#` au curseur, avec une espace si besoin, et ouvre la liste) ; lien « Joindre un lien — ou colle une adresse » ; trombone « Joindre un fichier — ou dépose-le » (sélecteur multiple) ; à droite, ce que la zone y pose (l'échéance).
- **WRT-9 Champ de lien en place** : remplace les icônes ; icône lien, « Colle ou tape une adresse, puis Entrée », ✕ « Annuler (Échap) » ; Entrée ajoute (préfixe `https://` si absent) ; vide + perte de focus = annulé ; Échap est une couche.
- **WRT-10 Une carte jointe est une carte mentionnée** : le texte fait foi ; retirer la puce retire la mention `#N` du texte.

### 1.7 Pièces jointes (`Joined`, `Piece`, `linkPiece`)

- **PJ-1** Rangée « Joint · N » sous la zone, invisible à 0.
- **PJ-2 Puce** : hauteur fixe (28 px, 40 px avec vignette), icône de nature, ✕ visible au survol/focus (toujours au doigt), focalisable, **⌫ / Suppr** la retire ; libellé « Retirer … ».
- **PJ-3 Carte** : `#` + numéro gris + titre (tronqué) ; infobulle « #N titre — colonne · dans #P titre de la parente » ; segment Réf./Inclure (Nouveau jalon seulement).
- **PJ-4 Lien** (`linkPiece`) : GitHub `pull`/`issues` → « PR #212 » / « Issue #212 » + `owner/repo` (icônes `GitPullRequest` / `CircleDot`) ; autre → dernier segment du chemin, sans extension, tirets en espaces, majuscule initiale (48 car. max), sinon l'hôte, + l'hôte en gris (icône `Globe`) ; infobulle = l'URL ; clic → nouvel onglet.
- **PJ-5 Fichier** : vignette 32 px pour une image, sinon `FileText` ; nom tronqué ; taille « 512 o », « 12 Ko », « 1,4 Mo ».

### 1.8 Lecture du brief (`brief.ts`) — ce qui pilote le pied du composer

- **BRF-1** `readBrief(text)` repère : étapes (lignes de liste `-`, `*`, `1.` et sous-titres `##`, hors sections contraintes / hors champ), contraintes (section « Contraintes / Exigences / Règles », ou ligne de liste qui dit « doit », « ne pas », « sans »), hors champ (« Hors champ / Hors périmètre / Pas dans ce jalon / Non-objectifs »), objectif (« Objectif / But / Cible », en section ou en ligne « Objectif : … »), points ouverts (ligne finissant par « ? » ou disant « à décider »). Le premier titre est celui du jalon, pas une étape.
- **BRF-2** Mots comptés (`words`).
- **BRF-3 Suffisant** : au moins deux étapes, **ou** un objectif et 60 mots.
- **BRF-4** `titleFromBrief` (CMP-2), `announce` (CMP-10).

### 1.9 Page d'un jalon (`MilestoneV2.tsx` en `flux="v3"`)

- **JAL-1 Adresse** `/p/:id/timeline/:n` ; un numéro qui n'est ni un jalon ni une idée → état vide « #N n'est pas un jalon ».
- **JAL-2 Retour** « ← Jalons » vers l'onglet (la vue mémorisée).
- **JAL-3 En-tête** : drapeau (accent si Lancé), « #N titre » (`text-lg`), `ℹ`, pastille de maturité, « sans échéance » ou « échéance {date} · {relative} », badge ambre « +N depuis le lancement » ; à droite **« + Ajouter au jalon »** (secondaire) sauf si Livré.
- **JAL-4 Bande de maturité** (cadre accent léger, coins 16 px) : sur-titre « PROCHAINE ACTION », le détail de MAT-6 en grand (`text-lg`/`md:text-xl`), bouton = libellé de MAT-6 (absent si Livré) ; au téléphone le bouton passe sous le texte.
- **JAL-5 Étapes expliquées** (`ExplainedSteps`) : six colonnes ; chacune un trait (franchi / courant / à venir, survol plus foncé) et, dès `sm`, son libellé (gras si courant, coche si franchie, souligné au survol) ; infobulle « Pourquoi cette étape ? ». Clic → popover (`w-80`, sous, aligné à droite pour les deux dernières) : « i/6 », nom, « ici maintenant » / « franchie » / « à venir ». Étape courante : « Pourquoi il est ici » (raisons MAT-7), « Pour passer à l'étape suivante » (règle de sortie) et le **bouton de l'action** (ferme le popover puis agit). Autre étape : « Il y était quand » / « Il y sera quand » + la règle d'entrée. Au téléphone : sous les traits, « Étape N/6 · {étape} · pourquoi ? » ouvre la fiche de l'étape courante. Focus visible (anneau d'accent).
- **JAL-6 Le geste de la prochaine action** : Idée → ouvre la session d'affinage (AFF-2) ; À affiner / À régler → défile jusqu'au bloc d'affinage (`#affinage`) ; Prêt → défile jusqu'à Lancer (`#lancer`) ; Lancé → PR ouverte : fusionner (RUN-12) ; session bloquée : défile vers l'affinage ; sinon vers Lancer ; Livré → rien.
- **JAL-7 Mise en page** : une colonne au téléphone dans l'ordre affinage (s'il attend quelque chose), vagues, Lancer, puis affinage (s'il n'attend rien) ; à partir de `xl`, deux colonnes `1fr | 340px`, **Lancer à droite, collé en haut** pendant qu'on lit les vagues.
- **JAL-8 « En attente »** qui place l'affinage en tête : questions, cartes à préciser, non acceptées, cycle, brouillon, ajout proposé, session bloquée, ou idée sans cartes.

### 1.10 Vagues (`waves.tsx`)

- **VAG-1** Titre « Vagues » + « ce qui part ensemble, de gauche à droite · N à la fois » (N = concurrence du pilotage, sinon celle choisie dans Lancer, défaut 3).
- **VAG-2 Vide** : « Pas encore découpé. L'affinage proposera des cartes et leur ordre. » (pointillé).
- **VAG-3 Étages** (`layersOf`) : 0 sans bloqueur dans le jalon, sinon 1 + le plus haut de ses bloqueurs ; un cycle est coupé. Cartes abandonnées exclues.
- **VAG-4 Colonnes** : une par vague, largeur égale remplissant le cadre (≥ 160 px, couloir de 32 px), défilement horizontal si elles ne tiennent pas ; dans une vague, ouvertes d'abord puis par numéro.
- **VAG-5 En-tête de vague** : « VAGUE N » + « terminée » ou « N ouverte(s) · N passes » (`⌈ouvertes / concurrence⌉`) ou « en parallèle » ; une barrette par carte à la couleur de son état.
- **VAG-6 Nœud** (76 px, lien vers la destination de la carte) : pastille d'état (ambre si elle attend, pulsante si en cours), « #N titre » sur deux lignes, `ℹ` ; en bas : état ou « t'attend » (ambre), « par #a, #b » (bloqueurs ouverts, ambre) ou, empilé, « après #a » (bloqueurs dans le jalon), « ajoutée » (ambre, après le lancement), icônes des sessions vivantes (fond ambre si elle attend), échéance (rouge si retard). Teintes par état ; faite à 70 % ; anneau rouge si en retard ; **ambre (bord, fond, anneau) si une session attend** (MAT-11).
- **VAG-7 Arêtes** : du bord droit du bloqueur au bord gauche de la bloquée, coudes arrondis par le milieu du couloir, pointe de flèche ; pointillé tant que le bloqueur n'est pas fait ; une arête qui **remonte** (cycle) passe par-dessus, en pointillé rouge.
- **VAG-8 Survol / focus** d'un nœud : sa chaîne (amont + aval) éclairée en accent, le reste à 30 % (nœuds) / 20 % (arêtes).
- **VAG-9 Étroit (< 560 px)** : les vagues s'empilent (en-tête puis nœuds en liste), les liens s'écrivent « après #N ».
- **VAG-10** Sous le graphe : « Ajoutées depuis le lancement : #a, #b » (ambre).

### 1.11 Session d'affinage en place (`RefineThread.tsx`)

- **AFF-1 En-tête** : « Session d'affinage » ; état avec point : **« t'attend »** (ambre : questions, brouillon ou ajout en attente), **« travaille »** (accent pulsant), **« terminée »** (vert : rien en attente et des cartes existent), **« pas encore lancée »** (gris) ; « · découpage direct » ou « · questions d'abord » selon le mode.
- **AFF-2 Pas encore lancée** : lien discret « Découper directement » + bouton « ✦ Affiner avec un agent » ; texte « Une session lit le projet et ce que porte ce jalon (skill `/affiner-un-jalon`), pose ses questions ou propose directement un découpage. » Les deux ouvrent la session (brouillon de conversation rattaché à la carte, message pré-rempli avec le titre et la description du jalon ; « Découper directement » ajoute la demande de découpage direct). Si une session d'affinage vit déjà sur la carte, on l'ouvre au lieu d'en créer une.
- **AFF-3 Lancée** : bouton plein « Ouvrir la session ↗ » à droite (le fil complet vit dans la session).
- **AFF-4 Terminée sans brouillon** : « Le jalon est découpé. « Ajouter au jalon » relance l'agent sur ce que tu ajoutes. »
- **AFF-5 Liste** (cadre, lignes séparées) : en « travaille », la **dernière activité** de la session en italique avec icône de chargement ; chaque **question en attente** (icône robot ambre, texte, « Répondre ici » à droite) ; « Répondre ici » ouvre sous la question un champ « Ta réponse » + ↵ (focus auto, envoi par Entrée, ↵ désactivé si vide) ; sans question mais avec brouillon : « Un découpage attend ta validation, ci-dessous ou dans la session. »
- **AFF-6 Brouillon** (`DraftEditor`) : sur-titre « DÉCOUPAGE PROPOSÉ » + « N cartes · corrige, puis valide » ; une ligne par carte : lettre A, B, C… en pastille ; titre éditable en place (enregistré à la perte de focus s'il a changé et n'est pas vide) ; ↑ « Monter » (désactivé en tête), ↓ « Descendre » (désactivé en queue), ✕ « Retirer » (rouge au survol ; retire aussi les liens qui la citaient) ; dessous, sauf pour la première : « après » + une pastille-lettre par carte **au-dessus** d'elle, allumée si elle l'attend, clic = bascule (infobulle = titre), « rien : part tout de suite » si aucune ; la première : « part tout de suite » ; sous-tâches proposées en aperçu (cases vides). Dernière ligne : « + Ajouter une carte au brouillon » (Entrée ajoute, à la suite de la dernière). Pied : « Réponds d'abord à la question ouverte. » (ambre) quand une question attend, et **« ✓ Valider le découpage »** (désactivé dans ce cas). Valider crée les cartes **enfants du jalon**, avec leurs liens.
- **AFF-7 Ajout proposé** (cadre accent léger) : « Ranger dans #N, en sous-tâche » + la citation de la première ligne de l'ajout, **ou** « N nouvelle(s) carte(s) dans le jalon » + liste (titre, « après #N » ou « peut partir tout de suite ») ; « Laisser tel quel » (ghost) / « ✓ Ajouter la sous-tâche » ou « Créer les cartes ».

### 1.12 « À régler avant de partir » (`Refine` en mode `rest`, `MilestoneV2.tsx:384-567`)

- **RGL-1** Titre « À régler avant de partir » + « N point(s) en attente » ; **absent** s'il n'y a rien (les questions et le brouillon sont dans AFF).
- **RGL-2 Session bloquée d'un jalon lancé** (fond ambre) : la question, « une session du jalon t'attend », champ « Ta réponse à la session », « Répondre ». ⚠ contredit la règle « une seule liste » (voir §2.6).
- **RGL-3 Carte à préciser** : `#N titre`, « à préciser depuis {durée} », champ « La précision attendue », « Préciser ».
- **RGL-4 Carte non acceptée** : `#N titre`, « pas encore acceptée », « Accepter » (secondaire).
- **RGL-5 Cycle** : « Cycle de blocages : aucune de ces cartes ne peut partir. » (icône rouge), puis par lien interne « #a bloque #b » + « retirer ce lien ».
- **RGL-6 Après réponse** : la ligne dit ce qui est parti (le proto : « Envoyé à l'agent (stub) : « … » ») puis disparaît quand le serveur l'a levé.

### 1.13 Tiroir « Ajouter au jalon » (`AddToMilestoneDrawer`)

- **ADD-1** Tiroir commun (largeur normale), libellé « Ajouter au jalon » ; en-tête : sur-titre « Ajouter au jalon », titre « #N titre » tronqué, ✕.
- **ADD-2** Zone d'écriture (WRT, 8 lignes), placeholder « Ce que tu veux ajouter : une phrase, ou une liste.\n\nex. Il faut aussi gérer les pièces jointes hors ligne (#156) » ; pièces jointes **sans** Réf./Inclure.
- **ADD-3 Pied** : vide → « Écris une phrase, ou colle ton brief. » ; sinon « L'agent le range dans une carte existante, ou propose de nouvelles cartes. » (infobulle « L'agent le range dans la carte qui en parle déjà (en sous-tâche), ou propose de nouvelles cartes dans la bonne vague. Tu valides dans le fil du jalon. ») ; puces « Repéré » ; « Annuler » / « Proposer à l'agent ⌘↵ » (désactivé vide, infobulle « Écris d'abord l'ajout. ») ; `⌘↵` envoie.
- **ADD-4 Envoi** : l'ajout part à la **session d'affinage du jalon** (avec liens et fichiers) ; le tiroir se ferme ; la proposition de l'agent apparaît en AFF-7.

### 1.14 Panneau Lancer, avant le lancement (`LaunchPanel`, `MilestoneV2.tsx:589-806`)

- **LCH-1 Livré** : cadre vert, « Livré » (`GitMerge`), « N cartes fusionnées, PR du jalon fusionnée dans main. »
- **LCH-2 Pas de cartes** (Idée, ou À affiner sans cartes) : « Lancer » + « Rien à lancer tant que le jalon n'est pas découpé en cartes. »
- **LCH-3 En-tête** « Lancer » + « à la main ou autonome, au choix ».
- **LCH-4 Mode** (radiogroup « Mode de lancement », deux grandes options avec icône, libellé, indice, rond à droite) : **À la main** (`Hand`) « Tu lances chaque carte quand tu veux » (défaut) ; **Autonome** (`Laptop`) « Solera lance, fait relire et fusionne, vague par vague ».
- **LCH-5 Environnement** (« Environnement », radios avec libellé + indice) : Hôte « Sur cette machine, comme aujourd'hui » ; Hôte confiné « Cette machine, sous bwrap : son worktree seulement » ; Dev container « Le conteneur du projet, partagé par les sessions » ; Dev container confiné « Un conteneur éphémère par session, son worktree monté ». Le vrai panneau ne montre que ce que le serveur sait lancer et part du réglage du projet (commentaire `MilestoneV2.tsx:67-72`).
- **LCH-6 Passer en Autonome confine d'office** : hôte → hôte confiné, dev container → dev container confiné (#146).
- **LCH-7 À la main** : « Une session par carte, livrée dans la branche du jalon comme en autonome. Pas de pilotage, donc pas de vérification. » ; l'environnement ; la liste des **cartes ouvertes** : pastille d'état (ambre + fond ambre si elle t'attend), `#N titre` (lien vers sa destination), `ℹ`, puis icônes des sessions vivantes, **ou** « ▶ Lancer » (ghost) si elle peut partir et est acceptée, **ou** « attend ».
- **LCH-8 Lancer une carte à la main** ouvre le pilotage **en mode manuel** (la carte livre dans la branche du jalon) et lance la session de la carte.
- **LCH-9 Autonome** : « Le serveur lance les cartes prêtes, chacune dans son worktree, les fait relire et les fusionne dans la branche du jalon. » ; champs alignés (libellé 112 px) : **Concurrence** (boutons 1 à 6, le choisi en accent) ; **Branche du jalon** (`jalon/N-slug`, code) ; **CLI** « comme une session neuve de ce projet » ; Environnement ; **Services** (si dev container confiné) « ceux du projet, partagés » / « une copie par session ».
- **LCH-10 Avertissement** non confiné : « Non confinée, chaque session te demandera ses autorisations : les cartes concernées attendront ta réponse. » (ambre).
- **LCH-11 Vérifications** (cadre vert « Prêt à partir » ou ambre « Avant de partir : N point(s) à régler »), **échecs d'abord** : « Rien à préciser » / « N point(s) d'affinage en attente » ; « Toutes les cartes acceptées » / « N carte(s) à accepter » ; « Pas de cycle de blocages » / « Cycle : #a, #b » ; « Au moins une carte peut partir » / « Aucune carte ne peut partir » ; « Concurrence : N à la fois » (toujours vert).
- **LCH-12** « En autonome, seuls les blocages te reviennent. » puis « ▶ Lancer en autonome », désactivé tant qu'une vérification échoue.

### 1.15 Suivi d'un jalon lancé, PR finale (`RunPanel`, `MilestoneV2.tsx:808-923`)

- **RUN-1 Cadre** accent ; point (ambre en pause, accent pulsant sinon) ; titre « En pause » / « Lancé en autonome » / « Lancé à la main » ; « depuis {durée} ».
- **RUN-2 Bascule de mode** en cours de route (segment « À la main » / « Autonome »).
- **RUN-3 Ligne d'état** : autonome « occupées/concurrence places occupées », à la main « Tu lances les cartes ; les sessions avancent seules » ; « · branche `…` ».
- **RUN-4 Confinement** : case « Sessions confinées, sans demandes d'autorisation (pour les prochaines) ».
- **RUN-5 Cartes** : pastille + libellé d'état de pilotage (« attend ses bloqueurs », « en file », « au travail » pulsant, « en revue » ambre, « fusionnée » vert, « t'attend » rouge en gras), `#N titre` (lien), `ℹ` ; à la main, une carte en file et acceptée a « ▶ Lancer ».
- **RUN-6 Ajouter une carte** : champ « Ajouter une carte au jalon » + « + Ajouter » (désactivé vide) ; la carte entre dans la file (et une PR finale ouverte se referme dans le proto).
- **RUN-7 Pause / Reprendre** (secondaire). La version non démo du proto montre aussi **« Arrêter »** (DECISIONS : « pause et arrêt »).
- **RUN-8** « Seuls les blocages te reviennent : ils s'affichent dans Affinage et dans « Ce qui t'attend ». »
- **RUN-9 PR finale ouverte** : cadre vert « PR du jalon ouverte » (`GitPullRequest`), « Toutes les cartes sont fusionnées dans `branche`. Solera a ouvert la PR vers `main` : relis-la, puis fusionne. », bouton « Fusionner dans main » (`GitMerge`).
- **RUN-10** Les blocages d'une session d'un jalon lancé apparaissent dans « Ce qui t'attend » étiquetés « Jalon #N » et la carte passe en ambre dans les vagues et le Gantt.
- **RUN-11** Une carte ajoutée au jalon lancé (par RUN-6, par AFF-7, par le board) entre dans la file (`adoptNewChildren`, déjà sur `main`).
- **RUN-12** Fusionner : la PR part dans la branche par défaut, le jalon passe Livré.

### 1.16 Fiche de carte sur place et drapeau (`CardDrawer.tsx`, `destination.ts`)

- **FCH-1 `ℹ`** sur chaque carte cliquable (horizon, Gantt, vagues, Lancer, suivi, en-tête du jalon) : `span role=button`, 20 px, `aria-label` « Détail de la carte #N », infobulle « Détail de la carte » ; Entrée/Espace ; n'ouvre **pas** la session (arrête la propagation, `pointerdown` compris).
- **FCH-2** État dans l'adresse : `?fiche=N` ; un lien partagé rouvre la fiche ; l'hôte est monté au niveau de la page.
- **FCH-3** Tiroir commun ; en-tête : titre, sous-titre `#N`, point + état (ou « t'attend »), puce « ⚑ Jalon #P titre » (lien vers la page du jalon), échéance relative (rouge si retard).
- **FCH-4** Si une session attend : la demande et la réponse sur place (`AskInbox` en mode `bare`, coque INB-6).
- **FCH-5 Sessions** (+ nombre) : agent, titre, branche (dès `sm`, mono), état en mots colorés (t'attend, tourne, en erreur, interrompue, au repos), `→` ; état vivant pris au WebSocket ; vide « Aucune session sur cette carte pour l'instant. »
- **FCH-6 Sous-tâches** (« x / y » + barre) : cases cochables (route existante).
- **FCH-7 Liens** : « Bloquée par », « Bloque », « Dedans » ; clic = la fiche passe à cette carte.
- **FCH-8 Description** (markdown, lignes de cases retirées) ou « Pas de description. » ; **Notes récentes** (3, « 3 sur N »).
- **FCH-9 Pied** : « Ouvrir la session → » (la plus active, sinon la plus récente) ou « ▶ Lancer une session » (`/c/new?card=`) ; « Voir dans le tableau » ; à droite la case **« C'est un jalon »** (FLG-1).
- **FLG-1 Drapeau** : coché et grisé d'office si la carte a des enfants (infobulle « d'office : N carte(s) dedans ») ; grisé si la carte a une parente (« une carte rangée dans un jalon ne peut pas en être un ») ; sinon cochable (« cochée, la carte devient une idée de jalon, à affiner »). Cochée → la carte apparaît en Idée dans « Plus tard ».
- **FCH-10 Destination d'un clic sur une carte** (`cardDestination`) : une carte qui t'attend → **sa fiche** (`?fiche=`) pour répondre sur place ; sinon sa session (t'attend > en erreur > tourne, sinon la plus récente, archivées exclues) ; sans session → brouillon rattaché `/c/new?card=`.

---

## 2. État actuel sur `main` et écarts

### 2.1 Onglet Jalons

| Sur `main` | Prototype retenu | Écart |
| --- | --- | --- |
| `ProjectTimelinePage` : une frise (`components/project/Timeline.tsx`) — une ligne par jalon (carte qui a des enfants), barres en pourcentage d'une fenêtre ≥ 6 semaines, pointillé sans échéance, rouge en retard, pied « N cartes sans jalon ni date » (`unplacedOf`) ; un jalon lancé montre ses segments (`MilestoneSegments`) et ses barres teintées par l'exécution (`milestoneToneOf`) ; clic → board (`?carte=`), ou vue du jalon s'il est lancé. Pas de « + Jalon » (une carte n'était jalon que parce qu'une autre la désignait). | Barre sur une ligne, Horizon + Gantt, cap, composer. | **Remplacé** en entier. Le pied « sans jalon ni date » disparaît (le proto ne le montre pas ; à confirmer, §2.9). La teinte d'exécution des barres d'un jalon lancé est remplacée par l'état de carte (MAT-10) + repère ambre. |
| Pas de notion d'idée de jalon ; `milestonesOf` (`lib/timeline.ts`) groupe par parente. | Idées (drapeau), maturité à six étapes. | **Nouveau** : modèle §1.4. `milestonesOf`, `milestoneIdsOf` restent utiles (Gantt) ; `windowOf`, `cardSpan`, `unplacedOf` ne servent plus qu'à `PortfolioTimelinePage` (domaine portefeuille, remplacé par sa v2). |
| Pas de cap. | Cap en tête, éditable en place, aussi dans Réglages › Général. | **Nouveau** (serveur + UI). |

### 2.2 Page d'un jalon

| Sur `main` | Prototype retenu | Écart |
| --- | --- | --- |
| `ProjectMilestonePage` (planche C2, #116) : **seulement pour un jalon lancé** — vagues en colonnes (`milestoneWaves`), tuiles teintées par exécution, la ligne de demande de session (`SessionRow`), file (`milestoneQueue`), pause/reprise ; un jalon jamais lancé → « jamais lancé » ; une carte sans enfant → « pas un jalon » + lien board. | Page pour **tout** jalon et toute idée : maturité expliquée, vagues (graphe à arêtes), affinage en place, Lancer, suivi. | **Remplacé**. Les mots `milestoneRun.status.*` restent utiles pour RUN-5. La demande de session recopiée dans la tuile (C2) **disparaît** (règle « une seule liste ») au profit du repère ambre. |
| Lancement : `CardMilestone` dans la fiche du board (`components/board/CardMilestone.tsx`) — bouton « Lancer » → dialogue `LaunchDialog` : aperçu `plan` (prêtes, en attente, déjà en cours, écartées), concurrence (`Select`), **CLI et réglages du jalon** (`useAgentSettings`), **CLI par carte** (menu), confinement (`AutonomousConfinementSelect`), avertissement de quota (> 3) ; suivi : pause/reprise/arrêt (`confirm()`), concurrence modifiable en cours, liste par étage avec raison de blocage, ouvrir la session. | Panneau Lancer dans la page du jalon (LCH), suivi (RUN). | **Déplacé et refait**. Perdu par le proto (à arbitrer, §2.9) : choix du CLI/modèle du jalon et par carte, concurrence modifiable en cours, avertissement de quota, raison de blocage détaillée. Gagné : mode à la main, bascule de mode, confinement modifiable en cours, ajout de carte, PR finale. `CardMilestone` dans la fiche du board devient un lien « Ouvrir le jalon » (domaine Tableau à prévenir). |
| Aucune vue des vagues avant le lancement. | Vagues dès qu'il y a des cartes. | Nouveau (calcul client, `layersOf`, identique à `layerCards` serveur). |

### 2.3 Affinage et découpage

| Sur `main` | Prototype retenu | Écart |
| --- | --- | --- |
| Découpage en cartes (#70) : conversation `purpose: 'split'` (+ `splitCardId`), ouverte par `?split=new` ou `?split=<id>` (rangée du projet « Découper en cartes », palette, menu de la fiche du board) ; briefing `splitBriefing` (lire le board et le code, questions dans la réponse puis fin de tour, `propose_cards`) ; brouillon `CardDraftPrompt` dans le fil (titre, description, sous-tâches, retirer une carte ou un lien ; pas d'ajout ni de réordonnancement : « demande-le à l'agent ») ; décision `POST /api/conversations/:id/card-drafts/:requestId` ; « À décider » compte le brouillon. | Session d'affinage **d'un jalon**, montrée **dans la page du jalon** (AFF) : état, mode, dernière activité, questions répondables sur place, brouillon éditable (renommer, réordonner, dépendances par pastilles, retirer, **ajouter**), valider ; « Ajouter au jalon ». | Le mécanisme existe ; **nouveau** : le mode (questions d'abord / découpage direct), le cap et la consigne « questions par l'outil de question » dans le briefing, le résumé d'affinage sur la carte, la lecture du brouillon hors du fil, l'ajout réordonnable, les sous-tâches ajoutées à une carte existante. « Découper en cartes » quitte la rangée (coque) ; `?split=` reste l'entrée technique. |
| Les questions d'une session de découpage sont du **texte** dans sa réponse : la session finit son tour (`idle`), rien n'« attend ». | Les questions sont des demandes en attente, répondables sur place et listées dans « Ce qui t'attend ». | **Changement de consigne** : poser les questions avec l'outil de question du CLI (`question.requested`, Claude et Codex), toutes à la fois → `awaiting_input`, `/api/projects/:id/prompts`, réponse `POST …/questions/:requestId`. |

### 2.4 Création d'un jalon

| Sur `main` | Prototype retenu | Écart |
| --- | --- | --- |
| Un jalon naît quand une carte reçoit un enfant (fiche du board, « Rattacher »), ou d'un brouillon `propose_cards` avec `parent: {kind:'new'}`. `createCardBodySchema` : titre, description, colonne, parente. | « + Jalon » : composer riche (CMP, WRT, PJ), échéance, cartes jointes ou incluses, liens, fichiers, trois gestes. | **Nouveau** : création d'une carte-jalon avec drapeau + échéance d'un seul appel ; enchaînement relations / parentés / pièces jointes ; ouverture de la session d'affinage. Le brouillon du composer n'est pas gardé à la fermeture (proto) — proposition : le garder par projet comme les brouillons du composer de conversation (à confirmer). |

### 2.5 Drapeau et fiche

| Sur `main` | Prototype retenu | Écart |
| --- | --- | --- |
| Pas de drapeau : `schema.ts` dit « un jalon n'est pas un type ». | Drapeau « C'est un jalon » (FLG-1). | **Nouveau** champ serveur ; la doc de `cards.parentId` et de `CardDto.parent` est à réécrire. |
| La fiche d'une carte vit dans le board (`CardPanel` / `CardDetail`, `?carte=`). | Fiche **sur place** partout hors du board (`?fiche=`), plus courte, orientée « répondre, suivre, cocher ». | **Nouveau** composant (FCH) ; `?carte=` du board reste. |

### 2.6 Contradictions entre le proto et DECISIONS (à trancher, proposition en gras)

1. **RGL-2 recopie la demande d'une session bloquée** dans la page du jalon, alors que DECISIONS (« Demandes ») dit « la carte concernée passe en ambre, **sans recopier la demande** ». Dans le proto la ligne n'existe qu'en démo (`entry.run.blocked`). **Ne pas la reproduire** : le repère ambre (VAG-6, GNT-9/10) + « Ce qui t'attend » suffisent ; RUN-8 renvoie déjà à « Ce qui t'attend ».
2. **LCH-5 laisse choisir où tourne la session** (hôte ou dev container), DECISIONS dit « l'emplacement vient du réglage du projet ; le lancement règle le confinement ». **Garder la liste de radios (rendu 1:1) mais n'y mettre que les environnements de `choices` dont le `where` est celui du projet** — soit deux options (X, X confiné) ; le lancement n'envoie que `confined`, comme aujourd'hui.
3. **LCH-9 Services** (partagés / copie) est un **réglage du projet** (`confinedServices`, #145), pas du lancement. **Afficher la valeur du projet, en lecture, avec un lien vers Réglages** ; pas de surcharge par pilotage (sinon : colonne `milestone_runs.confined_services` et passage à `createConversation`).
4. **RUN-9 « Fusionner dans main »** : DECISIONS dit « Solera ouvre la PR, que Tim fusionne ». **Le bouton fusionne au nom de Tim** (route nouvelle, §3) — c'est bien Tim qui clique ; ajouter « Ouvrir la PR ↗ » à côté pour relire.

### 2.7 Ce qui disparaît (fichiers de `main`)

- `routes/ProjectTimelinePage.tsx` (contenu) — remplacé par `routes/milestones/MilestonesPage.tsx` (nom proposé), route `timeline` inchangée.
- `routes/ProjectMilestonePage.tsx` (contenu) — remplacé par `routes/milestones/MilestonePage.tsx`, route `timeline/:number` inchangée.
- `components/board/CardMilestone.tsx` (section « Jalon » de la fiche du board et `LaunchDialog`) → un lien « Ouvrir le jalon » (coordonner avec la spec Tableau) ; sa story `CardMilestone.stories.tsx`.
- `lib/milestone-view.ts` : `milestoneWaves`, `milestoneQueue` ne servent plus ; `milestoneCounts`/`milestoneToneOf` restent tant que `MilestoneBanner` (Aperçu/Activité actuels) existe — à retirer par les domaines Aperçu/Activité.
- Clés i18n `timeline.*` de la frise, `milestoneRun.queue.*`, `milestoneRun.wave.*`, `milestoneRun.never*`, `milestoneRun.notParent*` : à retirer une fois sans usage.
- `components/project/Timeline.tsx` : reste tant que `PortfolioTimelinePage` existe (domaine portefeuille).

### 2.8 Ce qui existe déjà et se réutilise tel quel

- Pilotage serveur `MilestoneRuns` : `plan`, `launch` (cycle refusé, confinement vérifié), `update` (pause, reprise, arrêt, concurrence), `adoptNewChildren` (RUN-11), adoption des sessions ouvertes ailleurs, notifications de blocage, notes de jalon ; routes `/api/cards/:id/milestone[/plan]`, `/api/projects/:id/milestones/active`.
- Branche de jalon (`parent-branch.ts`) : toute carte enfant, lancée à la main ou par le pilotage, livre déjà par PR vers `jalon/N-slug` (#68) — « à la main, les cartes livrent aussi dans la branche du jalon » est **déjà vrai**.
- PR finale (`reviews/parent-pr.ts`) : ouverte quand toutes les enfants sont closes et au moins une fusionnée ; `cards.branchPrNumber`, `branchPrUrl` ; `forge.mergePullRequest` existe.
- Brouillons `propose_cards` (protocole `card-draft.ts`, `cardDraftProblems`, `withoutDraftCard`, `acceptDraft`), route de décision.
- Questions des CLI (`question.requested`, `POST /api/conversations/:id/questions/:requestId`), demandes ouvertes par projet (`/api/projects/:id/prompts`, `useSessionRequests`).
- Cartes : acceptation (`POST /api/cards/:id/accept`), liens « bloque » (`POST`/`DELETE /api/cards/:id/blocks`), relations (`/relations`), pièces jointes (`/attachments`), sous-tâches (`/subtasks`), notes.
- Environnements : `GET /api/projects/:id/environments` (`default`, `choices`, `autonomousConfined`), `autonomousEnvironment`.
- DS : `Popover`, `Tooltip`, `IconButton`, `Badge`, `Banner`, `EmptyState`, `ChoiceList`, `SegmentedControl`, `ConfirmDialog`. Toasts : `lib/toasts.ts`.

### 2.9 Pertes à arbitrer avec Tim (le proto les retire, `main` les a)

| Fonction de `main` | Proposition |
| --- | --- |
| Choix du CLI et des réglages du jalon, CLI par carte (`LaunchDialog`) | Le proto écrit « CLI : comme une session neuve de ce projet ». **Reproduire le proto** (config par défaut du projet) ; garder le champ `config`/`cards` côté serveur. |
| Concurrence modifiable pendant le pilotage | Absente de RUN. **L'ajouter** dans RUN-3 (menu « N places ») : la route existe, le coût est nul. À confirmer. |
| Avertissement de quota au-delà de 3 | **Le garder** sous le sélecteur de concurrence (LCH-9). |
| Raison détaillée d'un blocage (`milestone.block.*`) | **La mettre en infobulle** du libellé « t'attend » de RUN-5. |
| Pied « N cartes sans jalon ni date » | Retiré par le proto. **Ne pas reproduire** (le Gantt montre « Hors jalon » pour les datées ; les autres sont au Tableau). |

---

## 3. Ce que le prototype simule et qu'il faut rendre réel

Le parcours joué par `demo-store.ts` est le flux réel : **idée → affinage (questions) →
brouillon `propose_cards` → à régler → prêt → lancement à la main / autonome / confiné →
suivi (blocages, pause, ajout) → PR finale → livré**. Chaque geste ci-dessous.

| Geste / donnée simulé | Où | Ce qu'il faut | Existe déjà ? |
| --- | --- | --- | --- |
| **Drapeau « jalon »** | `flags.ts` (`localStorage`), `CardDrawer.tsx:MilestoneFlag`, `demo-store.flagged` | Migration `cards.milestone` (booléen, défaut faux ; **rempli à vrai** pour toute carte qui a des enfants). `CardDto.milestone: boolean` (le drapeau stocké). Côté client, `isMilestone(card) = card.milestone \|\| card.children.length > 0`. `updateCardBodySchema.milestone`. Règles serveur : **le drapeau se pose seul** quand une carte reçoit son premier enfant (rattachement, création avec `parentId`, brouillon accepté, promotion de sous-tâche) pour qu'une idée dont on détache les enfants reste une idée ; le poser sur une carte qui a une parente → 409 `card_milestone_child` ; rattacher une carte drapeautée sous une parente **lève** son drapeau (proposé : refuser serait plus sûr — à trancher). Une parente `new` de `propose_cards` naît drapeautée. `list_cards`/`read_card` (MCP) disent « jalon ». | Non. |
| **Cap du projet** | `CapBlock` (`localStorage proto-cap-*`), `prototype-settings` | Migration `projects.cap` (texte, nul) ; `ProjectDto.cap: string \| null` ; `updateProjectBodySchema.cap: z.string().trim().max(280).nullable()` (vide → `null`). Donné à l'agent d'affinage (briefing). Réglages › Général écrit le même champ (domaine Réglages). | Non. |
| **Créer un jalon d'un seul geste** | `createMilestoneFromBrief`, `NewMilestoneDrawer.submit` | `createCardBodySchema` + `dueAt: number \| null` + `milestone: boolean`. Puis, côté client, en séquence : `POST /api/cards/:new/relations` (Réf.), `PATCH /api/cards/:inclue {parentId}` (Inclure), `POST /api/cards/:new/attachments` (fichiers). Liens dans la description (« **Liens** »). En cas d'échec partiel, la carte existe : message qui le dit, pas de retour arrière. | Création oui ; `dueAt`/`milestone` à la création non. |
| **Session d'affinage liée à la carte** | `refineSession.ts` (`/c/new?card=…&prompt=`), `startRefineV2`, `RefineThread` | Une conversation `purpose: 'split'`, `splitCardId` = le jalon (**pas** `cardId` : elle ne doit pas recevoir la consigne de livraison par PR ni compter parmi les sessions de travail de la carte). Nouveau champ de création `splitMode: 'questions' \| 'direct'` (défaut `questions`), stocké (`conversations.split_mode`). `DraftConversationPage` accepte `?split=<cardId>&mode=direct&prompt=<texte>` (le `?prompt=` du proto devient réel : pré-remplit le premier message). | `purpose`/`splitCardId` oui ; mode et `?prompt=` non. |
| **Consigne d'affinage** | skill `/affiner-un-jalon` cité par le proto | Étendre `splitBriefing` quand `splitCardId` désigne un jalon (proposé plutôt qu'un skill : la consigne vaut pour les quatre CLI et se teste) : le cap du projet ; lire la carte, le board, le code ; **mode questions** : poser ses questions **avec l'outil de question du CLI, toutes à la fois**, puis attendre ; **mode direct** : ne questionner que sur les points laissés ouverts ; déposer avec `propose_cards` en `parent: existing` = le jalon ; un **ajout** (message « Ajout au jalon : … ») se range soit en sous-tâches d'une carte existante (`request_card_change` + `add_subtasks`), soit en nouvelles cartes (`propose_cards`, `blocked_by` la carte la plus proche). Si Tim veut quand même un skill `affiner-un-jalon`, il se livre par la source de la carte #156 et le briefing le cite. | `splitBriefing` oui, à étendre. |
| **État de l'affinage d'un jalon** (t'attend / travaille / terminée / pas lancée, mode, brouillon en attente, ajout en attente) | `DemoRefine`, `RefineThread.state` | `CardDto.refinement: CardRefinementDto \| null` = la session `split` non archivée la plus récente dont `splitCardId` est la carte : `{ conversationId, title, status, mode, createdAt, draft: { requestId, count } \| null, change: { requestId, count } \| null }` (`draft` = `propose_cards` non résolu de cette session, `change` = `request_card_change` non résolu). Une requête de plus dans `GET /api/projects/:id/cards`, indexée. | Non. |
| **Lire le brouillon et l'ajout hors du fil** | `DraftEditor`, bloc `addition` | `GET /api/cards/:id/refinement` → `{ session, draft: { requestId, conversationId, draft: CardDraft } \| null, change: { requestId, conversationId, changes: CardChangeDto[] } \| null }` (la charge telle que le bloc du fil la lit). Décision : routes existantes `POST /api/conversations/:id/card-drafts/:requestId` et `POST …/card-filings/:requestId`. | Décisions oui ; lecture non. |
| **Questions d'affinage, réponse sur place** | `answerQuestion`, `QuestionLine` | Demandes ouvertes de la session d'affinage via `useSessionRequests` (`kind: 'question'`, plusieurs questions par demande) ; réponse `POST /api/conversations/:id/questions/:requestId` avec **toutes** les réponses : le champ par question garde la réponse localement, l'envoi part à la dernière (cohérent avec coque INB-8). ⚠ Le proto envoie question par question ; une demande CLI se répond en une fois. | Oui. |
| **Dernière activité de la session qui travaille** | `lastActivity` (`activity` du fil de démo) | Client : lire la dernière page du journal de la session (`GET /api/conversations/:id/events`) et résumer le dernier outil par `tool-summary` ; à défaut « Lit le projet… ». Pas de route nouvelle. | Oui (briques). |
| **Brouillon : renommer, retirer, réordonner, lier, ajouter, valider** | `renameDraftCard`, `removeDraftCard`, `moveDraftCard`, `toggleDraftAfter`, `addDraftCard`, `validateDraft` | Édition **locale** d'un `CardDraft` (comme `CardDraftPrompt`), contrôlée par `cardDraftProblems` ; ajout = clé libre (`k1`, `k2`…), `after` = la dernière ; valider envoie le brouillon corrigé. Réordonner change l'ordre de création (et donc les numéros). | Décision oui ; ajout/ordre côté client. |
| **Ajout au jalon** | `proposeAddition` (heuristique de mots-clés), `AdditionProposal` | Envoyer l'ajout à la session d'affinage : `POST /api/conversations/:id/messages` si elle vit, sinon créer une session `split` sur le jalon avec ce premier message. L'agent répond par `propose_cards` (cartes) ou par `request_card_change` avec **`add_subtasks`** (nouveau champ MCP : `string[]`, ≤ 30, chacune ≤ 300 car. ; appliqué par `appendSubtasks` au clic ; le bloc du fil `CardFilingPrompt` le montre). « Laisser tel quel » = refus de la demande. | Messages et décisions oui ; `add_subtasks` non. |
| **Préciser une carte** | `clarifyCard` (ajoute « **Précision** — … » à la description et lève « à préciser ») | Envoyer la précision **à la session qui a posé la carte « à préciser »** (la plus récente non archivée de la carte : `POST /api/conversations/:id/messages`) ; c'est elle qui ramène la carte « en cours » (consigne existante). Sans session : `PATCH /api/cards/:id` description complétée + `toClarify: false`. | Oui. |
| **Accepter, retirer un lien de cycle** | `acceptCard`, `removeBlock` | `POST /api/cards/:id/accept` ; `DELETE /api/cards/:bloqueur/blocks/:bloquée`. | Oui. |
| **Lancer en autonome, confiné** | `launchMilestone({mode:'auto', confined, concurrency})` | `POST /api/cards/:id/milestone` existant ; **ajouter** `mode` (défaut `auto`). | Oui sauf `mode`. |
| **Mode à la main** | `launchMilestone({mode:'manual'})`, `startCard`, `setRunMode` | Migration `milestone_runs.mode` (`manual` \| `auto`, défaut `auto`) ; `MilestoneRunDto.mode` ; en `manual` le tour **ne lance rien** mais adopte les sessions ouvertes, suit les blocages et termine le pilotage ; `updateMilestoneRunBody.mode` (passer en `auto` reprend les lancements ; repasser à la main = plus de lancements, les sessions continuent) ; note de jalon à chaque bascule. | Non. |
| **Lancer une carte à la main** | `startByHand`, « ▶ Lancer » de RUN-5 | `POST /api/cards/:id/milestone/cards/:cardId/launch` : crée un pilotage `manual` s'il n'y en a pas d'actif (mêmes refus que `launch` : dépôt, cycle, confinement), puis lance la carte par le même chemin que le pilotage (`launchCard` : arbre parti de la branche du jalon, mission, `advanceCardOnLaunch`) ; refusé si la carte n'est pas une enfant ouverte, acceptée, sans bloqueur ouvert (409 `milestone_card_not_ready`) ou si elle a déjà une session vivante. Corps : `{ confined: boolean \| null }`. Rend le `MilestoneRunDto`. | Non (le moteur oui). |
| **Confinement changé en cours** | `setRunConfined` | `updateMilestoneRunBody.confined: boolean \| null` ; revérifie la disponibilité (`environments.assertAvailable`) ; vaut pour les prochains lancements ; note de jalon. | Non. |
| **Pause / reprise / arrêt** | `setPaused` | `PATCH /api/cards/:id/milestone {state}`. | Oui. |
| **Ajouter une carte à un jalon lancé** | `addCardToMilestone` | `POST /api/projects/:id/cards {title, parentId}` ; l'adoption fait le reste. | Oui. |
| **Statut de pilotage d'une carte** | `runStatusOf` (`waiting/queued/working/review/merged/blocked`) | `MilestoneRunDto.cards[].status` (`waiting`, `queued`, `launching`→au travail, `working`, `reviewing`/`merging`→en revue, `blocked`, `done`→fusionnée, `abandoned`, `failed`). | Oui. |
| **Jalon « Lancé » jusqu'à la fusion de sa PR** | `run.prOpen`, `run.merged` | Le pilotage passe `finished` dès que les cartes sont closes : il ne suffit plus. `CardDto.branch: string \| null`, `CardDto.branchPr: { number, url, mergedAt: number \| null } \| null`. Migration `cards.branch_pr_merged_at`. `ParentPullRequests.sweep` relit aussi les PR de parente **ouvertes** (même rythme que l'ouverture, `RETRY_MS` en cas d'échec) et pose `branchPrMergedAt` quand la forge la dit fusionnée (fusion faite sur GitHub). | Ouverture oui ; état fusionné non. |
| **Fusionner la PR du jalon** | `mergeMilestonePr` | `POST /api/cards/:id/branch-pr/merge` (propriétaire du projet) : lit la PR (`forge.readPullRequest`), refuse si fermée (409 `branch_pr_closed`) ou déjà fusionnée, fusionne (`forge.mergePullRequest`, squash, `--match-head-commit`), pose `branchPrMergedAt`, note de jalon. **Ne clôt pas la carte** (la clôture reste le geste de #69, proposé par la suite). Erreur de forge → 502 avec son message. | `mergePullRequest` oui ; route non. |
| **Session bloquée d'un jalon lancé, réponse** | `answerBlock`, `answerCardSession` | Demandes ouvertes (`useSessionRequests`) ; réponse par les routes de demande existantes (coque INB-6). | Oui. |
| **Étiquette « Jalon #N » d'une session d'affinage** | — | `ConversationDto.milestone` (coque §3) doit aussi résoudre **`splitCardId`** (la session d'affinage appartient à son jalon). | Non (coque). |
| **Repère ambre et sessions vivantes à jour** | `awaitsMe`, `liveSessions` sur `card.conversations[].status` | `CardConversationDto.status` est l'état **au chargement** ; recouvrir par l'état du WebSocket (`useLiveConversations`), comme la fiche du proto le fait déjà. Hook `useLiveCardStatuses(cards)`. | Briques oui. |
| **Début du pilotage** (`runStart`), concurrence | `useActiveMilestones` | `MilestoneRunDto.createdAt`, `concurrency`. | Oui. |
| **Branche du jalon avant lancement** | `slug()` local | `GET /api/cards/:id/milestone/plan` → `branch`. | Oui. |
| **Fiche : question de démo** | `question ?? 'Je peux supprimer…'` | Demande réelle (`useSessionRequests`). | Oui. |

---

## 4. Composants génériques à extraire

### 4.1 Design system (`~/projects/solera-ds`)

Règle (AGENTS.md) : les primitives ne savent rien du produit, une valeur se change dans
`src/tokens.ts`, une primitive ajoutée reçoit sa story, on pousse le DS puis on épingle
le commit dans `apps/web/package.json` **et** `apps/catalog/package.json`.

| Élément | Changement | API |
| --- | --- | --- |
| `ChoiceList` | Sert LCH-4 (mode) et LCH-5 (environnement). Le proto montre un **rond** à droite (mode) et un **radio** à gauche (environnement) là où `ChoiceList` met une coche. Ajouter l'indicateur `radio` (rond vide / plein, place réservée comme la coche) ; libellé de groupe facultatif à l'écran (le panneau a son propre libellé de champ). | `ChoiceList<T>({ label, value, options, onChange, indicator?: 'check' \| 'radio', hideLabel?: boolean })` |
| `SegmentedControl` | RUN-2 (« À la main / Autonome ») : vérifier qu'il couvre le segment compact `text-xs` ; sinon taille `sm`. | `size?: 'sm' \| 'md'` |
| Page de règles | `Gabarits` : un paragraphe « Pastille d'étape » (ton par étape, infobulle de raison) et « Barre de Gantt » (pointillé = sans échéance, hachures = retard, losange = échéance) si Tim veut en faire une règle commune avec le portefeuille ; sinon rien. | — |

Rien d'autre ne va au DS : maturité, Gantt, vagues, composer savent ce qu'est une carte.

### 4.2 Composants d'application (`apps/web`, story dans le même commit)

| Composant / module | Rôle et consommateurs | API proposée |
| --- | --- | --- |
| `lib/milestone-model.ts` (pur) | MAT-1 à MAT-12 : jalons et idées d'un projet, maturité, raisons, prochaine action, demandes. **Consommé par** Jalons, page d'un jalon, Aperçu `combo`, panneau Projet, portefeuille Jalons, « Ce qui t'attend ». | `type Maturity` ; `MATURITIES` ; `isMilestone(card)` ; `cardState(card)` ; `isLate(card, now)` ; `awaitsMe(card, live)` ; `cycleOf(cards)` ; `layersOf(cards)` ; `chainOf(cards, id)` ; `analyseMilestone({ card, children, run, now, pendingQuestions }) : MilestoneEntry` ; `horizonOf({ cards, runs, questionsByConversation, now }) : MilestoneEntry[]` ; `nextAction(entry) : { kind: NextActionKind; count?: number; cards?: number[]; question?: string }` (des **clés**, pas des phrases) ; `maturityReasons(entry) : Reason[]` ; `milestoneAsks(entry) : MilestoneAsk[]`. |
| `lib/milestones.ts` (étendu) | Hooks réseau. | `useMilestones(projectId)` → `{ entries, isPending }` (cartes + pilotages actifs + demandes ouvertes + statuts vivants) ; `useMilestoneRefinement(cardId)` ; `useLaunchMilestoneCard(cardId)` ; `useMergeMilestonePr(cardId)` ; `useLaunchMilestone`/`useUpdateMilestone` étendus (`mode`, `confined`). |
| `lib/card-destination.ts` | FCH-10, consommé par toutes les vues de cartes hors board (Aperçu, Travail, portefeuille, sessions). | `cardDestination(projectId, card, live?) : string` ; `sessionOf(card, live?)`. Pour un jalon sans session de travail, la session d'affinage (`card.refinement`) compte. |
| `components/milestones/MaturityPill.tsx` | MAT-8. | `<MaturityPill maturity entry? />` |
| `components/milestones/MaturitySteps.tsx` | MAT-9 (traits) et JAL-5 (étapes expliquées, popovers). | `<MaturitySteps maturity />` ; `<ExplainedSteps entry action onAct />` |
| `components/gantt/` | Échelle et dessin, partagés par l'horizon, le Gantt, le portefeuille (coque PF-29/30). | `scaleOf(cards, zoom, now, minWidth): Scale` ; `useAxisWidth(ref, listWidth)` ; `useScrollToNow(ref, scale, listWidth, now)` ; `barOf(card, now)` ; `<GanttAxis scale zoom now />` ; `<GanttGrid scale zoom height now today? />` ; `<TodayLine scale height now />` ; `<CardBar card scale top onOpen hovered dimmed onHover now labelInside? />` ; `<GanttArrows anchors width height chain />` ; `anchorsOf(cards, centerY, scale, now)` ; `<FloatingTip anchor>` ; `type Zoom = 'week' \| 'month'`. Formats de date par la langue courante (pas `fr-FR` en dur). |
| `components/milestones/WaveGraph.tsx` | VAG ; aussi la mini-vague de l'Aperçu `combo`. | `<WaveGraph projectId cards concurrency launchedAt />` |
| `components/milestones/Horizon*.tsx` | HOR (axe daté `MilestoneAxis`, tuiles `WaveTile`), CAP. | `<CapBlock project />` ; `<MilestoneAxis entries zoom />` ; `<WaveTiles entries />` |
| `components/milestones/MilestoneGantt.tsx` | GNT (groupes, repli). | `<MilestoneGantt projectId zoom keep />` |
| `components/writing/BriefField.tsx` | WRT + PJ : champ d'écriture à mentions `#`, liens, fichiers. Générique (réutilisable ailleurs : nouvelle carte, idée). | `<BriefField value onChange rows placeholder cards attachments onSubmitShortcut aside? textRef />` ; `useBriefAttachments(cards, text, setText)` → `{ cards, modeOf, setMode, removeCard, links, addLink, removeLink, files, addFiles, removeFile, count, reset }` ; `<AttachedPieces attachments cards allowInclude />` ; `linkPiece(url)` (pur). |
| `lib/brief.ts` (pur) | BRF : `readBrief`, `titleFromBrief`, `announce` (rend une **clé** + paramètres). Motifs FR **et** EN. | `readBrief(text, lang)` |
| `components/milestones/NewMilestoneDrawer.tsx`, `AddToMilestoneDrawer.tsx` | CMP, ADD. | `<NewMilestoneDrawer open onClose project cards />` ; `<AddToMilestoneDrawer open onClose milestone cards />` |
| `components/milestones/RefinementPanel.tsx` | AFF (session, questions, brouillon, ajout). | `<RefinementPanel entry />` |
| `components/milestones/DraftEditor.tsx` | AFF-6. Remplace à terme l'édition de `CardDraftPrompt` ? Non : celui-ci reste dans le fil ; les deux partagent `lib/card-draft-edit.ts` (renommer, retirer, déplacer, lier, ajouter : fonctions pures sur `CardDraft`). | `<DraftEditor draft onChange blocked onValidate busy error />` |
| `components/milestones/SettleList.tsx` | RGL. | `<SettleList entry />` |
| `components/milestones/LaunchPanel.tsx`, `RunPanel.tsx` | LCH, RUN. | `<LaunchPanel entry plan environments />` ; `<RunPanel entry run />` |
| `components/cards/CardInfoButton.tsx`, `CardSheetHost.tsx`, `CardSheet.tsx` | FCH, FLG ; monté par chaque page hors board. | `<CardInfoButton card />` ; `<CardSheetHost projectId />` (lit `?fiche=`) |

Chaque composant d'application reçoit sa story (`apps/catalog`) avec des cartes de
fixture (`components/board/card-fixtures.tsx` existe).

---

## 5. i18n

Toutes les chaînes du proto sont en dur. Familles de clés à créer (fr + en), en
réutilisant ce qui existe (`milestone.*`, `milestoneRun.status.*`, `milestone.block.*`,
`cardDraft.*`, `environment.*`, `project.environment.*`, `board.column.*`) :

| Famille | Contenu |
| --- | --- |
| `milestones.toolbar.*` | `search` (« Chercher un jalon »), `filter`, `display`, `displayCurrent` (« Affichage : {view} »), `add` (« Jalon »). |
| `milestones.filter.*` | `maturity`, `due`, `late` (« En retard »), `lateChip` (« en retard »), `clear` (« Effacer tous les filtres »). |
| `milestones.view.*`, `milestones.scale.*` | `horizon`, `gantt` ; `title` (« Échelle du temps »), `week`, `month`. |
| `milestones.cap.*` | `label` (« Cap »), `add`, `edit` (« Modifier le cap »), `placeholder`, `cancel`, `save`. |
| `milestones.horizon.*` | `now`, `nowHint`, `nowEmpty`, `next`, `nextHint`, `nextEmpty`, `later`, `laterHint`, `laterEmpty`, `axisHead` (« Jalon »), `sinceLaunch` (« +{count} depuis le lancement »), `awaiting` (« {count} t'attend » / pluriel), `openCards`, `notSplit`, `due` (« échéance {when} »). |
| `milestones.tooltip.*` | `maturity`, `cards` (« {done}/{total} faites »), `created`, `launched`, `due`, `noDue` (« aucune »), `lateBy` (« {days} j de retard »), `sessions` (« {count} vivante(s) »), `openHint` (« Clic : ouvrir sa session »). |
| `milestones.maturity.*` | `label.{idea,refine,split,ready,launched,delivered}` ; `rule.{étape}.when` / `.leave` ; `reason.*` (une clé par raison : `noCards`, `questions`, `draft`, `refining`, `toClarify`, `notAccepted`, `cycle`, `noStartable`, `startable`, `merged`, `paused`, `blocked`, `prOpen`, `delivered`) ; `aria` (« Maturité : {step} ») ; `step.{position,now,passed,coming,whyHere,toNext,wasWhen,willBeWhen,why,mobile}`. |
| `milestones.next.*` | `{kind}.label` / `{kind}.detail` pour `refine`, `validateDraft`, `answer`, `settle`, `undoCycle`, `reviewDeps`, `launch`, `merge`, `answerBlock`, `follow`, `review`. |
| `card.state.*` | `todo`, `blocked`, `running`, `review`, `done`, `abandoned` (« À faire »… ; distinct des colonnes du board : « Bloquée » est déduit). |
| `gantt.*` | `today` (« auj. »), `weekShort` (« S{n} »), `headList` (« Jalon / carte »), `headDue` (« échéance »), `outside` (« Hors jalon »), `fold`, `unfold`, `launched` (« lancé »), `empty`. Mois et jours par `Intl` dans la langue courante. |
| `milestones.composer.*` | `eyebrowNew`, `eyebrowAdd`, `titleAria`, `untitled`, `titleDerived`, `titleHint`, `placeholderNew` (l'exemple de brief, traduit), `placeholderAdd`, `entersIn`, `gesture.{note,refine,split}`, `why.{empty,insufficient,emptyAdd}`, `then.{note,refine,split}`, `agentNote`, `addHint`, `addTooltip`, `propose` (« Proposer à l'agent »), `cancel`, `close`, `noted` (« Idée notée : #{number}… »), `created`, `partialFailure`. |
| `brief.*` | `announce.{empty,phrase,brief,briefOpen}` ; `spotted` (« Repéré ») ; `chip.{objective,steps,constraints,outOfScope,openPoints,cards,links,files}` ; **vocabulaire des motifs** `brief.pattern.{constraints,outOfScope,objective,steps,must,openPoint}` par langue (le lecteur essaie la langue de l'interface puis l'autre). |
| `writing.*` | `card`, `cardTip` (« Joindre une carte — tape # »), `link`, `linkTip`, `file`, `fileTip`, `linkPlaceholder`, `linkAria`, `linkCancel`, `drop` (« Dépose pour joindre »), `suggestHint`, `due`, `dueRemove`. Colonnes : `board.column.*` (forme courte). |
| `attachments.*` | `joined` (« Joint · {count} »), `remove` (« Retirer {name} »), `ref`, `refTip`, `include`, `includeTip`, `refOrInclude` (aria), `inParent` (« dans #{n} {title} »), `size.{bytes,kb,mb}`, `pr` (« PR #{n} »), `issue`. |
| `milestone.page.*` | `back` (« Jalons »), `notMilestone` (« #{number} n'est pas un jalon »), `noDue`, `due`, `sinceLaunch`, `addTo` (« Ajouter au jalon »), `nextAction` (« Prochaine action »). |
| `milestone.waves.*` | `title`, `hint` (« ce qui part ensemble… · {count} à la fois »), `empty`, `wave` (« Vague {n} »), `finished`, `open` (« {count} ouverte(s) »), `passes`, `parallel`, `by` (« par {cards} »), `after`, `added`, `addedList`, `awaiting`. |
| `milestone.refine.*` | `title`, `state.{waiting,working,done,none}`, `mode.{questions,direct}`, `start` (« Affiner avec un agent »), `direct`, `open` (« Ouvrir la session »), `intro`, `doneText`, `answerHere`, `answerPlaceholder`, `send`, `draftWaiting`, `working` (repli de la dernière activité), `prompt.*` (premier message : en-tête, cap, cartes jointes, liens, demande de découpage direct, ajout). |
| `milestone.draft.*` | `eyebrow`, `count`, `after`, `nothing` (« rien : part tout de suite »), `startsNow`, `up`, `down`, `remove`, `addPlaceholder`, `validate`, `answerFirst`. Problèmes : `cardDraft.problem.*` existants. |
| `milestone.addition.*` | `subtask` (« Ranger dans #{n}, en sous-tâche »), `cards` (« {count} nouvelle(s) carte(s) dans le jalon »), `afterCard`, `startsNow`, `dismiss`, `acceptSubtask`, `acceptCards`. |
| `milestone.settle.*` | `title`, `pending` (« {count} point(s) en attente »), `toClarifySince`, `clarifyPlaceholder`, `clarify`, `notAccepted`, `accept`, `cycle`, `blocks` (« #{a} bloque #{b} »), `unlink`, `sent`. |
| `milestone.launch.*` | `title`, `subtitle`, `modeAria`, `manual`, `manualHint`, `auto`, `autoHint`, `manualIntro`, `autoIntro`, `environment`, `services`, `servicesValue.{shared,copy}`, `servicesInSettings`, `notConfined`, `concurrency`, `branch`, `cli`, `cliValue`, `ready`, `toSettle` (« Avant de partir : {count} point(s) à régler »), `check.{clear,accepted,noCycle,startable,concurrency}` et leurs échecs, `onlyBlocks`, `launchAuto`, `launchCard` (« Lancer »), `waits` (« attend »), `nothingYet`, `delivered`, `deliveredText`. Environnements : `environment.{host,host.confined,devcontainer,devcontainer.confined}` + **indices** `environment.hint.*` (nouveaux). |
| `milestone.run.*` | `title.{paused,auto,manual}`, `since`, `places`, `manualLine`, `branch`, `confined`, `status.{waiting,queued,working,review,merged,blocked,abandoned,failed}`, `addPlaceholder`, `add`, `pause`, `resume`, `stop`, `stopConfirm`, `footnote`, `prOpen`, `prText`, `merge` (« Fusionner dans {base} »), `openPr`, `mergeFailed`. |
| `card.sheet.*` | `infoAria` (« Détail de la carte #{number} »), `infoTip`, `milestone` (« Jalon #{n} {title} »), `sessions`, `noSessions`, `session.{awaiting,running,error,interrupted,idle}`, `subtasks`, `links`, `blockedBy`, `blocks`, `inside`, `description`, `noDescription`, `notes`, `notesOf` (« 3 sur {count} »), `openSession`, `launchSession`, `seeInBoard`, `flag` (« C'est un jalon »), `flag.{forced,child,free}`. |

Erreurs serveur nouvelles (codes traduits par `lib/api`) : `card_milestone_child`,
`milestone_card_not_ready`, `milestone_card_running`, `branch_pr_closed`,
`branch_pr_merged`, `branch_pr_missing`.

---

## 6. Plan TDD

Le dépôt n'a **pas vitest** : les tests unitaires sont `node:test` via `tsx`
(`pnpm --filter @solera/server test`, `apps/server/test/*.test.ts`), et les modules purs
du web s'y testent en les important (`../../web/src/lib/…`, comme
`tool-summary.test.ts`). Les composants se vérifient dans une suite Playwright
`scripts/*-ui-check.mjs` (navigateur via `launchBrowser()`, fournisseurs par
`viteDependency()`, Chromium avec
`LD_LIBRARY_PATH=$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu`) ; ces suites
écrivent des captures : **ne lancer que celle du sujet touché**. Nouvelle suite
proposée : `scripts/milestones-ui-check.mjs` (`pnpm test:milestones-ui`), données posées
par l'API et, pour les demandes d'agent, par insertion dans `agent_requests` comme
`card-draft-ui-check.mjs`.

| Comportement | Test |
| --- | --- |
| FLG : migration remplit le drapeau des parentes ; PATCH `milestone` ; 409 sur une enfant ; drapeau posé au premier enfant (rattachement, création, brouillon, promotion) ; levé au rattachement ; parente `new` drapeautée | `apps/server/test/card-milestone-flag.test.ts` (sur le modèle de `card-fields.test.ts`) + `migrations-cascade.test.ts` étendu |
| Cap : PATCH, trim, 280 max, vide → null ; présent dans `ProjectDto` | `api-projects.test.ts` étendu |
| Création avec `dueAt` + `milestone` | `card-fields.test.ts` étendu |
| `splitMode` stocké ; briefing d'affinage (cap, mode, outil de question, `parent: existing`, ajout) | `apps/server/test/milestone-refinement.test.ts` (briefing lu comme `agent-requests.test.ts` lit les consignes) |
| `CardDto.refinement` : dernière session `split` non archivée, `draft`/`change` en attente, `null` sans session ; `GET /api/cards/:id/refinement` (charge du brouillon et des changements, droits) | `milestone-refinement.test.ts` |
| `request_card_change.add_subtasks` : validation (bornes), affichage, application par `appendSubtasks` au clic, refus | `card-filing.test.ts` étendu |
| `milestone_runs.mode` : `manual` ne lance rien, adopte une session ouverte, termine ; bascule `manual`→`auto` lance au tour suivant ; `confined` modifiable et revérifié | `milestone-runs.test.ts` étendu |
| `POST …/milestone/cards/:cardId/launch` : crée un pilotage manuel, lance la carte dans un arbre parti de `jalon/…`, refus (non prête, non acceptée, déjà en cours, cycle, non dépôt) | `milestone-runs.test.ts` étendu |
| PR finale : `branchPr` dans `CardDto` ; balayage qui pose `mergedAt` (forge factice) ; route de fusion (fusionne, refuse fermée/fusionnée/absente, droits, erreur de forge) | `reviews.test.ts` / nouveau `parent-pr.test.ts` (forge factice comme dans `reviews.test.ts`) |
| MAT-2 à MAT-7 : chaque règle de maturité (idée, affinage par question / brouillon / session vivante, à régler par chaque raison, prêt, lancé par pilotage actif **et** par PR ouverte non fusionnée, livré), `cycleOf`, `layersOf` (cycle coupé), `chainOf`, `nextAction` (chaque branche), `maturityReasons`, `milestoneAsks` | `apps/server/test/milestone-model.test.ts` important `../../web/src/lib/milestone-model.js` |
| `cardDestination` (attente → fiche, priorité des sessions, archivées exclues, sans session → brouillon, jalon → session d'affinage) | `milestone-model.test.ts` |
| `scaleOf` (lundis, marge, étirement, ≥ 3 px/j en mois), jours au changement d'heure, `barOf`, `anchorsOf`, contournement | `apps/server/test/gantt-scale.test.ts` important `components/gantt/scale.js` (logique pure sortie des composants) |
| BRF : `readBrief` (étapes, contraintes par section et par mot, hors champ, objectif en ligne et en section, points ouverts, premier titre ignoré, suffisance), en FR et EN ; `titleFromBrief` (titre, phrase, 70 car.) ; `announce` ; `linkPiece` (PR, issue, chemin, hôte, URL invalide) | `apps/server/test/brief.test.ts` |
| Édition de brouillon : renommer, retirer (liens nettoyés), déplacer, basculer un lien, ajouter (clé libre, après la dernière), `cardDraftProblems` sur le résultat | `apps/server/test/card-draft-edit.test.ts` |
| BAR, HOR, CAP : barre (recherche `#901`, filtres + comptes, puces, effacer, vue mémorisée, échelle), cap (ajouter, modifier, vider), sections et vides, tri, tuiles (lien, action), axe (survol, infobulle, « t'attend ») | `milestones-ui-check.mjs` — étape « horizon » (fenêtre large et 390 px) |
| GNT : groupes, livrés repliés, déplier, clic titre → page, clic carte → destination, survol (chaîne, infobulle), « Hors jalon », vide | `milestones-ui-check.mjs` — étape « gantt » |
| CMP, WRT, PJ : `#` (liste, ↑↓, Entrée, Échap retire le `#` seul sans fermer le tiroir), coller une URL, lien en place, fichier, Réf./Inclure, gestes activés selon le texte, aperçu au survol, `⌘↵`, « Noter l'idée » (carte créée drapeautée, échéance, relations, enfant incluse, toast), « Affiner » (brouillon de conversation `?split=` pré-rempli) | `milestones-ui-check.mjs` — étape « composer » |
| JAL, VAG : maturité expliquée (popover par étape, bouton d'action, téléphone), défilement vers `#affinage`/`#lancer`, vagues (colonnes, arêtes, survol, empilement < 560 px) | `milestones-ui-check.mjs` — étape « page » |
| AFF, RGL, ADD : session d'affinage posée en base (états), question répondue sur place (fausse demande de question), brouillon édité puis validé (cartes enfants créées, liens), ajout envoyé (message en file), proposition d'ajout acceptée / laissée, préciser (message à la session), accepter, retirer un lien de cycle | `milestones-ui-check.mjs` — étape « affinage » (aucun CLI ne tourne : les messages restent en file, comme `card-draft-ui-check.mjs`) |
| LCH, RUN : vérifications et bouton désactivé, mode autonome confine d'office, environnements filtrés, lancer une carte à la main (pilotage manuel créé), bascule de mode, pause/reprise/arrêt (confirmation), ajouter une carte, PR ouverte → « Fusionner » (forge factice impossible en UI : vérifier l'appel et l'erreur rendue) | `milestones-ui-check.mjs` — étape « lancer » |
| FCH, FLG : `ℹ` n'ouvre pas la session, `?fiche=` partageable, sections, liens qui changent de fiche, case « C'est un jalon » (forcée, grisée, cochable → idée dans « Plus tard ») | `milestones-ui-check.mjs` — étape « fiche » |
| Stories | `pnpm build:catalog` passe ; une story par composant d'application ajouté |
| Retrait de l'ancien | `places-ui-check.mjs` adapté (il cherche aujourd'hui des boutons de la frise sur `/timeline`) |

---

## 7. Découpage en cartes

Dix-huit cartes. Chacune = une session, une PR. Les critères d'acceptation renvoient
aux identifiants du §1 ; « référence 1:1 » = les fichiers du proto à reproduire.

### 1. Serveur : drapeau « jalon » et cap du projet

Ajouter le drapeau d'une carte et la phrase de cap d'un projet. Migration
`cards.milestone` (remplie pour les cartes qui ont des enfants) et `projects.cap` ;
`CardDto.milestone`, `ProjectDto.cap` ; `createCardBodySchema` + `dueAt`, `milestone` ;
`updateCardBodySchema.milestone` ; `updateProjectBodySchema.cap`. Règles du §3 (pose
automatique au premier enfant, 409 sur une enfant, levée au rattachement, parente `new`
d'un brouillon drapeautée). MCP `list_cards` / `read_card` disent « jalon ». Réécrire
les commentaires de `schema.ts` et `CardDto` (« un jalon n'est pas un type » n'est plus
vrai). Référence : `flags.ts`, `CardDrawer.tsx:MilestoneFlag`, `CapBlock`.
**Acceptation** : FLG-1 (côté serveur), CAP-1..3 (données). **Tests** : §6 lignes FLG,
cap, création. **Dépendances** : aucune.

### 2. Serveur : session d'affinage d'un jalon

`splitMode` à la création d'une conversation (`questions` | `direct`, stocké) ;
`splitBriefing` étendu pour un jalon (cap, mode, questions par l'outil de question du
CLI toutes à la fois, `propose_cards` en `parent: existing`, traitement d'un « Ajout au
jalon ») ; `CardDto.refinement` ; `GET /api/cards/:id/refinement` ;
`ConversationDto.milestone` résout `splitCardId` (si la carte coque 5 l'a déjà livré,
sinon l'ajouter ici). Référence : `refineSession.ts`, `demo-store.ts` (`openRefine`,
`DemoRefine`), `RefineThread.tsx` (états). **Acceptation** : AFF-1 (données d'état), AFF-5
(questions = demandes ouvertes), AFF-6 (brouillon lisible hors du fil). **Tests** :
`milestone-refinement.test.ts`. **Dépendances** : après 1.

### 3. Serveur : ajout au jalon en sous-tâches (`request_card_change.add_subtasks`)

Champ `add_subtasks` de l'outil MCP et de sa charge, validation, application au clic
(`appendSubtasks`), affichage dans le bloc du fil (`CardFilingPrompt`) et dans
`GET /api/cards/:id/refinement` (`change`). Référence : `AdditionProposal` (`kind:
'subtask'`), `acceptAddition`. **Acceptation** : AFF-7 côté serveur. **Tests** :
`card-filing.test.ts` étendu. **Dépendances** : après 2.

### 4. Serveur : pilotage à la main, bascule de mode, lancement d'une carte

`milestone_runs.mode`, `MilestoneRunDto.mode`, `startMilestoneBody.mode`,
`updateMilestoneRunBody.mode` / `.confined` ; tour sans lancement en `manual` ; route
`POST /api/cards/:id/milestone/cards/:cardId/launch` ; notes de jalon. Référence :
`demo-store.ts` (`launchMilestone`, `startCard`, `setRunMode`, `setRunConfined`).
**Acceptation** : LCH-8, RUN-2, RUN-4 (côté serveur). **Tests** : `milestone-runs.test.ts`.
**Dépendances** : aucune.

### 5. Serveur : PR finale du jalon — état fusionné et fusion

`CardDto.branch`, `CardDto.branchPr { number, url, mergedAt }` ; migration
`cards.branch_pr_merged_at` ; balayage des PR de parente ouvertes ; route
`POST /api/cards/:id/branch-pr/merge`. Référence : `mergeMilestonePr`, `RunPanel` (PR
ouverte). **Acceptation** : RUN-9, RUN-12, MAT-2 « Lancé jusqu'à la fusion » (données).
**Tests** : `parent-pr.test.ts`. **Dépendances** : aucune.

### 6. Web : modèle des jalons (maturité, prochaine action, destination)

`lib/milestone-model.ts` pur (MAT-1 à MAT-12 avec la règle réelle : Lancé = pilotage
actif **ou** PR de jalon ouverte non fusionnée ; À affiner = brouillon en attente,
questions ouvertes de la session d'affinage, ou session d'affinage vivante sur un jalon
sans cartes), `lib/card-destination.ts` (FCH-10), hooks `useMilestones`,
`useLiveCardStatuses` ; clés i18n `milestones.maturity.*`, `milestones.next.*`,
`card.state.*` ; `MaturityPill`, `MaturitySteps` (+ stories). Expose `milestoneAsks` pour
« Ce qui t'attend » (coque INB-8..10). Référence : `maturity.ts`, `model.ts`,
`destination.ts`. **Acceptation** : MAT-1..12, FCH-10. **Tests** :
`milestone-model.test.ts`. **Dépendances** : après 1, 2, 4, 5. *Débloque aussi l'Aperçu
`combo`, le panneau Projet et le portefeuille Jalons.*

### 7. Web : primitives du Gantt

`components/gantt/` : `scaleOf`, `useAxisWidth`, `useScrollToNow`, `barOf`,
`GanttAxis`, `GanttGrid`, `TodayLine`, `CardBar` (+ infobulle), `GanttArrows`,
`anchorsOf`, `chainOf`, `FloatingTip` ; formats de date dans la langue courante ;
stories. Référence 1:1 : `gantt.tsx` (sans `ZoomToggle`, `Legend`, `DemoNotice`).
**Acceptation** : GNT-2, GNT-3, GNT-4, GNT-6, GNT-10, GNT-11 (infobulle de carte),
GNT-12. **Tests** : `gantt-scale.test.ts`. **Dépendances** : aucune. *Partagé avec la carte
16 de `coque.md` (portefeuille Jalons).*

### 8. Web : onglet Jalons — barre, cap et horizon

Remplacer `ProjectTimelinePage` : `OneLineToolbar` (recherche, Filtrer, puces,
Affichage, « + Jalon » qui ouvre pour l'instant un tiroir vide ou rien tant que la carte
11 n'est pas là), mémoire de vue, `CapBlock` (PATCH `cap`), chaîne de maturité, sections
Maintenant / Ensuite / Plus tard, axe daté (`MilestoneBar` d'horizon, trait du
lancement, infobulle), tuiles de vague. Crée `scripts/milestones-ui-check.mjs` et adapte
`places-ui-check.mjs`. Référence 1:1 : `HorizonVariant.tsx` en `mode="vues" flux="v2"`.
**Acceptation** : BAR-1..7, CAP-1..3, HOR-1..13. **Tests** : étape « horizon ».
**Dépendances** : après 6, 7, coque 2 et 4 (coque, barre sur une ligne).

### 9. Web : vue Gantt détaillé

`MilestoneGantt` : groupes par jalon + « Hors jalon », repli (livrés repliés), barre de
jalon par répartition d'états, lignes de cartes, survol et chaîne, filtre et échelle de
la barre, vide ; titre de groupe → page du jalon. Référence 1:1 :
`TimelineVariants.tsx:GanttClassic` (`bare`). **Acceptation** : BAR-8, GNT-1, GNT-5,
GNT-7, GNT-8, GNT-9, GNT-13. **Tests** : étape « gantt ». **Dépendances** : après 7, 8.

### 10. Web : champ d'écriture à mentions, liens et fichiers

`BriefField` + `useBriefAttachments` + `AttachedPieces` + `linkPiece` ; `lib/brief.ts`
(`readBrief` FR/EN, `titleFromBrief`, `announce`) ; Échap par couches (`useEscapeLayer`
de la coque) ; stories. Référence 1:1 : `MilestoneComposer.tsx:59-650` (`Writing`,
`WriteToolbar`, `DueField`, `Piece`, `Joined`, `Spotted`), `brief.ts:1-160`.
**Acceptation** : WRT-1..10, PJ-1..5, BRF-1..4, CMP-5. **Tests** : `brief.test.ts`, étape
« composer » (partie champ). **Dépendances** : après coque 3 (tiroir commun et couches).

### 11. Web : tiroir « Nouveau jalon » et création réelle

`NewMilestoneDrawer` : en-tête (titre dérivé), champ, échéance, Réf./Inclure, pied
(étape d'arrivée, phrase, repéré, aperçu au survol), trois gestes et leurs
désactivations, `⌘↵` ; création (carte drapeautée + échéance, relations, inclusions,
pièces jointes, liens) ; « Noter » → toast ; « Affiner » / « Découper » → brouillon de
conversation `?split=<id>&mode=…&prompt=…` (support de `?prompt=` et `?mode=` dans
`DraftConversationPage`, sans le repère `proto-carte`) ; branché sur « + Jalon ».
Référence 1:1 : `MilestoneComposer.tsx:652-822`, `refineSession.ts:refinePrompt`,
`maturity.ts:ENTRY_STAGE`, diff `DraftConversationPage.tsx`. **Acceptation** :
CMP-1..16, BAR-7. **Tests** : étape « composer ». **Dépendances** : après 1, 2, 8, 10.

### 12. Web : page d'un jalon — en-tête, maturité expliquée, vagues

Remplacer `ProjectMilestonePage` : vide « n'est pas un jalon », retour, en-tête (sans
« Ajouter au jalon » encore actif), bande de prochaine action et `ExplainedSteps`
(popovers, téléphone), geste de la prochaine action (navigation et défilement), mise
en page une / deux colonnes avec emplacements `#affinage` et `#lancer`, `WaveGraph`.
Référence 1:1 : `MilestoneV2.tsx:95-336` (`flux="v3"`, sans `Journey`),
`MaturityExplain.tsx`, `waves.tsx`. **Acceptation** : JAL-1..8, VAG-1..10. **Tests** :
étape « page ». **Dépendances** : après 6.

### 13. Web : session d'affinage en place et brouillon éditable

`RefinementPanel` : états, mode, « Affiner avec un agent » / « Découper directement » /
« Ouvrir la session », dernière activité (journal + `tool-summary`), questions
répondables sur place (réponses groupées par demande), `DraftEditor` (renommer,
monter/descendre, pastilles « après », retirer, ajouter, valider via
`card-drafts`, problèmes), `lib/card-draft-edit.ts`. Référence 1:1 :
`RefineThread.tsx:29-323` (hors bloc d'ajout). **Acceptation** : AFF-1..6. **Tests** :
`card-draft-edit.test.ts`, étape « affinage ». **Dépendances** : après 2, 12.

### 14. Web : « À régler avant de partir » et « Ajouter au jalon »

`SettleList` (préciser → message à la session ou description, accepter, retirer un
lien de cycle ; **sans** la ligne de session bloquée, §2.6-1) ; `AddToMilestoneDrawer`
(message à la session d'affinage ou nouvelle session) ; bloc d'ajout proposé (AFF-7 :
cartes = brouillon, sous-tâche = changement de carte ; accepter / laisser) ; bouton
« + Ajouter au jalon » de l'en-tête. Référence 1:1 : `MilestoneV2.tsx:384-567`
(`Refine` en `rest`, `Answerable`), `MilestoneComposer.tsx:824-903`,
`RefineThread.tsx:144-169`. **Acceptation** : RGL-1, RGL-3..6, ADD-1..4, AFF-7, JAL-3
(bouton). **Tests** : étape « affinage ». **Dépendances** : après 3, 10, 13.

### 15. Web : panneau Lancer

`LaunchPanel` avant lancement : états Livré / rien à lancer, mode (ChoiceList radio),
environnements filtrés au `where` du projet, autonome confine d'office, services en
lecture, avertissement non confiné, concurrence 1-6 (+ avertissement de quota),
branche (plan), CLI, vérifications (échecs d'abord), « Lancer en autonome » ; à la
main : liste des cartes et « ▶ Lancer » (route de la carte 4). Change éventuel du DS
(`ChoiceList indicator="radio"`) poussé et épinglé avant. Référence 1:1 :
`MilestoneV2.tsx:589-806`, `925-954`. **Acceptation** : LCH-1..12. **Tests** : étape
« lancer ». **Dépendances** : après 4, 12.

### 16. Web : suivi d'un jalon lancé et PR finale

`RunPanel` sur `MilestoneRunDto` : titre et durée, bascule de mode, places ou ligne
manuelle, branche, confinement « pour les prochaines », cartes avec statut de pilotage
(raison de blocage en infobulle) et « ▶ Lancer » à la main, ajout de carte, Pause /
Reprendre / **Arrêter** (`ConfirmDialog`), concurrence en cours (si Tim le confirme),
note de pied ; PR ouverte → « Fusionner dans {base} » + « Ouvrir la PR ↗ », erreurs de
forge. Référence 1:1 : `MilestoneV2.tsx:808-923`. **Acceptation** : RUN-1..12.
**Tests** : étape « lancer ». **Dépendances** : après 5, 15.

### 17. Web : fiche de carte sur place (`ℹ`) et case « C'est un jalon »

`CardInfoButton`, `CardSheetHost` (`?fiche=`), `CardSheet` (en-tête, réponse sur place
via `AskInbox` bare, sessions vivantes, sous-tâches, liens navigables, description,
notes, pied, drapeau) ; montée par l'onglet Jalons et la page d'un jalon (les autres
domaines la montent chez eux). Si la spec Tableau prend la fiche, fusionner les deux
cartes. Référence 1:1 : `CardDrawer.tsx`. **Acceptation** : FCH-1..9, FLG-1. **Tests** :
étape « fiche ». **Dépendances** : après 1, coque 3 et 5 (tiroir, `AskInbox`).

### 18. Nettoyage du prototype des jalons

Supprimer `routes/prototype-milestones/` (une fois l'Aperçu, le panneau, le
portefeuille, Travail, Tableau et Planifiées sevrés de `useProtoData`, `useProtoHref`,
`DemoToggle`, `cardDestination`, `CardDrawerHost`, `DRAWER_PARAM`, `layersOf`, `DAY`,
`STATE_*` : vérifier par `grep -rn prototype-milestones apps/web/src`), les variantes
des deux pages, `CardMilestone` (+ story) remplacé par un lien « Ouvrir le jalon »,
`milestoneWaves`/`milestoneQueue`, les clés i18n devenues orphelines.
**Acceptation** : §0 et §2.7 vides ; `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm build:catalog`, `test:milestones-ui`, `test:places-ui` verts. **Dépendances** :
après 8, 9, 11, 13, 14, 15, 16, 17 (et les cartes de coque.md qui consomment ces modules).

### Graphe des dépendances

```
1 ──> 2 ──> 3
│     │      \
│     │       └──────────────────────────────┐
4 ─────────────┐                              │
5 ─────────────┤                              │
1,2,4,5 ──> 6 ──> 8 ──> 9                     │
7 ──────────────> 8                           │
coque 3 ──> 10 ──> 11 (après 1, 2, 8)         │
6 ──> 12 ──> 13 (après 2) ──> 14 (après 3, 10)┘
4 + 12 ──> 15 ──> 16 (après 5)
1 + coque 3, 5 ──> 17
tout ──> 18
```

Parallélisable dès le départ : 1, 4, 5, 7 (serveur et primitives) ; puis 2, 10 ; puis 6.

### Questions ouvertes pour Tim

1. §2.6 : ne pas recopier la demande d'une session bloquée dans la page du jalon ;
   environnements limités au `where` du projet ; services en lecture ; bouton de fusion.
2. §2.9 : ce que le proto retire du lancement actuel (CLI par jalon/carte, concurrence
   en cours, avertissement de quota, raison de blocage, pied « sans jalon ni date »).
3. Skill `affiner-un-jalon` ou briefing serveur (proposé : briefing, §3).
4. Rattacher une carte drapeautée sous une parente : lever le drapeau (proposé) ou refuser.
5. Garder le brouillon du composer « Nouveau jalon » à la fermeture (proposé : oui, par projet).
