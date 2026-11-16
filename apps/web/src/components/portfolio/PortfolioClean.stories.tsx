import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ProjectDto } from '@solera/protocol'
import { verdictOf, type TreeFields, type TreeRow } from '../../lib/code-model'
import { PortfolioCleanButton, PortfolioCleanHost } from './PortfolioClean'

const NOW = Date.now()

const nimbus = { id: 'p-nimbus', name: 'Nimbus', image: null, color: '#5B9DF9' } as ProjectDto
const atlas = { id: 'p-atlas', name: 'Atlas', image: null, color: '#E0A43B' } as ProjectDto

function merged(key: string): TreeRow {
  const fields: TreeFields = {
    key,
    root: false,
    id: key,
    name: key,
    branch: key,
    path: `.worktrees/${key}`,
    external: false,
    state: 'merged',
    sessions: [],
    anySessionId: null,
    card: null,
    pr: null,
    ahead: 0,
    behind: 0,
    uncommitted: 0,
    conflicts: false,
    unmergedCommits: false,
    sizeBytes: 380_000_000,
    lastUsedAt: NOW - 86_400_000,
  }
  return { ...fields, ...verdictOf(fields, NOW) }
}

const NIMBUS = { project: nimbus, base: 'main', request: { trees: [merged('feat/880-ancien-portail')], branches: ['feat/870-menu'] }, count: 2 }
const ATLAS = { project: atlas, base: 'main', request: { trees: [merged('feat/9-import-csv')], branches: [] }, count: 1 }

const host: Decorator = (Story) => (
  <PortfolioCleanHost>
    <div className="flex justify-end">
      <Story />
    </div>
  </PortfolioCleanHost>
)

const meta = {
  title: "Composants d'application/Portefeuille · Nettoyer",
  component: PortfolioCleanButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "« Nettoyer · N » de Travail au portefeuille (PF-20). Le nettoyage se fait **projet par projet**, par le dialogue de Travail (`CleanDialog`), qui lit le plan du serveur pour chaque arbre. Un seul projet concerné : le dialogue s'ouvre. Plusieurs : un menu les nomme d'abord, chacun avec ce qu'il retire. Le compte réunit les arbres fusionnés et les branches fusionnées locales, comme dans un projet.",
      },
    },
  },
  args: { offers: [NIMBUS] },
  decorators: [host],
} satisfies Meta<typeof PortfolioCleanButton>

export default meta
type Story = StoryObj<typeof meta>

/** Un projet : le bouton ouvre son dialogue (sans serveur ici, son plan reste à lire). */
export const UnProjet: Story = { name: 'Un projet' }

/** Deux projets : le bouton ouvre le menu qui les nomme. */
export const PlusieursProjets: Story = { name: 'Plusieurs projets', args: { offers: [NIMBUS, ATLAS] } }
