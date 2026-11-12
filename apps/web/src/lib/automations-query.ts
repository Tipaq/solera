import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ProjectActionDto, ScheduledTaskDto } from '@solera/protocol'
import {
  ACTIONS_KEY,
  useActions,
  useApproveAction,
  useCreateAction,
  useDeleteAction,
  useRunAction,
  useUpdateAction,
} from './actions'
import { api } from './api'
import { automationsOf, type Automation, type AutomationDraft, type AutomationScope, type UnifiedRun } from './automations'
import { useAllConversations } from './conversations'
import {
  useApproveScheduleCheck,
  useCreateSchedule,
  useCreateScopedSchedule,
  useDeleteSchedule,
  useRunSchedule,
  useSchedules,
  useUpdateSchedule,
  type ScheduleTarget,
} from './schedules'

export interface AutomationsData {
  items: Automation[]
  isPending: boolean
  /** Le coût d'un passage : celui de sa session ; null sans session (une commande). */
  costOf: (run: UnifiedRun) => number | null
}

/**
 * Les actions et les tâches planifiées d'un projet, ou de toute l'instance, fondues en un
 * seul format (`lib/automations.ts`). Lit les deux listes que l'interface relit déjà.
 */
export function useAutomations(scope: AutomationScope): AutomationsData {
  const { data: actions, isPending: actionsPending } = useActions()
  const { data: tasks, isPending: tasksPending } = useSchedules()
  const { data: conversations } = useAllConversations()
  const key = 'all' in scope ? null : scope.projectId

  return useMemo(() => {
    const costs = new Map((conversations ?? []).map((entry) => [entry.id, entry.costUsd]))
    return {
      items: automationsOf(actions ?? [], tasks ?? [], key === null ? { all: true } : { projectId: key }),
      isPending: actionsPending || tasksPending,
      costOf: (run) => (run.conversationId ? (costs.get(run.conversationId) ?? null) : null),
    }
  }, [actions, tasks, conversations, actionsPending, tasksPending, key])
}

/** Où lancer : le worktree d'une conversation, sinon la racine du projet. */
export interface LaunchPlace {
  conversationId?: string
}

/**
 * Les gestes sur une action, quelle que soit sa table : chacun aiguille vers
 * `/api/actions` ou `/api/schedules`. `projectId` sert aux créations ; hors projet, une
 * tâche d'agent se crée dans la portée que `save` reçoit (la page Planifiées, PLF-10).
 *
 * La nature d'une action ne change pas à l'enregistrement (Q5) : une commande reste une
 * commande. L'éditeur fige le choix ; « Dupliquer » sert à en changer.
 */
export function useAutomationMutations(projectId: string | null) {
  const queryClient = useQueryClient()
  const createAction = useCreateAction(projectId ?? '')
  const updateAction = useUpdateAction()
  const approveAction = useApproveAction()
  const deleteAction = useDeleteAction()
  const runAction = useRunAction()
  const createSchedule = useCreateSchedule(projectId ?? '')
  const createScoped = useCreateScopedSchedule()
  const updateSchedule = useUpdateSchedule()
  const deleteSchedule = useDeleteSchedule()
  const runSchedule = useRunSchedule()
  const approveCheck = useApproveScheduleCheck()

  /*
   * Deux routes que `lib/actions.ts` n'expose pas encore : refuser une proposition
   * (AC-02) et mettre en pause la cadence d'une commande (AC-03). Tant que le serveur ne
   * les connaît pas, l'interface ne les propose pas : une commande n'a pas de cadence.
   */
  const actionRequest = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: unknown; method: 'post' | 'patch' }) =>
      method === 'post' ? api.post<ProjectActionDto | undefined>(path, body) : api.patch<ProjectActionDto>(path, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ACTIONS_KEY }),
  })

  /** Le geste qui convient à la table de l'action. */
  const bySource = <T,>(
    item: Automation,
    onAction: (action: ProjectActionDto) => Promise<T>,
    onTask: (task: ScheduledTaskDto) => Promise<T>,
  ): Promise<T> => (item.source.kind === 'action' ? onAction(item.source.action) : onTask(item.source.task))

  return {
    /**
     * Crée, ou enregistre `existing` dans sa table. `target` : la portée choisie hors d'un
     * projet ; une tâche d'agent s'y crée, une commande reste dans son projet.
     */
    save: async (draft: AutomationDraft, existing?: Automation, target?: ScheduleTarget | null): Promise<void> => {
      // Une erreur de programmation, pas un message : l'éditeur fige la nature d'une action existante.
      if (existing && existing.what !== draft.what) throw new Error('An action keeps its nature: duplicate it instead.')
      if (draft.what === 'command') {
        if (existing?.source.kind === 'action') await updateAction.mutateAsync({ id: existing.source.action.id, ...draft.body })
        else await createAction.mutateAsync(draft.body)
      } else if (existing?.source.kind === 'task') {
        await updateSchedule.mutateAsync({ id: existing.source.task.id, ...draft.body })
      } else if (target) {
        await createScoped.mutateAsync({ target, input: draft.body })
      } else {
        await createSchedule.mutateAsync(draft.body)
      }
    },
    remove: (item: Automation) =>
      bySource(item, (action) => deleteAction.mutateAsync(action.id), (task) => deleteSchedule.mutateAsync(task.id)),
    /** Lance une commande (ou démarre un service), ou un passage d'agent. */
    run: (item: Automation, place: LaunchPlace = {}) =>
      bySource<unknown>(
        item,
        (action) => runAction.mutateAsync({ action, conversationId: place.conversationId }),
        (task) => runSchedule.mutateAsync({ id: task.id }),
      ),
    /** Arrête un service ; rien pour le reste. */
    stop: async (item: Automation): Promise<void> => {
      if (item.source.kind === 'action' && item.source.action.kind === 'service') {
        await runAction.mutateAsync({ action: item.source.action, op: 'stop' })
      }
    },
    setPaused: (item: Automation, paused: boolean) =>
      bySource<unknown>(
        item,
        (action) => actionRequest.mutateAsync({ method: 'patch', path: `/api/actions/${action.id}`, body: { schedule: { enabled: !paused } } }),
        (task) => updateSchedule.mutateAsync({ id: task.id, enabled: !paused }),
      ),
    /** Valide une commande proposée, ou le script de vérification d'une tâche. */
    approve: (item: Automation) =>
      bySource<unknown>(
        item,
        (action) => approveAction.mutateAsync(action.id),
        async (task) => (task.check ? approveCheck.mutateAsync({ id: task.id, script: task.check.script }) : undefined),
      ),
    /**
     * Refuse : une commande revient à ce qui a été validé (ou disparaît si rien ne l'a
     * été) ; une tâche perd son script de vérification et se met en pause (Q3).
     */
    reject: (item: Automation) =>
      bySource<unknown>(
        item,
        (action) => actionRequest.mutateAsync({ method: 'post', path: `/api/actions/${action.id}/reject` }),
        (task) => updateSchedule.mutateAsync({ id: task.id, checkScript: null, enabled: false }),
      ),
  }
}

export type AutomationMutations = ReturnType<typeof useAutomationMutations>
