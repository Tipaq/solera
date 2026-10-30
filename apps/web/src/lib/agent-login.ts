import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentKind, ClaudeLoginStatusDto, CodexLoginStatusDto } from '@solera/protocol'
import { AGENT_AUTH_KEY } from './agents'
import { api } from './api'

/**
 * Connexion propre d'un CLI, menée depuis l'interface : celle des sessions sans compte,
 * partagée par toute l'instance, d'où des routes réservées à l'administrateur.
 *
 * Claude rejoue le dialogue de la connexion guidée d'un compte : la suite se lit par
 * `useClaudeLoginStatus`, avec le `loginId` rendu au lancement. Codex et Grok passent
 * par le code d'appareil, relu ici.
 */

/** Les CLI qui se connectent sans terminal ; OpenCode fait choisir un fournisseur dans un menu. */
export const GUIDED_LOGIN: ReadonlySet<AgentKind> = new Set(['claude', 'codex', 'grok'])

/** Codex et Grok rendent la même forme : l'URL, le code, l'état. */
export type DeviceLoginStatusDto = CodexLoginStatusDto

export type AgentLoginStart =
  | { agent: 'claude'; status: ClaudeLoginStatusDto }
  | { agent: 'codex' | 'grok'; status: DeviceLoginStatusDto }

const deviceKey = (agent: AgentKind) => ['agent-login', agent]

export function useStartAgentLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (agent: AgentKind): Promise<AgentLoginStart> => {
      if (agent === 'claude') return { agent, status: await api.post<ClaudeLoginStatusDto>('/api/agents/claude/login') }
      if (agent === 'codex' || agent === 'grok') {
        return { agent, status: await api.post<DeviceLoginStatusDto>(`/api/agents/${agent}/login`) }
      }
      throw new Error(`${agent} : connexion au terminal seulement.`)
    },
    onSuccess: (started) => {
      if (started.agent !== 'claude') queryClient.setQueryData(deviceKey(started.agent), started.status)
    },
  })
}

/**
 * Le code d'appareil d'un CLI, relu toutes les deux secondes tant qu'il attend : c'est
 * le serveur qui apprend la fin. Elle invalide la connexion lue des CLI, que le serveur
 * a déjà relue : la carte passe à « Connecté » sans clic sur Vérifier.
 */
export function useAgentDeviceLogin(agent: 'codex' | 'grok', enabled: boolean) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: deviceKey(agent),
    queryFn: async () => {
      const status = await api.get<DeviceLoginStatusDto>(`/api/agents/${agent}/login`)
      if (status.state === 'done') void queryClient.invalidateQueries({ queryKey: AGENT_AUTH_KEY })
      return status
    },
    enabled,
    refetchInterval: (query) => (query.state.data?.state === 'pending' ? 2000 : false),
    staleTime: 0,
  })
}

export function useCancelAgentLogin() {
  return useMutation({
    mutationFn: (agent: 'codex' | 'grok') => api.delete<void>(`/api/agents/${agent}/login`),
  })
}
