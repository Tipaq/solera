import { useIsMutating, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type {
  CardColumn,
  CardDto,
  CardLinkDto,
  CardNoteDto,
  CardSearchDto,
  ProjectDto,
} from '@solera/protocol'
import { api } from './api'
import { useDebounced } from './search'

const cardsKey = (projectId: string) => ['cards', projectId]

export function useCards(projectId: string | undefined) {
  return useQuery({
    queryKey: cardsKey(projectId ?? ''),
    queryFn: () => api.get<CardDto[]>(`/api/projects/${projectId}/cards`),
    enabled: Boolean(projectId),
    staleTime: 15_000,
  })
}

/**
 * Les cartes de plusieurs projets, chacune sachant d'où elle vient.
 *
 * Une requête par projet, parce que c'est ce que le serveur offre — `/api/cards` n'existe
 * pas, et `/api/cards/search` ne rend que des extraits sans colonne ni session. La liste
 * des projets est courte, et `useQueries` partage le cache avec `useCards` : ouvrir le
 * board d'un projet après le board global ne relit rien.
 *
 * Le projet voyage avec la carte plutôt qu'à côté : le board global mêle les cartes dans
 * quatre colonnes, et chaque tuile doit pouvoir dire d'où elle sort sans que l'appelant
 * garde une table de correspondance à jour.
 */
export function useAllCards(projects: ProjectDto[]): {
  cards: (CardDto & { project: ProjectDto })[]
  isPending: boolean
} {
  const queries = useQueries({
    queries: projects.map((project) => ({
      queryKey: cardsKey(project.id),
      queryFn: () => api.get<CardDto[]>(`/api/projects/${project.id}/cards`),
      staleTime: 15_000,
    })),
  })

  // Les dépendances sont les horodatages de réponse : le tableau que rend `useQueries`
  // est recomposé à chaque rendu, et le mémoriser dessus ne mémoriserait rien.
  const stamps = queries.map((query) => query.dataUpdatedAt).join(',')
  const pending = queries.some((query) => query.isPending)

  return useMemo(
    () => ({
      cards: projects.flatMap((project, index) =>
        (queries[index]?.data ?? []).map((card) => ({ ...card, project })),
      ),
      isPending: pending,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, stamps, pending],
  )
}

/**
 * Les cartes de tous les projets visibles, pour la palette.
 *
 * Sans saisie, les dernières touchées : la palette au repos propose ce qu'on rouvre.
 * La frappe est amortie comme la recherche dans les messages — une requête par lettre
 * traverse tous les projets pour un résultat qu'on ne lit pas encore.
 */
export function useCardSearch(query: string, enabled: boolean) {
  const settled = useDebounced(query.trim())
  return useQuery({
    queryKey: ['card-search', settled],
    queryFn: () => api.get<CardSearchDto>(`/api/cards/search?q=${encodeURIComponent(settled)}`),
    enabled,
    staleTime: 15_000,
  })
}

export function useCreateCard(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; description?: string; column?: CardColumn }) =>
      api.post<CardDto>(`/api/projects/${projectId}/cards`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cardsKey(projectId) }),
  })
}

export function useUpdateCard(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['update-card', projectId],
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string
      title?: string
      description?: string
      column?: CardColumn
      /** `null` enlève l'échéance ; absent la laisse telle quelle. */
      dueAt?: number | null
      /** `null` détache la carte de son jalon. */
      milestoneCardId?: string | null
    }) => api.patch<CardDto>(`/api/cards/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cardsKey(projectId) }),
  })
}

/**
 * Déplace une carte d'une colonne à l'autre sans savoir d'avance de quel projet.
 *
 * Le board global mêle les cartes de tous les projets : il n'a pas un `projectId` à
 * passer à `useUpdateCard`, il en a un par carte. La variable le porte donc, et c'est
 * elle qui dit quelle liste relire.
 *
 * Le **rang** n'y est pas, et ce n'est pas un oubli : dans une colonne qui mêle cinq
 * projets, le rang n'a plus de sens — la position d'une carte s'entend dans son propre
 * board, et c'est là qu'on la règle.
 */
export function useMoveCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, column }: { id: string; projectId: string; column: CardColumn }) =>
      api.patch<CardDto>(`/api/cards/${id}`, { column }),
    onSuccess: (_card, { projectId }) =>
      queryClient.invalidateQueries({ queryKey: cardsKey(projectId) }),
  })
}

/**
 * Coche ou décoche une sous-tâche de la description.
 *
 * L'indice et le libellé plutôt que la description entière : la carte est éditée
 * ailleurs, par une autre session ou dans un autre onglet, et renvoyer tout le texte
 * pour une case écraserait ce qu'on n'a pas lu. Le serveur refuse en 409 quand la
 * n-ième case ne dit plus ce qu'elle disait, et le board se recharge.
 */
export function useToggleSubtask(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['toggle-subtask', cardId],
    mutationFn: (task: { index: number; checked: boolean; label: string }) =>
      api.post<CardDto>(`/api/cards/${cardId}/subtasks`, task),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cardsKey(projectId) }),
    onError: () => queryClient.invalidateQueries({ queryKey: cardsKey(projectId) }),
  })
}

/** Pose le lien « cette carte bloque celle-là », qui survit aux réécritures du texte. */
export function useAddCardBlock(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (blockedId: string) =>
      api.post<CardDto>(`/api/cards/${cardId}/blocks`, { blockedId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cardsKey(projectId) }),
  })
}

export function useRemoveCardBlock(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (blockedId: string) =>
      api.delete<CardDto>(`/api/cards/${cardId}/blocks/${blockedId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cardsKey(projectId) }),
  })
}

