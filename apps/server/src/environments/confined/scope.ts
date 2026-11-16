import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOST_CONFINED_ENVIRONMENT, type AgentKind } from '@solera/protocol'
import { transcriptFolderName, transcriptPath } from '../../agents/claude/transcript.js'
import { containerPathOf } from '../devcontainer/paths.js'
import { EnvironmentUnavailableError } from '../provider.js'
import { enclosingRepo } from './git.js'
import type { ConfinementScope } from './plan.js'

/**
 * L'identité git de l'utilisateur, lue sur l'hôte dans le dossier de travail (config
 * locale et `includeIf` compris) : le home privé n'a pas de `~/.gitconfig`, et un commit
 * sans auteur échoue. Rien si git ne la connaît pas.
 */
export function gitIdentityEnv(cwd: string): Record<string, string> {
  const read = (key: string) => {
    try {
      return execFileSync('git', ['config', '--get', key], { cwd, encoding: 'utf8', timeout: 5_000 }).trim()
    } catch {
      return ''
    }
  }
  const name = read('user.name')
  const email = read('user.email')
  return {
    ...(name ? { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name } : {}),
    ...(email ? { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email } : {}),
  }
}

/**
 * Ce que git reçoit dans le bac à sable : l'identité de l'utilisateur, et pas
 * d'entretien automatique, qui réécrirait `packed-refs` dans un dossier commun en
 * lecture seule et se plaindrait à chaque commit.
 */
function gitEnv(cwd: string): Record<string, string> {
  return {
    ...gitIdentityEnv(cwd),
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'gc.auto',
    GIT_CONFIG_VALUE_0: '0',
    GIT_CONFIG_KEY_1: 'maintenance.auto',
    GIT_CONFIG_VALUE_1: 'false',
  }
}

/**
 * Refuse un dossier de travail situé dans un dépôt sans en être la racine (un projet
 * en sous-dossier) : l'agent pourrait y faire `git init` et poser une config que git
 * exécuterait sur l'hôte, et le `.git` vide qui l'en empêche ailleurs ferait aussi
 * refuser le dossier au git de l'hôte.
 */
function assertConfinable(cwd: string): void {
  if (existsSync(join(cwd, '.git')) || !enclosingRepo(cwd)) return
  throw new EnvironmentUnavailableError(
    HOST_CONFINED_ENVIRONMENT,
    'A confined session cannot run in a subfolder of a git repository.',
    { code: 'confinement_subfolder' },
  )
}

/** Un terminal confiné : son dossier, rien d'autre. */
export function terminalScope(cwd: string): ConfinementScope {
  assertConfinable(cwd)
  return { workspaces: [cwd], writable: [], readable: [], homeLinks: [], env: gitEnv(cwd) }
}

export interface SessionScopeInput {
  agent: AgentKind
  cwd: string
  /** Les worktrees liés à la session, que le CLI reçoit comme dossiers en plus. */
  workTrees: string[]
  /** Ce que `accountEnv` a posé : le jeton de Claude, le home du compte Codex ou Grok. */
  accountEnv: Record<string, string>
  memoryDir: string | null
  skillRoots: string[]
  prototypesDir: string | null
}

/** Ce que Claude lit de l'utilisateur dans `~/.claude`, sans connexion ni secret. */
const CLAUDE_USER_FILES = ['CLAUDE.md', 'skills', 'agents', 'commands', 'output-styles']

const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok', opencode: 'OpenCode' }

function refuse(code: string, agent: AgentKind, message: string): never {
  throw new EnvironmentUnavailableError(HOST_CONFINED_ENVIRONMENT, message, { code, params: { agent: AGENT_NAMES[agent] } })
}

/**
 * Ce qu'une session confinée voit de l'hôte, selon son agent. Lève quand elle ne peut
 * pas tourner confinée : elle ne retombe jamais sur la connexion du CLI de l'hôte, qui
 * vit dans un dossier personnel que le confinement cache.
 *
 * - Claude : son jeton passe par variable ; ses transcripts de ce dossier de travail,
 *   montés depuis l'hôte, survivent au home privé (la reprise et la resynchronisation
 *   les lisent là) ; les consignes et les skills de l'utilisateur sont lisibles.
 * - Codex et Grok : le home du compte, monté en écriture (le CLI y rafraîchit sa
 *   connexion et y écrit ses fils), et lui seul (#139).
 * - OpenCode : pas encore de compte isolé, donc pas de confinement.
 */
export function sessionScope(input: SessionScopeInput): ConfinementScope {
  const { agent, accountEnv } = input
  assertConfinable(input.cwd)
  const writable = [...(input.memoryDir ? [input.memoryDir] : []), ...(input.prototypesDir ? [input.prototypesDir] : [])]
  // Pas les pièces jointes : leur dossier mêle tous les projets (voir `shareAttachments`).
  const readable = [...input.skillRoots]
  const homeLinks: ConfinementScope['homeLinks'] = []
  if (agent === 'opencode') {
    refuse('confinement_agent_unsupported', agent, 'OpenCode has no isolated account yet: it cannot run confined.')
  }
  if (agent === 'claude') {
    if (!accountEnv.CLAUDE_CODE_OAUTH_TOKEN && !accountEnv.ANTHROPIC_API_KEY) {
      refuse('confinement_account_required', agent, 'A confined session needs one of your Solera accounts, not the CLI login.')
    }
    const transcripts = dirname(transcriptPath(input.cwd, 'session'))
    const configDir = dirname(dirname(transcripts))
    mkdirSync(transcripts, { recursive: true })
    writable.push(transcripts)
    // Au nom du cwd que le CLI voit : sous Windows natif, le conteneur dit `/mnt/c/…`
    // quand le dossier de l'hôte porte `C:\…` (#154). Ailleurs, c'est le même.
    const seen = transcriptFolderName(containerPathOf(input.cwd) ?? input.cwd)
    homeLinks.push({ path: join('.claude', 'projects', seen), target: transcripts })
    for (const name of CLAUDE_USER_FILES) {
      const path = join(configDir, name)
      if (!existsSync(path)) continue
      readable.push(path)
      homeLinks.push({ path: join('.claude', name), target: path })
    }
  } else {
    const variable = agent === 'codex' ? 'CODEX_HOME' : 'GROK_HOME'
    const home = accountEnv[variable]
    if (!home) {
      refuse('confinement_account_required', agent, 'A confined session needs one of your Solera accounts, not the CLI login.')
    }
    writable.push(home)
  }
  return {
    workspaces: [input.cwd, ...input.workTrees],
    writable,
    readable,
    homeLinks,
    env: gitEnv(input.cwd),
  }
}
