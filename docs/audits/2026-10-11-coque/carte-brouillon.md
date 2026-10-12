# Brouillon de carte — à créer au go de Tim

**Titre** : Porter la coque arrêtée — la barre du haut et le panneau droit

**Référence d'interface** : `docs/audits/2026-10-11-coque/final/` (treize écrans au
large, cinq au téléphone, clair et sombre). Les maquettes font foi au pixel près ; ce
qui n'y figure pas n'est pas dans cette carte.

## Dans la carte

1. **Une bande unique, segmentée par zone**, toute à `--header-height`. Aujourd'hui
   aucune vue ne lit le jeton : conversation, board, services et planifications ont
   quatre hauteurs différentes. Les segments se séparent par le prolongement des
   bordures des colonnes.
2. **L'en-tête de conversation** : identité à gauche (projet au-dessus, titre dessous),
   l'icône du CLI portant l'anneau d'activité, puce de branche/worktree remontée de la
   modale *Détails*, signaux conservés, bouton du panneau au bout. Disparaissent de là :
   la jauge, les consignes, la recherche, compacter, et le `⋯`.
3. **Le `+` du composer** reçoit *Chercher dans le fil* (`Ctrl F`) et *Détails de la
   conversation*. **Les consignes** passent aux réglages du projet.
4. **Le panneau droit perd son en-tête.** Ses vues vivent dans la bande, nommées tant
   qu'il y a la place, repliées en icônes sous 30 rem, toutes ensemble.
5. **Cinq vues** : Fichiers · Recherche · Git · Terminaux | Agent.
   - *MCP* quitte le panneau : la liste vit dans le `+`, redessinée (état, portée,
     nombre d'outils, interrupteur de session, isolation stricte), et une **modale**
     porte l'ajout et les réglages d'un serveur.
   - *Historique* est dissous : il devient la section **« Ses écritures »** de la vue
     *Agent*, groupée par fichier, avec le nombre de passes et la marque « réécrit à la
     main ». L'onglet disparaît.
6. **Fichiers** : l'en-tête de l'arbre porte le dossier du workspace, +fichier,
   +dossier, relire, replier. La rangée d'onglets reçoit son `⋯` (fermer, fermer les
   autres, fermer les enregistrés, tout fermer, rouvrir le dernier, copier le chemin).
7. **Recherche** : vue neuve, par **nom et par contenu**, avec casse / mot entier /
   regex, inclure et exclure, résultats en deux sections. *La seule pièce qui demande du
   serveur* — une route de recherche dans le workspace. À chiffrer avant de commencer.
8. **Visionneuse d'images** : ajuster / 100 % / largeur, zoom à la molette, glisser,
   double-clic, plein écran hors de la coque, et repli automatique de l'arbre à
   l'ouverture d'une image large. Aujourd'hui `EditorPane.tsx:277` pose un
   `object-contain` sans zoom, et une image au format éloigné du panneau est illisible.
9. **Le téléphone** : les cinq écrans de `final/mobile/` — tiroir à la place du logo,
   `+` en feuille, panneau en recouvrement, Fichiers sans arbre simultané, visionneuse
   plein écran.

## Hors de la carte, explicitement

- **La colonne de gauche** entière : sections, activité, signets, projets, pied de
  compte. Rien n'y est touché — une autre session s'en charge.
- **Le contexte Savoir** (PKM) : ni vue de panneau, ni éditeur de note, ni permissions
  par dossier, ni vault. Seule sa barre est dessinée, et elle attend la colonne.
- **Le fil libre** et le geste *Ranger…*.
- Les réglages en modale, la palette élargie, la ligne d'activité condensée, la
  disparition de l'accueil : décidés sur le papier (`emplacements.md`), **pas** dans
  cette carte, parce qu'ils touchent la colonne.

## À vérifier avant de commencer

- **La surveillance de fichiers côté serveur** : si l'arbre se met à jour tout seul, le
  bouton *relire* reste un confort ; sinon il est nécessaire. Ne pas le retirer sans
  avoir regardé.
- **La route de recherche** (point 7) : existe-t-elle ? Sinon, c'est le plus gros poste
  de la carte, et il peut être livré à part.
- `scripts/*-ui-check.mjs` : les suites qui touchent la coque devront être reprises, et
  elles écrivent des captures — ne lancer que celles qui concernent ce qu'on touche.

## À supprimer en fin de chantier

`apps/web/src/components/ShellPrototypes.tsx` et `scripts/shell-prototypes.mjs`, une
fois la coque portée. Les images de `final/` restent : elles datent la décision.
