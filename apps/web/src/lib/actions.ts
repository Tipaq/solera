import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  actionRunStatusOf,
  MAX_ACTION_LABEL_CHARS,
  MAX_TRY_TITLE_CHARS,
  resolveActionUrl,
  type ActionRunDetailDto,
  type ActionSuggestion,
  type CreateProjectActionBody,
  type ProjectActionDto,
  type ProjectActionRunResult,
  type ServiceActionControl,
  type TerminalDto,
  type UpdateProjectActionBody,
} from '@solera/protocol'
import { api } from './api'
import { relativeDate } from './dates'
import { useTranslate, type MessageKey, type MessageParams } from './i18n'
import { showTerminal } from './panel'

export const ACTIONS_KEY = ['actions']

/**
 * Toutes les actions visibles, tous projets confondus : le panneau filtre son projet,
 * la palette les propose toutes.
 *
 * Relue périodiquement : un agent en propose une sans passer par une route que le
 * socket signalerait, et l'état d'un service change sans qu'on y touche.
 */
export function useActions() {
  return useQuery({
    queryKey: ACTIONS_KEY,
    queryFn: () => api.get<ProjectActionDto[]>('/api/actions'),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return (projectId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ACTIONS_KEY })
    if (projectId) void queryClient.invalidateQueries({ queryKey: ['terminals', projectId] })
  }
}

export function useCreateAction(projectId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: CreateProjectActionBody) =>
      api.post<ProjectActionDto>(`/api/projects/${projectId}/actions`, input),
    onSuccess: () => invalidate(),
  })
}

/** La pause d'une commande planifiée n'envoie que `{ schedule: { enabled } }`. */
export function useUpdateAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & UpdateProjectActionBody) =>
      api.patch<ProjectActionDto>(`/api/actions/${id}`, patch),
    onSuccess: () => invalidate(),
  })
}

export function useApproveAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.post<ProjectActionDto>(`/api/actions/${id}/approve`),
    onSuccess: () => invalidate(),
  })
}

/**
 * Refuser ce qu'un agent propose : la commande relue en dernier revient, ou l'action
 * disparaît si elle n'a jamais été relue (rien n'est alors rendu).
 */
export function useRejectAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.post<ProjectActionDto | undefined>(`/api/actions/${id}/reject`),
    onSuccess: () => invalidate(),
  })
}

/**
 * Les derniers passages d'une action avec l'extrait de leur sortie, pour son détail : la
 * liste des actions ne les porte pas, relue trop souvent pour charger vingt extraits par
 * action. Relue avec elle, pour qu'un passage en cours se close sous les yeux.
 */
