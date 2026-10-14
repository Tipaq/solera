# Audit du bundle de `apps/web` — 2026-10-14

Constat chiffré pour la carte **#22** (« Le bundle principal frôle la limite de
précache »). **Aucune optimisation n'a été faite dans cet audit** : on mesure, on
évalue la découpabilité, on ne découpe pas.

## Méthode

- Worktree `audit/bundle-web`, `HEAD = c34f386` (`git describe` → `v0.16.0-53-gc34f386`).
- `pnpm install --ignore-scripts`, puis `npx vite build` dans `apps/web`
  (on passe `vite build` directement pour sauter l'`eslint src` du script `build` ;
  le résultat est le même bundle).
- `apps/web/vite.config.ts` a **déjà** `build.sourcemap: true` — aucune modification
  de configuration n'a été nécessaire, **rien n'a été ajouté ni commité** : pas de
  `rollup-plugin-visualizer`, pas de dépendance de mesure.
- `source-map-explorer` **échoue** sur ce chunk (« source map refers to generated
  column Infinity »). L'attribution a donc été refaite à la main : décodage des
  `mappings` VLQ de `index-*.js.map`, et attribution de chaque intervalle d'octets
  générés au module source dont il provient. Script jetable, non commité
  (`/tmp/attrib.mjs`).
- **99,81 %** des octets du chunk d'entrée sont attribués
  (2 066 060 / 2 069 899 o) ; 3 839 o restent non mappés (préambule du runtime).
  Les chiffres ci-dessous sont donc fiables à ~0,2 % près.

### L'unité qui compte est l'octet non compressé

La limite de `vite-plugin-pwa` (`maximumFileSizeToCacheInBytes`, 2 097 152 o par
défaut) s'applique à la **taille du fichier sur disque, minifié et non compressé**.
Le gzip et le brotli ne jouent donc aucun rôle dans la contrainte qui casse le
build. Ils sont donnés une fois, pour mémoire :

| mesure | octets | % du brut |
|---|---|---|
| minifié (ce qui compte) | **2 069 899** | 100 % |
| gzip -9 | 596 966 | 28,8 % |
| brotli -11 | 480 863 | 23,2 % |

## La marge réelle, et pourquoi elle diffère de la carte

La carte annonce **2 091 508 o / 5,6 Ko de marge**. Ce chiffre est juste, mais il ne
mesure pas `main` : `b60e0ba` est la pointe de la branche **`port/savoir`** (aussi
taguée `stable`), et **n'est pas un ancêtre de `HEAD`**. Le contexte Savoir (carte
#19) n'est pas encore fusionné — `packages/protocol/src/vault.ts` et les deux pages
du vault sont absents de cette branche.

