import { useState } from 'react'
import { Tabs } from '@solera/ui'
import { AGENT_LABELS, AgentIcon } from '../components/AgentIcon'
import { SectionHeader } from '../components/settings/SectionHeader'
import { useTranslate } from '../lib/i18n'
import { useSettingsDialog, type SubscriptionAgent } from '../lib/settings-dialog'
import { ClaudeAccountsSettingsPage } from './ClaudeAccountsSettingsPage'
import { CodexAccountsSettingsPage } from './CodexAccountsSettingsPage'
import { GrokAccountsSettingsPage } from './GrokAccountsSettingsPage'

const AGENTS: SubscriptionAgent[] = ['claude', 'codex', 'grok']

/**
 * Abonnements (#120, Q31) : les comptes Claude, Codex et Grok qu'une session peut
 * emprunter, réunis en une section. Trois sections avant, qui se distinguaient mal de
 * « Comptes », les utilisateurs de l'instance.
 */
export function SubscriptionsSettingsPage() {
  const t = useTranslate()
  const { subscription } = useSettingsDialog()
  const [agent, setAgent] = useState<SubscriptionAgent>(subscription ?? 'claude')

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.subscriptions.title')} description={t('settings.subscriptions.description')} />
      <Tabs
        label={t('settings.subscriptions.title')}
        value={agent}
        onChange={setAgent}
        tabs={AGENTS.map((value) => ({ value, label: AGENT_LABELS[value], icon: <AgentIcon agent={value} size={14} /> }))}
      />
      {agent === 'claude' ? <ClaudeAccountsSettingsPage bare /> : null}
      {agent === 'codex' ? <CodexAccountsSettingsPage bare /> : null}
      {agent === 'grok' ? <GrokAccountsSettingsPage bare /> : null}
    </div>
  )
}