/** Une carte rouverte attend sa sauvegarde en vol avant d'en lancer une autre. */
export function useCardSaving(cardId: string) {
  return useIsMutating({
    mutationKey: ['update-card'],
    predicate: (mutation) => (mutation.state.variables as { id?: string } | undefined)?.id === cardId,
  }) > 0
}

export function useDeleteCard(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/cards/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cardsKey(projectId) })
      // Les conversations rattachées perdent leur puce : leur liste devient fausse.
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

/** Une colonne du board dans son ordre, telle qu'elle sera écrite. */
export interface CardColumnOrder {
  column: CardColumn
  ids: string[]
}

export function useReorderCards(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (columns: CardColumnOrder[]) =>
      api.post<{ ok: true }>(`/api/projects/${projectId}/cards/order`, { columns }),

    onMutate: async (columns) => {
      await queryClient.cancelQueries({ queryKey: cardsKey(projectId) })
      const previous = queryClient.getQueryData<CardDto[]>(cardsKey(projectId))
      if (!previous) return { previous }

      // Le déplacement doit se voir immédiatement : attendre la réponse ferait revenir
      // la carte à sa place le temps d'un aller-retour, ce qui se lit comme un refus.
      const moved = new Map<string, { column: CardColumn; position: number }>()
      for (const group of columns) {
        group.ids.forEach((id, index) => moved.set(id, { column: group.column, position: index }))
      }
      queryClient.setQueryData(
        cardsKey(projectId),
        previous.map((card) => {
          const move = moved.get(card.id)
          return move ? { ...card, ...move } : card
        }),
      )
      return { previous }
    },

    onError: (_error, _columns, context) => {
      // Le serveur a refusé : l'ordre affiché doit redevenir celui qu'il connaît.
      if (context?.previous) queryClient.setQueryData(cardsKey(projectId), context.previous)
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: cardsKey(projectId) }),
  })
}

/**
 * Cartes citables après un `#`, sans les sessions ni les backlinks que porte le board.
 *
 * `query !== null` plutôt que `query.length > 0` : un `#` seul doit ouvrir la liste,
 * comme le `@` des fichiers.
 */
export function useCardSuggestions(projectId: string | undefined, query: string | null) {
  return useQuery({
    queryKey: ['card-mentions', projectId, query],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query ?? '' })
      const result = await api.get<{ cards: CardLinkDto[] }>(
        `/api/projects/${projectId}/cards/mentions?${params}`,
      )
      return result.cards
    },
    enabled: Boolean(projectId) && query !== null,
    staleTime: 15_000,
  })
}

const notesKey = (cardId: string) => ['card-notes', cardId]

/**
 * Le fil d'une carte, chargé à part du board.
 *
 * Les notes s'accumulent au fil des sessions et ne servent qu'au panneau ouvert : les
 * embarquer dans la liste ferait payer à chaque affichage du board des textes que
 * personne ne regarde.
 */
export function useCardNotes(cardId: string | undefined) {
  return useQuery({
    queryKey: notesKey(cardId ?? ''),
    queryFn: () => api.get<CardNoteDto[]>(`/api/cards/${cardId}/notes`),
    enabled: Boolean(cardId),
    staleTime: 15_000,
  })
}

export function useAddCardNote(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['add-card-note', cardId],
    mutationFn: (body: string) => api.post<CardNoteDto[]>(`/api/cards/${cardId}/notes`, { body }),
    onSuccess: (notes) => {
      queryClient.setQueryData(notesKey(cardId), notes)
      // Le compte affiché sur la tuile vient du board, qui ne sait rien de cet ajout.
      void queryClient.invalidateQueries({ queryKey: cardsKey(projectId) })
    },
  })
}

export function useCardNoteSaving(cardId: string) {
  return useIsMutating({ mutationKey: ['add-card-note', cardId] }) > 0
}

export function useDeleteCardNote(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string) => api.delete<void>(`/api/card-notes/${noteId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notesKey(cardId) })
      void queryClient.invalidateQueries({ queryKey: cardsKey(projectId) })
    },
  })
}
