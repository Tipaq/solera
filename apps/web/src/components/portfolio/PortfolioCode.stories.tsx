import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ProjectDto } from '@solera/protocol'
import { verdictOf, type TreeFields, type TreeSession } from '../../lib/code-model'
import type { PortfolioTree } from '../../lib/portfolio-overview'
import { PortfolioCode } from './PortfolioCode'

const HOUR = 3_600_000
const NOW = Date.now()

const nimbus = { id: 'p-nimbus', name: 'Nimbus', image: null, color: '#5B9DF9' } as ProjectDto
const atlas = { id: 'p-atlas', name: 'Atlas', image: null, color: '#E0A43B' } as ProjectDto

const session = (id: string, tone: TreeSession['tone'], agent: TreeSession['agent'] = 'claude'): TreeSession => ({ id, title: id, agent, tone })

function tree(project: ProjectDto, key: string, over: Partial<TreeFields>): PortfolioTree {
  const fields: TreeFields = {
    key,
    root: false,
    id: key,
    name: key,
    branch: key,
    path: `.worktrees/${key}`,
    external: false,
    state: 'unmerged',
    sessions: [],
    anySessionId: null,
    card: null,
    pr: null,
    ahead: 2,
    behind: 0,
    uncommitted: 0,
    conflicts: false,
    unmergedCommits: true,
    sizeBytes: null,
    lastUsedAt: NOW - 2 * HOUR,
    ...over,
  }
  return { ...fields, ...verdictOf(fields, NOW), project }
}

const card = (number: number, title: string) => ({ id: `c${number}`, number, title, milestone: null, source: 'name' as const })

const TREES: PortfolioTree[] = [
  tree(nimbus, 'feat/903-schema-des-jalons', { sessions: [session('s1', 'running')], card: card(903, 'Bloc « Le code en cours »'), pr: { number: 212, url: null, state: 'checks' } }),
  tree(nimbus, 'feat/905-vue-horizon', { sessions: [session('s2', 'awaiting', 'codex')], card: card(905, 'Graphe de dépendances'), uncommitted: 6 }),
  tree(atlas, 'feat/12-export-pdf', { sessions: [session('s3', 'running', 'grok')], pr: { number: 41, url: null, state: 'draft' } }),
  tree(nimbus, 'root', { root: true, state: 'root', branch: 'main', uncommitted: 3, id: null }),
  tree(nimbus, 'fix/911-gantt-largeur', { pr: { number: 209, url: null, state: 'ready' } }),
  tree(atlas, 'feat/9-import-csv', { lastUsedAt: NOW - 21 * 24 * HOUR }),
]

/** La colonne de gauche de l'Aperçu, à partir de `xl`. */
const column: Decorator = (Story) => <div className="w-[40rem] max-w-full"><Story /></div>

const meta = {
  title: "Composants d'application/Portefeuille · Code en cours",
  component: PortfolioCode,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "« Code en cours » à l'Aperçu du portefeuille (`coque.md` PF-11) : les arbres actifs de tous les projets, douze au plus, le titre comptant tous les autres. Une ligne par arbre — verdict, projet, branche, raison et carte, agents vivants, PR — qui ouvre l'arbre dans Travail de son projet. Une liste et non le graphe d'un projet : des dépôts mêlés n'ont pas de base commune.",
      },
    },
  },
  args: { trees: TREES },
  decorators: [column],
} satisfies Meta<typeof PortfolioCode>

export default meta
type Story = StoryObj<typeof meta>

export const Arbres: Story = { name: 'Arbres de deux projets' }

export const Vide: Story = { name: 'Rien ne tourne', args: { trees: [] } }
