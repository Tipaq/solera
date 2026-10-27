import { useEffect, useState, type ReactNode } from 'react'
import { agentKindSchema, type AgentKind } from '@solera/protocol'
import { Tabs } from '@solera/ui'
import { AGENT_LABELS, AgentIcon } from '../components/AgentIcon'
import { AgentAuthCard, AgentInstallCard } from '../components/settings/AgentPanels'
import { AgentModelCard, SharedModelCard } from '../components/settings/LayeredSettings'
import { ListHeading, SectionHeader } from '../components/settings/SectionHeader'
import { useAgentAuth, useAgentAvailability, useRefreshAgentAuth } from '../lib/agents'
import { useTranslate } from '../lib/i18n'
import { useSettingsDialog } from '../lib/settings-dialog'
import { ClaudeAccountsSettingsPage } from './ClaudeAccountsSettingsPage'
import { CodexAccountsSettingsPage } from './CodexAccountsSettingsPage'
import { GrokAccountsSettingsPage } from './GrokAccountsSettingsPage'

/** Les CLI qui savent emprunter un autre abonnement ; opencode n'en a pas. */
const EXTRA_ACCOUNTS: Partial<Record<AgentKind, () => ReactNode>> = {
  claude: () => <ClaudeAccountsSettingsPage bare />,
  codex: () => <CodexAccountsSettingsPage bare />,
  grok: () => <GrokAccountsSettingsPage bare />,
}

/**
 * Agents : tout ce qui tient à un CLI, un onglet par CLI. « Modèles par défaut » et
 * « Abonnements » étaient deux sections pour le même objet, et l'installation comme la
 * connexion n'avaient pas d'écran : on réglait le modèle d'un CLI sans savoir s'il était
 * là, ni connecté.
 *
 * L'ordre de l'onglet suit celui des questions : est-il installé, est-il connecté,
 * quels comptes peut-il emprunter, avec quoi s'ouvre-t-il. L'envoi pendant un tour vaut
 * pour tous les CLI : il reste sous les onglets, une seule fois.
 */
export function AgentsSettingsPage() {
  const t = useTranslate()
  const { agent: requested } = useSettingsDialog()
  const [agent, setAgent] = useState<AgentKind>(requested ?? 'claude')
  // Une demande arrivée modale ouverte (`openSettings('agents', 'codex')` depuis la
  // palette, par exemple) change l'onglet sans remonter la section.
  useEffect(() => {
    if (requested) setAgent(requested)
  }, [requested])

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.agents.title')} description={t('settings.agents.description')} />
      <Tabs
        label={t('settings.agents.title')}
        value={agent}
        onChange={setAgent}
        tabs={agentKindSchema.options.map((value) => ({ value, label: AGENT_LABELS[value], icon: <AgentIcon agent={value} size={14} /> }))}
      />
      <AgentTab key={agent} agent={agent} />
      <SharedModelCard level={{ kind: 'account' }} />
    </div>
  )
}

function AgentTab({ agent }: { agent: AgentKind }) {
  const t = useTranslate()
  const availability = useAgentAvailability()
  const auth = useAgentAuth()
  const refresh = useRefreshAgentAuth()
  const entry = availability.data?.agents.find((item) => item.agent === agent)
  // La connexion propre du CLI : celle des comptes supplémentaires se lit sur leur carte.
  const own = auth.data ? (auth.data.entries.find((item) => item.agent === agent && item.account === null) ?? null) : undefined
  const accounts = EXTRA_ACCOUNTS[agent]

  return (
    <div className="flex flex-col gap-6">
      <AgentInstallCard entry={entry} />
      <AgentAuthCard
        agent={agent}
        auth={own}
        error={auth.isError || refresh.isError}
        checking={refresh.isPending || auth.isFetching}
        onCheck={() => refresh.mutate()}
      />
      {accounts ? (
        <section className="flex flex-col gap-2">
          <ListHeading title={t('settings.agents.accounts.title')} />
          {accounts()}
        </section>
      ) : null}
      <AgentModelCard level={{ kind: 'account' }} agent={agent} />
    </div>
  )
}
