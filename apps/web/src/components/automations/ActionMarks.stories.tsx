import type { Meta, StoryObj } from '@storybook/react-vite'
import { cx } from '@solera/ui'
import { actionState, natureOf, type Automation } from '../../lib/automations'
import { useTranslate } from '../../lib/i18n'
import { KindChip, STATE_TEXT, StateIcon } from './ActionMarks'
import { NOW, STATES } from './automation-fixtures'

function Line({ item, size }: { item: Automation; size: 'md' | 'sm' }) {
  const t = useTranslate()
  const state = actionState(item, NOW, t)
  return (
    <li className="flex min-w-0 items-center gap-2.5">
      <StateIcon nature={natureOf(item)} tone={state.tone} size={size} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{item.label}</span>
          <KindChip item={item} />
        </span>
        <span className={cx('truncate text-xs', STATE_TEXT[state.tone])}>{state.text}</span>
      </span>
    </li>
  )
}

const meta = {
  title: "Composants d'application/Actions/Repères",
  component: StateIcon,
  args: { nature: { what: 'command', kind: 'service' }, tone: 'live' },
  parameters: {
    docs: {
      description: {
        component:
          "Les repères d'une action, les mêmes partout : l'icône de sa nature (le CLI d'un agent, un serveur, un terminal) avec le point de son état — vert qui bat, gris au repos, rouge en échec, ambre à relire —, la phrase d'état de `actionState`, et la puce Quoi · Quand.",
      },
    },
  },
} satisfies Meta<typeof StateIcon>

export default meta
type Story = StoryObj<typeof meta>

/** Un état par ligne : en marche, arrêté, réussie, échec, échecs d'affilée, jamais lancée, en cours, à relire. */
export const Etats: Story = {
  name: 'États',
  render: () => (
    <ul className="flex max-w-xl flex-col gap-3">
      {STATES.map((item) => <Line key={item.id} item={item} size="md" />)}
    </ul>
  ),
}

/** La taille d'une ligne de panneau : l'icône nue, 24 px. */
export const Petite: Story = {
  name: 'Petite',
  render: () => (
    <ul className="flex max-w-sm flex-col gap-2">
      {STATES.map((item) => <Line key={item.id} item={item} size="sm" />)}
    </ul>
  ),
}
