import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ConversationDto, ProjectDto, ProjectPullRequestListDto, WorktreeStatusListDto } from '@solera/protocol'
import type { ChatItem } from '../../lib/chat-fold'
import { CARDS, CURRENT, PROJECT_ID, SeededBoard } from '../board/card-fixtures'
import { ProjectPane, type ProjectPaneSession } from './ProjectPane'

/** Le plan que l'agent tient, tel que `TodoWrite` le publie dans le fil. */
const PLAN: ChatItem = {
  kind: 'tool', id: 't1', ts: 0, name: 'TodoWrite', output: null, outputBytes: null, status: 'done', durationMs: 12, parentToolCallId: null,
  input: { todos: [
    { content: 'Rebaser sur main, régler les catalogues i18n', status: 'completed' },
    { content: 'Écrire la fiche commune', status: 'completed' },
    { content: 'Brancher la vue Projet', status: 'in_progress' },
    { content: 'Stories et suite panel-project-ui', status: 'pending' },
  ] },
}

/** Un fil qui cite trois fois la carte #21 : c'est elle qu'on proposera de rattacher. */
const CITING: ChatItem = {
  kind: 'message', id: 'm1', role: 'user', ts: 0, seq: 1, streamingText: '', streamingThinking: '', parentToolCallId: null,
  blocks: [{ type: 'text', text: 'On reprend #21. Le bouton de #21 doit ouvrir une conversation neuve, comme #21 le décrit.' }],
}

const SESSION: ProjectPaneSession = {
  title: 'Onglet projet du panneau',
  card: { id: CURRENT.id, number: CURRENT.number, title: CURRENT.title, column: CURRENT.column },
  items: [PLAN],
  running: true,
  activity: 'Édition de ProjectPane.tsx',
  model: 'opus-5.5',
  contextRatio: 0.38,
}

const now = Date.UTC(2026, 9, 19, 10, 0)

/** Les conversations du projet : celle du panneau, une qui attend, une qui travaille. */
const conversation = (id: string, title: string, status: ConversationDto['status'], card: ConversationDto['card'] = null) =>
  ({ id, title, status, card, projectId: PROJECT_ID, agent: 'claude', archivedAt: null, lastSeq: 0, lastNotableSeq: 0, lastReadSeq: 0, createdAt: now, updatedAt: now }) as ConversationDto

const CONVERSATIONS = [
  conversation('c-here', SESSION.title, 'running', SESSION.card),
  conversation('c-1', 'Jetons générés', 'running', { id: 'card-1', number: 1, title: CARDS.find((card) => card.number === 1)!.title, column: 'in_progress' }),
  conversation('c-wait', 'Vérifier la release', 'awaiting_input'),
]

const TREES = {
  base: 'main', computedAt: now, fresh: true, branches: [], branchesPending: false,
  worktrees: [{
    id: 'w-27', name: 'feat-27', path: '/w/feat-27', branch: 'feat/27-carte-panneau', external: false, state: 'active',
    ahead: 4, behind: 3, modified: 2, untracked: 0, conflicts: false, unmergedCommits: true, mergedPullRequest: null,
    head: 'a093fcd', lastCommitAt: now, lastEditAt: now, conversations: [{ id: 'c-here', link: 'session' }], sizeBytes: null,
    card: null, cardSource: null,
  }],
} as unknown as WorktreeStatusListDto

const PULL_REQUESTS: ProjectPullRequestListDto = {
  available: true, fetchedAt: now,
  pullRequests: [{
    number: 214, url: 'https://github.com/tipaq/solera/pull/214', title: 'Lire la carte traitée sans quitter la session',
    branch: 'feat/27-carte-panneau', base: 'main', state: 'checks', checks: { passed: 6, pending: 2, failed: [] }, review: null, updatedAt: now,
  }],
}

/** Le reste du panneau : un dépôt git, l'arbre de la session, sa PR, les autres sessions. */
function SeededPanel({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    const projects = client.getQueryData<ProjectDto[]>(['projects']) ?? []
    client.setQueryData(['projects'], projects.map((project) => ({ ...project, git: { branch: 'main', isDirty: false, changedFiles: 0, added: 0, removed: 0 } })))
    client.setQueryData(['conversations', 'all'], CONVERSATIONS)
    client.setQueryData(['worktree-status', PROJECT_ID], TREES)
    client.setQueryData(['pull-requests', PROJECT_ID], PULL_REQUESTS)
    return null
  })
  return <>{children}</>
}

const withBoard: Decorator = (Story) => (
  <SeededBoard>
    <SeededPanel>
      <div className="surface flex h-[46rem] w-[26rem] flex-col border border-line"><Story /></div>
    </SeededPanel>
  </SeededBoard>
)

const meta = {
  title: "Composants d'application/ProjectPane",
  component: ProjectPane,
  decorators: [withBoard],
  parameters: {
    docs: {
      description: {
        component:
          "L'onglet *Projet* du panneau d'une session (#229), sur le cadre commun.\n\n*Cette session* : ce qu'elle fait, sa carte à plat — colonne, jalon, gestes, sous-tâches cochables, dépendances, sessions, trois notes —, le plan de l'agent, sa branche et sa PR. Sans carte : « Pas de carte. », Rattacher, Créer depuis la session, et la carte la plus citée dans le fil.\n\n*Projet* : ce qui t'attend, le jalon en cours, les autres sessions actives, trois cartes prêtes à partir et les vues du projet.\n\nUne carte ouverte s'empile dans le panneau : c'est la fiche sur place, « ‹ Projet » pour revenir.",
      },
    },
  },
  args: { projectId: PROJECT_ID, conversationId: 'c-here', session: SESSION },
} satisfies Meta<typeof ProjectPane>

export default meta
type Story = StoryObj<typeof meta>

/** La session et sa carte : le cas pour lequel l'onglet existe. */
export const AvecCarte: Story = { name: 'Avec carte' }

/** Sans carte : la proposition tirée du fil, et de quoi en choisir ou en créer une. */
export const SansCarte: Story = {
  name: 'Sans carte',
  args: { session: { ...SESSION, card: null, items: [CITING, PLAN], running: false, activity: null } },
}
