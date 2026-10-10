# Design system de Solera

Référence normative de l'interface web. Tout écran, tout composant, toute revue s'y
rapporte. Si le code et ce document divergent, c'est le document qui dit le vrai et le
code qui est en dette — sauf si le code a raison, auquel cas on change le document
d'abord, dans le même commit.

Deux statuts se croisent ici, et ils ne se relisent pas de la même façon :

- **Constat** — ce que le code fait déjà, partout, et qui est donc acquis.
- **Décision** — un point sur lequel le code hésite aujourd'hui, et qu'on tranche ici.
  Ces passages portent la marque **[D]**. Ce sont eux qui méritent une relecture, et
  eux qui ouvrent un chantier de mise en conformité. Le récapitulatif chiffré est en
  §14.

Le design system est un **paquet**, `@solera/ui`, et le catalogue qui le montre est un
**Storybook**, `apps/catalog`. Ni l'un ni l'autre n'est une fonctionnalité de Solera.

```sh
pnpm --filter @solera/catalog dev   # http://localhost:6417
```

| | |
| --- | --- |
| `packages/ui` | Les primitives, les jetons, la feuille partagée. Et leurs stories. |
| `apps/catalog` | Le Storybook : documentation, motifs, et le rassemblement des stories. |
| `apps/web` | Le produit. Ses composants d'application gardent leurs stories à côté d'eux. |

**Pourquoi un paquet et pas un dossier.** La règle « les primitives ne savent rien du
produit » était une phrase dans ce document ; c'est maintenant le graphe de dépendances.
`@solera/ui` ne dépend pas de `@solera/web`, donc il ne *peut pas* importer du code
applicatif — c'est une erreur de compilation, plus une relecture à faire.

Trois primitives franchissaient déjà la ligne sans que rien ne l'empêche : `Select` et
`ConfirmDialog` allaient chercher des libellés dans le catalogue de traduction, et
`Tooltip` un hook dans les utilitaires de l'application. Les deux premières les
reçoivent par `UiLabelsProvider`, que l'application remplit une fois — **un design
system ne possède pas la copie du produit** — et le hook est versé dans le paquet, où il
est générique.

**Pourquoi les stories ne sont pas regroupées.** Elles restent à côté de ce qu'elles
montrent, et c'est la convention pour une raison : une primitive renommée casse sa story
au `typecheck`. Un dossier de stories tenu à part n'aurait rien vu venir. Le catalogue ne
fait que les rassembler par un `stories` glob qui couvre les trois endroits.

La barre d'outils change le **thème**, la **palette de syntaxe** et la **langue** — une
règle se vérifie dans les trois thèmes et pas seulement dans celui où l'on travaille, et
le français est plus long que l'anglais.

Ce document donne les règles, le catalogue donne les yeux.

**Une primitive ajoutée à `packages/ui` reçoit sa story dans le même commit.** Une
primitive sans story est une primitive dont personne ne vérifie les états.

Les composants sont montés avec le contexte réel de l'application et rien de plus —
`QueryClientProvider`, `UiLabelsProvider`, `TooltipProvider`, un routeur. Un composant
qui ne tient que parce qu'un parent lointain lui fournit quelque chose se voit donc tout
de suite. Le thème, la palette et la langue sont posés sur `<html>` et non sur un
conteneur de story : les jetons sont définis par `:root[data-theme]`, et tout ce qui part
en portail — dialogue, menu, infobulle — se rend hors de l'arbre de la story.

Deux limites à connaître. Les **tables d'API** sont écrites à la main dans les stories et
non dérivées des types : une prop ajoutée sans passer par là ne s'y verra pas. Les
**extraits de code** des pages MDX sont des chaînes posées à côté du spécimen qu'elles
décrivent, et peuvent donc se décaler de lui — les variantes, elles, sont vivantes, et
rien n'y dérive.

---

## 1. Registre

Épuré. La hiérarchie est portée par **l'espacement et la typographie**, pas par les
bordures et les ombres. Les dégradés existent mais restent à la limite du perceptible :
ils donnent une matière aux surfaces élevées, ils ne les décorent pas.

Trois conséquences pratiques :

- Une bordure sépare, elle ne souligne pas. Deux bordures qui se touchent sont une de
  trop.
- Une ombre dit « ceci flotte au-dessus ». Un élément posé dans le flux n'en a pas.
- Quand une distinction peut se faire par l'écart plutôt que par un trait, elle se fait
  par l'écart.