| état | chunk d'entrée | marge sous 2 097 152 |
|---|---|---|
| `main` / `HEAD` = c34f386 (sans Savoir) | 2 069 899 o | **27 253 o** (26,6 Ko) |
| `port/savoir` = b60e0ba (carte #19) | 2 091 508 o | **5 644 o** (5,6 Ko) |

Autrement dit : les 5,6 Ko de marge ne sont pas la situation d'aujourd'hui sur
`main`, c'est la situation **le jour où la carte #19 fusionne**. Le portage Savoir
coûte +21 609 o au tronc, pages du vault déjà en `lazy` comprises. La contrainte
est réelle, mais son échéance est la fusion de #19, pas le prochain commit sur
`main`.

## Composition du chunk d'entrée

Regroupée par poste logique. Somme = 100 % des octets attribués.

| poste | octets | % |
|---|---|---|
| **CodeMirror + lezer** (`view`, `state`, `language`, `commands`, `search`, `@lezer/*`, `style-mod`…) | **339 468** | 16,4 % |
| **Catalogues i18n** (`catalog-fr` 122 371 + `catalog-en` 113 648) | **236 965** | 11,4 % |
| React + `react-dom` + `scheduler` | 193 886 | 9,4 % |
| **`cronstrue`** (entrée `cronstrue/i18n`, toutes les langues) | **176 998** | 8,6 % |
| Radix UI + floating-ui + aides (`react-remove-scroll`, `aria-hidden`…) | 142 860 | 6,9 % |
| **`markdown-it` + sa chaîne** (`entities`, `linkify-it`, `uc.micro`, `mdurl`, `punycode.js`) | **104 724** | 5,1 % |
| `lucide-react` (icônes effectivement utilisées) | 58 925 | 2,8 % |
| `zod` (via `@solera/protocol`) | 56 632 | 2,7 % |
| `@dnd-kit` (`core`, `sortable`, `utilities`, `modifiers`, `accessibility`) | 51 203 | 2,5 % |
| `@tanstack/react-query` + `query-core` | 46 097 | 2,2 % |
| `react-router` | 39 076 | 1,9 % |
| `croner` | 27 939 | 1,3 % |
| `fflate` | 9 014 | 0,4 % |
| **code applicatif** (`apps/web/src` hors i18n, + `@solera/ui` 17 758, + `@solera/protocol` 26 632) | **582 273** | 28,1 % |

Le code applicatif, par dossier de `apps/web/src` :

| dossier | octets |
|---|---|
| `lib/i18n` | 236 965 |
| `routes` | 121 160 |
| `components/chat` | 118 114 |
| `lib` (hors i18n) | 102 772 |
| `components` (racine) | 59 862 |
| `src` (racine : `App.tsx`, `main.tsx`…) | 52 578 |
| `components/skills` | 34 974 |
| `components/sidebar` | 22 912 |
| `components/board` | 21 923 |
| `components/panel` | 10 705 |
| `components/tools` | 9 428 |
| `components/instructions` | 9 162 |
| `components/mcp` | 7 426 |
| `components/schedule` | 7 312 |
| `components/settings` | 6 185 |

Les plus gros modules applicatifs isolés : `routes/ConversationPage.tsx` 16 273,
`components/chat/agent-settings.tsx` 15 158, `lib/chat-fold.ts` 11 021,
`components/chat/Composer.tsx` 10 809, `components/sidebar/PlaceProjects.tsx` 10 181,
`lib/instructions.ts` 10 164.

## Ce qui est déjà chargé à la demande — confirmé

Les quatre frontières `lazy()` de `apps/web/src` sont :
`EditorPane.tsx:39` (ModelView) et `SidePanel` dans `BoardPage.tsx:43`,
`ConversationPage.tsx:79`, `DraftConversationPage.tsx:39`.

| ce qui est hors du tronc | chunk | octets |
|---|---|---|
| `three` (visionneuse 3D) | `ModelView-*.js` | 719 322 (sur 726 591) |
| **`@xterm/xterm`** (terminaux) | `SidePanel-*.js` | 332 738 |
| `highlight.js/lib/common` | `common-*.js` | 162 444 |
| grammaires `@codemirror/lang-*` | chunks séparés par langage | — |
| grammaires highlight.js additionnelles | `ruby-*`, `nginx-*`, `powershell-*`, `perl-*`, `clike-*` | 5–22 Ko chacune |
| manifeste des 1250 icônes de fichiers | **absent du bundle** (`material-icons.json` : 0 occurrence dans le chunk d'entrée) | 0 |

**Réponse à la question xterm de la mission : xterm est déjà `lazy`**, à l'intérieur
du chunk `SidePanel`. Ce n'est pas un gisement.

`highlight.js` est chargé par `import()` dans `lib/highlight.ts:loadHighlighter()`,
avec rendu non coloré en attente — la coloration de syntaxe **n'est donc pas** dans
le tronc, contrairement à ce que supposait la piste 2 de la carte.

(Les deux pages du vault sont `lazy` sur `port/savoir` — vérifié dans
`git show b60e0ba:apps/web/src/App.tsx:33-34` — mais hors de cette branche.)

## Les gros postes encore *eager*, et leur découpabilité

### 1. CodeMirror — 339 468 o — **découpable d'un seul geste**

C'est le premier poste du tronc, et il y entre par **une seule route**. La chaîne
est sans embranchement :

```
App.tsx  →  routes/SkillEditorPage.tsx  (import statique)
              ├─ components/panel/CodeEditor.tsx
              │    └─ components/panel/editor-setup.ts  → @codemirror/{view,state,language,commands,search}
              └─ components/skills/SkillFiles.tsx → components/panel/CodeEditor.tsx
```

`SkillFiles.tsx` n'est utilisé **que** par `SkillEditorPage.tsx` (vérifié : aucune
autre référence dans `src`). `EditorPane.tsx`, l'autre consommateur de `CodeEditor`,
est déjà dans le chunk `SidePanel` lazy. Donc : passer la route `/skills/:skillId`
en `lazy()` dans `App.tsx` sort les 339 Ko du tronc, et c'est le même geste que
celui déjà appliqué à `SidePanel` et aux pages du vault.

C'est, de loin, le meilleur rapport gain/risque de l'audit : **12× la marge
manquante** pour une ligne.

### 2. Catalogues i18n — 236 965 o — **découpable, mais pas par une route**

`lib/i18n/catalogs.ts` importe statiquement `catalog-en` **et** `catalog-fr`. Les
deux sont dans le tronc alors qu'une session n'affiche qu'une langue. Le gisement
brut est de ~113 à 122 Ko (la langue non utilisée).

Ce n'est pas un découpage par écran : la locale est connue au démarrage, donc un
`import()` sur le catalogue choisi retarde le premier rendu de tout texte, et
`catalog-en` reste nécessaire au type `MessageKey` (import de type, effacé au build —
pas un problème) et comme repli. Techniquement faisable (charger le catalogue de la
locale résolue, avec `en` en repli synchrone ou les deux en chunks séparés), mais
cela touche le chemin de démarrage et demande une décision sur le comportement avant
résolution. **Découpable, coût de conception non nul.**

### 3. `cronstrue` — 176 998 o — **découpable, et surtout mal importé**

`lib/cron.ts:2` fait `import cronstrue from 'cronstrue/i18n'`. Dans le paquet :

| entrée | minifié |
|---|---|
| `cronstrue/i18n` (toutes les langues) | 186 140 o |
| `cronstrue` (anglais seul) | 22 033 o |

L'application n'a que deux langues. On paie 177 Ko dans le tronc pour une phrase
lisible décrivant un motif cron. Deux leviers, cumulables :

- **Sans aucun découpage** : importer l'entrée par défaut + la seule locale `fr`
  (`cronstrue/locales/fr`), au lieu du paquet complet. Gain de l'ordre de 150 Ko,
  sans toucher à la structure.
- **Avec découpage** : `cronToHuman()` est la seule fonction qui touche `cronstrue`
  (`lib/cron.ts:22`). Elle est appelée par `ScheduleDialog.tsx`, `SchedulePage.tsx`,
  `SchedulesPage.tsx`, `ArchivingSettingsPage.tsx`, `ProjectDashboardPage.tsx` —
  des écrans de planification, aucun au premier rendu. Un `import()` dans `cron.ts`
  rendrait la fonction asynchrone, ce qui change sa signature chez cinq appelants.

Le premier levier est quasi gratuit ; le second est un vrai refactor. **Découpable,
mais commencer par corriger l'import.**

`croner` (27 939 o) suit le même chemin, mais il est aussi importé par
`packages/protocol/src/{schedules,app-settings}.ts` : **structurel**, il vient avec
le protocole.

### 4. `markdown-it` + sa chaîne — 104 724 o — **découpable, gain partiel**

Entre par `lib/markdown.ts` ← `components/chat/Markdown.tsx` ← le fil de
conversation. La page de connexion et l'accueil n'en ont pas besoin. Mais le rendu
markdown est présent au premier rendu **dès qu'on ouvre une conversation**, ce qui
est l'écran le plus fréquent : le sortir du tronc ne fait que déplacer le coût d'un
écran sur deux. Découpable au sens technique, intérêt réel discutable — à juger
avec le point suivant.

### 5. La chaîne `ConversationPage` — l'hypothèse de la carte, corrigée

La piste 2 de la carte suppose que « `ConversationPage` et sa chaîne (fil, composer,
markdown, coloration de syntaxe) sont dans le tronc ». Mesuré :

| élément de la chaîne | état | octets dans le tronc |
|---|---|---|
| `ConversationPage.tsx` lui-même | eager | 16 273 |
| `components/chat/*` (fil, composer, bulles, outils…) | eager | 118 114 |
| `markdown-it` + chaîne | eager | 104 724 |
| **coloration de syntaxe** (`highlight.js`) | **déjà lazy** | 0 |
| **panneau latéral** (xterm, éditeur) | **déjà lazy** | 0 |

Soit ~239 Ko réellement attribuables à la chaîne de conversation, et non la totalité
supposée : la coloration de syntaxe en est déjà sortie. Le découpage est techniquement
possible (`ConversationPage` et `DraftConversationPage` en `lazy()`), mais c'est **la
route la plus visitée de l'application** : le gain sur le chunk d'entrée se paierait
en latence sur l'écran principal. Évaluation : découpable, **à ne pas faire en
premier** — les postes 1 et 3 donnent plus, sur des écrans rares.

### 6. Postes structurels — ~480 Ko, non découpables

React + `react-dom` + `scheduler` (193 886), Radix + floating-ui (142 860),
`zod` via `@solera/protocol` (56 632), `@tanstack/react-query` (46 097),
`react-router` (39 076). Tous utilisés au premier rendu, y compris sur la page de
connexion. `lucide-react` (58 925) est déjà réduit aux icônes utilisées par le code
eager ; il décroîtra mécaniquement avec les découpages ci-dessus.

`@dnd-kit` (51 203) est l'exception du lot : il sert au glisser-déposer du tableau
et de la barre latérale. Le tableau est une route (`BoardPage`), mais la barre
latérale est dans `AppShell`, donc au premier rendu. **Partiellement découpable**,
gain faible pour la complexité.

## Récapitulatif : le gisement, classé

| # | poste | octets | geste | évaluation |
|---|---|---|---|---|
| 1 | CodeMirror via `SkillEditorPage` | 339 468 | un `lazy()` dans `App.tsx` | **découpable, trivial** |
| 2 | `cronstrue/i18n` → entrée par défaut + `fr` | ~150 000 | changer un import | **corrigeable, trivial** |
| 3 | catalogue i18n non utilisé | ~113 000 | `import()` par locale | découpable, conception à faire |
| 4 | `markdown-it` + chaîne | 104 724 | `lazy()` sur la chaîne de chat | découpable, intérêt discutable |
| 5 | chaîne `ConversationPage` | ~239 000 | `lazy()` sur la route | découpable, à éviter (route principale) |
| — | React, Radix, zod, query, router | ~480 000 | — | structurel |

Les deux premières lignes, à elles seules, ramèneraient le tronc sous 1,6 Mio — soit
~500 Ko de marge au lieu de 5,6 Ko, y compris après la fusion de la carte #19.

## Remarques pour la suite

- La piste 1 de la carte (`maximumFileSizeToCacheInBytes` explicite et commenté dans
  `apps/web/vite.config.ts`) reste pertinente indépendamment : le plafond n'est
  aujourd'hui écrit nulle part dans le dépôt, et le message d'erreur du plugin ne le
  nomme pas.
- La piste 3 (garde de taille en CI) a maintenant un chiffre de référence et une
  commande qui le produit : `stat -c%s apps/web/dist/assets/index-*.js`.
- `vite build` émet déjà un avertissement « chunks larger than 500 kB » sur ce chunk,
  noyé dans la sortie. Il ne fait pas échouer le build et personne ne le lit.

## Reproduire ces chiffres

```sh
pnpm install --ignore-scripts
cd apps/web && node scripts/sync-file-icons.mjs && npx vite build
stat -c%s dist/assets/index-*.js
```

Puis, pour la composition, décoder `dist/assets/index-*.js.map` et attribuer les
intervalles d'octets générés à `map.sources` (voir « Méthode »).

---

# Suite : les deux premiers gestes, appliqués

Fait le 2026-10-14, après l'audit, sur demande explicite — l'audit lui-même ne
devait rien changer. Seuls les postes 1 et 2 du récapitulatif ont été traités : les
deux « triviaux ». Les postes 3 à 5 (catalogues i18n, `markdown-it`, chaîne
`ConversationPage`) sont **laissés en place**, ils demandent une décision de
conception.

## Résultat

| | chunk d'entrée | marge sous 2 097 152 |
|---|---|---|
| avant | 2 069 899 o | 27 253 o |
| **après** | **1 542 309 o** | **554 843 o** (542 Ko) |
| gain | **−527 590 o** (−25,5 %) | ×20 |

Et en projetant la fusion de la carte #19 (+21 609 o) : ~1 563 918 o, soit encore
**~533 Ko de marge** au lieu de 5,6 Ko. La contrainte de précache cesse d'être un
sujet pour plusieurs écrans à venir.

## Geste 1 — `SkillEditorPage` en `lazy()`

`apps/web/src/App.tsx`. Import statique remplacé par `lazy()`, route enveloppée
dans `<Suspense fallback={null}>` — le même pattern que `SidePanel` et que les pages
du vault sur `port/savoir`.

Vérifié après build : `@codemirror/*` et `@lezer/*` pèsent désormais **0 octet** dans
le chunk d'entrée, et sont rassemblés dans un chunk `CodeEditor-*.js` de 350 056 o
chargé à l'ouverture de `/skills/:skillId`.

Le gain mesuré (−377 Ko) dépasse les 339 Ko de CodeMirror : `SkillEditorPage`,
`SkillFiles`, `editor-setup` et `CodeEditor` partent avec, ainsi que les icônes
`lucide` qu'eux seuls utilisaient.

*Contrepartie assumée* : `fallback={null}` laisse l'écran vide le temps du
téléchargement des 350 Ko, à la première ouverture seulement. C'est le choix déjà
fait partout ailleurs dans ce fichier ; si l'attente se voit à l'usage sur une
connexion lente, c'est là qu'il faudra mettre autre chose que `null`.

## Geste 2 — `cronstrue`, l'entrée par défaut au lieu de `/i18n`

`apps/web/src/lib/cron.ts` :

```diff
-import cronstrue from 'cronstrue/i18n'
+import cronstrue from 'cronstrue'
+import 'cronstrue/locales/fr'
```

`cronstrue` seul n'embarque que l'anglais ; chaque autre langue est un fichier
séparé qui se greffe sur `cronstrue.locales` par effet de bord. L'application n'a
que deux langues (`LOCALE_LABELS` : `en`, `fr`), là où `cronstrue/i18n` en embarquait
une quarantaine.

| | octets dans le tronc |
|---|---|
| avant (`cronstrue/i18n`) | 176 998 |
| après (défaut + `fr`) | 26 808 |
| gain | **−150 190** |

### Ce qui a été vérifié, et pourquoi il fallait le vérifier

`cronstrue/locales/fr.js` est un bundle **UMD** qui déclare `cronstrue` en externe
(`require("cronstrue")`) et mute `ExpressionDescriptor.locales["fr"]`. Si l'interop
CommonJS de Vite avait rendu une instance différente de celle de notre `import`, la
mutation serait partie dans le vide et **le français serait silencieusement retombé
sur l'anglais** — un bug invisible au build, au lint et au typecheck.

`lib/cron.ts` a donc été passé par le vrai pipeline Vite (build en mode `lib`, format
ESM) et le résultat exécuté dans Node. Sonde jetable, supprimée depuis :

```
45 4 * * 1-5 | fr: À 04:45, de lundi à vendredi      || en: At 04:45, Monday through Friday
0 */3 * * *  | fr: À l'heure pile, toutes les 3 heures || en: On the hour, every 3 hours
0 0 1 1 *    | fr: À 00:00, le 1 du mois, uniquement en janvier || en: At 00:00, on day 1 of the month, only in January
```

Les deux langues donnent bien des phrases distinctes : l'interop tient. Un motif
invalide rend toujours `null` (c'est le test de validité dont dépendent les écrans
de planification) et `cronNextRuns` est inchangé.

Une locale inconnue retombe sur l'anglais avec un avertissement console
(`Locale 'de' could not be found; falling back to 'en'`). Sans conséquence ici —
l'interface n'expose que `en` et `fr` — mais c'est le comportement à connaître : une
langue ajoutée à `LOCALE_LABELS` sans sa ligne d'import dans `cron.ts` aura des
phrases cron en anglais, sans erreur.

`croner` (27 931 o) reste dans le tronc : `@solera/protocol` l'importe, il est
structurel.

## Contrôles

- `npx eslint src` — propre.
- `npx tsc --noEmit` — propre.
- `npx vite build` — passe, 49 entrées de précache (4334 KiB).
- Diff limité à deux fichiers : `apps/web/src/App.tsx`, `apps/web/src/lib/cron.ts`.
  Aucune dépendance ajoutée ou retirée, `package.json` et `vite.config.ts` intacts.

## Ce qui reste ouvert

- **Pistes 1 et 3 de la carte #22** (plafond explicite et commenté dans
  `vite.config.ts`, garde de taille en CI) : toujours pertinentes, et d'autant plus
  faciles à poser maintenant qu'il y a de la marge. Le plafond n'est écrit nulle part
  dans le dépôt.
