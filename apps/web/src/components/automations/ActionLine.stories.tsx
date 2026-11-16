import type { Meta, StoryObj } from '@storybook/react-vite'
import { ActionLine } from './ActionLine'
import { STATES } from './automation-fixtures'
import type { ActionHandlers } from './useActionGestures'

const ignore = () => {}
const handlers: ActionHandlers = {
  onOpen: ignore,
  onEdit: ignore,
  onLaunch: ignore,
  onLaunchUnchecked: ignore,
  onToggle: ignore,
  onService: ignore,
  onTerminal: ignore,
  onDuplicate: ignore,
  onDelete: ignore,
}

const meta = {
  title: "Composants d'application/ActionLine",
  component: ActionLine,
  parameters: {
    docs: {
      description: {
        component:
          "Une action dans l'onglet *Actions* du panneau d'une conversation : une ligne de 36 px (44 au doigt). L'icône de nature et son point d'état, le libellé, la phrase d'état — ambre à relire, rouge en échec —, et le geste principal en petit à droite : *Relire*, l'interrupteur d'un service (↗ quand il tourne avec un lien), ▷ d'une commande ou d'un agent, son terminal ou sa session quand elle tourne. La ligne entière ouvre le détail, en pile.",
      },
    },
  },
  args: { item: STATES[0]!, where: 'here', handlers },
} satisfies Meta<typeof ActionLine>

export default meta
type Story = StoryObj<typeof meta>

/** Un état par ligne : service en marche ou arrêté, réussie, en échec, jamais lancée, dans un terminal, à relire, agents. */
export const Etats: Story = {
  render: (args) => (
    <ul className="surface flex w-[30rem] flex-col border border-line">
      {STATES.map((item) => (
        <ActionLine key={item.id} {...args} item={item} />
      ))}
    </ul>
  ),
}

/** Dans un panneau étroit : la phrase d'état se tronque avant le libellé. */
export const Etroit: Story = {
  render: (args) => (
    <ul className="surface flex w-[18rem] flex-col border border-line">
      {STATES.map((item) => (
        <ActionLine key={item.id} {...args} item={item} />
      ))}
    </ul>
  ),
}
