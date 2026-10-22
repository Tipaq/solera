import { useEffect } from 'react'
import { agentKindSchema, type AgentKind } from '@solera/protocol'
import { SwitchRow } from '@solera/ui'
import { useAgentAvailability } from '../../lib/agents'
import { useTranslate } from '../../lib/i18n'
import { AGENT_LABELS, AGENT_META, AgentIcon } from '../AgentIcon'
import { StepTitle, Why, useCommit, useGate, type StepProps } from './shell'

/**
 * Bienvenue : ce que Solera est, puis la seule question qui décide de la suite, les CLI
 * dont on compte se servir. Les étapes des agents et des autorisations ne parlent que
 * d'eux.
 */
export function WelcomeStep({ nav, state, setAnswers, profile, user }: StepProps) {
  const t = useTranslate()
  const { data: availability } = useAgentAvailability()
  // Un CLI coupé dans la configuration n'a rien à faire dans la question.
  const offered = availability
    ? availability.agents.filter((entry) => entry.enabled).map((entry) => entry.agent)
    : agentKindSchema.options
  const installed = availability
    ? availability.agents.filter((entry) => entry.enabled && entry.installed).map((entry) => entry.agent)
    : []
  const answers = state.answers

  useGate(nav, { canContinue: true, laterAllowed: false, skipAllowed: true })
  useCommit(nav, null)

  // Tant qu'on n'a pas répondu, ce que la machine porte déjà vaut réponse : un CLI
  // installé sur le serveur est un CLI dont on se sert.
  const agentsEmpty = answers.agents.length === 0
  const agentsChosen = answers.agentsChosen
  const installedKey = installed.join(',')
  useEffect(() => {
    if (agentsChosen || !agentsEmpty || installedKey === '') return
    setAnswers({ agents: installedKey.split(',') as AgentKind[] })
    // `setAnswers` change à chaque rendu : la liste des installés suffit à décider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsChosen, agentsEmpty, installedKey])

  const toggleAgent = (agent: AgentKind, on: boolean) =>
    setAnswers({
      agentsChosen: true,
      agents: on ? [...answers.agents.filter((entry) => entry !== agent), agent] : answers.agents.filter((entry) => entry !== agent),
    })

  const host = t(profile === 'desktop' ? 'onboarding.host.computer' : 'onboarding.host.server')

  return (
    <>
      <StepTitle
        title={user ? t('onboarding.welcome.title', { name: user.displayName }) : t('onboarding.welcome.title.anonymous')}
        lead={t('onboarding.welcome.lead', { host })}
      />
      <Why>{t('onboarding.welcome.why')}</Why>

      {/* Aucun CLI activé dans la configuration : pas de question sans réponse possible. */}
      {offered.length === 0 ? null : (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-ink">{t('onboarding.welcome.agents')}</h2>
          <p className="mb-1 text-xs text-ink-faint">{t('onboarding.welcome.agents.hint')}</p>
          {offered.map((agent) => (
            <SwitchRow
              key={agent}
              checked={answers.agents.includes(agent)}
              onCheckedChange={(on) => toggleAgent(agent, on)}
              icon={<AgentIcon agent={agent} size={16} />}
              label={AGENT_LABELS[agent]}
              description={
                installed.includes(agent)
                  ? t('onboarding.welcome.agents.installed', { vendor: AGENT_META[agent].vendor })
                  : AGENT_META[agent].vendor
              }
            />
          ))}
        </section>
      )}
    </>
  )
}