- **Postes 3 à 5** du récapitulatif (~113 Ko de catalogue i18n, 104 Ko de
  `markdown-it`, la chaîne `ConversationPage`) : non traités, délibérément. Avec
  542 Ko de marge, rien ne presse — et pour `ConversationPage`, l'audit conclut qu'il
  ne faut probablement pas le faire du tout.

---

# Suite 2 : le plafond est dit, et le garde présente un choix

Pistes 1 et 3 de la carte #22, posées ensemble dans `apps/web/vite.config.ts` —
elles répondent à la même question et partagent une constante.

Contrainte posée pour la piste 3 : **le garde ne doit pas aller contre l'expérience
d'usage.** C'est ce qui a décidé sa forme. Un budget qui ne sait dire que « c'est
trop gros, découpe » finit par faire découper ce qui est le plus gros — et le plus
gros est dans le tronc justement parce qu'il sert au premier rendu de l'écran
principal. Le garde pousserait alors vers le seul geste que cet audit déconseille.

## Piste 1 — le plafond écrit là où il s'applique

```ts
const PRECACHE_BUDGET_BYTES = 2 * 1024 * 1024
```

Et dans la configuration Workbox : `maximumFileSizeToCacheInBytes: PRECACHE_BUDGET_BYTES`.

Le commentaire dit ce que le dépôt ne disait nulle part : **les 2 Mio sont le défaut
de Workbox, pas une limite du navigateur**. C'est un budget qu'on choisit de garder
parce qu'un précache plus lourd se paie à la première visite et à chaque mise à jour
du service worker. Donc un chiffre qu'on peut décider de relever — en sachant ce
qu'on achète.

