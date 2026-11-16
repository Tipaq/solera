import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { JournalEntryDto, JournalKind } from '@solera/protocol'
import { sessionBars, timelineWindow, type BarFacts } from '../../lib/activity-timeline'
import { verdictOf, type BranchInfo, type TreeFields, type TreeRow } from '../../lib/code-model'
import { ActivityTimeline, type TimelineTree } from './ActivityTimeline'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.now()
const FRAME = timelineWindow(null, NOW)

function tree(branch: string, over: Partial<TreeFields> = {}): TreeRow {
  const fields: TreeFields = {
    key: `/wt/${branch}`, root: false, id: branch, name: branch, branch, path: `/wt/${branch}`, external: false, state: 'unmerged', sessions: [],
    anySessionId: null, card: null, pr: null, ahead: 2, behind: 0, uncommitted: 0, conflicts: false, unmergedCommits: true,
    sizeBytes: null, lastUsedAt: NOW - HOUR, ...over,
  }
  return { ...fields, ...verdictOf(fields, NOW) }
}

const bar = (id: string, group: BarFacts['group'], startAgo: number, endAgo: number, agent: BarFacts['agent'] = 'claude'): BarFacts => ({
  id, title: `Session ${id}`, agent, group, createdAt: NOW - startAgo, updatedAt: NOW - endAgo,
})

let next = 0
const event = (kind: JournalKind, ago: number, title: string): JournalEntryDto => {
  next += 1
  return { id: `e${next}`, kind, at: NOW - ago, title, projectId: 'p1', cardNumber: null, source: null, count: null, status: null, conversationId: null }
}

const TREES: TimelineTree[] = [
  {
    tree: tree('feat/906-compat-format', { sessions: [{ id: 'a', title: 'Compat', agent: 'claude', tone: 'awaiting' }] }),
    bars: sessionBars([bar('a', 'asking', 30 * HOUR, 0)], FRAME, NOW),
    events: [event('cardOpened', 34 * HOUR, 'Carte #906 ouverte'), event('session', 30 * HOUR, 'Session lancée'), event('branch', 2 * HOUR, '2 commits poussés')],
  },
  {
    tree: tree('main', { root: true, id: null, state: 'root', key: 'root' }),
    bars: sessionBars([bar('b', 'running', 26 * HOUR, 0)], FRAME, NOW),
    events: [],
  },
  {
    tree: tree('feat/907-vagues', { sessions: [{ id: 'c', title: 'Vagues', agent: 'codex', tone: 'running' }] }),
    bars: sessionBars([bar('c', 'running', 28 * HOUR, 0, 'codex'), bar('d', 'done', 3 * DAY, 2 * DAY)], FRAME, NOW),
    events: [event('note', 50 * HOUR, 'Décision : vagues de trois'), event('cardClosed', 3 * HOUR, 'Carte #907 fermée')],
  },
  {
    tree: tree('feat/912-reglages', { pr: { number: 126, url: null, state: 'ready' }, lastUsedAt: NOW - DAY }),
    bars: sessionBars([bar('e', 'done', 4 * DAY, DAY)], FRAME, NOW),
    events: [event('run', 5 * DAY, 'Tâche du matin'), event('audit', 20 * HOUR, 'Audit versé')],
  },
]

const BRANCHES: BranchInfo[] = [
  {
    key: 'branche:feat/908-actions-hub', name: 'feat/908-actions-hub', kind: 'pr', merged: false, remoteOnly: false, lastCommitAt: NOW - 8 * HOUR, ahead: 3, behind: 0,
    commits: [
      { hash: 'a1', shortHash: 'a1', title: 'Le hub des actions', at: NOW - 30 * HOUR },
      { hash: 'a2', shortHash: 'a2', title: 'Ses tests', at: NOW - 20 * HOUR },
      { hash: 'a3', shortHash: 'a3', title: 'Retours de relecture', at: NOW - 8 * HOUR },
    ],
    pr: { number: 151, url: 'https://github.com/o/r/pull/151', state: 'checks', title: 'Actions' }, card: null,
  },
  { key: 'branche:spike/vieux', name: 'spike/vieux', kind: 'unmerged', merged: false, remoteOnly: false, lastCommitAt: NOW - 40 * DAY, ahead: 1, behind: 30, commits: [], pr: null, card: null },
]

function Frise() {
  const [target, setTarget] = useState<string | null>(null)
  return (
    <div className="h-[36rem] overflow-y-auto p-6">
      <ActivityTimeline projectId="p1" frame={FRAME} trees={TREES} branches={BRANCHES} targetKey={target} onSelect={setTarget} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/La Frise de Travail",
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La Frise de Travail (T-9) : une rangée par arbre puis par branche sans arbre, sur les sept derniers jours ou la période de « Filtrer ». Les sessions en barres, les événements en points, les commits en losanges ; un clic sur une étiquette choisit l'arbre.",
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Une session qui t'attend, deux qui tournent, des finies ; une branche avec PR et une vieille branche. */
export const Semaine: Story = { name: 'Sept jours', render: () => <Frise /> }
