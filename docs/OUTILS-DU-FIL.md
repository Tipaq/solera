# Les outils dans le fil

Les adaptateurs normalisent noms et entrées des outils au moment de journaliser
(`docs/CODEX.md`, `docs/GROK.md`, `docs/OPENCODE.md`). Le fil ne fait que lire ce journal :
il ne devine jamais un CLI d'après un nom de fichier ou un intitulé traduit, et la vue
brute garde toujours la charge native.

## Le résumé d'une ligne (`apps/web/src/lib/tool-summary.ts`)

Dans l'ordre :

1. La `description` d'un `Bash`, d'un `Agent` ou d'une `Task`. Celle d'une carte ou d'une
   tâche est son corps, pas une description de l'appel.
2. L'intitulé du harnais, `presentation.title` (ACP, OpenCode), gardé à part des arguments.
3. Ce que Codex a compris d'une commande (`commandActions`), quand une seule action la
   décrit entière.
4. La cible : chemins d'une édition, requêtes d'une recherche web, URL, commande, sujet
   ou identifiant d'une tâche, compétence, ressource MCP, source d'un hook, durée d'une
   attente. Pour une recherche, le motif passe avant le dossier.
5. Les `locations` d'ACP, à défaut d'une cible plus précise.

L'étiquette qu'un connecteur MCP donne à son opération (`presentation.label`, d'après
`appContext.actionName` chez Codex) remplace le nom de l'outil, jamais le résumé : « Lire
le ticket » ne cache pas `#58`.

## Les compteurs `+N / −N` (`apps/web/src/lib/tool-edits.ts`)

- Un patch (Codex, `apply_patch` d'OpenCode) compte les lignes changées, sans en-têtes ni
  contexte. Un ajout ou une suppression de Codex porte le contenu brut : on en compte les
  lignes.
- Un extrait remplacé (`Edit` de Claude et d'OpenCode, `search_replace` de Grok) compte
  l'extrait, avec le même alignement que les diffs du serveur (`text-diff.ts` du
  protocole). Avec `replace_all`, le compte vaut pour un remplacement, et le libellé dit
  que le nombre d'occurrences n'est pas connu.
- Un `Write` ne montre que `+N`, les lignes écrites : l'ancien contenu n'est pas connu.
- Un appel en cours annonce un changement prévu ; un appel échoué ou interrompu n'a pas de
  compteur.
- Une donnée manquante ou mal formée, une suppression sans l'ancien contenu, ou un calcul
  qui dépasserait son budget n'ont pas de compteur. Jamais un zéro inventé.

## Le repli d'une suite (`apps/web/src/lib/tool-rows.ts`, `ToolCallGroup`)

Une suite d'appels est une seule ligne du fil, de son premier appel à sa clôture : elle ne
change pas de composant en grandissant. Elle se replie quand l'agent reprend la parole (du
texte, pas une réflexion) ou quand le tour finit, et seulement si aucun de ses appels ne
tourne. Elle ne se replie pas pendant qu'on lit plus haut dans le fil, ni après qu'on l'a
ouverte ou fermée à la main, ni quand un de ses appels est ouvert.

## Les présentations

Six, choisies dans Apparence et enregistrées sur le compte (`toolStyle`). Toutes gardent
la même hauteur de ligne. La suite `pnpm test:tool-styles-ui` le vérifie à 1280 et 390 px,
avec les origines, les compteurs, les échecs et le repli.

## Les corps lourds

L'aperçu que le serveur envoie au lieu d'une entrée volumineuse (`event-bodies.ts`) garde
ce dont le résumé a besoin, borné à 20 entrées et 512 caractères par champ, et jamais un
extrait de diff dont on tirerait un faux compteur. Une ancienne recherche web de Codex
garde sa requête dans l'aperçu de sa sortie, et le fil l'y retrouve sans charger le corps
(`tool-web-input.ts`).
