import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  actionRunStatusOf,
  resolveActionUrl,
  type ActionRunDetailDto,
  type CreateProjectActionBody,
  type ProjectActionDto,
  type ProjectActionRunResult,
  type ServiceActionControl,
} from '@solera/protocol'
import { api } from './api'
import { relativeDate } from './dates'
import type { MessageKey, MessageParams } from './i18n'
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

export function useUpdateAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<CreateProjectActionBody>) =>
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
 * conversation), sinon la racine, que le placement d'un service peut remplacer. `args`
 * s'ajoutent à la commande d'un lancement (« relancer seulement les échecs »).
 *
 * Un service qui tourne depuis un autre arbre échoue en 409 `service_running_elsewhere`,
 * ses `params` disant lequel (`cwd`, `branch`, `ports`, `href`) : `switch` le bascule.
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
      switch: switching,
    }: {
      action: ProjectActionDto
      op?: 'run' | 'logs' | ServiceActionControl
      conversationId?: string
      worktreeId?: string
      args?: string[]
      switch?: boolean
    }) =>
      api.post<ProjectActionRunResult>(
        op === 'run' ? `/api/actions/${action.id}/run` : `/api/actions/${action.id}/service/${op}`,
        {
          ...(conversationId ? { conversationId } : worktreeId ? { worktreeId } : {}),
          ...(op === 'run' && args && args.length > 0 ? { args } : {}),
          ...(op === 'run' && switching ? { switch: true } : {}),
        },
      ),
    onSuccess: (result, { action }) => {
      invalidate(action.projectId)
      if (result.terminal) showTerminal(result.terminal.id)
    },
  })
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
