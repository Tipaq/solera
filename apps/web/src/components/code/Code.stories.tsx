import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { PullRequestBadgeState } from '@solera/protocol'
import {
  sortTrees,
  verdictOf,
  type BranchKind,
  type TreeFields,
  type TreeRow,
  type TreeSession,
} from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import { BaseLine } from './BaseLine'
import { Drift } from './Drift'
import { MilestoneChip } from './MilestoneChip'
import { PrTag } from './PrTag'
import { SessionStack } from './SessionStack'
import { TreeChip } from './TreeChip'
import { TreeFacts } from './TreeFacts'
import { BranchDot, VerdictDot, verdictLabel, verdictReason } from './VerdictDot'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MB = 1024 * 1024
const NOW = Date.now()

const session = (id: string, tone: TreeSession['tone'], agent: TreeSession['agent'] = 'claude'): TreeSession => ({ id, title: `Session ${id}`, agent, tone })
const pr = (number: number, state: PullRequestBadgeState) => ({ number, url: `https://github.com/o/r/pull/${number}`, state })

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
    behind: 1,
    uncommitted: 0,
    conflicts: false,
    unmergedCommits: true,
    sizeBytes: null,
    lastUsedAt: NOW - 2 * HOUR,
    ...over,
  }
  return { ...fields, ...verdictOf(fields, NOW) }
}

/** Un arbre par verdict, dans l'ordre d'affichage : celui du jeu de démo du prototype. */
const TREES: TreeRow[] = sortTrees([
  tree('root', { root: true, id: null, name: 'main', branch: 'main', state: 'root', uncommitted: 3, ahead: 0, behind: 0, sessions: [session('r', 'running')], sizeBytes: 1480 * MB }),
  tree('feat/906-compat-format', { state: 'dirty', uncommitted: 6, ahead: 4, sessions: [session('906', 'awaiting')], sizeBytes: 820 * MB }),
  tree('feat/907-vagues', { pr: pr(131, 'checks'), ahead: 7, behind: 0, uncommitted: 2, sessions: [session('907', 'running', 'codex')], sizeBytes: 760 * MB }),
  tree('feat/904-tiroir', { pr: pr(128, 'ready'), ahead: 5, behind: 2, sizeBytes: 690 * MB }),
  tree('fix/865-titre-tronque', { state: 'dirty', pr: pr(108, 'merged'), ahead: 0, behind: 40, uncommitted: 4, unmergedCommits: false }),
  tree('spike/terminal-wasm', { ahead: 3, behind: 58, uncommitted: 1, conflicts: true, lastUsedAt: NOW - 37 * DAY }),
  tree('essai-vite', { id: null, external: true, ahead: 1, behind: 3, lastUsedAt: NOW - 4 * DAY }),
  tree('feat/923-cycle', { state: 'empty', ahead: 0, behind: 0, unmergedCommits: false }),
  tree('feat/880-acces-distant', { state: 'merged', pr: pr(119, 'merged'), ahead: 0, behind: 14, unmergedCommits: false, sizeBytes: 1120 * MB }),
  tree('feat/850-ancienne', { state: 'missing', ahead: 0, behind: 0, unmergedCommits: false }),
])

