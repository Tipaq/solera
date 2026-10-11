/*
 * Échelles statiques du design system : la source, dont le CSS est généré.
 *
 * `pnpm ui:tokens` écrit `styles/scales.generated.css` depuis ce fichier, et
 * `pnpm ui:tokens:check` échoue si les deux ont divergé. Changer une valeur ici sans
 * régénérer casse la CI plutôt que de passer en silence.
 *
 * Chaque pas porte son **rôle** à côté de sa valeur, et c'est tout l'intérêt : le rôle
 * était dans une table markdown du document et dans une table recopiée du catalogue, qui
 * ne disaient déjà plus la même chose. Les spécimens lisent ce fichier ; aucune valeur
 * n'est plus écrite deux fois.
 *
 * Ne portent une valeur que les pas dont nous déclarons le jeton. Ceux qui viennent de
 * l'échelle intégrée de Tailwind — `text-xs`, `rounded-full`, l'espacement, les `z-*` —
 * ont `token: null` : les recopier serait exactement la divergence qu'on supprime.
 *
 * **Les couleurs ne sont pas ici**, et ne peuvent pas y être : elles sont calculées à
 * l'exécution en `oklch()` depuis `--sg-hue`, `--sg-tint` et `--sg-lift`, que les réglages
 * d'apparence déplacent sous l'utilisateur. Un spécimen qui veut en montrer la valeur la
 * lit sur le document. Voir `styles/tokens.css`.
 */

/** Un pas d'échelle : la classe qu'on écrit, ce qu'elle vaut, et où elle s'emploie. */
export type Step = {
  /** La classe Tailwind, en toutes lettres : Tailwind ne génère rien d'un nom assemblé. */
  readonly className: string
  /** La variable déclarée par ce pas, ou `null` si le pas vient de Tailwind. */
  readonly token: string | null
  /** La valeur émise dans le CSS généré. `null` avec `token: null`, jamais seule. */
  readonly value: string | null
  readonly role: string
  /** Commentaire reporté tel quel au-dessus de la déclaration, dans le CSS généré. */
  readonly note?: string
}

/** Une convention qui n'a pas de jeton : une chaîne de classes, et ce qu'elle veut dire. */
export type Pattern = {
  readonly className: string
  readonly role: string
  /** Le jeton thémé que l'utilitaire lit, quand il en lit un. */
  readonly token?: string
}

export const FONTS = [
  {
    className: 'font-sans',
    token: '--font-sans',
    value: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    role: "Tout le texte de l'interface. La pile système, aucune police chargée.",
  },
  {
    className: 'font-mono',
    token: '--font-mono',
    value: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    role: 'Code, diff, terminal, chemin, valeur de jeton.',
  },
] as const satisfies readonly Step[]

/**
 * Quatre rayons, plus `rounded-full`. L'ordre `sm < md < lg < xl` suit l'imbrication et
 * ne la contredit jamais : un contrôle plus arrondi que la carte qui le contient se voit.
 *
 * Il n'y a **pas** de cinquième pas `2xl`, et il ne s'emploie pas : sans jeton, il tombait
 * sur le défaut de Tailwind, 1rem, soit la valeur de `rounded-xl` à l'identique. La
 * distinction « `xl` pour la palette, `2xl` pour le dialogue » ne distinguait donc rien à
 * l'écran, et trois dialogues sur quatre employaient déjà `xl` ou `lg`.
 *
 * Son nom n'est volontairement écrit nulle part en entier dans un fichier scanné par
 * Tailwind : le mentionner suffirait à régénérer l'utilitaire qu'on vient de retirer.
 */
export const RADII = [
  {
    className: 'rounded-sm',
    token: '--radius-sm',
    value: '0.375rem',
    role: 'Code inline, pastille de couleur, micro-cadre',
  },
  {
    className: 'rounded-md',
    token: '--radius-md',
    value: '0.5rem',
    role: 'Tout contrôle : bouton, champ, entrée de menu, bannière, badge carré',
  },
  {
    className: 'rounded-lg',
    token: '--radius-lg',
    value: '0.75rem',
    role: 'Carte, panneau posé dans la page, liste flottante ancrée à un champ',
  },
  {
    className: 'rounded-xl',
    token: '--radius-xl',
    value: '1rem',
    role: "Grande surface flottante : dialogue centré et sa feuille mobile, palette de commandes, tuile d'état vide",
  },
  {
    className: 'rounded-full',
    token: null,
    value: null,
    role: "Pastille, avatar, puce d'état, badge",
  },
] as const satisfies readonly Step[]

/**
 * L'échelle de texte, fermée à six pas, dans l'ordre des tailles. Les trois qui viennent
 * de Tailwind restent ceux de Tailwind ; les quatre autres sont nommés par rôle et non par
 * dimension — `text-md` collisionnerait avec l'espace `text-*`, et un pas nommé par sa
 * taille ne dit pas où l'employer.
 */
