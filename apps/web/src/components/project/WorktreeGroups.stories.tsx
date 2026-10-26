import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ConversationDto, GitSummaryDto, WorktreeStatusDto, WorktreeStatusListDto } from '@solera/protocol'
import type { ActivityRow } from '../../lib/activity-rows'
import { WorktreeGroups } from './WorktreeGroups'

/**
 * L'Activité d'un projet de démonstration groupée par worktree, comme sur la planche B3 :
 * la racine, trois arbres habités, puis les arbres sans session et les branches libres.
 */
const PROJECT_ID = 'p-nimbus'
const now = Date.now()
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const ROOT = '/home/alex/.local/share/solera/worktrees/p-nimbus'

function tree(name: string, state: WorktreeStatusDto['state'], extra: Partial<WorktreeStatusDto> = {}): WorktreeStatusDto {
  return {
    id: `wt-${name}`, name, path: `${ROOT}/${name.replace(/\//g, '__')}`, branch: name, external: false, state,
    ahead: 0, behind: 0, modified: 0, untracked: 0, conflicts: false, unmergedCommits: false, head: null,
    lastCommitAt: null, lastEditAt: null, conversations: [], ...extra,
  }
}

/** Les champs que la ligne lit ; le reste du DTO n'y paraît pas. */
function conversation(id: string, title: string, ago: number, card: number | null): ConversationDto {
  return {
    id, projectId: PROJECT_ID, title, agent: 'claude', status: 'idle', archivedAt: null, updatedAt: now - ago,
    card: card === null ? null : { id: `card-${card}`, number: card, title: `Carte ${card}`, column: 'in_progress' },
  } as unknown as ConversationDto
}

function row(
  conv: ConversationDto,
  group: ActivityRow['group'],
  marker: ActivityRow['marker'],
  place: { tree?: WorktreeStatusDto },
  summary: ActivityRow['summary'] = null,
): ActivityRow {
  return {
    entry: { conversation: conv, status: conv.status, running: false, awaiting: false, unread: false, settledAt: conv.updatedAt, since: conv.updatedAt, seq: conv.lastNotableSeq },
    group,
    marker,
    summary,
    place: place.tree
      ? { root: false, branch: place.tree.branch, path: place.tree.path }
      : { root: true, branch: 'main', path: null },
    pr: null,
    request: null,
  }
}

const DESIGN = tree('design/page-projet', 'unmerged', { ahead: 0, conversations: [{ id: 'c-design', link: 'worktree' }] })
const SILLAGE = tree('feat/tri-sillage', 'dirty', { ahead: 4, modified: 7, unmergedCommits: true, conversations: [{ id: 'c-sillage', link: 'worktree' }] })
const VUE_GIT = tree('feat/vue-git-lot-3', 'unmerged', { ahead: 9, behind: 14, unmergedCommits: true, conversations: [{ id: 'c-git', link: 'worktree' }] })

const CONVERSATIONS = [
  conversation('c-flow', 'Flow de projet, cards et jalons', 50 * MINUTE, null),
  conversation('c-ds', 'Réutilisation du design system', 5 * 60 * MINUTE, null),
  conversation('c-design', 'Dessiner la page projet', 42 * MINUTE, 73),
  conversation('c-sillage', 'Tri des nouveautés de Sillage', 65 * MINUTE, 65),
  conversation('c-git', 'Vue Git, lot 3', 2 * 60 * MINUTE, 50),
  conversation('c-old', 'Onglet projet', 1 * DAY, 16),
]

const ROWS: ActivityRow[] = [
  row(CONVERSATIONS[2]!, 'asking', 'awaiting', { tree: DESIGN }, { text: 'Attend 3 min', tone: 'caution' }),
  row(CONVERSATIONS[3]!, 'asking', 'awaiting', { tree: SILLAGE }, { text: 'Attend 12 min', tone: 'caution' }),
  row(CONVERSATIONS[0]!, 'running', 'working', {}),
  row(CONVERSATIONS[4]!, 'asking', 'broken', { tree: VUE_GIT }, { text: 'Interrompue', tone: 'critical' }),
  row(CONVERSATIONS[1]!, 'done', 'quiet', {}),
]

const STATUS: WorktreeStatusListDto = {
  base: 'main',
  computedAt: now,
  fresh: true,
  worktrees: [
    DESIGN,
    SILLAGE,
    VUE_GIT,
    tree('feat/onglet-projet', 'merged', { conversations: [{ id: 'c-old', link: 'worktree' }] }),
    tree('feat/journal', 'merged', { external: true, id: null, lastCommitAt: now - 6 * DAY }),
    tree('port/savoir', 'dirty', { ahead: 11, modified: 2, unmergedCommits: true, lastEditAt: now - 8 * DAY }),
    tree('audit/bundle-web', 'unmerged', { ahead: 3, unmergedCommits: true, lastCommitAt: now - 7 * DAY }),
    tree('fix/tir-planifie', 'missing', { lastCommitAt: now - 4 * DAY }),
  ],
  branches: [
    { name: 'feat/vieux-panneau', merged: true },
    { name: 'fix/coquille', merged: true },
    { name: 'essai/abandonne', merged: false },
  ],
}

const ROOT_GIT: GitSummaryDto = { branch: 'main', isDirty: true, changedFiles: 3, added: 12, removed: 4 }

const meta = {
  title: "Composants d'application/WorktreeGroups",
  component: WorktreeGroups,
  args: {
    projectId: PROJECT_ID,
    rows: ROWS,
    status: STATUS,
    rootGit: ROOT_GIT,
    conversations: CONVERSATIONS,
    filtering: false,
    words: [],
    expanded: new Set(),
    onToggle: () => {},
  },
  parameters: {
    docs: {
      description: {
        component:
          "L'onglet Activité groupé par worktree (planche B3) : la racine en tête, puis les arbres habités, l'en-tête portant la branche, l'écart à la base et l'état propre ou modifié. Dessous, les arbres sans session avec leur geste — Nettoyer, Reprendre, Oublier — et les branches qu'aucun arbre n'a extraites.\n\nC'est l'ancienne vue Chantiers des réglages : « Nettoyer » ouvre la même confirmation, qui relit l'arbre et dit ce qui serait perdu.",
      },
    },
  },
} satisfies Meta<typeof WorktreeGroups>

export default meta
type Story = StoryObj<typeof meta>

export const ParWorktree: Story = {}

/** Un filtre de texte : seuls restent les arbres et les sessions qui y répondent. */
export const Filtre: Story = {
  args: { rows: ROWS.filter((entry) => entry.place.branch?.includes('sillage')), filtering: true, words: ['sillage'] },
}