L'interface est **bilingue de structure** : aucune chaîne en dur dans un composant, tout
passe par `t('clé')` (`lib/i18n`). Une chaîne écrite en français dans du JSX est un bug,
pas un raccourci.

## 2. Jetons de couleur

Tous les jetons sont préfixés `--sg-`, définis dans `styles/tokens.css`, exposés à
Tailwind dans `styles/index.css`. **Aucune couleur en dur dans un composant.**

Deux règles de nommage, et elles sont pièges tous les deux :

- La clé Tailwind et le jeton source ne portent jamais le même nom, sinon la variable
  s'auto-référence et devient invalide.
- Aucun nom ne collisionne avec une échelle intégrée de Tailwind (`base`, `sm`, `md`,
  `lg`, `xl` pour `text-*`). Nommer un jeton `base` écrase silencieusement
  `text-base`.

### Surfaces

| Jeton | Classe | Rôle |
| --- | --- | --- |
| `--sg-canvas` | `bg-canvas` | Le fond de l'application. Plat, porté par `html`. |
| `--sg-surface` | `bg-surface` / `.surface` | Ce qui se détache du fond : carte, barre, dialogue. |
| `--sg-surface-high` | `bg-surface-high` | Survol, état actif, en-tête de tableau. |
| `--sg-sunken` | `bg-sunken` | Ce qui s'enfonce : champ de saisie, bloc de code. |

`.surface` et `bg-surface` ne sont pas interchangeables : `.surface` pose le dégradé
signature par-dessus la couleur, `bg-surface` pose la couleur seule. **[D]** Toute
surface élevée prend `.surface` ; `bg-surface` est réservé aux cas où le dégradé
gênerait — un en-tête collant qui doit se raccorder au contenu qui défile dessous.

Le fond de l'application est **plat et sans dégradé**, et ce n'est pas une
simplification : une application installée sur iOS remonte le viewport de la hauteur de
la barre d'état, et la bande qui reste en bas n'est peinte que par le fond de la racine.
Un dégradé s'y raccordait toujours de travers. La raison complète est en commentaire dans
`index.css`, elle n'a pas à être redécouverte.

### Encres

| Jeton | Classe | Rôle |
| --- | --- | --- |
| `--sg-ink` | `text-ink` | Le texte qu'on lit. |
| `--sg-ink-soft` | `text-ink-soft` | Libellé, intitulé de champ, texte secondaire qu'on lit quand même. |
| `--sg-ink-faint` | `text-ink-faint` | Métadonnée, horodatage, aide. |

`ink-faint` reste du texte à lire : sa luminosité est tenue au contraste AA, pas posée
à vue. On n'atténue jamais un texte par `opacity` — un même message ne se lirait pas
pareil dans une bulle et hors d'elle. Pour atténuer, on mélange vers `ink-faint` en
`oklch`, comme le fait `.sg-reading`.

### Accent et statuts

