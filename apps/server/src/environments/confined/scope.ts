import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOST_CONFINED_ENVIRONMENT, type AgentKind } from '@solera/protocol'
import { transcriptPath } from '../../agents/claude/transcript.js'
import { EnvironmentUnavailableError } from '../provider.js'
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

/** Un terminal confiné : son dossier, rien d'autre. */
export function terminalScope(cwd: string): ConfinementScope {
  return { workspaces: [cwd], writable: [], readable: [], homeLinks: [], env: gitIdentityEnv(cwd) }
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
    homeLinks.push({ path: join('.claude', 'projects', transcripts.split('/').at(-1)!), target: transcripts })
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
    env: gitIdentityEnv(input.cwd),
  }
}
