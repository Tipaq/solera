import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PushDeviceDto, PushStatusDto, PushTestDto } from '@solera/protocol'
import { api } from './api'
import { translate } from './i18n'
import { wsClient } from './ws-client'

const PUSH_KEY = ['push']
const PUSH_DEVICES_KEY = ['push-devices']

/**
 * Abonnement aux notifications système.
 *
 * Trois conditions doivent être réunies, et elles échouent chacune pour une raison
 * différente qu'il faut savoir distinguer : un service worker enregistré (donc HTTPS),
 * l'API Push disponible, et la permission accordée par l'utilisateur.
 */

export type PushAvailability = 'ok' | 'insecure' | 'unsupported'

/**
 * Ce que le navigateur permet ici.
 *
 * Hors contexte sécurisé, ni le service worker ni l'API Push n'existent : le distinguer
 * d'un navigateur qui ne les gère pas évite de dire « non supporté » à quelqu'un dont
 * le seul tort est d'être en `http://`.
 */
export function pushAvailability(): PushAvailability {
  if (!window.isSecureContext) return 'insecure'
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  return 'ok'
}

/**
 * La clé publique voyage en base64url ; l'API en attend les octets.
 *
 * Le type de retour est `ArrayBuffer` et non `Uint8Array` : depuis que les tableaux
 * typés peuvent s'appuyer sur un `SharedArrayBuffer`, ils ne satisfont plus `BufferSource`.
 */
function decodeKey(base64url: string): ArrayBuffer {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=')
  const binary = atob(padded.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return bytes.buffer as ArrayBuffer
}

export function usePushStatus(enabled: boolean) {
  return useQuery({
    queryKey: PUSH_KEY,
    queryFn: () => api.get<PushStatusDto>('/api/push'),
    enabled,
  })
}

export function useSubscribePush() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (publicKey: string) => {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error(
          permission === 'denied'
            ? translate('push.permission.blocked')
            : translate('push.permission.denied'),
        )
      }

      const registration = await navigator.serviceWorker.ready
      // `userVisibleOnly` est obligatoire : les navigateurs refusent un abonnement qui
      // permettrait de recevoir des messages sans rien montrer à l'utilisateur.
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      })

      await api.post('/api/push/subscribe', subscription.toJSON())
      wsClient.setPushEndpoint(subscription.endpoint)
    },
    onSuccess: () => invalidatePush(queryClient),
  })
}

export function useUnsubscribePush() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return

      // Le serveur d'abord : si le navigateur se désabonne et que l'appel échoue,
      // l'endpoint resterait en base et recevrait des envois voués à l'échec.
      await api.post('/api/push/unsubscribe', { endpoint: subscription.endpoint })
      await subscription.unsubscribe()
      wsClient.setPushEndpoint(null)
    },
    onSuccess: () => invalidatePush(queryClient),
  })
}

function invalidatePush(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: PUSH_KEY }),
    queryClient.invalidateQueries({ queryKey: PUSH_DEVICES_KEY }),
  ])
}

/**
 * Les appareils abonnés du compte, et celui-ci parmi eux.
 *
 * C'est `current` qui dit si les notifications sont actives **ici** : le compte peut
 * avoir un téléphone abonné sans que cet ordinateur le soit, et l'inverse.
 */
export function usePushDevices(enabled: boolean) {
  return useQuery({
    queryKey: PUSH_DEVICES_KEY,
    queryFn: async () => {
      const { devices } = await api.get<{ devices: PushDeviceDto[] }>('/api/push/devices')
      return { devices, current: await currentEndpoint() }
    },
    enabled,
  })
}

async function currentEndpoint(): Promise<string | null> {
  try {
    // `getRegistration` et non `ready` : sans service worker enregistré, `ready` ne se
    // résout jamais, et l'écran attendrait indéfiniment.
    const registration = await navigator.serviceWorker.getRegistration()
    return (await registration?.pushManager?.getSubscription())?.endpoint ?? null
  } catch {
    return null
  }
}

/** Retire un appareil du compte, depuis n'importe lequel des autres. */
export function useRemovePushDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (endpoint: string) => api.post<void>('/api/push/devices/remove', { endpoint }),
    onSuccess: () => invalidatePush(queryClient),
  })
}

/** Une notification d'essai, après un délai pour avoir le temps de fermer l'application. */
export function useSendPushTest() {
  return useMutation({
    mutationFn: (delaySeconds: number) => api.post<PushTestDto>('/api/push/test', { delaySeconds }),
  })
}

/** Suivi jusqu'au résultat : relu chaque seconde tant que l'envoi n'a pas eu lieu. */
export function usePushTest(id: string | null) {
  return useQuery({
    queryKey: ['push-test', id],
    queryFn: () => api.get<PushTestDto>(`/api/push/test/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.deliveries ? false : 1_000),
  })
}