`--sg-accent`, `--sg-accent-hover`, `--sg-accent-ink` (le texte posé *sur* l'accent),
`--sg-accent-wash` (le lavis, pour un fond teinté).

L'accent porte déjà quatre choses : le travail de fond, le tour en cours, la sélection,
et l'action principale. **Il est donc saturé** : tout rôle qui doit rester lisible à côté
de lui prend une teinte absolue, qui ne suit pas `--sg-hue`. C'est le cas de
`--sg-positive`, `--sg-caution`, `--sg-critical`, et de `--sg-loop` (boucle armée).

### Lignes

`--sg-line` sépare. `--sg-line-strong` marque le survol d'un élément bordé, et sert de
poignée visible.

### Coloration syntaxique

Sept rôles (`--sg-syn-comment`, `-keyword`, `-string`, `-number`, `-function`, `-type`,
`-attribute`), dix palettes, chacune en clair et en sombre, choisies dans les réglages et
posées en attribut `data-syntax` sur `<html>`.

Une palette **ne redéfinit que ces sept jetons**, jamais rien d'autre : tout ce qui
affiche du code suit d'un coup, et le reste de l'interface ne bouge pas. La palette par
défaut s'obtient en *retirant* l'attribut, pas en dupliquant ses valeurs.

Les sélecteurs ne sont pas ancrés sur `:root`, volontairement : un aperçu peut porter les
deux attributs et montrer les vraies couleurs sans que l'application en change.

Le thème contrasté garde sa propre palette quoi qu'il arrive. Son contraste est ce pour
quoi on le choisit ; une palette d'ambiance l'annulerait.

### Les trois exceptions à « aucune couleur en dur »

1. `AppearancePresets.tsx` et `AppearanceControls.tsx` calculent des `oklch()` en ligne
   parce qu'ils *montrent* des thèmes autres que celui en cours. Un aperçu qui lirait les
   jetons montrerait le thème courant.
2. `AgentIcon.tsx` porte `#D97757` : la couleur de marque de Claude n'est pas un jeton de
   Solera.
3. Les scrims de dialogue sont en `bg-black/…` — voir §9, où la règle est fixée.

Toute autre couleur littérale dans un `.tsx` est à reprendre.

## 3. Thèmes et réglages d'apparence

Trois thèmes livrés : `light`, `dark`, `dark-contrast`. Posés en `data-theme` sur
`<html>`, **avant l'hydratation**, sinon le premier rendu clignote. Pas de thème
personnalisé : le réglage de teinte le remplace.

Trois curseurs pilotent l'ensemble des surfaces :

| Réglage | Ce qu'il fait | Ce qu'il ne touche pas |
| --- | --- | --- |
| `--sg-hue` | La teinte, partagée avec l'accent | Les statuts, la boucle, les palettes à teinte absolue |
| `--sg-tint` | Multiplicateur de chroma | — |
| `--sg-lift` | Décalage de luminosité | **Le texte.** L'appliquer aussi à l'encre annulerait le gain : les deux bougeraient ensemble et le contraste resterait figé. |

Teinte et intensité sont **neutralisées sur le thème contrasté**, dont les surfaces sont
strictement neutres, sans dégradé ni ombre.

Un piège à connaître : la chroma perçue s'effondre dans les valeurs sombres. À L=0.21 il
faut environ 0.06 de chroma pour qu'une surface se lise comme teintée et non comme grise.
Les valeurs de `tokens.css` en tiennent compte ; ne les diviser par deux « pour faire
sobre » ne rend pas l'interface sobre, ça la rend grise.

Trois réglages séparés gouvernent le confort de lecture du fil, et **du fil seul** :
`--sg-read-size`, `--sg-read-leading`, `--sg-read-softness`, portés par `.sg-reading`.
Agrandir la conversation ne doit déplacer ni la barre latérale ni la barre de saisie.

## 4. Typographie

Une seule famille de texte (`--font-sans`, la pile système) et une de code
(`--font-mono`). Pas de police chargée : une interface qui attend un fichier de police
affiche du texte deux fois.

**[D] L'échelle est fermée à six pas.** Les tailles sont nommées par **rôle** et non par
dimension, pour ne pas collisionner avec l'échelle intégrée de Tailwind :

| Classe | Taille | Rôle |
| --- | --- | --- |
| `text-micro` | 0.625rem / 10px | Micro-étiquette dans une pastille, compteur |
| `text-meta` | 0.6875rem / 11px | Métadonnée dense : horodatage, chemin, badge de liste |
| `text-xs` | 0.75rem / 12px | Aide, légende, intitulé de groupe |
| `text-sm` | 0.875rem / 14px | **Le pas courant.** Corps de l'interface, libellé, bouton |
| `text-heading` | 0.9375rem / 15px | Titre de carte, titre de dialogue |
| `text-lg` | 1.125rem / 18px | Titre de page |
| `text-code` | 0.8125rem / 13px | **Monospace uniquement** : bloc de code, diff, terminal |

`text-code` est hors de l'échelle de texte, et c'est voulu : une monospace à la même
taille nominale qu'une sans-serif paraît plus grosse, le pas de 13px compense. On ne
l'emploie jamais pour du texte courant.

Toute autre taille (`text-base`, `text-xl`, `text-2xl`, et toute valeur arbitraire
`text-[…]`) est hors échelle. Une taille arbitraire dans une revue est un point à
justifier, pas un détail.

**[D] Un titre de page est en `text-lg font-semibold tracking-tight`**, sans exception.
Quatre tailles se partagent ce rôle aujourd'hui — `text-base` sur *Services* et
*Planification*, `text-lg` sur *Design*, `text-xl` sur *Connexion*, *Brouillon* et
l'éditeur de skill, `text-2xl` sur le titre d'une fiche — et deux pages voisines n'ont
aucune raison de hiérarchiser différemment.

Les quatre pas que Tailwind n'a pas (`--text-micro`, `--text-meta`, `--text-heading`,
`--text-code`) sont déclarés dans `packages/ui/src/tokens.ts`, avec les rayons, et le
bloc `@theme` qui les porte est **généré** de là vers
`packages/ui/src/styles/scales.generated.css` par `pnpm ui:tokens` — valeurs littérales,
ni thémables ni sujettes à l'auto-référence, contrairement aux couleurs. Les classes
existent donc déjà ; ce qui reste est de remplacer les valeurs arbitraires par elles. La
table ci-dessus est le dernier exemplaire recopié de l'échelle, à retirer avec le reste
des valeurs de ce document.

