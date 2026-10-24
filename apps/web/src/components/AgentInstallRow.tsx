import { useEffect, useState } from 'react'
import { EyeOff } from 'lucide-react'
import type { AgentAvailabilityDto } from '@solera/protocol'
import { Button, IconButton } from '@solera/ui'
import { useInstallAgent } from '../lib/agents'
import { useTranslate } from '../lib/i18n'
import { AGENT_LABELS } from './AgentIcon'

/** Où en est une installation : son départ, et ce que npm a déjà reçu. */
export interface InstallProgress {
  startedAt: number
  fetched: number
  current: string | null
}

/**
 * Un CLI manquant, et l'installation de la version que Solera vise. Partagé par l'écran
 * d'une conversation neuve et par la visite : les deux demandent la même chose au même
 * moment, quand le CLI qu'on veut n'est pas là.
 *
 * Pendant l'installation, le rang devient son avancement : elle dure plusieurs minutes,
 * et un bouton grisé ne dit pas si quelque chose se passe. `onDismiss` ajoute « Ne plus
 * proposer », pour qui n'a que faire de ce CLI.
 *
 * Rien pour un CLI désactivé : il relève de la configuration, son installation ne
 * résoudrait pas son indisponibilité.
 */
export function AgentInstallRow({ entry, onDismiss }: { entry: AgentAvailabilityDto; onDismiss?: () => void }) {
  const t = useTranslate()
  const install = useInstallAgent()
  if (entry.installed || entry.reason === 'disabled') return null

  const label = AGENT_LABELS[entry.agent]
  // Dès le clic et avant la réponse du serveur, un départ sans rien de reçu : le rang ne
  // doit pas rester muet le temps de l'aller-retour.
  const progress: InstallProgress | null =
    entry.install.status === 'running'
      ? { startedAt: entry.install.startedAt, fetched: entry.install.fetched, current: entry.install.current }
      : install.isPending
        ? { startedAt: Date.now(), fetched: 0, current: null }
        : null
  if (progress) {
    const version = entry.install.status === 'running' ? entry.install.version : entry.preferredVersion
    return (
      <div className="rounded-lg border border-line p-3">
        <AgentInstallProgress label={label} version={version} progress={progress} />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line p-2">
      <span className="min-w-0 text-xs leading-snug text-ink-faint">
        {entry.install.status === 'failed' ? entry.install.error : t('agent.install.missing', { label })}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="secondary" onClick={() => install.mutate(entry.agent)}>
          {entry.install.status === 'failed'
            ? t('agent.install.retry')
            : t('agent.install.action', { version: entry.preferredVersion })}
        </Button>
        {onDismiss ? (
          <IconButton label={t('agent.install.dismiss')} size="sm" onClick={onDismiss}>
            <EyeOff size={14} />
          </IconButton>
        ) : null}
      </span>
    </div>
  )
}

/** Le temps écoulé depuis `startedAt`, en secondes, rafraîchi chaque seconde. */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.round((now - startedAt) / 1000))
}

/**
 * npm ne sait pas dire quelle part du paquet est arrivée, seulement qu'il télécharge
 * tel fichier et combien il en a déjà reçus. La barre est donc animée sans être
 * proportionnelle : elle montre que ça avance, et les lignes dessous disent quoi. Le
 * temps écoulé répond à la question qu'on se pose devant un bouton muet : « est-ce que
 * c'est planté ? ».
 */
function AgentInstallProgress({ label, version, progress }: { label: string; version: string; progress: InstallProgress }) {
  const t = useTranslate()
  const elapsed = useElapsed(progress.startedAt)
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const duration =
    minutes > 0
      ? t('agent.install.progress.minutes', { minutes, seconds })
      : t('agent.install.progress.seconds', { seconds })
  const title = t('agent.install.running', { label, version })

  return (
    <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium text-ink">{title}</span>
        <span className="shrink-0 tabular-nums text-ink-faint">{duration}</span>
      </div>
      <div role="progressbar" aria-label={title} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-high">
        <div className="sg-install-sweep h-full w-1/3 rounded-full bg-accent" />
      </div>
      <p className="min-w-0 truncate text-xs text-ink-faint">
        {progress.current
          ? t('agent.install.progress.fetch', { file: progress.current })
          : t('agent.install.progress.resolving')}
        {progress.fetched > 0 ? ` · ${t('agent.install.progress.files', { count: progress.fetched })}` : null}
      </p>
      <p className="text-xs text-ink-faint">{t('agent.install.progress.hint')}</p>
    </div>
  )
}
