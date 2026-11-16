import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { JournalEntryDto, ProjectDto } from '@solera/protocol'
import { verdictOf, type TreeFields, type TreeSession } from '../../lib/code-model'
import type { JournalDay } from '../../lib/journal'
import type { WorkTree } from '../../lib/portfolio-work'
import { ProjectGroupHeader } from '../places/ProjectPip'
import { PortfolioCleanHost } from './PortfolioClean'
import { WorkFolded, WorkMoments, WorkTreeList } from './PortfolioWork'

const HOUR = 3_600_000
const NOW = Date.now()

const nimbus = { id: 'p-nimbus', name: 'Nimbus', image: null, color: '#5B9DF9' } as ProjectDto
const atlas = { id: 'p-atlas', name: 'Atlas', image: null, color: '#E0A43B' } as ProjectDto

const session = (id: string, tone: TreeSession['tone'], agent: TreeSession['agent'] = 'claude'): TreeSession => ({ id, title: id, agent, tone })

function tree(project: ProjectDto, key: string, over: Partial<TreeFields>): WorkTree<ProjectDto> {
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
    ahead: 3,
    behind: 0,
    uncommitted: 0,
    conflicts: false,
    unmergedCommits: true,
    sizeBytes: 412_000_000,
    lastUsedAt: NOW - 2 * HOUR,
    ...over,
  }
  return { ...fields, ...verdictOf(fields, NOW), project }
}

const card = (number: number, title: string, milestone: number | null = null) => ({
  id: `c${number}`,
  number,
  title,
  milestone: milestone ? { id: `m${milestone}`, number: milestone, title: 'Page projet v2' } : null,
  source: 'name' as const,
})

const NIMBUS = [
  tree(nimbus, 'root', { root: true, id: null, state: 'root', branch: 'main', uncommitted: 3, ahead: 0, sizeBytes: 1_800_000_000 }),
  tree(nimbus, 'feat/905-vue-horizon', { sessions: [session('s2', 'awaiting', 'codex')], card: card(905, 'Graphe de dépendances', 901), uncommitted: 6 }),
  tree(nimbus, 'feat/903-schema-des-jalons', { sessions: [session('s1', 'running')], card: card(903, 'Bloc « Le code en cours »', 901), pr: { number: 212, url: null, state: 'checks' } }),
  tree(nimbus, 'fix/911-gantt-largeur', { pr: { number: 209, url: null, state: 'ready' }, behind: 4 }),
]
const ATLAS = [
  tree(atlas, 'root', { root: true, id: null, state: 'root', branch: 'main', ahead: 0, sizeBytes: 640_000_000 }),
  tree(atlas, 'feat/12-export-pdf', { sessions: [session('s3', 'running', 'grok')], pr: { number: 41, url: null, state: 'draft' }, sizeBytes: null }),
]
const MERGED = [
  tree(nimbus, 'feat/880-ancien-portail', { state: 'merged', unmergedCommits: false, ahead: 0, pr: { number: 180, url: null, state: 'merged' }, lastUsedAt: NOW - 9 * 24 * HOUR }),
  tree(nimbus, 'feat/882-menu', { state: 'merged', unmergedCommits: false, ahead: 0, lastUsedAt: NOW - 6 * 24 * HOUR, sizeBytes: 380_000_000 }),
]
const OFFERS = [{ project: nimbus, base: 'main', request: { trees: MERGED, branches: [] }, count: MERGED.length }]

const page: Decorator = (Story) => (
  <PortfolioCleanHost>
    <div className="w-[64rem] max-w-full">
      <Story />
    </div>
  </PortfolioCleanHost>
)

function Demo({ mode }: { mode: 'group' | 'table' | 'moment' }) {
  if (mode === 'table') {
    return (
      <section className="flex flex-col">
        <WorkTreeList trees={[...NIMBUS, ...ATLAS]} mode="table" />
        <WorkFolded trees={MERGED} offers={OFFERS} />
      </section>
    )
  }
  if (mode === 'moment') return <WorkMoments days={DAYS} projects={new Map([nimbus, atlas].map((project) => [project.id, project]))} />
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <ProjectGroupHeader project={nimbus} count={3} aside={<span className="text-xs text-ink-faint">2 branches sans arbre</span>} />
        <WorkTreeList trees={NIMBUS} mode="group" />
        <WorkFolded trees={MERGED} offers={OFFERS} />
      </section>
      <section className="flex flex-col gap-1">
        <ProjectGroupHeader project={atlas} count={1} />
        <WorkTreeList trees={ATLAS} mode="group" />
      </section>
    </div>
  )
}

const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0)
const entry = (id: string, kind: JournalEntryDto['kind'], title: string, hoursAgo: number, projectId: string): JournalEntryDto =>
  ({ id, kind, title, at: NOW - hoursAgo * HOUR, projectId, cardNumber: null, conversationId: null, source: null }) as JournalEntryDto
const ENTRIES = [
  entry('e1', 'branch', 'feat/902-maturite fusionnée dans jalon/901', 1, nimbus.id),
  entry('e2', 'session', 'Export PDF : session ouverte', 3, atlas.id),
  entry('e3', 'cardClosed', '#899 Schéma des jalons', 28, nimbus.id),
  entry('e4', 'note', 'Décision : la maturité remplace les phases', 30, nimbus.id),
]
const DAYS: JournalDay[] = [...new Set(ENTRIES.map((row) => midnight(row.at)))].map((at) => ({
  at,
  entries: ENTRIES.filter((row) => midnight(row.at) === at),
}))

const meta = {
  title: "Composants d'application/Portefeuille · Travail",
  component: Demo,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Les pièces de Travail au portefeuille (`coque.md` PF-17 à PF-21). **Par projet** : un groupe par projet, ses arbres en table bordée, les fusionnés repliés dessous (« N arbres fusionnés · taille · rien à perdre — Nettoyer »). **Tableau** : une seule table, colonne Projet, en-têtes à partir de `md` ; au téléphone la ligne s'empile. Une ligne est un lien vers l'arbre dans Travail de son projet (`?arbre=`). **Par moment** : le fil de tous les projets, par jour, chaque ligne avec son projet.",
      },
    },
  },
  args: { mode: 'group' },
  decorators: [page],
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const ParProjet: Story = { name: 'Par projet' }

export const Tableau: Story = { args: { mode: 'table' } }

export const ParMoment: Story = { name: 'Par moment', args: { mode: 'moment' } }