**Poids** : `font-medium` pour tout ce qui porte, `font-semibold` pour un titre. Rien
au-delà. `font-bold` n'existe pas dans l'interface.

## 5. Rayons

Quatre jetons (`--radius-sm`, `md`, `lg`, `xl`) plus `rounded-full`. **[D] Le rayon est
décidé par le rôle, jamais à l'œil.** Les valeurs et les rôles vivent dans
`packages/ui/src/tokens.ts`, d'où le CSS est généré et que le catalogue affiche : la table
qui était ici en était le troisième exemplaire, et le troisième à dire autre chose.

**[D] `rounded-2xl` n'existe pas.** Il n'avait pas de jeton, tombait donc sur le défaut de
Tailwind — 1rem, soit la valeur de `rounded-xl` à l'identique — et la distinction
annoncée ici (`xl` pour la palette, `2xl` pour le dialogue) ne distinguait rien à l'écran.
Les dialogues centrés et leurs feuilles mobiles sont en `rounded-xl` / `rounded-t-xl`.

Un contrôle plus arrondi que la carte qui le contient se voit tout de suite. L'ordre
`sm < md < lg < xl` suit l'imbrication, il ne la contredit jamais.

## 6. Espacement et densité

L'échelle Tailwind, sans valeur arbitraire. Les pas réellement utiles sont `0.5 1 1.5 2
2.5 3 4 5 6` ; le reste est du bruit.

**[D] Trois densités, et on ne mélange pas dans un même écran :**

| Densité | Écart interne | Écart entre éléments | Où |
| --- | --- | --- | --- |
| Dense | `px-2 py-1` / `px-2.5 py-1.5` | `gap-1` / `gap-1.5` | Liste, arbre de fichiers, barre d'outils, en-tête de diff |
| Courante | `px-3 py-2` | `gap-2` | Formulaire, entrée de menu, contrôle |
| Aérée | `px-5 py-4` | `gap-3` / `gap-4` | Carte, en-tête de dialogue, section de page |

`px-5 py-4` est le gabarit de `CardHeader` et `CardBody`. Une carte qui s'en écarte
s'écarte de toutes les autres cartes de l'application.

Entre sections d'une page : `gap-4` dans les réglages, `gap-6` à `gap-8` sur une page
autonome. Marge de page : `p-4` au doigt, `md:p-8` au large.

## 7. Élévation

Trois ombres, trois utilitaires, un sens chacun :

| Classe | Jeton | Sens |
| --- | --- | --- |
| `shadow-card` | `--sg-shadow-sm` | Posé sur le fond : carte, bouton principal |
| `shadow-float` | `--sg-shadow-md` | Détaché : panneau, liste déroulante, élément en cours de glissement |
| `shadow-pop` | `--sg-shadow-lg` | Flottant par-dessus l'application : dialogue, palette, infobulle |

Le thème contrasté les annule toutes les trois (`none`). Un composant qui compte sur son
ombre pour se distinguer du fond est cassé sur ce thème : la bordure fait le travail,
l'ombre le confirme.

## 8. Icônes

`lucide-react`, trait fin, jamais remplies. Elles accompagnent un texte ; une icône
seule porte obligatoirement son intitulé (`IconButton` l'impose par son type).

**[D] Quatre tailles, et pas une de plus :**

| `size` | Où |
| --- | --- |
| `11` | Dans une pastille, un badge, une étiquette `text-meta` |
| `14` | Densité dense : ligne de liste, arbre, barre d'outils |
| `16` | Densité courante : bouton, en-tête de carte, menu |
| `22` | Emphase : icône d'`EmptyState` |

Les pas intermédiaires (`12`, `13`, `15`, `17`, `18`, `19`, `20`) sont à replier. Quatre
valeurs à un pixel d'écart ne produisent aucune hiérarchie, seulement du désalignement
entre deux lignes voisines. **Ce repli se juge à l'œil, composant par composant** : une
icône qui passe de 15 à 16 dans une ligne serrée peut la faire grandir d'un pixel. Ce
n'est pas un `sed`.

## 9. Surfaces flottantes

### Le scrim

**[D] Un seul voile pour toute l'application, et c'est un utilitaire : `scrim z-40`.**
`.scrim` est déclaré dans `packages/ui/src/styles/index.css`, à côté de `.surface` ; seule
la couche d'empilement reste au site d'appel. Il valait quatre choses différentes
(`black/35`, `/50`, `/60`, avec `blur-sm` ou `blur-[2px]`), réécrites à la main dans seize
dialogues dont un seul portait la valeur retenue ici. Les seize lisent maintenant le même
utilitaire : l'intermédiaire, 50 % et un flou de 2 px — `/35` ne détache pas assez une
feuille sur fond clair, `/60` assombrit l'écran plus que nécessaire pour un panneau de
réglages.

Le voile est en noir littéral et non en jeton : c'est une occultation, pas une couleur de
thème. Un voile teinté changerait d'opacité perçue d'un thème à l'autre. Et le
`-webkit-backdrop-filter` que l'utilitaire porte n'est pas décoratif : sans lui, pas de
flou sur iOS, donc pas de flou dans la PWA installée, où ce voile se voit le plus.

### Le gabarit de dialogue

**[D] Feuille en bas au doigt, boîte centrée au large.** C'est le gabarit majoritaire du
code, et il devient la règle :

```
surface fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col
rounded-t-xl border border-line shadow-pop
sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2
sm:w-[min(<largeur>,calc(100vw-2rem))]
sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl
```

- `max-h-[90dvh]` pour tous. Les valeurs de 84 à 95 dvh relevées aujourd'hui ne
  recouvrent aucune intention : elles ont été posées une par une.
- La largeur `sm:` est le seul paramètre libre : `560px` pour un formulaire court,
  `640px` par défaut, `960px`–`1040px` pour un dialogue qui montre du contenu.
- En-tête : `flex items-center justify-between border-b border-line px-5 py-4`, titre en
  `text-heading font-semibold`.
- Deux dialogues dérogent encore (`ProjectSwitcher`, `SidebarActivity`) : centrés même au
  doigt, et en `bg-surface` au lieu de `.surface`, donc sans le dégradé signature. Leur
  voile et leur hauteur, eux, sont alignés.

Une **palette de commandes** n'est pas un dialogue et garde son gabarit propre : ancrée
en haut, parce qu'on y tape et que le clavier mobile occupe le bas de l'écran. Son rayon,
`rounded-xl`, est celui du dialogue : les deux surfaces sont du même ordre.

### L'échelle de z-index

**[D] Six niveaux, nommés par ce qu'ils empilent. Aucune autre valeur.**

| Niveau | Ce qui y vit |
| --- | --- |
| `z-10` | Local à un conteneur : en-tête collant, poignée de redimensionnement, surimpression dans la page |
| `z-20` | Panneau dans la page : panneau latéral accosté, panneau de fiche, liste d'un combobox |
| `z-30` | Barre latérale mobile, voile de dépôt de fichier |
| `z-40` | Scrim de dialogue, panneau en plein écran |
| `z-50` | Dialogue, feuille, palette |
| `z-[100]` | Infobulle — seule couche au-dessus d'un dialogue, puisqu'elle doit s'afficher dedans |

## 10. Primitives

`@solera/ui` est le seul endroit où l'on écrit l'habillage d'un contrôle. **On
n'écrit pas un bouton à la main.**

| Primitive | À quoi elle sert | À ne pas confondre avec |
| --- | --- | --- |
| `Button` | Action à libellé. `primary` (l'action de l'écran, une seule), `secondary`, `ghost`, `danger` | — |
| `IconButton` | Action sans libellé. `label` obligatoire | `Button icon=` quand il y a un texte |
| `Card` / `CardHeader` / `CardBody` | Bloc de contenu titré | Un `div` bordé : si c'est une carte, c'est `Card` |
| `Field` | Champ texte avec intitulé, aide, erreur, `aria-describedby` câblé | Un `input` nu |
| `Select` | Choix parmi beaucoup, avec icône et aide par option | Le `<select>` natif, qui ne sait pas les porter |
| `ChoiceList` | Choix parmi **quelques-uns**, dépliés. Sémantique `radiogroup` | `Select` — au-delà d'une demi-douzaine d'options, c'est `Select` |
| `Menu` + `MenuItem` / `MenuCheckboxItem` / `MenuLabel` / `MenuSeparator` / `MenuSwatch` | Menu déroulant, `role="menu"` | `Popover` |
| `Popover` | Panneau ancré à contenu libre | `Menu` : son roving tabindex est réservé aux `menuitem`, un bouton ordinaire posé dedans devient cliquable à la souris seulement |
| `ContextMenu` | Clic droit et appui long, positionné au curseur | `Menu` ouvert à la main : il se place sous un déclencheur et ignore l'appui long |
| `ConfirmDialog` | Confirmation d'une action qu'on ne devine pas | — |
| `Tooltip` / `TooltipButton` | Précision au survol | Un intitulé : une infobulle n'existe pas au doigt |
| `Badge` | État en un mot. `neutral`, `accent`, `positive`, `caution`, `critical` | — |
| `Banner` | Message de bandeau. `info`, `positive`, `caution`, `critical` ; `role="alert"` sur `critical`, `status` sinon | — |
| `EmptyState` | Liste vide, accès refusé | — |
| `cx` | Concaténation de classes | `clsx` : inutile, `cx` suffit |

`SectionHeader` est exporté depuis `routes/SettingsPage.tsx` et employé par les quinze
pages de réglages. Il **reste là** : il code en dur un retour vers `/settings`, donc ce
n'est pas une primitive mais un composant propre à la zone des réglages. Le verser dans
`@solera/ui` y mettrait un composant qui connaît une route de l'application — et le
paquet ne peut de toute façon pas importer son routeur.

**Deux pièges de Tailwind qui reviennent**, et qui expliquent la forme du code des
primitives :

1. Une classe de taille passée par `className` ne l'emporte pas sur celle de la
   primitive : Tailwind ordonne ses utilitaires lui-même, l'ordre dans la chaîne ne
   décide de rien. D'où les tables `VARIANTS` / `SIZES` / `ICON_SIZES`.
2. Tailwind scanne les fichiers source : une classe construite dynamiquement n'existe
   pas. Les listes de classes sont écrites en toutes lettres.

### Trois couches, pas une

`@solera/ui` n'est pas tout le vocabulaire de l'interface, et faire comme si l'était
a laissé la moitié des composants sans référence. Il y en a trois :

| Couche | Où | Ce qui la définit |
| --- | --- | --- |
| **Primitives** | `packages/ui` | Ne savent rien du produit, et la frontière est tenue par le graphe de dépendances. Un bouton, un champ, un menu. |
| **Composants d'application** | `components/`, `components/chat/`, `components/tools/` | Connaissent le domaine : un CLI, un projet, une fenêtre de quota, un diff. Partagés, et parfois plus réemployés qu'une primitive — `AgentIcon` est importé par quinze fichiers. |
| **Motifs** | nulle part | Des chaînes de classes recopiées à la main. Certains ne méritent pas mieux ; d'autres devraient être des primitives et ne le sont pas. |

La deuxième couche n'a pas sa place dans `@solera/ui`, qui ne doit rien savoir du
produit — mais elle a sa place dans le catalogue, au même titre que la première. C'est
d'ailleurs là que les variantes divergent le plus, puisque rien ne les montrait côte à
côte.

La troisième est le chantier : voir §14.

### Quand un `<button>` nu est légitime

Trois cas, et ils sont les seuls : la primitive elle-même ; une **ligne de liste
entièrement cliquable**, qui n'est pas un bouton d'action et porte son propre habillage ;
un élément dont Radix exige la maîtrise via `asChild`. Partout ailleurs, un `<button>`
nu perd le focus visible, la cible tactile et l'état désactivé que la primitive apporte.

## 11. Tactile et responsive

**Cible tactile de 44 px minimum** (`--tap`, utilitaire `.tap-target`). Ce n'est pas une
marge de confort, c'est la spec.

Deux leviers, et ils ne disent pas la même chose :

- `md:` — la largeur de l'écran. Pour la mise en page.
- `pointer-coarse:` — le doigt. Pour la taille des cibles.

Un grand écran tactile existe. `Button size="sm"` fait donc `h-11 md:h-9
pointer-coarse:h-11` : petit au large *et* à la souris, jamais petit au doigt.

Point de bascule : `sm:` (640px) pour un dialogue qui passe de feuille à boîte, `md:`
(768px) pour la mise en page générale. `lg:` et `xl:` ne servent pas — l'interface a deux
états, pas quatre.

Trois contraintes mobiles tenues par `index.css`, à ne pas défaire sans lire le
commentaire qui les accompagne :

- iOS zoome sur un champ dont le texte fait moins de 16 px, et ce zoom ne se défait
  jamais. D'où `font-size: 1rem` sur `input`/`select`/`textarea` en `pointer: coarse`,
  **hors de toute couche**, pour l'emporter sur les utilitaires.
- Le document ne défile jamais : l'application est un calque fixe (`.app-layer`)
  dimensionné sur le viewport visuel. Sans ça, iOS fait rebondir la page derrière le
  clavier.
- `.header-bar` ajoute l'encoche à sa hauteur. `h-[var(--header-height)]` et `pt-safe`
  sur le même élément ne se combinent pas : le contenu déborde sous la barre.

## 12. États

**Focus** : `:focus-visible` est traité une fois pour toute l'application
(`outline: 2px solid var(--sg-accent)`, `offset: 2px`). On ne le redéfinit pas
localement, et on ne le retire jamais.

**Désactivé** : `disabled:pointer-events-none disabled:opacity-45`. C'est le seul endroit
où l'opacité est admise comme atténuation, parce qu'un contrôle désactivé n'est pas un
texte à lire.

**Erreur de champ** : bordure `border-critical` et message en `text-xs text-critical`,
relié par `aria-describedby`. `Field` le fait ; un champ monté à la main doit le refaire.

**Vide** : `EmptyState`, avec une description qui dit quoi faire — pas « aucun élément ».

**Chargement** : rien qui saute. Une zone qui se remplit garde sa hauteur ; une liste qui
charge ne pousse pas ce qui est en dessous. Pas de *spinner* plein écran.

## 13. Mouvement

Les transitions sont courtes et portent sur des propriétés nommées, jamais sur `all` :
`transition-[background,border-color,filter,color] duration-150` pour un contrôle,
`duration-200` pour un panneau qui s'ouvre.

`prefers-reduced-motion: reduce` écrase tout à 0.01ms, globalement. Une animation qui
porte de l'information doit donc rester lisible à l'arrêt.

Une règle tirée du code et qui vaut d'être retenue : **la place d'un élément conditionnel
est réservée en permanence**. La coche de `ChoiceList` occupe ses 4 unités même absente,
et le sélecteur de palette est une grille et non une liste qui s'enroule. Sans ça,
choisir redistribue les autres options sous les yeux au moment du clic.

## 14. Écarts constatés

Relevé sur `apps/web/src` au 2026-10-10. C'est le chantier qu'ouvre ce document, du plus
mécanique au plus délicat.

| Écart | Ampleur | §    |
| --- | --- | --- |
| `<button>` nus là où une primitive conviendrait | ~70 sur 86 | §10 |
| Rayons posés à l'œil plutôt que par rôle | à trier | §5 |
| Tailles d'icônes intermédiaires à replier sur quatre pas | ~240 | §8 |
| `transition-all` dans la minimap, au lieu de propriétés nommées | 1 | §13 |
| Cartes refaites à la main (`rounded-* border border-line` + surface) | 38 à trier | §10 |

Les trois lignes marquées « à trier » — rayons, icônes, cartes — se jugent à l'œil,
composant par composant, et ne se passent pas en lot. Les ~240 tailles d'icônes sont le
relevé réel (15 ×96, 13 ×69, 18 ×26, 12 ×26, et une queue de 10 à 34), contre 286 déjà
dans l'échelle ; l'estimation à 330 du premier relevé comptait large.

### Ce qui est fermé

Replié le 2026-10-10, dans le même chantier que les jetons générés :

| Écart | Ampleur | Ce qui le tient désormais |
| --- | --- | --- |
| Tailles de texte hors échelle | 134 | Les valeurs écrites en dur étaient *identiques* au jeton dans 124 cas ; les 8 à 0.8125rem en sans sont passées à `text-sm`, les 2 en monospace à `text-code` |
| Titres de page en quatre tailles concurrentes | 10 | `text-lg font-semibold tracking-tight` partout, `text-heading` pour un titre de dialogue ou de carte |
| Scrims réécrits à la main, en quatre variantes | 16 | L'utilitaire `.scrim` de `@solera/ui` |
| Hauteurs maximales de dialogue de 80 à 95 dvh | 10 | `max-h-[90dvh]`, sauf la palette (70) et la liste en ligne du panneau d'activité (32) |
| `ProjectSwitcher` et `SidebarActivity`, voile en `z-50` | 2 | `scrim z-40`, comme les quatorze autres |
| `rounded-2xl` sans jeton, à la même valeur que `rounded-xl` | 8 | Le pas n'existe plus ; `tokens.ts` est la source de l'échelle |

Il reste **une** valeur de taille arbitraire dans tout `apps/web` : le `text-[0.5625rem]`
du badge d'`AppShell`, 9 px, le seul pas qui ne corresponde à aucun jeton. À trancher
avant d'activer la règle de lint du §6, qui échouerait dessus.

### Deux primitives manquantes

L'audit d'usage en a sorti deux, et toutes deux sont recopiées trois fois :

**`SegmentedControl`** — `CardEditor`, `Instructions` (deux fois). C'est le motif le plus
mûr : les trois copies portent exactement le même habillage, à la taille des entrées
près. Rail `flex gap-1 rounded-lg bg-sunken p-1`, actif `surface text-ink shadow-sm`.
Deux défauts, identiques dans les trois, qu'un seul correctif réglera :

- `shadow-sm`, l'ombre brute de Tailwind, au lieu de `shadow-card` — elle ne disparaît
  donc pas sur le thème contrasté, dont c'est pourtant la règle (§7) ;
- environ 30 px de haut, sous la cible tactile de 44 px (§11), pour un contrôle qu'on
  touche.

**`Tabs`** — `SidebarActivity`, `SkillsControl`, `CardPanel`. Celui-ci a dérivé : trois
traitements actifs (`font-semibold text-ink`, `text-ink`, `text-accent`) et trois
hauteurs (44, 44, 48 px). **[D]** Un seul traitement à retenir, et le soulignement
d'accent suffit — souligner en accent *et* colorer le texte en accent dit deux fois la
même chose.

### Un état « sélectionné » à trancher

Quatre habillages dans le code pour la même question, et le même problème se rejoue sur
les bascules de barre d'outils :

| Habillage | Où |
| --- | --- |
| `bg-accent-wash font-medium text-ink` | `AppShell`, navigation |
| `bg-accent-wash text-ink` | `QuickOpen`, `MentionPicker`, `TokenPicker` |
| `bg-accent-wash text-accent` | `SidebarActivity`, `SidePanel` |
| `bg-surface-high text-ink` | `CommandPalette`, `CodeBlock` |

**[D]** La sélection part du lavis d'accent. La quatrième ligne est à reprendre :
`surface-high` est la couleur du survol (§2), donc un élément sélectionné y ressemble à
un élément survolé.

### Le défaut de `Button size` est à l'envers

`size` vaut `md` par défaut, et §10 dit que `sm` est « réservé aux barres denses ». Le
code dit l'inverse : **133 `size="sm"` explicites contre 2 `size="md"`**. Le défaut
oblige donc à écrire le cas courant et laisse le cas rare implicite.

**[D]** Deux sorties, et c'est la seule décision de ce document qui change du code
existant plutôt que d'en aligner : soit on inverse le défaut, soit on admet que `sm` est
la taille de l'interface et que `md` est celle des formulaires, et on le dit ici. Dans
les deux cas, la phrase actuelle de §10 est fausse.

Accessoirement : `variant="primary"` est écrit une fois en toutes lettres alors que 91
boutons s'appuient sur le défaut. À retirer, pour que l'écriture explicite veuille dire
quelque chose.

## 15. Où vit quoi

| Fichier | Contenu |
| --- | --- |
| `packages/ui/src/styles/tokens.css` | Les jetons `--sg-*`, les trois thèmes, les dix palettes de syntaxe |
| `packages/ui/src/styles/index.css` | Le mapping vers Tailwind, la base et les utilitaires partagés |
| `packages/ui/src/*.tsx` | Les primitives, et leurs stories à côté |
| `packages/ui/src/labels.tsx` | Les deux libellés que les primitives portent, fournis par l'application |
| `apps/web/src/styles/index.css` | L'entrée : Tailwind, le paquet, les sources à scanner |
| `apps/web/src/styles/app.css` | Les règles propres à Solera : géométrie, fil, markdown |
| `apps/catalog/.storybook/` | La configuration du catalogue : sources, thème, langue, providers |
| `apps/catalog/src/*.mdx` | Les pages de documentation : principes, fondations, gabarits |
| `apps/catalog/src/specimens.tsx` | Les grilles visuelles des fondations, sans prose |
| `scripts/chromium-deps.sh` | Pose Chromium sans sudo, pour capturer le catalogue |
| `apps/web/src/lib/theme.ts` | L'application du thème, et la recopie du canevas dans `theme-color` |
| `apps/web/src/lib/appearance.ts` | Les trois réglages d'apparence |
| `docs/brand/README.md` | Le symbole, ses exemplaires, et la règle de mise à jour |

`docs/SPEC.md` §12.6 décrit l'ancien jeu de jetons (`--bg-base`, `--fg-primary`,
`--accent-subtle`, `--gradient-canvas`…), un thème personnalisé et un fond à deux halos :
rien de tout cela n'existe plus dans le code. Ce document le remplace sur le sujet du
design, et §12.6 doit renvoyer ici.
