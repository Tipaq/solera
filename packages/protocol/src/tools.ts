import { z } from 'zod'

/**
 * Ce que le harnais dit d'un appel, à côté de ses arguments : son intitulé humain
 * (« Lire le fichier de config »), l'étiquette d'un outil MCP, les fichiers qu'il touche,
 * et son origine. Séparé de `input` pour que l'intitulé ne se confonde jamais avec un
 * argument, et que la vue des arguments reste complète dans chaque présentation.
 */
export const toolPresentationSchema = z.object({
  origin: z.enum(['native', 'mcp']).optional(),
  title: z.string().optional(),
  label: z.string().optional(),
  paths: z.array(z.string()).optional(),
})
export type ToolPresentation = z.infer<typeof toolPresentationSchema>

/**
 * Garde l'intitulé écrit par le harnais, sauf quand il ne fait que répéter le nom de
 * l'outil : « read_file » n'est pas une description. Les chemins viennent des
 * `locations` d'ACP, bornés comme l'aperçu du journal.
 */
export function toolPresentation(title: unknown, names: string[], locations?: unknown): ToolPresentation {
  const result: ToolPresentation = {}
  const trimmed = typeof title === 'string' ? title.trim() : ''
  if (trimmed && !names.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
    result.title = trimmed.slice(0, 512)
  }
  if (Array.isArray(locations)) {
    const paths = locations.slice(0, 20).flatMap((location: unknown) => {
      const path = (location as { path?: unknown } | null)?.path
      return typeof path === 'string' && path.trim() ? [path.slice(0, 512)] : []
    })
    if (paths.length) result.paths = [...new Set(paths)]
  }
  return result
}

/**
 * Vocabulaire canonique des noms d'outils portés par `tool.started.name`.
 *
 * Ce contrat n'était écrit nulle part : il ne vivait que dans un commentaire du
 * registre de vues du frontend, et un auteur d'adaptateur devait le deviner en
 * lisant l'adaptateur Codex. Le voici, normatif.
 *
 * Un adaptateur DOIT publier ses appels d'outils sous ces noms quand l'action
 * correspond : Codex publie ses exécutions de commande sous `Bash` et ses
 * changements de fichiers sous `Edit`. Un outil MCP passe tel quel sous la forme
 * `serveur/outil`, et un outil vraiment natif sans équivalent garde son nom : le
 * frontend le rend alors par sa vue générique, sans casser.
 *
 * La détection des modifications de fichiers ne passe jamais par ces noms :
 * l'événement `file.edited` existe précisément pour ça.
 */
export const CANONICAL_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  /** `Task` et `Agent` désignent le même outil de sous-agent selon la version du CLI. */
  'Task',
  'Agent',
  'ExitPlanMode',
] as const

export type CanonicalToolName = (typeof CANONICAL_TOOLS)[number]

/** Les deux noms de l'outil de sous-agent, réunis là où le contrat les déclare. */
const SPAWN_TOOLS: ReadonlySet<string> = new Set<CanonicalToolName>(['Task', 'Agent'])

/** Vrai si cet appel lance un sous-agent, dont tout le travail se rattache à lui. */
export function isSpawnTool(name: string): boolean {
  return SPAWN_TOOLS.has(name)
}
