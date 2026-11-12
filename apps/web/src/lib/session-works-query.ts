import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ProjectBackgroundDto } from '@solera/protocol'
import { api } from './api'
import { projectBackgroundKey, stopBackgroundTask, useAllConversations, useConversations, useProjectBackground } from './conversations'
import { SERVICES_KEY, stopService, useServices } from './services'
import { mergeWorks, type SessionWork } from './session-works'

/**
 * Les processus et travaux de fond des sessions d'un projet (AC-17), fusionnés. Dans le
 * panneau d'une conversation, `conversationId` met les siens en tête : ceux des autres
 * sessions restent, avec leur pastille (Q7).
 *
 * Les processus se relisent toutes les 5 s avec la page Services, dont ils partagent la
 * requête ; les travaux de fond quand le nombre d'une session bouge (`useStatusFeed`).
 */
export function useSessionWorks(projectId: string | undefined, { conversationId }: { conversationId?: string } = {}): SessionWork[] {
  const services = useServices()
  const background = useProjectBackground(projectId)
  const { data: conversations } = useConversations(projectId)
  return useMemo(
    () =>
      projectId
        ? mergeWorks({
            projectId,
            services: services.data?.supported ? services.data.services : null,
            background: background.data ?? [],
            conversations: conversations ?? [],
            currentConversationId: conversationId,
          })
        : [],
    [projectId, services.data, background.data, conversations, conversationId],
  )
}

/**
 * Les mêmes, pour plusieurs projets à la fois (le portefeuille) : rangés par projet. Les
 * processus viennent de la liste de l'instance, que la page Services relit déjà ; les
 * travaux de fond, d'une requête par projet, la même que `useSessionWorks` (cache commun).
 */
export function useAllSessionWorks(projectIds: readonly string[]): Map<string, SessionWork[]> {
  const services = useServices()
  const { data: conversations } = useAllConversations()
  const backgrounds = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: projectBackgroundKey(projectId),
      queryFn: () => api.get<ProjectBackgroundDto[]>(`/api/projects/${projectId}/background`),
      staleTime: 15_000,
    })),
  })
  // Le tableau que rend `useQueries` change à chaque rendu : on mémorise sur les réponses.
  const stamps = backgrounds.map((query) => query.dataUpdatedAt).join(',')
  return useMemo(
    () =>
      new Map(
        projectIds.map((projectId, index) => [
          projectId,
          mergeWorks({
            projectId,
            services: services.data?.supported ? services.data.services : null,
            background: backgrounds[index]?.data ?? [],
            conversations: conversations ?? [],
          }),
        ]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectIds.join(','), stamps, services.data, conversations],
  )
}

/** « Arrêter » : le processus s'il y en a un, sinon le travail par la route de sa session. */
export function useStopWork(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (work: SessionWork) => {
      const stop = work.stop
      if (!stop) return
      if (stop.via === 'service') await stopService(stop.serviceId)
      else await stopBackgroundTask(stop.conversationId, stop.taskId)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: SERVICES_KEY })
      void client.invalidateQueries({ queryKey: projectBackgroundKey(projectId) })
    },
  })
}
