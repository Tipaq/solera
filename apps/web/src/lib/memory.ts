import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProjectMemoryDto } from '@solera/protocol'
import { api } from './api'

/** Relue à chaque ouverture : les agents y écrivent sans passer par l'interface. */
const memoryKey = (projectId: string) => ['memory', projectId]

export function useProjectMemory(projectId: string) {
  return useQuery({
    queryKey: memoryKey(projectId),
    queryFn: () => api.get<ProjectMemoryDto>(`/api/projects/${projectId}/memory`),
  })
}

export function useWriteMemoryFile(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ file, content }: { file: string; content: string }) =>
      api.put<void>(`/api/projects/${projectId}/memory/${encodeURIComponent(file)}`, { content }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: memoryKey(projectId) }),
  })
}

export function useDeleteMemoryFile(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    /** `keepIndexLine` laisse sa ligne dans `MEMORY.md`, qui devient orpheline. */
    mutationFn: ({ file, keepIndexLine = false }: { file: string; keepIndexLine?: boolean }) =>
      api.delete<void>(
        `/api/projects/${projectId}/memory/${encodeURIComponent(file)}${keepIndexLine ? '?index=keep' : ''}`,
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: memoryKey(projectId) }),
  })
}