export function useActionRuns(actionId: string | null) {
  return useQuery({
    queryKey: [...ACTIONS_KEY, actionId, 'runs'],
    queryFn: () => api.get<ActionRunDetailDto[]>(`/api/actions/${actionId}/runs`),
    enabled: actionId !== null,
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useDeleteAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/actions/${id}`),
    onSuccess: () => invalidate(),
  })
}

/**
 * Lancer, piloter un service ou suivre son journal. Ce qui ouvre un terminal le met
 * devant : cliquer un bouton sans voir sa sortie donnerait l'impression qu'il n'a rien fait.
 *
 * Où : le worktree de `conversationId`, sinon `worktreeId` (« Lancer dans… » hors
 * conversation), sinon la racine. `args` s'ajoutent à la commande d'un lancement
 * (« relancer seulement les échecs »).
 */
export function useRunAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      action,
      op = 'run',
      conversationId,
      worktreeId,
      args,
    }: {
      action: ProjectActionDto
      op?: 'run' | 'logs' | ServiceActionControl
      conversationId?: string
      worktreeId?: string
      args?: string[]
    }) =>
      api.post<ProjectActionRunResult>(
        op === 'run' ? `/api/actions/${action.id}/run` : `/api/actions/${action.id}/service/${op}`,
        {
          ...(conversationId ? { conversationId } : worktreeId ? { worktreeId } : {}),
          ...(op === 'run' && args && args.length > 0 ? { args } : {}),
        },
      ),
    onSuccess: (result, { action }) => {
      invalidate(action.projectId)
      if (result.terminal) showTerminal(result.terminal.id)
    },
  })
}

/**
 * « Trouvé dans le dépôt » : ce que la racine du projet sait lancer, moins ce qui est
 * déjà un bouton. Sous la clé des actions, pour être relue quand on en enregistre une.
 */
export function useActionSuggestions(projectId: string | null) {
  return useQuery({
    queryKey: [...ACTIONS_KEY, 'suggestions', projectId],
    queryFn: () => api.get<ActionSuggestion[]>(`/api/projects/${projectId}/actions/suggestions`),
    enabled: projectId !== null,
    staleTime: 30_000,
  })
}

/**
 * « Essayer » une commande de l'éditeur sans l'enregistrer. Rend le terminal d'essai,
 * dont la sortie se lit par sa socket ; il n'est pas mis devant, l'éditeur la montre.
 * Un essai remplace le précédent.
 */
export function useTryAction(projectId: string) {
  const t = useTranslate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      command,
      subdir,
      label,
      conversationId,
    }: {
      command: string
      subdir?: string
      /** Le libellé saisi, pour titrer le terminal ; sinon la première ligne de la commande. */
      label?: string
      conversationId?: string
    }) => {
      const name = label?.trim() || command.trim().split('\n')[0]!.trim()
      return api.post<TerminalDto>(`/api/projects/${projectId}/actions/try`, {
        command,
        subdir: subdir || undefined,
        title: t('actions.try.title', { name }).slice(0, MAX_TRY_TITLE_CHARS),
        conversationId,
      })
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['terminals', projectId] }),
  })
}

const SUGGESTION_LABELS: Record<string, MessageKey> = {
  dev: 'actionSuggestion.label.dev',
  start: 'actionSuggestion.label.start',
  serve: 'actionSuggestion.label.serve',
  test: 'actionSuggestion.label.test',
  lint: 'actionSuggestion.label.lint',
  build: 'actionSuggestion.label.build',
  typecheck: 'actionSuggestion.label.typecheck',
  format: 'actionSuggestion.label.format',
  check: 'actionSuggestion.label.check',
  storybook: 'actionSuggestion.label.storybook',
  preview: 'actionSuggestion.label.preview',
  compose: 'actionSuggestion.label.compose',
}

/**
 * Ce qu'un clic sur une suggestion met dans l'éditeur. Le libellé traduit les noms
 * courants et garde les autres tels quels ; celui d'un espace de travail dit lequel.
 */
export function suggestionDraft(
  suggestion: ActionSuggestion,
  t: (key: MessageKey, params?: MessageParams) => string,
): CreateProjectActionBody & { subdir: string; url: string } {
  const known = SUGGESTION_LABELS[suggestion.name]
  const base = known ? t(known) : suggestion.name
  const label = suggestion.subdir
    ? t('actionSuggestion.inPackage', { label: base, package: suggestion.subdir.split('/').at(-1)! })
    : base
  return {
    label: label.slice(0, MAX_ACTION_LABEL_CHARS),
    kind: suggestion.kind,
    command: suggestion.command,
    subdir: suggestion.subdir,
    url: suggestion.url ?? '',
  }
}

/** L'infobulle d'une suggestion : d'où elle vient, et pourquoi cette nature. */
export function suggestionWhy(
  suggestion: ActionSuggestion,
  t: (key: MessageKey, params?: MessageParams) => string,
): string {
  const why = t(`actionSuggestion.why.${suggestion.reason}`, { name: suggestion.name })
  return t('actionSuggestion.from', { source: suggestion.source, why })
}

const RUNNING_STATES = ['active', 'activating', 'reloading']

/**
 * Ce qu'une action est en ce moment, lu de la même façon par le panneau, le lanceur
 * de l'en-tête et la palette : sans ce calcul commun, l'un proposerait « Lancer » pendant
 * que l'autre montre le service en marche.
 */
export interface ActionView {
  /** Un service qui tourne, ou une tâche dont la commande n'est pas finie. */
  live: boolean
  failed: boolean
  /** Le geste principal, celui du disque et de la palette. */
  primary: 'review' | 'run' | 'stop' | 'output'
  /** Adresse à ouvrir, quand le service tourne et qu'elle est connue. */
  href: string | null
}

export function actionView(action: ProjectActionDto): ActionView {
  const { service, lastRun } = action
  const live = service ? RUNNING_STATES.includes(service.state) : (lastRun?.alive ?? false)
  // Une commande arrêtée (Ctrl-C, 130) n'a pas échoué.
  const failed = service
    ? service.state === 'failed'
    : lastRun !== null && !lastRun.alive && lastRun.exitCode !== null && actionRunStatusOf(lastRun.exitCode) === 'failed'
  const primary =
    action.status === 'proposed' ? 'review' : service && live ? 'stop' : live ? 'output' : 'run'
  return { live, failed, primary, href: service && live ? resolveActionUrl(action.url, service.ports) : null }
}

/** La phrase d'état d'une action, sous son libellé. */
export function describeActionState(action: ProjectActionDto, t: (key: MessageKey, params?: MessageParams) => string): string {
  const { service, lastRun } = action
  const view = actionView(action)
  // Les badges disent déjà « à relire », « en marche », « en échec » : la phrase
  // donne ce qu'ils ne peuvent pas dire, d'où vient l'action, où elle écoute, quoi faire.
  if (action.status === 'proposed') {
    return t('actions.state.proposedIn', { title: action.agentConversationTitle ?? t('actions.proposedInGone') })
  }
  if (service) {
    if (view.live) {
      return service.ports.length > 0
        ? t('actions.state.runningPorts', { ports: service.ports.map((port) => `:${port}`).join(' ') })
        : t('actions.state.running')
    }
    return view.failed ? t('actions.state.failed') : t('actions.state.stopped')
  }
  if (!lastRun) return t('actions.state.neverRun')
  if (lastRun.alive) return t('actions.state.taskRunning')
  const when = relativeDate(lastRun.startedAt)
  if (lastRun.exitCode === null || actionRunStatusOf(lastRun.exitCode) === 'stopped') {
    return t('actions.state.taskInterrupted', { when })
  }
  return lastRun.exitCode === 0
    ? t('actions.state.taskOk', { when })
    : t('actions.state.taskFailed', { code: lastRun.exitCode, when })
}
