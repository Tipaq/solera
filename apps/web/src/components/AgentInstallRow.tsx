import type { AgentAvailabilityDto } from '@solera/protocol'
import { Button } from '@solera/ui'
import { useInstallAgent } from '../lib/agents'
import { useTranslate } from '../lib/i18n'
import { AGENT_LABELS } from './AgentIcon'

/**
 * Un CLI manquant, et l'installation de la version que Solera vise. Partagé par l'écran
 * d'une conversation neuve et par la visite : les deux demandent la même chose au même
 * moment, quand le CLI qu'on veut n'est pas là.
 *
 * Rien pour un CLI désactivé : il relève de la configuration, son installation ne
 * résoudrait pas son indisponibilité.
 */
export function AgentInstallRow({ entry }: { entry: AgentAvailabilityDto }) {
  const t = useTranslate()
  const install = useInstallAgent()
  if (entry.installed || entry.reason === 'disabled') return null

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line p-2">
      <span className="min-w-0 text-xs leading-snug text-ink-faint">
        {entry.install.status === 'running'
          ? t('agent.install.running', {
              label: AGENT_LABELS[entry.agent],
              version: entry.install.version,
            })
          : entry.install.status === 'failed'
            ? entry.install.error
            : t('agent.install.missing', { label: AGENT_LABELS[entry.agent] })}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={entry.install.status === 'running' || install.isPending}
        onClick={() => install.mutate(entry.agent)}
      >
        {entry.install.status === 'failed'
          ? t('agent.install.retry')
          : t('agent.install.action', { version: entry.preferredVersion })}
      </Button>
    </div>
  )
}
