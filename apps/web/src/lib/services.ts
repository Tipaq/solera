import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ServicesDto } from '@solera/protocol'
import { api } from './api'

/** Une seule requête pour la page Services et « Lancés par les sessions ». */
export const SERVICES_KEY = ['services'] as const

/** Ce qui tourne sur la machine pour Solera, relu toutes les 5 s. */
export function useServices() {
  return useQuery({
    queryKey: SERVICES_KEY,
    queryFn: () => api.get<ServicesDto>('/api/services'),
    refetchInterval: 5000,
  })
}

/** Arrête un processus de la liste et tout ce qui en descend. */
export function useStopService() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/services/${encodeURIComponent(id)}/stop`),
    onSuccess: () => { void client.invalidateQueries({ queryKey: SERVICES_KEY }) },
  })
}
