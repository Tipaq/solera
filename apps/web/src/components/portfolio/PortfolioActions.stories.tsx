import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ProjectDto } from '@solera/protocol'
import type { Automation } from '../../lib/automations'
import { runningNow } from '../../lib/portfolio-actions'
import type { SessionWork } from '../../lib/session-works'
import { AGENT, AGENT_RUNNING, FAILED, IN_TERMINAL, NEVER, PROPOSED, SERVICE_ON, SERVICE_SCHEDULED, SUCCEEDED } from '../automations/automation-fixtures'
import { PortfolioActionsList, PortfolioRunningNow } from './PortfolioActions'

const nimbus = { id: 'p-nimbus', name: 'Nimbus', image: null, color: '#5B9DF9' } as ProjectDto
const atlas = { id: 'p-atlas', name: 'Atlas API', image: null, color: '#E0A43B' } as ProjectDto
const PROJECTS = new Map([nimbus, atlas].map((project) => [project.id, project]))
const projectOf = (id: string) => PROJECTS.get(id)

const inAtlas = (item: Automation): Automation => ({ ...item, id: `${item.id}-atlas`, projectId: atlas.id })
const ITEMS: Automation[] = [SERVICE_ON, PROPOSED, SUCCEEDED, AGENT, inAtlas(SERVICE_SCHEDULED), inAtlas(AGENT_RUNNING), inAtlas(FAILED), inAtlas(NEVER), inAtlas(IN_TERMINAL)]

const VITE: SessionWork = {
  id: 'w-vite',
  conversationId: 'c1',
  conversationTitle: 'Refonte du panier',
  agent: 'claude',
  family: 'shell',
  description: null,
  command: 'pnpm vite --port 5418',
  startedAt: Date.now() - 40 * 60_000,
  port: 5418,
  cpu: null,
  memoryBytes: null,
  stop: null,
}
const WORKS = new Map([[nimbus.id, [VITE]]])
const ignore = () => {}

const frame: Decorator = (Story) => (
  <div className="w-[64rem] max-w-full border border-line">
    <Story />
  </div>
)

const meta = {
  title: "Composants d'application/Portefeuille/Actions",
  component: PortfolioActionsList,
  decorators: [frame],
  args: { items: ITEMS, projectOf, onOpen: ignore },
  parameters: {
    docs: {
      description: {
        component:
          "Les Actions du portefeuille : en tête **Tourne maintenant, tous projets** (une pastille par action en marche ou processus laissé par une session, avec son projet, et le lien vers la page Services), puis la **Liste** : projet, libellé et commande ou prompt, nature, état — à relire en ambre, ce qui tourne en vert. Un clic mène à l'onglet Actions du projet. Le Lanceur, lui, reprend celui d'un projet, groupe par groupe.",
      },
    },
  },
} satisfies Meta<typeof PortfolioActionsList>

export default meta
type Story = StoryObj<typeof meta>

/** Ce qui tourne sur l'instance, puis la Liste de tous les projets. */
export const Liste: Story = {
  render: (args) => (
    <>
      <PortfolioRunningNow entries={runningNow(ITEMS, WORKS, [nimbus.id, atlas.id])} projectOf={projectOf} onOpen={ignore} />
      <PortfolioActionsList {...args} />
    </>
  ),
}

/** Au téléphone : le projet passe au-dessus du libellé, la nature se tait. */
export const Telephone: Story = {
  name: 'Téléphone',
  decorators: [(Story) => <div className="w-[24rem]"><Story /></div>],
  render: Liste.render,
}
