import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CardDto } from '@solera/protocol'
import { ApiRequestError, api } from './api'
import { uploadAttachment } from './attachments'
import { translateError } from './i18n'

export interface NewMilestone {
  title: string
  description: string
  /** L'échéance, en minuit local du jour. */
  dueAt: number | null
  /** Les cartes jointes en *Référence* : un lien « liée à ». */
  references: readonly string[]
  /** Les cartes *Incluses* : elles deviennent des enfants du jalon. */
  included: readonly string[]
  files: readonly File[]
}

export interface CreatedMilestone {
  card: CardDto
  /** Ce qui n'a pas suivi la carte, déjà créée : la première erreur, et combien. */
  failed: { count: number; message: string } | null
}

/**
 * Crée un jalon d'un seul geste (#193, CMP-15) : la carte drapeautée et datée, puis ses
 * liens « liée à », ses cartes incluses et ses fichiers, un à un.
 *
 * Une fois la carte créée, un échec ne défait rien : la carte existe, ce qui n'a pas
 * suivi est compté et dit, pour qu'on le rattache à la main.
 */
export function useCreateMilestone(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewMilestone): Promise<CreatedMilestone> => {
      const card = await api.post<CardDto>(`/api/projects/${projectId}/cards`, {
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        milestone: true,
      })
      const errors: unknown[] = []
      const attempt = async (step: () => Promise<unknown>) => {
        try {
          await step()
        } catch (error) {
          errors.push(error)
        }
      }
      for (const targetId of input.references) {
        await attempt(() => api.post(`/api/cards/${card.id}/relations`, { kind: 'related', targetId }))
      }
      for (const childId of input.included) await attempt(() => api.patch(`/api/cards/${childId}`, { parentId: card.id }))
      // Un à un : plusieurs vidéos ne saturent pas la mémoire du serveur.
      for (const file of input.files) await attempt(() => uploadAttachment(file, `/api/cards/${card.id}/attachments`))
      const first = errors[0]
      return {
        card,
        failed:
          first === undefined
            ? null
            : {
                count: errors.length,
                message: first instanceof ApiRequestError ? translateError(first.code, first.message) : String(first),
              },
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cards', projectId] }),
  })
}
