import type { Meta, StoryObj } from '@storybook/react-vite'
import type { WorktreeState } from '@solera/protocol'
import { Badge } from '@solera/ui'
import { useTranslate } from '../lib/i18n'
import { WORKTREE_STATE_TONE, WorktreeStateMark } from './WorktreeState'

const STATES: WorktreeState[] = ['missing', 'unreadable', 'dirty', 'unmerged', 'empty', 'merged']

function States() {
  const t = useTranslate()
  return (
    <ul className="flex flex-col gap-2">
      {STATES.map((state) => (
        <li key={state} className="flex items-center gap-2">
          <WorktreeStateMark state={state} className="size-2" />
          <span className="w-40 font-mono text-sm text-ink">{state}</span>
          <Badge tone={WORKTREE_STATE_TONE[state]}>{t(`worktrees.state.${state}`)}</Badge>
        </li>
      ))}
    </ul>
  )
}

const meta = {
  title: "Composants d'application/WorktreeState",
  component: WorktreeStateMark,
  args: { state: 'dirty' },
  parameters: {
    docs: {
      description: {
        component:
          "Le repère d'état d'un chantier et sa teinte, partagés par toute vue qui parle d'un arbre : un carré plein, sans arrondi, pour ne pas se confondre avec les points de signal des sessions, qui parlent de l'instant et non de l'arbre.",
      },
    },
  },
} satisfies Meta<typeof WorktreeStateMark>

export default meta
type Story = StoryObj<typeof meta>

/** Les six états, du plus urgent au plus anodin, avec leur badge. */
export const Etats: Story = {
  name: 'États',
  render: () => <States />,
}
