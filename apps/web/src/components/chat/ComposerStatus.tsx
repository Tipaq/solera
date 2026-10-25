import { Flame, Snowflake } from 'lucide-react'
import type { AgentKind } from '@solera/protocol'
import { AGENT_LABELS, AgentIcon } from '../AgentIcon'
import { useTranslate } from '../../lib/i18n'
import { cx } from '@solera/ui'

/**
 * Ce qui est toujours vrai d'une conversation, sous la barre de saisie : le CLI, la
 * session chargée ou non, la liaison.
 *
 * Rien de ce qui va et vient n'a sa place ici. Les signaux sont au-dessus du composer,
 * en couleur ; cette ligne-ci reste grise et immobile, et ne doit jamais attirer l'œil.
 *
 * Le rappel « Entrée pour envoyer » a disparu : c'est le geste le plus fréquent de
 * l'application, il s'apprend au premier message et se relit ensuite à chaque fois pour
 * rien.
 */
export function ComposerStatus({
  agent,
  connected,
  warm,
}: {
  agent: AgentKind
  connected: boolean
  /** Null tant que le serveur ne l'a pas annoncé, c'est-à-dire avant l'abonnement. */
  warm: boolean | null
}) {
  const t = useTranslate()

  return (
    <div
      className={cx(
        'mx-auto flex sg-conversation-width flex-wrap items-center gap-x-3 gap-y-1',
        'px-1.5 pt-2 text-meta text-ink-faint',
      )}
    >
      <span className="flex items-center gap-1.5">
        <AgentIcon agent={agent} size={11} />
        {AGENT_LABELS[agent]}
      </span>

      {warm !== null ? (
        <span
          className="flex items-center gap-1"
          title={warm ? t('composer.status.warm.title') : t('composer.status.cold.title')}
        >
          {warm ? <Flame size={11} /> : <Snowflake size={11} />}
          {warm ? t('composer.status.warm.label') : t('composer.status.cold.label')}
        </span>
      ) : null}

      {/* La liaison n'est dite ici que lorsqu'elle fonctionne. Coupée, elle devient un
          signal au-dessus du composer, où l'ambiant va quand il tourne mal. */}
      {connected ? (
        <span title={t('composer.status.connected.title')}>
          {t('composer.status.connected.label')}
        </span>
      ) : null}

    </div>
  )
}