## Piste 3 — un garde qui explique au lieu de bloquer

Plugin `solera:precache-budget`, placé **avant** `VitePWA` dans `plugins`.

| taille du chunk d'entrée | effet |
|---|---|
| < 90 % du budget | silence |
| ≥ 90 % | avertissement, le build passe |
| > 100 % | échec, avec le message ci-dessous |

Deux seuils et non un : l'avertissement est ce qui transforme la surprise en
décision, l'échec n'arrive que là où le build serait de toute façon cassé. Le garde
n'invente aucune contrainte plus serrée que la vraie — il ne sert pas de cliquet.

Le message d'échec nomme trois réponses, dont **relever le budget**, et nomme
explicitement ce qu'il ne faut pas faire :

```
Budget de précache dépassé.

  assets/index-D6tSJcr5.js : 1 542 309 octets, 103 % du budget de précache (1 500 000)
  Dépassement : 42 309 octets.

Workbox va refuser de précacher ce fichier, et vite-plugin-pwa en fera une
erreur fatale. Trois réponses, et le choix n'est pas évident :

  1. Charger à la demande un écran rare — le geste déjà appliqué au panneau
     du Travail, à la visionneuse 3D et à l'éditeur de skill.
  2. Relever PRECACHE_BUDGET_BYTES dans ce fichier. C'est permis : les 2 Mio
     sont un défaut de Workbox, pas une limite du navigateur. Ça se paie à la
     première visite et à chaque mise à jour du service worker.
  3. Corriger un import trop large — c'est ce qui a rendu 150 Ko sur cronstrue.

À ne pas faire : découper la chaîne de conversation. Elle est dans le chunk
d'entrée parce que c'est la route la plus visitée de l'application ; l'en sortir
déplace le coût sur l'écran principal au lieu de le supprimer.

Les postes du bundle, chiffrés et classés, avec ce qui reste découpable et ce
qui est structurel : docs/audits/2026-10-14-bundle-web/
```