export const TEXT_STEPS = [
  {
    className: 'text-micro',
    token: '--text-micro',
    value: '0.625rem',
    role: 'Micro-étiquette dans une pastille, compteur',
  },
  {
    className: 'text-meta',
    token: '--text-meta',
    value: '0.6875rem',
    role: 'Métadonnée dense : horodatage, chemin, badge de liste',
  },
  {
    className: 'text-xs',
    token: null,
    value: null,
    role: 'Aide, légende, intitulé de groupe',
  },
  {
    className: 'text-sm',
    token: null,
    value: null,
    role: "Le pas courant : corps de l'interface, libellé, bouton",
  },
  {
    className: 'text-heading',
    token: '--text-heading',
    value: '0.9375rem',
    role: 'Titre de carte, titre de dialogue',
  },
  {
    className: 'text-lg',
    token: null,
    value: null,
    role: 'Titre de page',
  },
  {
    className: 'text-code',
    token: '--text-code',
    value: '0.8125rem',
    role: 'Monospace uniquement : bloc de code, diff, terminal',
    note: 'Monospace uniquement : à taille nominale égale, une mono paraît plus grosse.',
  },
] as const satisfies readonly Step[]

/**
 * Ce que le générateur écrit dans `styles/scales.generated.css`, dans cet ordre et dans
 * un seul bloc `@theme`. Les notes sont reportées telles quelles : elles portent des
 * règles qu'on perdrait en les laissant dans le CSS, puisque ce CSS est réécrit.
 */
export const CSS_SCALES = [
  { steps: FONTS },
  { steps: RADII },
  {
    note: [
      "Les pas de texte que l'échelle intégrée de Tailwind n'a pas, nommés par rôle et",
      "non par dimension : `text-md` collisionnerait avec l'espace `text-*`, et un pas",
      "nommé par sa taille ne dit pas où l'employer. Les quatre complètent `text-xs`,",
      '`text-sm` et `text-lg`, qui restent ceux de Tailwind. Toute autre taille est hors',
      'échelle.',
    ],
    steps: TEXT_STEPS,
  },
] as const

/**
 * Les trois ombres. Leur valeur est thémée — le thème contrasté les annule toutes les
 * trois — donc elle n'est pas ici : seul le sens de chacune l'est.
 */
export const SHADOWS = [
  {
    className: 'shadow-card',
    token: '--sg-shadow-sm',
    role: 'Posé sur le fond : carte, bouton principal',
  },
  {
    className: 'shadow-float',
    token: '--sg-shadow-md',
    role: 'Détaché : panneau, liste déroulante, élément en cours de glissement',
  },
  {
    className: 'shadow-pop',
    token: '--sg-shadow-lg',
    role: "Flottant par-dessus l'application : dialogue, palette, infobulle",
  },
] as const satisfies readonly Pattern[]

/** Trois densités, et on ne les mélange pas dans un même écran. */
export const DENSITIES = [
  {
    className: 'px-2.5 py-1.5',
    gap: 'gap-1.5',
    role: "Liste, arbre de fichiers, barre d'outils, en-tête de diff",
  },
  {
    className: 'px-3 py-2',
    gap: 'gap-2',
    role: 'Formulaire, entrée de menu, contrôle',
  },
  {
    className: 'px-5 py-4',
    gap: 'gap-3',
    role: 'Carte, en-tête de dialogue, section de page',
  },
] as const satisfies readonly (Pattern & { readonly gap: string })[]

/**
 * Quatre tailles d'icône. En pixels et non en jeton : `lucide-react` prend un nombre,
 * et une icône se dimensionne par rapport au texte qu'elle accompagne.
 */
export const ICON_SIZES = [
  {
    size: 11,
    role: "Dans une pastille, un badge, une étiquette `text-meta` ; un marqueur d'état posé contre un texte",
  },
  {
    size: 14,
    role: "Densité dense : ligne de liste, arbre, barre d'outils, `IconButton size=\"sm\"`, `Button size=\"sm\"`",
  },
  {
    size: 16,
    role: "Densité courante : `Button`, `IconButton`, en-tête de carte, `MenuItem`, option de `Select` ou de `ChoiceList`, en-tête de page, champ",
  },
  {
    size: 22,
    role: "Emphase : icône d'état vide, grand espace vide, attente centrée",
  },
] as const

/** Six couches de `z-index`, nommées par ce qu'elles empilent. Aucune autre valeur. */
export const LAYERS = [
  {
    className: 'z-10',
    role: 'Local à un conteneur : en-tête collant, poignée, surimpression dans la page',
  },
  {
    className: 'z-20',
    role: 'Panneau dans la page : panneau latéral accosté, panneau de fiche, combobox',
  },
  { className: 'z-30', role: 'Barre latérale mobile, voile de dépôt de fichier' },
  { className: 'z-40', role: 'Voile de dialogue, panneau en plein écran' },
  { className: 'z-50', role: 'Dialogue, feuille, palette' },
  {
    className: 'z-[100]',
    role: "Infobulle — seule couche au-dessus d'un dialogue, puisqu'elle doit s'y afficher",
  },
] as const satisfies readonly Pattern[]
