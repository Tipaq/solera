import * as Dialog from '@radix-ui/react-dialog'
import { Loader, RefreshCw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentKind } from '@solera/protocol'
import { AGENT_LABELS, AgentIcon } from './AgentIcon'
import { locale, useTranslate } from '../lib/i18n'
import { useAgentAvailability } from '../lib/agents'
import { useAgentUsage, useRefreshUsage } from '../lib/usage'
import { Banner, IconButton, Tabs, cx } from '@solera/ui'
import { UsageBar, readAge } from './chat/UsageBar'

/**
 * Consommation du compte, l'équivalent de `/usage`.
 *
 * Le panneau ne connaît aucune fenêtre à l'avance : il affiche ce que le CLI déclare,
 * dans l'ordre reçu. C'est ce qui a permis à la jauge Fable d'apparaître sans que rien
 * ne soit écrit à son sujet, et ce qui fera apparaître la suivante.
 *
 * Il ne connaît pas davantage ses CLI à l'avance : la rangée d'onglets est celle que le
 * serveur dit savoir lancer. Un CLI absent est un état normal depuis que Solera ne
 * transporte plus les binaires, et l'interroger ne rapporterait qu'une erreur.
 *
 * **Un seul CLI est lu à la fois**, celui de l'onglet ouvert. Chaque lecture démarre un
 * process : lire les trois à l'ouverture en lancerait trois pour deux chiffres que
 * personne n'a demandés. Changer d'onglet lit le suivant, et le cache garde les
 * précédents le temps de la modale.
 */

/**
 * Le CLI regardé, avec son en-tête.
 *
 * Remonté à chaque changement d'onglet, et démonté à la fermeture par le portail de
 * Radix. C'est ce qui fait qu'ouvrir le panneau — ou choisir un onglet — redemande la
 * consommation, sans dépendre d'une durée de fraîcheur côté client. Le seul garde-fou
 * est le cache du serveur, placé là où se trouve le coût réel. La valeur précédente
 * reste affichée pendant la relecture, donc revenir sur un onglet n'efface pas l'écran
 * pour le remplir à nouveau.
 */
function UsageContent({
  agent,
  agents,
  onSelect,
}: {
  agent: AgentKind
  agents: AgentKind[]
  onSelect: (agent: AgentKind) => void
}) {
  const t = useTranslate()
  const { data: usage, error, isPending, isFetching } = useAgentUsage(agent)
  const refresh = useRefreshUsage(agent)
  const [refreshing, setRefreshing] = useState(false)

  const reload = async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const busy = refreshing || isFetching

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 pt-safe">
        <Dialog.Title className="flex-1 text-sm font-semibold">
          {/* Un seul CLI : son nom est dans le titre, faute de rangée d'onglets pour le
              porter. Plusieurs : le titre nomme le compte, les onglets nomment les CLI. */}
          {agents.length > 1
            ? t('usage.account.title')
            : t('usage.title', { agent: AGENT_LABELS[agent] })}
        </Dialog.Title>
        <IconButton label={t('usage.refresh')} onClick={() => void reload()} disabled={busy}>
          <RefreshCw size={16} className={cx(busy && 'animate-spin')} />
        </IconButton>
        <Dialog.Close asChild>
          <IconButton label={t('usage.close')}>
            <X size={16} />
          </IconButton>
        </Dialog.Close>
      </header>

      {agents.length > 1 ? (
        <div className="shrink-0 px-3">
          <Tabs
            label={t('usage.account.tabs')}
            value={agent}
            tabs={agents.map((kind) => ({
              value: kind,
              label: AGENT_LABELS[kind],
              // Muette : l'onglet porte déjà le nom du CLI à côté.
              icon: <AgentIcon agent={kind} size={14} decorative />,
            }))}
            onChange={onSelect}
            layout="fill"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-safe">
        {isPending ? (
          <div className="flex items-center justify-center py-10 text-ink-faint">
            <Loader size={22} className="animate-spin" aria-label={t('usage.loading')} />
          </div>
        ) : null}

        {error ? (
          <Banner>{error instanceof Error ? error.message : t('usage.error')}</Banner>
        ) : null}

        {usage ? (
          <div className="flex flex-col gap-4">
            {usage.plan ? (
              <p className="text-xs text-ink-soft">
                {t('usage.plan')} <span className="font-medium text-ink">{usage.plan}</span>
              </p>
            ) : null}

            {!usage.limitsAvailable ? (
              <p className="text-sm text-ink-faint">{t('usage.noLimits')}</p>
            ) : (
              <div className="flex flex-col gap-3.5">
                {usage.windows.map((window) => (
                  <UsageBar key={window.id} window={window} />
                ))}
              </div>
            )}

            {usage.credits ? (
              <div className="flex flex-col gap-1 border-t border-line pt-3">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{usage.credits.label}</span>
                  <span className="shrink-0 text-meta text-ink-faint">
                    {usage.credits.enabled ? t('usage.credits.enabled') : t('usage.credits.disabled')}
                  </span>
                </div>
                {usage.credits.detail ? (
                  <p className="text-meta text-ink-faint">{usage.credits.detail}</p>
                ) : null}
              </div>
            ) : null}

            <p
              className="text-meta text-ink-faint"
              title={new Date(usage.fetchedAt).toLocaleString(locale())}
            >
              {t('usage.readAt', { age: readAge(usage.fetchedAt) })}
            </p>
          </div>
        ) : null}
      </div>
    </>
  )
}

/**
 * Les CLI lançables, et celui qu'on regarde.
 *
 * `agent` est le CLI sur lequel ouvrir. Il est toujours proposé, même absent de la
 * liste des disponibles : il vient alors d'un fil ouvert avec ce CLI, et refuser de
 * lire la consommation de la conversation qu'on a sous les yeux serait incompréhensible.
 */
function UsageDialog({ agent }: { agent?: AgentKind }) {
  const t = useTranslate()
  const { data: availability } = useAgentAvailability()

  const agents = useMemo(() => {
    const installed = (availability?.agents ?? []).filter((a) => a.installed).map((a) => a.agent)
    return agent && !installed.includes(agent) ? [agent, ...installed] : installed
  }, [availability, agent])

  const [chosen, setChosen] = useState<AgentKind | null>(null)
  // La liste arrive après le premier rendu : tant qu'elle manque, il n'y a rien à
  // choisir. Un choix explicite n'est jamais réécrit quand elle arrive.
  const current = chosen ?? agent ?? agents[0] ?? null

  if (!current) {
    return (
      <>
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 pt-safe">
          <Dialog.Title className="flex-1 text-sm font-semibold">
            {t('usage.account.title')}
          </Dialog.Title>
          <Dialog.Close asChild>
            <IconButton label={t('usage.close')}>
              <X size={16} />
            </IconButton>
          </Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-safe">
          {/* Aucun CLI installé, ou la liste n'est pas encore là. Les deux disent la
              même chose à l'écran : il n'y a rien à lire pour l'instant. */}
          <p className="text-sm text-ink-faint">{t('usage.noAgent')}</p>
        </div>
      </>
    )
  }

  return <UsageContent key={current} agent={current} agents={agents} onSelect={setChosen} />
}

export function UsagePanel({
  agent,
  open,
  onOpenChange,
}: {
  /** CLI sur lequel ouvrir. Omis depuis le compte, qui n'en privilégie aucun. */
  agent?: AgentKind
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          className={cx(
            'surface fixed z-50 flex flex-col overflow-hidden border-line shadow-pop',
            'inset-0 border-0',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[90dvh] sm:w-[min(26rem,92vw)]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border',
          )}
        >
          <UsageDialog agent={agent} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