### Le piège de l'implémentation : `writeBundle` ne peut pas échouer

Première version écrite entièrement dans `writeBundle`. Elle mesurait juste, et ne
servait à rien : **une exception levée depuis `writeBundle` est avalée par Vite**. Le
build continuait, et c'est Workbox qui finissait par échouer avec son message
illisible — précisément ce que le garde existe pour éviter. Observé, pas supposé :
le hook était bien atteint (`dépasse? true`) et l'erreur affichée était quand même
celle de `logWorkboxResult`.

La mesure se prend donc en `writeBundle`, où les fichiers sont écrits et le bundle
connu, et le verdict tombe en `closeBundle`, qui remonte l'erreur et s'exécute avant
celui de `VitePWA`. Vérifié : avec un budget abaissé, le message du garde est seul à
l'écran et la trace de Workbox a disparu.

### Pas de nouvelle étape de CI

`ci.yml` lance déjà `pnpm build`, qui construit `apps/web` : le garde y tourne sans
rien ajouter au workflow. Le même contrôle protège donc la CI et le build local, avec
le même message — il n'y a pas un seuil pour la machine et un autre pour la personne.

## Contrôles

Les trois cas ont été éprouvés en abaissant temporairement `PRECACHE_BUDGET_BYTES` :

| cas | budget simulé | résultat |
|---|---|---|
| dépassement | 1 500 000 | échec, message du garde, `exit 1`, pas de trace Workbox |
| alerte | 1 700 000 (91 %) | avertissement, build terminé, `exit 0` |
| nominal | 2 097 152 (74 %) | silence, `exit 0` |

