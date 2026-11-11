import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ProjectActionDto } from '@solera/protocol'
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
  useDeleteSchedule,
  useRunSchedule,
  useSchedules,
  useUpdateSchedule,
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
 * `/api/actions` ou `/api/schedules`. `projectId` sert aux créations ; null hors projet,
 * où l'on ne crée pas encore (AC-09).
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

  const actionOf = (item: Automation) => (item.source.kind === 'action' ? item.source.action : null)
  const taskOf = (item: Automation) => (item.source.kind === 'task' ? item.source.task : null)

  return {
    /** Crée, ou enregistre `existing` dans sa table. */
    save: async (draft: AutomationDraft, existing?: Automation): Promise<void> => {
      if (existing && existing.what !== draft.what) throw new Error('An action keeps its nature: duplicate it instead.')
      const action = existing ? actionOf(existing) : null
      const task = existing ? taskOf(existing) : null
      if (draft.what === 'command') {
        if (action) await updateAction.mutateAsync({ id: action.id, ...draft.body })
        else await createAction.mutateAsync(draft.body)
        return
      }
      if (task) await updateSchedule.mutateAsync({ id: task.id, ...draft.body })
      else await createSchedule.mutateAsync(draft.body)
    },
    remove: async (item: Automation): Promise<void> => {
      const action = actionOf(item)
      if (action) await deleteAction.mutateAsync(action.id)
      else await deleteSchedule.mutateAsync(taskOf(item)!.id)
    },
    /** Lance une commande (ou démarre un service), ou un passage d'agent. */
    run: async (item: Automation, place: LaunchPlace = {}): Promise<void> => {
      const action = actionOf(item)
      if (action) await runAction.mutateAsync({ action, conversationId: place.conversationId })
      else await runSchedule.mutateAsync({ id: taskOf(item)!.id })
    },
    /** Arrête un service. */
    stop: async (item: Automation): Promise<void> => {
      const action = actionOf(item)
      if (action?.kind === 'service') await runAction.mutateAsync({ action, op: 'stop' })
    },
    setPaused: async (item: Automation, paused: boolean): Promise<void> => {
      const action = actionOf(item)
      if (action) await actionRequest.mutateAsync({ method: 'patch', path: `/api/actions/${action.id}`, body: { schedule: { enabled: !paused } } })
      else await updateSchedule.mutateAsync({ id: taskOf(item)!.id, enabled: !paused })
    },
    /** Valide une commande proposée, ou le script de vérification d'une tâche. */
    approve: async (item: Automation): Promise<void> => {
      const action = actionOf(item)
      if (action) {
        await approveAction.mutateAsync(action.id)
        return
      }
      const task = taskOf(item)!
      if (task.check) await approveCheck.mutateAsync({ id: task.id, script: task.check.script })
    },
    /**
     * Refuse : une commande revient à ce qui a été validé (ou disparaît si rien ne l'a
     * été) ; une tâche perd son script de vérification et se met en pause (Q3).
     */
    reject: async (item: Automation): Promise<void> => {
      const action = actionOf(item)
      if (action) await actionRequest.mutateAsync({ method: 'post', path: `/api/actions/${action.id}/reject` })
      else await updateSchedule.mutateAsync({ id: taskOf(item)!.id, checkScript: null, enabled: false })
    },
  }
}

export type AutomationMutations = ReturnType<typeof useAutomationMutations>
