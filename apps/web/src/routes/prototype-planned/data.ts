/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les données de la page globale des **Planifiées** : toutes les tâches, tous projets,
 * le Savoir et l'instance, au format unifié des Actions (`Automation`, Quoi × Quand),
 * chacune avec sa **portée**.
 *
 * Le modèle réel ne connaît qu'une portée : `ScheduledTaskDto.projectId`, un projet ou
 * `null`. Une tâche sans projet peut travailler le vault comme toucher toute l'instance :
 * rien ne les distingue. Hors démo, `null` s'affiche donc « Sans projet ». Les portées
 * *Savoir* et *Instance* n'existent qu'en démo (SIMULÉ), pour juger la page.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { nextScheduleRun, type AgentKind, type ProjectDto, type ScheduleCadence } from '@solera/protocol'
import { useAllConversations } from '../../lib/conversations'
import { useProjects } from '../../lib/projects'
import { useSchedules } from '../../lib/schedules'
import { demoScheduledCommands, fromTask, type Automation, type RunStatus, type UnifiedRun } from '../prototype-automations/model'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export type Scope =
  | { kind: 'project'; project: ProjectDto }
  | { kind: 'knowledge' }
  | { kind: 'instance' }
  | { kind: 'none' }

export type PlannedItem = Automation & { scope: Scope }

export const scopeKey = (scope: Scope): string => (scope.kind === 'project' ? scope.project.id : scope.kind)

export function scopeLabel(scope: Scope): string {
  if (scope.kind === 'project') return scope.project.name
  if (scope.kind === 'knowledge') return 'Savoir'
  if (scope.kind === 'instance') return 'Instance'
  return 'Sans projet'
}

export interface ScopeOption {
  key: string
  scope: Scope
  count: number
}

export interface PlannedData {
  demo: boolean
  isPending: boolean
  items: PlannedItem[]
  scopes: ScopeOption[]
  /** Le coût d'un passage d'agent : celui de sa session. Null pour une commande. */
  costOf: (run: UnifiedRun) => number | null
}

/** Le projet où ouvrir les liens d'une tâche (session, détail) ; `''` hors projet. */
export const projectIdOf = (item: PlannedItem): string => (item.scope.kind === 'project' ? item.scope.project.id : '')

export function usePlanned(): PlannedData {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data: schedules, isPending } = useSchedules()
  const { data: projects } = useProjects()
  const { data: conversations } = useAllConversations()

  return useMemo(() => {
    if (demo) return demoData()
    const byId = new Map((projects ?? []).map((project) => [project.id, project]))
    const costs = new Map((conversations ?? []).map((entry) => [entry.id, entry.costUsd]))
    const items: PlannedItem[] = (schedules ?? []).map((task) => {
      const project = task.projectId ? byId.get(task.projectId) : undefined
      return { ...fromTask(task), scope: project ? { kind: 'project', project } : { kind: 'none' } }
    })
    return {
      demo,
      isPending,
      items,
      scopes: scopesOf(items),
      costOf: (run) => (run.conversationId ? costs.get(run.conversationId) ?? null : null),
    }
  }, [demo, schedules, projects, conversations, isPending])
}

function scopesOf(items: PlannedItem[]): ScopeOption[] {
  const map = new Map<string, ScopeOption>()
  for (const item of items) {
    const key = scopeKey(item.scope)
    const entry = map.get(key) ?? { key, scope: item.scope, count: 0 }
    entry.count += 1
    map.set(key, entry)
  }
  const rank = (scope: Scope) => (scope.kind === 'project' ? 0 : scope.kind === 'knowledge' ? 1 : scope.kind === 'instance' ? 2 : 3)
  return [...map.values()].sort((a, b) => rank(a.scope) - rank(b.scope) || scopeLabel(a.scope).localeCompare(scopeLabel(b.scope)))
}

/* ------------------------------------------------------------------ santé, échéance */

export interface Health {
  rate: number | null
  judged: number
  cost30: number
  lastError: string | null
}

