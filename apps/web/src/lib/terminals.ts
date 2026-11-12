import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TerminalDto } from '@solera/protocol'
import { api } from './api'

/**
 * Cycle de vie des terminaux d'un projet.
 *
 * Scopés au projet et non à la conversation : la liste est la même partout dans le
 * projet, et un serveur lancé dans un shell ne peut pas se retrouver caché derrière
 * une session archivée. Les process vivent en mémoire du daemon ; un redémarrage les
 * interrompt mais leurs entrées reviennent, marquées telles, avec leur dernier écran.
 */

const key = (projectId: string) => ['terminals', projectId]

/**
 * `poll` relit la liste à intervalle : un agent lance une action par `run_action`, sans
 * passer par une route que l'interface verrait.
 */
export function useTerminals(projectId: string, enabled: boolean, poll?: number) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => api.get<TerminalDto[]>(`/api/projects/${projectId}/terminals`),
    enabled,
    staleTime: 5_000,
    refetchInterval: poll,
  })
}

export function useOpenTerminal(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input?: { conversationId?: string; cwd?: string }) =>
      api.post<TerminalDto>(`/api/projects/${projectId}/terminals`, input ?? {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export function useCloseTerminal(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (terminalId: string) =>
      api.delete(`/api/projects/${projectId}/terminals/${terminalId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export function useRenameTerminal(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<TerminalDto>(`/api/projects/${projectId}/terminals/${id}`, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(projectId) }),
  })
}

/**
 * Arrêter la commande d'un terminal : Ctrl-C côté serveur. Le terminal reste, avec son
 * écran. Le serveur répond avant que le process sorte : recharger la liste ici la
 * relirait encore « en cours ». C'est l'`exit` de la socket qui la recharge
 * (`useTerminalsReload`).
 */
export function useInterruptTerminal(projectId: string) {
  return useMutation({
    mutationFn: (terminalId: string) =>
      api.post(`/api/projects/${projectId}/terminals/${terminalId}/interrupt`),
  })
}

/**
 * Poser dans la liste le terminal qu'une relance vient d'ouvrir, sans attendre de la
 * relire : le détail qui la suit le trouve tout de suite. Le terminal fini qu'il
 * recycle (même action, même conversation, même dossier) en sort, comme côté serveur.
 */
export function useTerminalsUpsert(projectId: string): (terminal: TerminalDto) => void {
  const queryClient = useQueryClient()
  return useCallback(
    (terminal: TerminalDto) =>
      queryClient.setQueryData<TerminalDto[]>(key(projectId), (current) => [
        ...(current ?? []).filter(
          (entry) =>
            entry.id !== terminal.id &&
            !(entry.actionId === terminal.actionId && !entry.alive && entry.conversationId === terminal.conversationId && entry.cwd === terminal.cwd),
        ),
        terminal,
      ]),
    [queryClient, projectId],
  )
}

/** Recharger la liste des terminaux : à l'`exit` reçu par la socket d'un terminal. */
export function useTerminalsReload(projectId: string): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => void queryClient.invalidateQueries({ queryKey: key(projectId) }), [queryClient, projectId])
}
