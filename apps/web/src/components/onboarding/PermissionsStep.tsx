import { Columns3, FolderInput, MessageCircleQuestion, Plug } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { OnboardingPermission } from '@solera/protocol'
import { ChoiceList, SwitchRow } from '@solera/ui'
import { CliDefaultsSettingsPage } from '../../routes/CliDefaultsSettingsPage'
import { useMcpServers } from '../../lib/mcp'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { withFamily, withPermissionChoice, type OnboardingFamily } from '../../lib/onboarding'
import { useAgentDefaults } from './defaults'
import { StepTitle, Why, useCommit, useGate, type StepProps } from './shell'

const PERMISSIONS: OnboardingPermission[] = ['manual', 'auto', 'acceptEdits', 'bypass']

/** Les familles de cette étape, dans l'ordre du socle vers ce qu'on accorde. */
const FAMILIES: { name: Exclude<OnboardingFamily, 'agentMemory' | 'skillLibrary'>; icon: ReactNode; label: MessageKey; hint: MessageKey }[] = [
  { name: 'soleraMcp', icon: <Plug size={16} />, label: 'onboarding.permissions.family.soleraMcp', hint: 'onboarding.permissions.family.soleraMcp.hint' },
  { name: 'decisions', icon: <MessageCircleQuestion size={16} />, label: 'composer.setting.decisions', hint: 'onboarding.permissions.family.decisions.hint' },
  { name: 'cardFiling', icon: <Columns3 size={16} />, label: 'composer.setting.cardFiling', hint: 'onboarding.permissions.family.cardFiling.hint' },
  { name: 'projectFiling', icon: <FolderInput size={16} />, label: 'composer.setting.projectFiling', hint: 'onboarding.permissions.family.projectFiling.hint' },
]

/**
 * Ce que l'agent fait sans demander : le réflexe de permission de son CLI, et les
 * familles d'autorisation des outils de Solera. Les deux deviennent les défauts du
 * compte, que chaque conversation peut changer pour elle.
 */
export function PermissionsStep({ nav, state, setAnswers }: StepProps) {
  const t = useTranslate()
  const defaults = useAgentDefaults()
  const { data: registry } = useMcpServers()
  const [families, setFamilies] = useState<Partial<Record<OnboardingFamily, boolean>>>({})
  /*
   * Le réflexe ne s'écrit que s'il a été choisi ici : sinon « Continuer » écraserait ce
   * qu'on vient de régler CLI par CLI dans le volet du bas. Affiché d'après le défaut de
   * Claude tant qu'on n'y a pas touché, puisque c'est son vocabulaire.
   */
  const [reflex, setReflex] = useState<OnboardingPermission | null>(null)
  const permission = reflex ?? defaults.claudeReflex ?? state.answers.permission

  // Une famille que l'instance refuse disparaît, comme dans le composeur : la régler ici
  // ne changerait rien.
  const offered = FAMILIES.filter(({ name }) =>
    name === 'soleraMcp' ? registry?.soleraServer !== false : registry?.[name] !== false,
  )
  const valueOf = (name: OnboardingFamily) => families[name] ?? defaults.family(name)
  const socle = valueOf('soleraMcp')

  useGate(nav, { canContinue: defaults.ready, laterAllowed: true, skipAllowed: true })
  useCommit(nav, () =>
    defaults.apply((config) => {
      let next = reflex ? withPermissionChoice(config, reflex) : config
      for (const [name, on] of Object.entries(families) as [OnboardingFamily, boolean][]) next = withFamily(next, name, on)
      return next
    }),
  )

  return (
    <>
      <StepTitle title={t('onboarding.permissions.title')} lead={t('onboarding.permissions.lead')} />

      <ChoiceList<OnboardingPermission>
        label={t('onboarding.permissions.reflex')}
        value={permission}
        onChange={(choice) => {
          setReflex(choice)
          setAnswers({ permission: choice })
        }}
        options={PERMISSIONS.map((choice) => ({
          value: choice,
          label: t(`onboarding.permissions.reflex.${choice}` as MessageKey),
          hint: t(`onboarding.permissions.reflex.${choice}.hint` as MessageKey),
        }))}
      />

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">{t('onboarding.permissions.families')}</h2>
        <Why>{t('onboarding.permissions.families.why')}</Why>
        {offered.map(({ name, icon, label, hint }) => (
          <SwitchRow
            key={name}
            checked={valueOf(name)}
            // Le socle coupé emporte les familles qui se découpent dedans.
            disabled={name !== 'soleraMcp' && !socle}
            onCheckedChange={(on) => setFamilies((current) => ({ ...current, [name]: on }))}
            icon={icon}
            label={t(label)}
            description={t(hint)}
          />
        ))}
      </section>

      <details>
        <summary className="cursor-pointer py-1 text-sm font-medium text-ink-soft">
          {t('onboarding.permissions.perCli')}
        </summary>
        <p className="py-2 text-xs text-ink-faint">{t('onboarding.permissions.perCli.hint')}</p>
        <CliDefaultsSettingsPage />
      </details>
    </>
  )
}