export function healthOf(item: PlannedItem, costOf: PlannedData['costOf'], now = Date.now()): Health {
  const judged = item.runs.filter((run) => run.status !== 'running' && run.status !== 'checking' && run.status !== 'skipped' && run.startedAt > now - 30 * DAY)
  const ok = judged.filter((run) => run.status === 'succeeded').length
  const last = item.runs.find((run) => run.status !== 'running' && run.status !== 'checking')
  return {
    rate: judged.length ? ok / judged.length : null,
    judged: judged.length,
    cost30: item.runs.filter((run) => run.startedAt > now - 30 * DAY).reduce((sum, run) => sum + (costOf(run) ?? 0), 0),
    lastError:
      last && (last.status === 'failed' || last.status === 'timed_out')
        ? (last.error ?? last.excerpt?.find((line) => /error|erreur|no such|failed|exit [1-9]/i.test(line)) ?? `code ${last.exitCode ?? '?'}`)
        : null,
  }
}

export type Due = 'today' | 'week' | 'later' | 'idle'
export const DUE_WORD: Record<Due, string> = { today: "Aujourd'hui", week: 'Cette semaine', later: 'Plus tard', idle: 'En pause' }

export function dueOf(item: PlannedItem, now = Date.now()): Due {
  const schedule = item.schedule
  if (!schedule || !schedule.enabled || schedule.nextRunAt === null) return 'idle'
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  if (schedule.nextRunAt <= endOfToday.getTime()) return 'today'
  if (schedule.nextRunAt <= now + 7 * DAY) return 'week'
  return 'later'
}

/* ------------------------------------------------------------------ démo (SIMULÉ) */

function demoProject(id: string, name: string, color: string, index: number): ProjectDto {
  return {
    id,
    name,
    image: null,
    workspacePath: `/home/demo/${id}`,
    ownerId: 'demo',
    ownerName: 'Démo',
    visibility: 'private',
    color,
    isOwner: true,
    position: index,
    archivedAt: null,
    createdAt: Date.now() - 90 * DAY,
    conversationCount: 8,
    configLayer: {} as ProjectDto['configLayer'],
    instructionsMode: 'repo',
    designSystemPath: null,
    turnCheckpoints: false,
    activeTerminals: 0,
    git: { branch: 'main', isDirty: false, changedFiles: 0 } as ProjectDto['git'],
  }
}

/** Des passages réguliers : le plus récent d'abord, il y a `lastAgo` heures, tous les `every`. */
function runs(id: string, statuses: RunStatus[], every: number, lastAgo: number, minutes: number, agent: boolean): UnifiedRun[] {
  const now = Date.now()
  return statuses.map((status, index) => {
    const startedAt = now - (lastAgo + index * every) * HOUR
    return {
      id: `${id}-${index}`,
      status,
      startedAt,
      finishedAt: status === 'running' ? null : startedAt + minutes * MIN,
      conversationId: agent ? `demo-${id}-${index}` : null,
      error: status === 'failed' ? (agent ? 'Le script de vérification a échoué (code 1).' : 'exit 1') : null,
      exitCode: agent ? undefined : status === 'succeeded' ? 0 : 1,
    }
  })
}

function agentTask(
  id: string,
  label: string,
  agent: AgentKind,
  prompt: string,
  cadence: ScheduleCadence,
  history: UnifiedRun[],
  scope: Scope,
  extra: Partial<PlannedItem> = {},
): PlannedItem {
  const enabled = extra.schedule?.enabled ?? true
  let failStreak = 0
  for (const run of history) {
    if (run.status === 'failed' || run.status === 'timed_out') failStreak += 1
    else if (run.status !== 'skipped') break
  }
  return {
    id,
    label,
    description: null,
    what: 'agent',
    agent,
    prompt,
    onDemand: true,
    schedule: { cadence, enabled, nextRunAt: enabled ? nextScheduleRun(cadence, Date.now(), history[0]?.startedAt ?? null) : null },
    runs: history,
    live: null,
    review: null,
    failStreak,
    simulated: true,
    ...extra,
    scope,
  }
}

function commandTask(
  id: string,
  label: string,
  command: string,
  cadence: ScheduleCadence,
  history: UnifiedRun[],
  scope: Scope,
  enabled = true,
): PlannedItem {
  let failStreak = 0
  for (const run of history) {
    if (run.status === 'failed') failStreak += 1
    else break
  }
  return {
    id,
    label,
    description: null,
    what: 'command',
    commandKind: 'task',
    command,
    subdir: null,
    onDemand: true,
    schedule: { cadence, enabled, nextRunAt: enabled ? nextScheduleRun(cadence, Date.now(), history[0]?.startedAt ?? null) : null },
    runs: history,
    live: null,
    review: null,
    failStreak,
    simulated: true,
    scope,
  }
}

