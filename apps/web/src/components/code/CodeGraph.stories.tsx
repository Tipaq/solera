import type { Meta, StoryObj } from '@storybook/react-vite'
import type { PullRequestBadgeState } from '@solera/protocol'
import { liveTrees, orderLines, verdictOf, type TreeFields, type TreeRow, type TreeSession } from '../../lib/code-model'
import { CodeGraph } from './CodeGraph'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.now()
const MILESTONE = { id: 'k164', number: 164, title: 'Page projet v2 · 2 — Aperçu, Travail, Tableau' }

const session = (id: string, tone: TreeSession['tone'], agent: TreeSession['agent'] = 'claude'): TreeSession => ({ id, title: `Session ${id}`, agent, tone })
const pr = (number: number, state: PullRequestBadgeState) => ({ number, url: `https://github.com/o/r/pull/${number}`, state })
const card = (number: number, title: string) => ({ id: `k${number}`, number, title, milestone: MILESTONE, source: 'session' as const })

function tree(key: string, over: Partial<TreeFields>): TreeRow {
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
  return { ...fields, ...verdictOf(fields, NOW) }
}

/** Les arbres du jeu de démo du prototype : un par statut de ligne (A-4.3), plus deux à nettoyer. */
const TREES: TreeRow[] = [
  tree('root', { root: true, id: null, name: 'main', branch: 'main', state: 'root', ahead: 0, uncommitted: 3, sessions: [session('r', 'running')] }),
  tree('feat/906-compat-format', { state: 'dirty', uncommitted: 6, ahead: 4, sessions: [session('906', 'awaiting'), session('906b', 'running', 'codex')], card: card(906, 'Format de compat des sessions') }),
  tree('feat/907-vagues', { pr: pr(131, 'checks'), ahead: 7, uncommitted: 2, sessions: [session('907', 'running', 'codex')], card: card(907, 'Vagues du jalon') }),
  tree('fix/911-gantt-largeur', { pr: pr(209, 'ready'), ahead: 1, behind: 3, card: card(911, 'Gantt pleine largeur'), lastUsedAt: NOW - 3 * HOUR }),
  tree('feat/912-erreur', { sessions: [session('912', 'broken')], ahead: 2, behind: 1 }),
  tree('spike/terminal-wasm', { ahead: 3, behind: 58, uncommitted: 1, conflicts: true, lastUsedAt: NOW - 4 * DAY }),
  tree('feat/904-ci', { pr: pr(128, 'failing'), ahead: 5, behind: 2, lastUsedAt: NOW - 5 * HOUR }),
  tree('fix/865-titre-tronque', { state: 'dirty', pr: pr(108, 'merged'), ahead: 0, behind: 40, uncommitted: 4, unmergedCommits: false }),
  tree('feat/880-acces-distant', { state: 'merged', pr: pr(119, 'merged'), ahead: 0, behind: 14, unmergedCommits: false }),
  tree('feat/850-ancienne', { state: 'missing', ahead: 0, unmergedCommits: false }),
]

const meta: Meta<typeof CodeGraph> = {
  title: "Composants d'application/Aperçu · Code en cours",
  component: CodeGraph,
  parameters: {
    docs: {
      description: {
        component:
          "« Code en cours » de l'Aperçu (`projet.md` A-4) : la branche par défaut en tronc, chaque arbre vivant en rameau, un point par statut ; un clic sur une ligne déplie ses gestes, une à la fois. Les arbres qui n'ont plus qu'à être nettoyés sont comptés sous le graphe.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof CodeGraph>

const { live, settled } = liveTrees(TREES)

/** Un arbre par statut, dans l'ordre de A-4.5 ; deux arbres fusionnés sans session comptés à part. */
export const Graphe: Story = {
  args: { projectId: 'p1', lines: orderLines(live), settled, base: 'main' },
}

/** La racine seule : rien ne part d'elle. */
export const RacineSeule: Story = {
  args: { projectId: 'p1', lines: [TREES[0]!], settled: 0, base: 'main' },
}

/** Pas de dépôt git, ou rien en cours (A-4.1). */
export const Vide: Story = {
  args: { projectId: 'p1', lines: [], settled: 0, base: null },
}
