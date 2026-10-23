import { Brain } from 'lucide-react'
import { useState } from 'react'
import type { ProjectInstructionsMode } from '@solera/protocol'
import { ChoiceList, SwitchRow } from '@solera/ui'
import { GlobalInstructions } from '../instructions/Instructions'
import { useMcpServers } from '../../lib/mcp'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { withFamily } from '../../lib/onboarding'
import { useUpdateProjectDefaults, useUserSettings } from '../../lib/user-settings'
import { useAgentDefaults } from './defaults'
import { StepTitle, Why, useCommit, useGate, type StepProps } from './shell'

const MODES: ProjectInstructionsMode[] = ['auto', 'solera', 'repo']

/**
 * Ce qu'une session laisse aux suivantes : les consignes, que tu écris, et la mémoire,
 * que l'agent écrit.
 *
 * La mémoire est la famille `agentMemory`, réglée ici pour les quatre CLI : c'est le
 * seul réglage de la mémoire, et un mode de projet à côté en ferait un second. Les
 * consignes ont deux réglages : la partie globale de SOLERA.md, que l'administrateur
 * écrit, et l'endroit où vivra la partie de chaque projet à venir.
 */
export function InstructionsStep({ nav, user }: StepProps) {
  const t = useTranslate()
  const defaults = useAgentDefaults()
  const { data: settings } = useUserSettings()
  const { data: registry } = useMcpServers()
  const saveProjectDefaults = useUpdateProjectDefaults()
  const [memory, setMemory] = useState<boolean | null>(null)
  const [mode, setMode] = useState<ProjectInstructionsMode | null>(null)

  const memoryOn = memory ?? defaults.family('agentMemory')
  const modeValue = mode ?? settings?.projectDefaults.instructionsMode ?? 'auto'

  useGate(nav, { canContinue: defaults.ready, laterAllowed: true, skipAllowed: true })
  useCommit(nav, async () => {
    if (memory !== null) await defaults.apply((config) => withFamily(config, 'agentMemory', memory))
    if (mode !== null) await saveProjectDefaults.mutateAsync({ instructionsMode: mode })
  })

  return (
    <>
      <StepTitle title={t('onboarding.instructions.title')} lead={t('onboarding.instructions.lead')} />

      {/* L'instance qui ne prête pas sa mémoire la fait disparaître, comme du composeur. */}
      {registry?.agentMemory === false ? null : (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-ink">{t('onboarding.instructions.memory')}</h2>
          <Why>{t('onboarding.instructions.memory.why')}</Why>
          <SwitchRow
            checked={memoryOn}
            onCheckedChange={setMemory}
            icon={<Brain size={16} />}
            label={t('composer.setting.agentMemory')}
            description={t(memoryOn ? 'composer.agentMemory.on.hint' : 'composer.agentMemory.off.hint')}
          />
        </section>
      )}

      <ChoiceList<ProjectInstructionsMode>
        label={t('onboarding.instructions.mode')}
        value={modeValue}
        onChange={setMode}
        options={MODES.map((value) => ({
          value,
          label: t(`instructions.mode.${value}` as MessageKey),
          hint: t(`instructions.mode.${value}.hint` as MessageKey),
        }))}
      />

      {/* La partie globale vaut pour toute l'instance : seul l'administrateur l'écrit. */}
      {user?.isAdmin ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">{t('onboarding.instructions.global')}</h2>
          <p className="text-xs text-ink-faint">{t('onboarding.instructions.global.hint')}</p>
          <GlobalInstructions />
        </section>
      ) : null}
    </>
  )
}
