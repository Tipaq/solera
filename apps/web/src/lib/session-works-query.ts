import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from './api'
import { projectBackgroundKey, stopBackgroundTask, useConversations, useProjectBackground } from './conversations'
import { SERVICES_KEY, useServices } from './services'
import { mergeWorks, type SessionWork } from './session-works'

/**
 * Les processus et travaux de fond des sessions d'un projet (AC-17), fusionnés. Dans le
 * panneau d'une conversation, `conversationId` met les siens en tête : ceux des autres
 * sessions restent, avec leur pastille (Q7).
 *
 * Les processus se relisent toutes les 5 s avec la page Services, dont ils partagent la
 * requête ; les travaux de fond quand le nombre d'une session bouge (`useStatusFeed`).
 */
export function useSessionWorks(projectId: string | undefined, { conversationId }: { conversationId?: string } = {}): {
  works: SessionWork[]
  isPending: boolean
} {
  const services = useServices()
  const background = useProjectBackground(projectId)
  const { data: conversations } = useConversations(projectId)
  const works = useMemo(
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
  return { works, isPending: services.isPending || background.isPending }
}

/** « Arrêter » : le processus s'il y en a un, sinon le travail par la route de sa session. */
export function useStopWork(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (work: SessionWork) => {
      const stop = work.stop
      if (!stop) return
      if (stop.via === 'service') await api.post(`/api/services/${encodeURIComponent(stop.serviceId)}/stop`)
      else await stopBackgroundTask(stop.conversationId, stop.taskId)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: SERVICES_KEY })
      void client.invalidateQueries({ queryKey: projectBackgroundKey(projectId) })
    },
  })
}
