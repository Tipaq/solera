import type { AgentKind } from '@solera/protocol'
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@solera/ui'
import { Bot } from 'lucide-react'
import type { ComponentType } from 'react'
import { ClaudeAccountsSettingsPage } from '../../routes/ClaudeAccountsSettingsPage'
import { CodexAccountsSettingsPage } from '../../routes/CodexAccountsSettingsPage'
import { GrokAccountsSettingsPage } from '../../routes/GrokAccountsSettingsPage'
import { unavailableReason, useAgentAvailability, versionMismatch } from '../../lib/agents'
import { useTranslate } from '../../lib/i18n'
import { AGENT_LABELS, AgentIcon } from '../AgentIcon'
import { AgentInstallRow } from '../AgentInstallRow'
import { StepTitle, Why, useCommit, useGate, type StepProps } from './shell'

/**
 * Les comptes supplémentaires, par CLI : les sections des réglages, ouvertes ici telles
 * quelles. opencode n'en a pas, il prend les fournisseurs de sa propre configuration.
 */
const ACCOUNTS: Partial<Record<AgentKind, ComponentType>> = {
  claude: ClaudeAccountsSettingsPage,
  codex: CodexAccountsSettingsPage,
  grok: GrokAccountsSettingsPage,
}

/**
 * Les CLI choisis à la bienvenue : là ou pas, à quelle version, et les comptes avec
 * lesquels ils travaillent. Rien ne bloque la suite : un CLI s'installe aussi plus tard.
 */
export function AgentsStep({ nav, state }: StepProps) {
  const t = useTranslate()
  const { data: availability } = useAgentAvailability()
  const chosen = state.answers.agents

  useGate(nav, { canContinue: true, laterAllowed: true, skipAllowed: true })
  useCommit(nav, null)

  return (
    <>
      <StepTitle title={t('onboarding.agents.title')} lead={t('onboarding.agents.lead')} />
      <Why>{t('onboarding.agents.why')}</Why>

      {chosen.length === 0 ? (
        <EmptyState icon={<Bot size={20} />} title={t('onboarding.agents.none')} description={t('onboarding.agents.none.hint')} />
      ) : null}

      {chosen.map((agent) => {
        const entry = availability?.agents.find((candidate) => candidate.agent === agent)
        const Accounts = ACCOUNTS[agent]
        const mismatch = versionMismatch(entry)
        const missing = unavailableReason(entry)
        return (
          <Card key={agent}>
            <CardHeader
              title={AGENT_LABELS[agent]}
              icon={<AgentIcon agent={agent} size={16} />}
              description={entry?.installed ? t('onboarding.agents.version', { version: entry.version ?? '?' }) : (missing ?? undefined)}
              actions={entry?.installed ? <Badge tone="positive">{t('onboarding.agents.ready')}</Badge> : null}
            />
            <CardBody className="flex flex-col gap-3">
              {mismatch ? <p className="text-xs text-caution">{mismatch}</p> : null}
              {entry ? <AgentInstallRow entry={entry} /> : null}
              {Accounts ? (
                <details>
                  <summary className="cursor-pointer py-1 text-sm font-medium text-ink-soft">
                    {t('onboarding.agents.accounts')}
                  </summary>
                  <div className="pt-3">
                    <Accounts />
                  </div>
                </details>
              ) : null}
            </CardBody>
          </Card>
        )
      })}
    </>
  )
}
