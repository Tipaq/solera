import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { verdictOf, type BranchInfo, type TreeFields, type TreeRow } from '../../lib/code-model'
import { indexTrees } from '../../lib/travail-model'
import { TravailIndex } from './TravailIndex'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MB = 1024 * 1024
const NOW = Date.now()

function tree(key: string, over: Partial<TreeFields>): TreeRow {
  const fields: TreeFields = {
    key, root: false, id: key, name: key, branch: key, path: `.worktrees/${key}`, external: false, state: 'unmerged', sessions: [],
    anySessionId: null, card: null, pr: null, ahead: 2, behind: 1, uncommitted: 0, conflicts: false, unmergedCommits: true,
    sizeBytes: 640 * MB, lastUsedAt: NOW - 2 * HOUR, ...over,
  }
  return { ...fields, ...verdictOf(fields, NOW) }
}

const TREES = indexTrees(
  [
    tree('root', { root: true, id: null, name: 'main', branch: 'main', state: 'root', ahead: 0, behind: 0, sizeBytes: 1480 * MB, lastUsedAt: NOW - DAY }),
    tree('feat/175-travail', { sessions: [{ id: 's1', title: 'Travail', agent: 'claude', tone: 'awaiting' }], lastUsedAt: NOW - 3 * HOUR }),
    tree('feat/178-graphe', { sessions: [{ id: 's2', title: 'Graphe', agent: 'codex', tone: 'running' }], lastUsedAt: NOW - HOUR }),
    tree('feat/162-barre', { pr: { number: 140, url: null, state: 'ready' }, lastUsedAt: NOW - 5 * HOUR }),
    tree('spike/terminal', { lastUsedAt: NOW - 30 * DAY, sizeBytes: null }),
    tree('feat/160-coque', { state: 'merged', ahead: 0, unmergedCommits: false }),
  ],
  false,
)

const BRANCHES: BranchInfo[] = [
  {
    key: 'branche:feat/181-liste', name: 'feat/181-liste', kind: 'pr', merged: false, remoteOnly: false, lastCommitAt: NOW - 6 * HOUR, ahead: 3, behind: 0, commits: [],
    pr: { number: 151, url: 'https://github.com/o/r/pull/151', state: 'checks', title: 'Liste' },
    card: { id: 'k181', number: 181, title: 'Tableau : vues Liste et Par geste', milestone: { id: 'k164', number: 164, title: 'Page projet v2 · 2' }, source: 'name' },
  },
  { key: 'branche:origin/essai', name: 'origin/essai', kind: 'remote', merged: false, remoteOnly: true, lastCommitAt: NOW - 4 * DAY, ahead: 1, behind: 12, commits: [], pr: null, card: null },
]

function Interactive({ mode }: { mode: 'filter' | 'scroll' }) {
  const [current, setCurrent] = useState<string | null>(null)
  return (
    <div className="w-[17rem] border-r border-line">
      <TravailIndex trees={TREES} branches={BRANCHES} current={current} onChoose={setCurrent} mode={mode} project={mode === 'scroll'} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/L'index des arbres",
  parameters: {
    docs: {
      description: {
        component:
          "L'index de Travail (T-3) : les arbres actifs, ce qui t'attend d'abord, puis les branches sans arbre. En « Par moment », un clic filtre le fil ; en « Par arbre », il fait défiler jusqu'au couloir.",
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Par moment : un clic restreint le fil, l'élément choisi reste surligné. */
export const Filtre: Story = { name: 'En filtre', render: () => <Interactive mode="filter" /> }

/** Par arbre : un clic fait défiler, et la ligne « Projet » s'ajoute. */
export const Defilement: Story = { name: 'En défilement', render: () => <Interactive mode="scroll" /> }
