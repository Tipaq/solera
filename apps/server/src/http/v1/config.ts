import type { ApiTokenRow, ProjectRow } from '@solera/db'
import {
  isPermissiveConfig,
  mergeAgentConfig,
  readProjectLayer,
  resolveAgentConfig,
  type ConfigLayer,
  type AgentConfig,
  type AgentKind,
  type CreateTaskBody,
} from '@solera/protocol'
import type { AgentRegistry } from '../../agents/registry.js'
import { badRequest } from '../errors.js'

/**
 * Avec quoi une tâche va tourner.
 *
 * Quatre niveaux, du plus précis au plus général : ce que la requête dit, les réglages
 * du jeton, ceux du projet, puis les défauts du compte qui possède le jeton. Un
 * appelant machine n'a ainsi qu'un prompt à fournir, et le choix du modèle a été fait
 * une fois, dans un formulaire, par quelqu'un qui savait ce qu'il faisait.
 */
export async function resolveTaskConfig(
  registry: AgentRegistry,
  token: ApiTokenRow,
  project: ProjectRow,
  body: CreateTaskBody,
  account: ConfigLayer,
): Promise<{ agent: AgentKind; config: AgentConfig }> {
  const agent = body.agent ?? token.agent
  const base = baseConfigFor(agent, token, account, readProjectLayer(project.defaultConfig))

  let merged: AgentConfig
  let rejected: string[]
  try {
    ;({ config: merged, rejected } = mergeAgentConfig(base, body.config))
  } catch {
    throw badRequest(
      'config_invalid',
      'The configuration override is not valid for {agent}. See GET /api/v1/agents.',
      { agent },
    )
  }

  if (rejected.length > 0) {
    throw badRequest(
      'config_field_locked',
      'These settings are fixed by the token and cannot be set per task: {fields}.',
      { fields: rejected.join(', ') },
    )
  }

  if (typeof body.config?.model === 'string' && body.config.model.length > 0) {
    await assertModelExists(registry, agent, body.config.model)
  }

  // Sur la configuration résolue, pas sur celle du jeton : le socle peut aussi venir
  // du préréglage du projet quand la tâche vise l'autre CLI, et ce chemin-là ne doit
  // pas contourner la portée.
  const scopes = JSON.parse(token.scopes) as string[]
  if (isPermissiveConfig(merged) && !scopes.includes('tasks:autonomous')) {
    throw badRequest(
      'config_requires_autonomous',
      'A configuration without guardrails requires the tasks:autonomous scope.',
    )
  }

  return { agent, config: await registry.adapter(agent).resolveDefaults(merged) }
}

/**
 * Le socle sur lequel la surcharge s'applique.
 *
 * La configuration du jeton est complète, choisie dans un formulaire pour son CLI : elle
 * l'emporte telle quelle. Une tâche qui vise un autre CLI hérite du compte puis du projet,
 * champ par champ, comme une conversation ouverte dans l'interface (#120).
 */
function baseConfigFor(
  agent: AgentKind,
  token: ApiTokenRow,
  account: ConfigLayer,
  projectLayer: ConfigLayer,
): AgentConfig {
  if (agent === token.agent) return JSON.parse(token.config) as AgentConfig

  return resolveAgentConfig(agent, [account, projectLayer])
}

/**
 * Un modèle inventé doit se voir dire ce qui existe.
 *
 * Seule la valeur explicitement demandée est vérifiée : contrôler aussi celle du jeton
 * ferait échouer une tâche pour une configuration choisie dans l'interface, et
 * dépendre du CLI à chaque lancement. Si le catalogue est injoignable, on laisse
 * passer, comme le fait `resolveDefaults` avec ses sentinelles.
 */
async function assertModelExists(
  registry: AgentRegistry,
  agent: AgentKind,
  model: string,
): Promise<void> {
  let known: string[]
  try {
    const catalog = await registry.adapter(agent).models()
    known = catalog.models.map((entry) => entry.value)
  } catch {
    return
  }

  if (known.length > 0 && !known.includes(model)) {
    throw badRequest('model_unknown', 'Unknown model {model} for {agent}. Known: {known}.', {
      model,
      agent,
      known: known.join(', '),
    })
  }
}
