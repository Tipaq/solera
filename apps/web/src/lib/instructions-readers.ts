import type { AgentKind, InstructionsMode, RepoInstructionFile } from '@solera/protocol'

/**
 * Ce que chaque CLI lit des consignes d'un projet (page projet v2, R-6.3 et R-6.4).
 *
 * Les règles sont celles des adaptateurs, sondées et écrites dans
 * `packages/protocol/src/instructions.ts` et `docs/{CODEX,GROK,OPENCODE}.md` :
 * - *dans Solera*, Solera injecte son texte aux quatre CLI et leur masque les fichiers
 *   du dépôt ;
 * - *dans le dépôt*, chaque CLI lit lui-même ce qu'il sait lire : Claude, Grok et
 *   OpenCode lisent `AGENTS.md` et `CLAUDE.md`, **Codex ignore `CLAUDE.md`** ;
 * - la partie globale de SOLERA.md est injectée dans les deux cas.
 */

/** L'ordre de la table « Ce que lit chaque CLI ». */
export const INSTRUCTION_READERS = ['claude', 'codex', 'grok', 'opencode'] as const satisfies readonly AgentKind[]

/** Les fichiers de consignes présents à la racine du workspace, par nom. */
export type RepoFiles = Partial<Record<RepoInstructionFile, string>>

export interface InstructionsState {
  mode: InstructionsMode
  /** Le texte tenu par Solera pour ce projet. */
  solera: string
  files: RepoFiles
  /** La partie globale de SOLERA.md. */
  global: string
}

export type ProjectReading =
  | { kind: 'solera' }
  | { kind: 'files'; files: RepoInstructionFile[] }
  | { kind: 'missing'; reason: 'noFile' | 'codexIgnoresClaude' | 'soleraEmpty' }

export interface CliReading {
  agent: (typeof INSTRUCTION_READERS)[number]
  global: boolean
  project: ProjectReading
}

export type InstructionsAlert =
  /** Ces CLI démarrent sans consignes du projet ; `rename` : seul `CLAUDE.md` existe. */
  | { kind: 'missing'; agents: AgentKind[]; rename: boolean }
  /** `AGENTS.md` et `CLAUDE.md` ont chacun leur contenu : les CLI ne lisent pas la même chose. */
  | { kind: 'diverge' }

export type RepoFileState =
  | { kind: 'absent' }
  | { kind: 'pointer'; to: RepoInstructionFile }
  /** `masked` : présent, mais masqué aux CLI tant que les consignes sont dans Solera. */
  | { kind: 'lines'; count: number; masked: boolean }

export type EditTarget = { kind: 'solera' } | { kind: 'file'; path: RepoInstructionFile; exists: boolean }

const OTHER: Record<RepoInstructionFile, RepoInstructionFile> = { 'AGENTS.md': 'CLAUDE.md', 'CLAUDE.md': 'AGENTS.md' }

/** Ce que chaque CLI sait lire du dépôt. */
const READABLE: Record<CliReading['agent'], RepoInstructionFile[]> = {
  claude: ['AGENTS.md', 'CLAUDE.md'],
  codex: ['AGENTS.md'],
  grok: ['AGENTS.md', 'CLAUDE.md'],
  opencode: ['AGENTS.md', 'CLAUDE.md'],
}

/** Au-delà, un fichier porte des consignes à lui, même s'il cite l'autre. */
const POINTER_MAX_LINES = 4

const filled = (text: string | undefined) => (text ?? '').trim().length > 0

export const nonEmptyLines = (text: string) => text.split('\n').filter((line) => line.trim()).length

/** Un fichier court qui ne fait que renvoyer à l'autre : `CLAUDE.md` → « Voir AGENTS.md ». */
export function pointsTo(content: string, other: RepoInstructionFile): boolean {
  return nonEmptyLines(content) <= POINTER_MAX_LINES && content.includes(other)
}

function projectReading(state: InstructionsState, agent: CliReading['agent']): ProjectReading {
  if (state.mode === 'solera') return filled(state.solera) ? { kind: 'solera' } : { kind: 'missing', reason: 'soleraEmpty' }
  const used = READABLE[agent].filter((file) => filled(state.files[file]))
  if (used.length > 0) return { kind: 'files', files: used }
  const ignored = agent === 'codex' && filled(state.files['CLAUDE.md'])
  return { kind: 'missing', reason: ignored ? 'codexIgnoresClaude' : 'noFile' }
}

/** Une ligne par CLI : la partie globale lui parvient-elle, et quelle partie projet. */
export function readersOf(state: InstructionsState): CliReading[] {
  return INSTRUCTION_READERS.map((agent) => ({ agent, global: filled(state.global), project: projectReading(state, agent) }))
}

/**
 * Les alertes sous la table. Le même texte des deux côtés, comme un `AGENTS.md` lien
 * symbolique vers `CLAUDE.md`, ne diverge pas ; en mode Solera, les fichiers sont
 * masqués et leur désaccord ne touche aucun agent.
 */
export function alertsOf(state: InstructionsState): InstructionsAlert[] {
  const alerts: InstructionsAlert[] = []
  const missing = readersOf(state).filter((reading) => reading.project.kind === 'missing')
  if (missing.length > 0) {
    const rename = state.mode === 'repo' && filled(state.files['CLAUDE.md']) && !filled(state.files['AGENTS.md'])
    alerts.push({ kind: 'missing', agents: missing.map((reading) => reading.agent), rename })
  }
  const agents = state.files['AGENTS.md'] ?? ''
  const claude = state.files['CLAUDE.md'] ?? ''
  if (
    state.mode === 'repo' &&
    filled(agents) &&
    filled(claude) &&
    agents.trim() !== claude.trim() &&
    !pointsTo(agents, 'CLAUDE.md') &&
    !pointsTo(claude, 'AGENTS.md')
  ) {
    alerts.push({ kind: 'diverge' })
  }
  return alerts
}

/** La mention d'un fichier du dépôt dans la liste « Fichiers à la racine du dépôt ». */
export function fileStateOf(mode: InstructionsMode, files: RepoFiles, file: RepoInstructionFile): RepoFileState {
  const content = files[file]
  if (content === undefined) return { kind: 'absent' }
  const other = OTHER[file]
  if (pointsTo(content, other)) return { kind: 'pointer', to: other }
  return { kind: 'lines', count: nonEmptyLines(content), masked: mode === 'solera' }
}

/**
 * Le texte qu'« ✎ Modifier » ouvre : celui de Solera, ou le fichier du dépôt qui porte
 * le contenu. `AGENTS.md` d'abord, que tous les CLI lisent, sauf s'il ne fait que
 * renvoyer à `CLAUDE.md` ; à défaut de l'un et de l'autre, un `AGENTS.md` à créer.
 */
export function editTargetOf(mode: InstructionsMode, files: RepoFiles): EditTarget {
  if (mode === 'solera') return { kind: 'solera' }
  const agents = files['AGENTS.md']
  const claude = files['CLAUDE.md']
  if (agents !== undefined && !(claude !== undefined && pointsTo(agents, 'CLAUDE.md'))) {
    return { kind: 'file', path: 'AGENTS.md', exists: true }
  }
  if (claude !== undefined) return { kind: 'file', path: 'CLAUDE.md', exists: true }
  return { kind: 'file', path: 'AGENTS.md', exists: false }
}
