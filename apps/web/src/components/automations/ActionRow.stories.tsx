import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { sectionsOf } from '../../lib/actions-tab'
import type { Section } from '../../lib/automations'
import { ActionRow, ActionSection } from './ActionRow'
import type { TileHandlers } from './ActionTile'
import { AGENT, FAIL_STREAK, SERVICE_SCHEDULED, STATES, SeededWorktrees } from './automation-fixtures'

const ignore = () => {}
const HANDLERS: TileHandlers = {
  onOpen: ignore,
  onEdit: ignore,
  onLaunch: ignore,
  onToggle: ignore,
  onService: ignore,
  onTerminal: ignore,
  onDuplicate: ignore,
  onDelete: ignore,
}
const withWorktrees: Decorator = (Story) => <SeededWorktrees><Story /></SeededWorktrees>

const TITLES: Record<Section, { title: string; hint: string }> = {
  live: { title: 'En cours', hint: 'Ce qui tourne maintenant : services, commandes dans un terminal, passages d’agent.' },
  review: { title: 'À relire', hint: 'Écrites ou modifiées par un agent : elles ne partent pas d’un clic avant ta relecture.' },
  scheduled: { title: 'Planifiées', hint: 'Elles partent seules, à leur cadence.' },
  demand: { title: 'À la demande', hint: 'Un clic, ou un agent par run_action. « Planifier » leur donne une cadence.' },
}

function List() {
  const sections = sectionsOf([...STATES, SERVICE_SCHEDULED, { ...FAIL_STREAK, schedule: AGENT.schedule }])
  return (
    <div className="flex flex-col gap-7">
      {(['live', 'review', 'scheduled', 'demand'] as const).map((key) => (
        <ActionSection key={key} title={TITLES[key].title} hint={TITLES[key].hint} count={sections[key].length} tone={key === 'review' ? 'caution' : undefined}>
          {sections[key].map((item) => (
            <ActionRow key={item.id} item={item} section={key} served={null} handlers={HANDLERS} />
          ))}
        </ActionSection>
      ))}
    </div>
  )
}

const meta = {
  title: "Composants d'application/Actions/Ligne de la Liste",
  component: ActionRow,
  decorators: [withWorktrees],
  args: { item: AGENT, section: 'scheduled', served: null, handlers: HANDLERS },
  parameters: {
    docs: {
      description: {
        component:
          "La **Liste** de l'onglet Actions, par état : En cours, À relire, Planifiées, À la demande, chaque action dans une seule section. Une ligne dit sa nature, son libellé et sa puce, ce qu'elle fait ou sert ; à droite, les gestes de sa section — « Ouvrir ↗ » et « Arrêter » d'un service, « Relire », la cadence, l'échéance et les dix derniers passages d'une planifiée, « Planifier » et « Lancer ▾ » d'une action à la demande.",
      },
    },
  },
  render: (args) => (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      <ActionRow {...args} />
    </ul>
  ),
} satisfies Meta<typeof ActionRow>

export default meta
type Story = StoryObj<typeof meta>

/** Toutes les sections. */
export const Liste: Story = { name: 'Liste', render: () => <List /> }

/** Une planifiée : cadence, échéance, passages. */
export const Planifiee: Story = { name: 'Planifiée' }

/** Étroit : chaque ligne tronque, les gestes restent à droite. */
export const Telephone: Story = {
  name: 'Téléphone',
  render: () => (
    <div className="w-[22rem]">
      <List />
    </div>
  ),
}
