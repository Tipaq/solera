import { useQuery } from '@tanstack/react-query'
import type { AgentKind, UsagePeekDto, UsageLiveWindowDto } from '@solera/protocol'
import { api } from './api'
import { locale, translate, type MessageKey } from './i18n'

/**
 * L'aperçu de consommation qui ne coûte rien : la dernière sonde complète gardée par le
 * serveur, et les signaux de limite que les CLI envoient pendant les tours.
 *
 * Il ne lance jamais de CLI. C'est ce qui permet de le montrer sur chaque pastille du
 * brouillon, à chaque ouverture : la sonde complète, elle, démarre un process par
 * compte, et n'est demandée que par la modale de consommation.
 */
export function useUsagePeek(enabled = true) {
  return useQuery({
    queryKey: ['usage', 'peek'],
    queryFn: async () => (await api.get<{ entries: UsagePeekDto[] }>('/api/agents/usage/peek')).entries,
    staleTime: 30_000,
    enabled,
  })
}

export function peekOf(
  entries: UsagePeekDto[] | undefined,
  agent: AgentKind,
  account: string | null,
): UsagePeekDto | undefined {
  return entries?.find((entry) => entry.agent === agent && entry.account === account)
}

/** Les fenêtres que les CLI nomment pendant un tour ; une autre garde son nom d'origine. */
const LIVE_LABELS: Record<string, MessageKey> = {
  five_hour: 'usage.live.fiveHour',
  seven_day: 'usage.live.sevenDay',
  seven_day_opus: 'usage.live.sevenDayOpus',
  seven_day_sonnet: 'usage.live.sevenDaySonnet',
}

export function liveLabel(window: UsageLiveWindowDto): string {
  const key = LIVE_LABELS[window.type]
  return key ? translate(key) : window.type.replaceAll('_', ' ')
}

/** Au-delà, une sonde ne dit plus où en est la fenêtre de 5 h : son âge s'affiche. */
const FRESH_MS = 30 * 60_000

export type PeekTone = 'neutral' | 'caution' | 'critical'

/**
 * Une ligne pour une pastille : ce qui bloque d'abord, puis le pourcentage le plus haut
 * de la dernière sonde, puis, faute de mieux, l'heure à laquelle la fenêtre rouvre.
 *
 * Claude ne donne presque jamais de pourcentage pendant un tour — seulement le statut
 * et la remise à zéro —, et ce n'est pas une panne : sans sonde récente, l'aperçu dit
 * « OK » plutôt que d'inventer un chiffre.
 */
export function peekSummary(peek: UsagePeekDto | undefined): { text: string; tone: PeekTone } | null {
  if (!peek) return null
  const blocked = peek.live.find((window) => window.status === 'rejected')
  if (blocked) {
    return {
      text: blocked.resetsAt
        ? translate('usage.peek.blockedUntil', { at: resetMoment(blocked.resetsAt) })
        : translate('usage.peek.blocked'),
      tone: 'critical',
    }
  }
  const warning = peek.live.find((window) => window.status === 'allowed_warning')
  const probedTop = peek.probed?.windows
    .filter((window) => window.utilization !== null && (window.resetsAt === null || window.resetsAt > Date.now()))
    .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0]

  const probedFresh = peek.probed !== null && Date.now() - peek.probed.fetchedAt < FRESH_MS
  if (warning && !(probedFresh && probedTop)) {
    return {
      text: warning.utilization === null
        ? translate('usage.peek.near', { window: liveLabel(warning) })
        : `${liveLabel(warning)} · ${Math.round(warning.utilization * 100)} %`,
      tone: 'caution',
    }
  }
  if (probedTop && probedTop.utilization !== null) {
    const percent = Math.round(probedTop.utilization * 100)
    const text = `${probedTop.label} · ${percent} %`
    return {
      text: probedFresh ? text : `${text} · ${shortAgo(peek.probed!.fetchedAt)}`,
      tone: probedTop.utilization >= 0.9 ? 'critical' : probedTop.utilization >= 0.75 ? 'caution' : 'neutral',
    }
  }
  const open = peek.live.find((window) => window.resetsAt !== null)
  if (open?.resetsAt) {
    return { text: translate('usage.peek.okUntil', { window: liveLabel(open), at: resetMoment(open.resetsAt) }), tone: 'neutral' }
  }
  return null
}

function shortAgo(at: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - at) / 60_000))
  if (minutes < 60) return translate('usage.age.minutes', { minutes })
  const hours = Math.round(minutes / 60)
  return hours < 48 ? translate('usage.age.hours', { hours }) : translate('usage.peek.days', { days: Math.round(hours / 24) })
}

/**
 * L'heure de la remise à zéro, à côté du délai : « dans 3 h » oblige à compter pour
 * savoir si la fenêtre rouvre avant la fin de la journée, « 15:00 » le dit. Le jour
 * s'ajoute dès que ce n'est plus aujourd'hui, la date au-delà d'une semaine.
 */
export function resetMoment(resetsAt: number): string {
  const at = new Date(resetsAt)
  const now = new Date()
  const time = at.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return time
  if (resetsAt - now.getTime() < 6 * 86_400_000) {
    return `${at.toLocaleDateString(locale(), { weekday: 'short' })} ${time}`
  }
  return `${at.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} ${time}`
}