function Verdicts() {
  const t = useTranslate()
  return (
    <ul className="flex flex-col gap-2">
      {TREES.map((row) => (
        <li key={row.key} className="flex min-w-0 items-start gap-2.5">
          <VerdictDot verdict={row.verdict} className="mt-1.5" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-ink">{row.branch}</span>
              <span className="text-xs font-medium text-ink-soft">{verdictLabel(t, row.verdict)}</span>
            </span>
            <span className="text-xs text-ink-soft">{verdictReason(t, row.reason)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function Branches() {
  const t = useTranslate()
  const kinds: BranchKind[] = ['pr', 'unmerged', 'remote', 'merged']
  return (
    <ul className="flex flex-col gap-2">
      {kinds.map((kind) => (
        <li key={kind} className="flex items-center gap-2.5">
          <BranchDot kind={kind} />
          <GitBranch size={13} className="text-ink-faint" />
          <span className="text-xs text-ink-soft">{t(`code.branchKind.${kind}`)}</span>
        </li>
      ))}
    </ul>
  )
}

function Chips() {
  const [active, setActive] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap gap-2">
      {TREES.map((row) => (
        <TreeChip key={row.key} tree={row} active={active === row.key} onSelect={(key) => setActive((current) => (current === key ? null : key))} />
      ))}
    </div>
  )
}

const meta = {
  title: "Composants d'application/Code",
  parameters: {
    docs: {
      description: {
        component:
          "Les briques du modèle « Code » (`lib/code-model.ts`), partagées par l'Aperçu, Travail et le portefeuille : la couleur ne sert qu'au point d'état, la phrase reste à l'encre secondaire, et ce qui a l'air cliquable fait quelque chose.",
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Les dix verdicts d'un arbre (T-10.1, T-10.2), dans l'ordre d'affichage. */
export const Verdicts_: Story = {
  name: 'Verdicts',
  render: () => <Verdicts />,
}

/** Les quatre genres d'une branche sans arbre (T-10.3). */
export const GenresDeBranche: Story = {
  name: 'Genres de branche',
  render: () => <Branches />,
}

/** Les cinq états de PR (T-10.4), et l'absence de PR. */
export const Pr: Story = {
  name: 'PrTag',
  render: () => (
    <div className="flex flex-col gap-2">
      {(['draft', 'checks', 'failing', 'ready', 'merged'] as const).map((state) => (
        <PrTag key={state} pr={pr(120, state)} />
      ))}
      <PrTag pr={{ number: 108, url: null, state: 'merged' }} />
      <PrTag pr={null} />
    </div>
  ),
}

/** La dérive d'une branche : à jour, en avance, en retard (ambre au-delà de 2), sale, en conflit. */
export const Derive: Story = {
  name: 'Drift',
  render: () => (
    <div className="flex flex-col gap-2 text-xs text-ink-faint">
      <Drift ahead={0} behind={0} dirty={0} conflicts={false} />
      <Drift ahead={4} behind={1} dirty={0} conflicts={false} />
      <Drift ahead={7} behind={6} dirty={2} conflicts={false} />
      <Drift ahead={3} behind={58} dirty={1} conflicts />
    </div>
  ),
}

/** Les sessions vivantes d'un arbre : tourne, t'attend, en erreur, et « +N » au-delà de trois. */
export const Sessions: Story = {
  name: 'SessionStack',
  render: () => (
    <div className="flex flex-col gap-3">
      <SessionStack projectId="p1" sessions={[session('a', 'running'), session('b', 'awaiting', 'codex'), session('c', 'broken', 'grok')]} />
      <SessionStack projectId="p1" sessions={[session('a', 'running'), session('b', 'running', 'codex'), session('c', 'awaiting'), session('d', 'running', 'opencode')]} />
    </div>
  ),
}

/** Les faits d'un arbre en une ligne : PR, ↑↓ (↓ ambre au-delà de 20), non commités, taille si mesurée. */
export const Faits: Story = {
  name: 'TreeFacts',
  render: () => (
    <ul className="flex flex-col gap-2">
      {TREES.map((row) => (
        <li key={row.key} className="flex items-center gap-3">
          <span className="w-56 truncate font-mono text-xs text-ink">{row.branch}</span>
          <TreeFacts tree={row} />
        </li>
      ))}
    </ul>
  ),
}

/** La puce d'arbre d'une ligne du fil : un clic la surligne, comme le filtre qu'elle pose. */
export const Puces: Story = {
  name: 'TreeChip',
  render: () => <Chips />,
}

/** La ligne de base (T-2.1, T-2.2) : la racine sur la base, puis sortie ailleurs avec du non commité. */
export const Base: Story = {
  name: 'BaseLine',
  render: () => {
    const root = (branch: string, uncommitted: number) => tree('root', { root: true, id: null, branch, state: 'root', uncommitted })
    return (
      <div className="flex flex-col gap-3">
        <BaseLine code={{ base: 'main', trees: [root('main', 0)] }} />
        <BaseLine code={{ base: 'main', trees: [root('feat/repointage', 3)] }} />
        <BaseLine code={{ base: 'main', trees: [root('feat/repointage', 1)] }} />
      </div>
    )
  },
}

/** « ⚑ Jalon #n » : un lien quand on sait où mener, une étiquette sinon. */
export const Jalon: Story = {
  name: 'MilestoneChip',
  render: () => (
    <div className="flex items-center gap-3">
      <MilestoneChip milestone={{ number: 901, title: 'Page projet v2' }} to="/p/p1/timeline" />
      <MilestoneChip milestone={{ number: 901, title: 'Page projet v2' }} />
    </div>
  ),
}
