import type { Meta, StoryObj } from '@storybook/react-vite'
import { GitBranch, ListTree, PanelRight } from 'lucide-react'
import { useTranslate } from '../../lib/i18n'
import type { OnboardingStepId } from '../../lib/onboarding'
import { Idea, Ideas, OnboardingShell, StepTitle, Why, type ShellStep } from './shell'

const IDS: OnboardingStepId[] = ['welcome', 'appearance', 'agents', 'permissions', 'instructions', 'skills', 'screen', 'work', 'ready']

/** Le cadre seul, sur l'étape qui présente l'écran : les boutons ne font rien ici. */
function Shell({ index }: { index: number }) {
  const t = useTranslate()
  const steps: ShellStep[] = IDS.map((id, i) => ({
    id,
    title: t(`onboarding.step.${id}`),
    sub: t(`onboarding.step.${id}.sub`),
    status: i === index ? 'current' : i < index ? (id === 'appearance' ? 'skipped' : 'done') : 'todo',
    reachable: i <= index,
  }))
  const noop = () => undefined

  return (
    <OnboardingShell
      steps={steps}
      index={index}
      onGoto={noop}
      onSkipAll={noop}
      onBack={noop}
      onNext={noop}
      onLater={noop}
      nextLabel={t('onboarding.shell.continue')}
      pending={false}
      canContinue
      laterAllowed={false}
      skipAllowed
      error={null}
    >
      <StepTitle title={t('onboarding.screen.title')} lead={t('onboarding.screen.lead')} />
      <Why>{t('onboarding.welcome.why')}</Why>
      <Ideas>
        <Idea icon={<ListTree size={16} />} title={t('onboarding.screen.column')}>
          {t('onboarding.screen.column.body')}
        </Idea>
        <Idea icon={<PanelRight size={16} />} title={t('onboarding.screen.panel')}>
          {t('onboarding.screen.panel.body')}
        </Idea>
        <Idea icon={<GitBranch size={16} />} title={t('onboarding.screen.git')}>
          {t('onboarding.screen.git.body')}
        </Idea>
      </Ideas>
    </OnboardingShell>
  )
}

const meta = {
  title: "Composants d'application/Visite de première ouverture",
  component: Shell,
  args: { index: 6 },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Le cadre de la visite : la liste des étapes à gauche sur grand écran, une barre de progression au téléphone, les boutons en bas. Une étape passée garde un rond en pointillé, une étape faite sa coche.",
      },
    },
  },
} satisfies Meta<typeof Shell>

export default meta
type Story = StoryObj<typeof meta>

export const Ecran: Story = { name: "L'écran" }
