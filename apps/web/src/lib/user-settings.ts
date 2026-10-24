import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentConfig,
  BoardOrder,
  NotificationPrefs,
  OnboardingState,
  ProjectDefaults,
  UserSettingsDto,
} from '@solera/protocol'
import { api } from './api'

const USER_SETTINGS_KEY = ['user-settings']

/** `enabled` à faux tant qu'aucune session n'est ouverte : la route répondrait 401. */
export function useUserSettings(enabled = true) {
  return useQuery({
    queryKey: USER_SETTINGS_KEY,
    queryFn: () => api.get<UserSettingsDto>('/api/me/settings'),
    enabled,
  })
}

/** Le défaut d'un CLI, remplacé en bloc : la route ne fusionne pas champ par champ. */
export function useUpdateAgentDefault() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agentDefault: AgentConfig) =>
      api.patch<UserSettingsDto>('/api/me/settings', { agentDefault }),
    onSuccess: (settings) => queryClient.setQueryData(USER_SETTINGS_KEY, settings),
  })
}

/**
 * Les projets repliés dans la sidebar.
 *
 * Appliqué localement avant la réponse : un chevron qui attend un aller-retour réseau
 * pour tourner donne une sidebar molle, alors que le repli est un geste qu'on répète.
 * La réponse du serveur fait ensuite foi, comme pour toute mutation.
 */
export function useUpdateCollapsedProjects() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (collapsedProjects: string[]) =>
      api.patch<UserSettingsDto>('/api/me/settings', { collapsedProjects }),

    onMutate: async (collapsedProjects) => {
      await queryClient.cancelQueries({ queryKey: USER_SETTINGS_KEY })
      const previous = queryClient.getQueryData<UserSettingsDto>(USER_SETTINGS_KEY)
      if (previous) {
        queryClient.setQueryData(USER_SETTINGS_KEY, { ...previous, collapsedProjects })
      }
      return { previous }
    },

    onError: (_error, _ids, context) => {
      // Le serveur n'a pas pris le repli : l'affichage doit redevenir ce qu'il connaît,
      // sinon un projet resterait fermé chez soi et ouvert au rechargement suivant.
      if (context?.previous) queryClient.setQueryData(USER_SETTINGS_KEY, context.previous)
    },

    onSuccess: (settings) => queryClient.setQueryData(USER_SETTINGS_KEY, settings),
  })
}

/**
 * Les sortes de notifications voulues, remplacées en bloc. Appliquées sans attendre,
 * comme les projets repliés : un interrupteur qui attend le réseau pour basculer
 * semble ne pas avoir pris le clic.
 */
export function useUpdateNotificationPrefs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (notifications: NotificationPrefs) =>
      api.patch<UserSettingsDto>('/api/me/settings', { notifications }),
    onMutate: async (notifications) => {
      await queryClient.cancelQueries({ queryKey: USER_SETTINGS_KEY })
      const previous = queryClient.getQueryData<UserSettingsDto>(USER_SETTINGS_KEY)
      if (previous) queryClient.setQueryData(USER_SETTINGS_KEY, { ...previous, notifications })
      return { previous }
    },
    onError: (_error, _prefs, context) => {
      if (context?.previous) queryClient.setQueryData(USER_SETTINGS_KEY, context.previous)
    },
    onSuccess: (settings) => queryClient.setQueryData(USER_SETTINGS_KEY, settings),
  })
}

/**
 * L'état de la visite, remplacé en bloc. Appliqué sans attendre : chaque pas l'écrit, et
 * une étape qui attendrait le réseau pour s'afficher donnerait une visite molle.
 */
export function useUpdateOnboarding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (onboarding: OnboardingState) =>
      api.patch<UserSettingsDto>('/api/me/settings', { onboarding }),
    onMutate: async (onboarding) => {
      await queryClient.cancelQueries({ queryKey: USER_SETTINGS_KEY })
      const previous = queryClient.getQueryData<UserSettingsDto>(USER_SETTINGS_KEY)
      if (previous) queryClient.setQueryData(USER_SETTINGS_KEY, { ...previous, onboarding })
      return { previous }
    },
    onError: (_error, _state, context) => {
      if (context?.previous) queryClient.setQueryData(USER_SETTINGS_KEY, context.previous)
    },
    onSuccess: (settings) => queryClient.setQueryData(USER_SETTINGS_KEY, settings),
  })
}

/** Les défauts des projets à venir, remplacés en bloc. */
export function useUpdateProjectDefaults() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectDefaults: ProjectDefaults) =>
      api.patch<UserSettingsDto>('/api/me/settings', { projectDefaults }),
    onSuccess: (settings) => queryClient.setQueryData(USER_SETTINGS_KEY, settings),
  })
}

/**
 * L'ordre des colonnes d'un board, et de quoi le changer. Appliqué sans attendre : le
 * board se réordonne au clic, et revient si le serveur n'a pas pris le choix.
 */
export function useBoardOrder(projectId: string | undefined): [BoardOrder, (order: BoardOrder) => void] {
  const queryClient = useQueryClient()
  const { data } = useUserSettings()
  const update = useMutation({
    mutationFn: (order: BoardOrder) => api.patch<UserSettingsDto>('/api/me/settings', { boardOrder: { projectId, order } }),
    onMutate: async (order) => {
      await queryClient.cancelQueries({ queryKey: USER_SETTINGS_KEY })
      const previous = queryClient.getQueryData<UserSettingsDto>(USER_SETTINGS_KEY)
      if (previous && projectId) {
        queryClient.setQueryData(USER_SETTINGS_KEY, { ...previous, boardOrder: { ...previous.boardOrder, [projectId]: order } })
      }
      return { previous }
    },
    onError: (_error, _order, context) => {
      if (context?.previous) queryClient.setQueryData(USER_SETTINGS_KEY, context.previous)
    },
    onSuccess: (settings) => queryClient.setQueryData(USER_SETTINGS_KEY, settings),
  })
  const order = (projectId && data?.boardOrder[projectId]) || 'manual'
  return [order, (next) => update.mutate(next)]
}
