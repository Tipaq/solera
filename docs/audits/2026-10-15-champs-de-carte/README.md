# Les champs d'une carte — ce qu'on ajoute, ce qu'on refuse

Carte **#32**, détachée de la **#31** le 2026-10-15. Session de décision : aucune ligne
de code, aucune migration. La maquette de départ est
[`../2026-10-14-gestion-de-projet/final/pages/clair/14-t2-carte-enrichie.png`](../2026-10-14-gestion-de-projet/final/pages/clair/14-t2-carte-enrichie.png)
(T2), née parce que les chronologies en avaient besoin et jamais discutée pour elle-même.

La question qu'elle posait sans y répondre : **« est-ce encore une carte, ou déjà un
ticket Jira ? »** La réponse tenue ici : une carte, parce que des cinq champs proposés,
**un seul ajoute une colonne porteuse de sens nouveau** (l'échéance), un deuxième réutilise
la carte elle-même (le jalon), un troisième se dérive du texte déjà écrit (les sous-tâches),
et les deux derniers sont refusés ou réduits.

## Trois constats qui ont déplacé la discussion

1. **Le panneau réel n'est pas la maquette.** `CardPanel.tsx` a déjà trois onglets
   (détails · activité · sessions) et se redimensionne à la poignée. T2 empile tout à
   plat et surestime donc l'encombrement : l'argument « cinq champs sur 30 rem » pesait
   moins qu'il n'en avait l'air, et n'a pas servi à trancher.
2. **`card_refs` est une table dérivée**, réécrite à chaque enregistrement depuis le texte
   de la description (`parseCardReferences`). Un type ne peut pas y être dérivé sans
   inventer une syntaxe dans la prose. Tout lien typé est donc une **seconde table
   affirmée**, à côté, jamais une colonne de plus sur celle-là.
3. **Les sous-tâches recoupent la description.** Une liste `- [ ]` en markdown s'y écrit
   déjà, les agents en produisent naturellement, et la barre d'avancement de T2 s'en
   déduit sans une ligne de schéma.

## Les décisions

### 1. L'échéance — **prise**

Une colonne nullable `due_at` sur `cards`, une pastille dans le panneau.

*Pourquoi* : c'est la clé de voûte des trois écrans qui en dépendent (les échéances
proches de l'Aperçu F1, la chronologie d'un projet F4, celle du portefeuille F10), et
c'est le champ le moins cher du lot — une colonne, pas d'entité, pas de table, rien à
apprendre de neuf au serveur MCP sinon la lire.

*L'objection retenue en connaissance de cause* : une date sur une carte d'un projet solo
est souvent du théâtre. On l'assume ; le champ est nullable et une carte sans échéance
reste la norme.

### 2. Le jalon — **pris, mais un jalon est une carte**

Pas de table `milestones`. « v0.2 — la gestion de projet » est une **carte ordinaire**,
avec son numéro, sa description, ses notes, ses pièces jointes — et son échéance, qui
devient la date du jalon. Les autres cartes s'y rattachent par une colonne
`milestone_card_id` sur `cards`, auto-référence nullable.

*Pourquoi la carte plutôt que l'entité* : un jalon a exactement les besoins d'une carte
— un nom, une date, un endroit où écrire ce qu'il recouvre, un fil de notes, un état
ouvert/fermé (sa colonne). Une table dédiée aurait dupliqué tout cela, plus son propre
écran de création, de renommage et de clôture.

*Pourquoi une colonne plutôt qu'un lien typé* : un jalon au plus par carte, garanti par
le schéma au lieu d'une convention. Avec un lien, rien n'empêche une carte d'appartenir
à trois jalons.

*Pas de drapeau `is_milestone`* : une carte **est** un jalon dès que quelque chose la
désigne. Rien à tenir, rien à corriger quand on se trompe. Le sélecteur propose les
cartes déjà utilisées comme jalon, plus une recherche.

*Ce qu'on accepte en échange* : une carte-jalon occupe une place sur le board comme une
autre. Si elle y gêne, c'est un problème d'affichage du board, pas de schéma — et il se
corrigera là où il se pose.