function demoData(): PlannedData {
  const solera = demoProject('demo-solera', 'Solera (démo)', '#22d3ee', 0)
  const atelier = demoProject('demo-atelier', 'Atelier', '#a78bfa', 1)
  const vitrine = demoProject('demo-vitrine', 'Site vitrine', '#f59e0b', 2)
  const project = (entry: ProjectDto): Scope => ({ kind: 'project', project: entry })
  const knowledge: Scope = { kind: 'knowledge' }
  const instance: Scope = { kind: 'instance' }
  const [backup, purge] = demoScheduledCommands()

  const items: PlannedItem[] = [
    agentTask(
      'p-deps',
      'Revue nocturne des dépendances',
      'claude',
      'Passe en revue les dépendances : versions obsolètes, avis de sécurité, changements cassants annoncés. Ouvre une PR par mise à jour sûre.',
      { kind: 'cron', expression: '0 3 * * *' },
      runs('p-deps', ['succeeded', 'succeeded', 'skipped', 'succeeded', 'succeeded', 'succeeded', 'succeeded', 'failed', 'succeeded', 'succeeded'], 24, 7, 11, true),
      project(solera),
    ),
    { ...backup!, id: 'p-backup', scope: project(solera) },
    agentTask(
      'p-e2e',
      'Tests E2E nocturnes',
      'codex',
      'Lance la suite E2E du site sur la branche par défaut et résume les échecs dans une note.',
      { kind: 'cron', expression: '0 2 * * *' },
      runs('p-e2e', ['failed', 'failed', 'failed', 'failed', 'succeeded', 'succeeded', 'succeeded', 'succeeded'], 24, 9, 24, true),
      project(atelier),
    ),
    agentTask(
      'p-issues',
      'Synchro des issues GitHub',
      'claude',
      "Récupère les issues ouvertes et propose les cartes qui manquent au tableau.",
      { kind: 'interval', minutes: 180 },
      runs('p-issues', ['skipped', 'skipped', 'succeeded', 'succeeded'], 3, 1, 4, true),
      project(atelier),
      { review: 'script de vérification à valider' },
    ),
    agentTask(
      'p-weekly',
      'Rapport hebdo',
      'claude',
      'Rédige le rapport de la semaine : jalons avancés, cartes fermées, PR fusionnées, coût des sessions.',
      { kind: 'cron', expression: '0 17 * * 5' },
      runs('p-weekly', ['succeeded', 'succeeded', 'succeeded', 'succeeded'], 24 * 7, 4 * 24, 6, true),
      project(vitrine),
    ),
    { ...purge!, id: 'p-purge', scope: project(vitrine) },
    agentTask(
      'p-notes',
      'Résumer les notes de la semaine',
      'claude',
      'Relis les notes du vault écrites cette semaine et rédige un résumé avec les liens vers chacune.',
      { kind: 'cron', expression: '0 18 * * 0' },
      runs('p-notes', ['succeeded', 'succeeded', 'succeeded'], 24 * 7, 3 * 24 + 2, 5, true),
      knowledge,
    ),
    commandTask(
      'p-links',
      'Vérifier les liens morts du vault',
      'scripts/check-links.sh --vault',
      { kind: 'cron', expression: '0 6 * * 1' },
      runs('p-links', ['succeeded', 'failed', 'succeeded'], 24 * 7, 5 * 24, 2, false),
      knowledge,
      false,
    ),
    commandTask(
      'p-clean',
      'Nettoyer les worktrees fusionnés de tous les projets',
      'solera worktrees clean --merged --all-projects',
      { kind: 'interval', minutes: 360 },
      runs('p-clean', ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded'], 6, 2, 1, false),
      instance,
    ),
  ]

  const costs = new Map<string, number>()
  for (const item of items) {
    if (item.what !== 'agent') continue
    for (const [index, run] of item.runs.entries()) {
      if (run.status !== 'skipped') costs.set(run.id, 0.08 + ((index * 37 + item.label.length) % 40) / 100)
    }
  }
  return { demo: true, isPending: false, items, scopes: scopesOf(items), costOf: (run) => costs.get(run.id) ?? null }
}