`npx eslint apps packages` et `npx tsc --noEmit` propres, budget restauré à
`2 * 1024 * 1024`.

---

# Épilogue : le contexte Savoir a fusionné, la projection est vérifiée

Pendant que cet audit s'écrivait, la carte #19 a fusionné dans `main` (plus
`3a7f2ba`, qui renumérote deux migrations), et `audit/bundle-web` y a été fusionnée
de son côté. L'état « après #19 », qui n'était jusqu'ici qu'une projection, est
devenu mesurable.

| | chunk d'entrée | marge |
|---|---|---|
| `main` avant tout ceci, sans Savoir | 2 069 899 o | 27 253 o |
| `port/savoir`, l'état décrit par la carte #22 | 2 091 508 o | **5 644 o** |
| **`main` avec Savoir et les deux découpages** | **1 562 789 o** | **534 363 o** (522 Ko) |

La projection annoncée plus haut était ~1 563 918 o ; le chiffre réel est
1 562 789 o, soit **1 129 octets d'écart**. Le raisonnement tenait.

Autrement dit, la situation que décrivait la carte — 5,6 Ko de marge, le prochain
écran casse le build — ne s'est jamais produite : les deux découpages ont atterri
avant, et le tronc est à **74,5 % du budget** avec le contexte Savoir dedans. Le
garde reste silencieux, comme prévu à ce niveau.

Vérifié sur l'arbre fusionné : `eslint apps packages` propre, `pnpm -r typecheck`
propre sur les huit paquets, `vite build` passe (52 entrées de précache).