*Un effet de bord à connaître avant de le prendre pour un bug* (relevé par la session qui
porte la #31) : **les compteurs d'onglet comptent les cartes ouvertes**, pas l'inventaire —
`ProjectLayout.tsx` et `PortfolioLayout.tsx` filtrent par `CARD_CLOSED_COLUMNS`, et le
chiffre se lit « ce qui reste à faire ». Une carte-jalon y entre donc comme une autre, et
« Board 9 » deviendra « Board 10 » le jour où quelqu'un crée `v0.3`. Ce n'est pas faux — un
jalon est du travail tant qu'il n'est pas livré — mais ce n'est pas non plus un accident :
c'est la conséquence assumée du choix ci-dessus. Même chose, plus bénigne, pour le board
global (`PortfolioBoardPage.tsx`) et pour *Travail* (`lib/portfolio.ts`), où une carte-jalon
apparaîtra si une session lui est rattachée.

### 3. Les sous-tâches — **prises, dérivées de la description**

Aucune table. On rend cochables les `- [ ]` déjà écrits dans le markdown de la
description, et la barre d'avancement de T2 s'en déduit. Cocher réécrit la description.

*Pourquoi* : la maquette obtenue à coût de schéma nul. Les agents savent déjà écrire une
liste markdown ; `create_card` et l'édition de description n'apprennent rien de neuf ; et
on évite un **troisième endroit où un travail se décrit**, à côté de la description et
des notes — le reproche qui était déjà fait aux notes contre la description.

*La limite assumée* : pas d'ordre indépendant du texte, pas d'interrogation SQL sur les
sous-tâches, et cocher une case est une écriture sur la description (donc un conflit
possible avec une édition concurrente).

### 4. Les liens typés — **réduits à `bloque`**

`card_refs` **ne bouge pas** : elle reste dérivée du texte et non typée, un `#12` écrit
dans une description continue de produire un backlink « cite ». À côté, une petite table
de liens **posés à la main**, avec un seul type pour commencer : `bloque` / `bloqué par`.

*Pourquoi un seul type* : c'est celui qui porte une information qu'aucun autre champ ne
porte — « n'ouvre pas #26 avant #25 », ce qu'une session lira dans `read_card`. Le reste
du vocabulaire (parent/enfant, duplique, appartient-à) n'a pas d'emploi aujourd'hui :
appartient-à est remplacé par `milestone_card_id`, et parent/enfant par une citation.

*Pourquoi deux tables et pas une* : l'une est dérivée et se réécrit à chaque
enregistrement, l'autre est affirmée et doit survivre à une réécriture de la description.
Les fondre ferait disparaître un lien posé à la main le jour où quelqu'un corrige une
phrase.

### 5. Les étiquettes — **refusées**

*Pourquoi* : elles ne servent aucune chronologie. Leur seul emploi dans le jeu d'écrans
est le filtre *Étiquette* du board global (F8), et 32 cartes se cherchent plus vite
qu'elles ne se taguent. Le prix — une table, un éditeur de tags, une question de couleurs,
et un vocabulaire qui dérive quand personne ne le range — ne se paie pas à cette taille.

*Rouvrable* : quand un board dépasse la centaine de cartes, ou quand le board global
devient la vue principale. Rien dans les décisions ci-dessus ne les empêche.

### 6. L'assignation — **confirmée absente**

Une carte est prise par la session qui l'ouvre, et un agent n'est pas une personne à qui
on assigne. Les sessions rattachées disent déjà qui travaille, avec leur état et leur
worktree.

## Deux questions voisines, tranchées ici

### Le type d'une note (le Journal F5) — **pas de type**

`card_notes.body` reste un champ libre. Le Journal écrira `NOTE` et dira la vérité, au
lieu d'étiqueter `DÉCISION` une note dont rien ne dit que c'en est une.

*Pourquoi* : un `kind` serait rempli au jugé par les agents, qui étiquetteraient tout
« décision ». Un tri auquel on ne peut pas se fier est pire qu'un tri absent — il fait
croire qu'on a cherché partout.

### `card_moves` — **prise, dans la même migration**

Une table étroite, en ajout seul : une ligne par changement de colonne (carte, colonne
d'avant, colonne d'après, qui, quand).

*Pourquoi* : aujourd'hui `cards` ne porte que `column` + `updated_at`, qu'une simple
correction de titre réécrit. On ne peut donc pas dire **quand** une carte a été terminée,
et c'est précisément ce qu'un journal doit raconter. Tant qu'on ouvre le schéma des
cartes, la poser coûte une table et évite une seconde migration.

**Pour la session qui portera le Journal (carte #33)** : ces deux réponses sont les
tiennes, la description de #33 dit encore de les attendre. Écris `NOTE`, pas `DÉCISION` ;
et `card_moves` t'est livrée par la carte **#36**, dans la migration des champs de carte.
Elle doit être écrite partout où une colonne change — le glisser-déposer du board, le menu
du panneau, et le passage automatique en « en cours » quand une session s'ouvre sur une
carte « à faire » : si un seul de ces chemins est oublié, la table ment et le Journal ment
avec elle.

## Ce que les écrans de la carte #31 deviennent

| Écran | Sort |
|---|---|
| **F1** échéances proches de l'Aperçu | **survit** — l'échéance est prise |
| **F4** chronologie d'un projet | **survit** — échéances + dates des cartes-jalons |
| **F10** chronologie du portefeuille | **survit** — idem, tous projets |
| **F6** colonne « jalon » des lignes du portefeuille | **survit** — c'est le titre de la carte-jalon |
| **F8** filtre *Jalon* du board global | **survit** |
| **F8** filtre *Étiquette* du board global | **tombe** — les étiquettes sont refusées |
| **F5 / F11** Journal | inchangé, et gagne `card_moves` ; sa première ligne dira `NOTE` |

## Ce que les agents voient changer

`read_card` gagne l'échéance, le jalon (titre et numéro de la carte-jalon), les cartes
bloquées et bloquantes. `list_cards` gagne l'échéance et le jalon. `create_card` **n'en
gagne aucun** : une carte ouverte par un agent pour noter ce qu'il a croisé n'a ni date ni
jalon à proposer, et le lui demander l'inviterait à inventer. Poser une échéance, un jalon
ou un lien `bloque` reste un geste de l'interface — ce qui croise la carte **#24** et n'y
ajoute rien à décider : aucun outil d'écriture nouveau.

## Ce qui a été écarté, et pourquoi

| | |
|---|---|
| une table **`milestones`** | un jalon a exactement les besoins d'une carte ; l'entité aurait dupliqué le nom, la date, la description, les notes et l'état ouvert/fermé, plus son écran de gestion |
| un **lien typé « appartient à »** pour le jalon | rien n'y empêche trois jalons sur une carte ; une colonne le garantit |
| un drapeau **`is_milestone`** | un état de plus à poser et à corriger, là où « être désigné comme jalon » suffit |
| une **table de sous-tâches** | un troisième endroit où un travail se décrit, à côté de la description et des notes, pour une barre d'avancement que le markdown donne déjà |
| un **`type` sur `card_refs`** | la table est dérivée du texte à chaque enregistrement : un type y serait effacé par une correction de phrase, ou imposerait une syntaxe dans la prose |
| le **jeu complet de liens typés** | parent/enfant, duplique, appartient-à n'ont pas d'emploi une fois le jalon traité par une colonne |
| les **étiquettes libres** | ne servent aucune chronologie ; un seul filtre les emploie, et 32 cartes se cherchent plus vite qu'elles ne se taguent |
| un **`kind` sur `card_notes`** | rempli au jugé par les agents, il ferait croire à un tri qui n'existe pas |
| l'**assignation** | la session qui ouvre la carte la prend ; un agent n'est pas une personne |
| des champs dans **`create_card`** | un agent qui note ce qu'il a croisé n'a pas de date à proposer ; le lui demander l'invite à en inventer une |

## Pour la session qui implémentera (carte #36)

Quatre pièges que la décision laisse ouverts, et que personne n'a encore regardés :

1. **Cocher une sous-tâche réécrit la description.** Il existe un brouillon par
   utilisateur et par carte (`apps/web/src/lib/card-drafts.ts`, utilisé dans
   `CardPanel.tsx`) et une édition concurrente est possible. C'est le seul endroit de ce
   chantier où du texte de l'utilisateur peut se perdre : à traiter en premier, et le
   comportement choisi se dit dans le commit.
2. **Le `#12` d'une description doit continuer de marcher exactement comme avant.**
   `card_refs`, `CardDto.references` et `CardDto.referencedBy` ne changent pas de sens ;
   les liens `bloque` s'ajoutent à côté, sous leur propre nom.
3. **`card_moves` doit être écrite sur les trois chemins** qui changent une colonne : le
   glisser-déposer du board, le menu du panneau, et le passage automatique en « en cours »
   quand une session s'ouvre sur une carte « à faire ».
4. **La maquette T2 ne dit pas dans quel onglet va quoi** : elle empile tout à plat alors
   que `CardPanel.tsx` a déjà trois onglets (détails · activité · sessions) et une poignée
   de redimensionnement. Le placement est à décider, pas à recopier.
