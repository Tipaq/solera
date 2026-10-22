import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { ConversationDto, WorktreeStatusDto, WorktreeStatusListDto } from '@solera/protocol'
import { WorktreeBoard } from './WorktreeBoard'

/**
 * Les chantiers d'un projet de démonstration, un arbre par état. La vue lit la liste et
 * les conversations par React Query : la story préremplit le cache, rien ne part.
 */
const PROJECT_ID = 'p-nimbus'
const now = Date.UTC(2026, 9, 22, 10, 0)
const HOUR = 3_600_000
const ROOT = '/home/alex/.local/share/solera/worktrees/p-nimbus'

function tree(name: string, state: WorktreeStatusDto['state'], extra: Partial<WorktreeStatusDto> = {}): WorktreeStatusDto {
  return {
    id: `wt-${name}`, name, path: `${ROOT}/${name.replace(/\//g, '__')}`, branch: name, external: false, state,
    ahead: 0, behind: 0, modified: 0, untracked: 0, conflicts: false, unmergedCommits: false, head: null,
    lastCommitAt: null, lastEditAt: null, conversations: [], ...extra,
  }
}

/** Les champs que la vue lit ; le reste du DTO n'y paraît pas. */
function session(id: string, title: string, status: ConversationDto['status'], card: number | null): ConversationDto {
  return {
    id, projectId: PROJECT_ID, title, agent: 'claude', status, archivedAt: null, updatedAt: now - HOUR,
    card: card === null ? null : { id: `card-${card}`, number: card, title: `Carte ${card}`, column: 'in_progress' },
  } as unknown as ConversationDto
}

const LIST: WorktreeStatusListDto = {
  base: 'main',
  computedAt: now,
  fresh: true,
  worktrees: [
    tree('feat/gone', 'missing', { external: true, id: null }),
    tree('feat/offline-cache', 'dirty', {
      modified: 2, ahead: 1, behind: 3, unmergedCommits: true, lastEditAt: now - 10 * 60_000,
      conversations: [{ id: 'c-offline', link: 'worktree' }],
    }),
    tree('feat/radar-prefetch', 'unmerged', {
      ahead: 1, behind: 3, conflicts: true, unmergedCommits: true, lastCommitAt: now - 6 * 24 * HOUR,
      conversations: [{ id: 'c-radar', link: 'worktree' }, { id: 'c-root', link: 'edited' }],
    }),
    tree('feat/fresh', 'empty'),
    tree('fix/squashed-typo', 'merged', { external: true, id: null, ahead: 1, behind: 3, lastCommitAt: now - 2 * HOUR }),
  ],
}

const CONVERSATIONS = [
  session('c-offline', 'Add offline caching for forecasts', 'running', 2),
  session('c-radar', 'Radar tile prefetching', 'idle', 4),
  session('c-root', 'Ranger les chantiers', 'idle', null),
]

function Seeded({ list, children }: { list: WorktreeStatusListDto; children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(['worktree-status', PROJECT_ID], list)
    client.setQueryData(['conversations', PROJECT_ID], CONVERSATIONS)
    return null
  })
  return <>{children}</>
}

const meta = {
  title: "Composants d'application/WorktreeBoard",
  component: WorktreeBoard,
  args: { projectId: PROJECT_ID, isRepository: true },
  parameters: {
    docs: {
      description: {
        component:
          "Les chantiers d'un projet, dans ses réglages : chaque arbre que git ou Solera connaît, jugé contre la branche par défaut, les plus urgents en tête, avec les sessions qui y vivent ou y ont écrit et leur carte.\n\n« Nettoyer » ouvre une confirmation qui relit l'arbre et dit ce qui serait perdu ; elle attend la fin du tour d'une session qui y travaille. Absente hors dépôt git ou sans arbre hors du principal.",
      },
    },
  },
} satisfies Meta<typeof WorktreeBoard>

export default meta
type Story = StoryObj<typeof meta>

/** Un arbre par état : introuvable, non commité, à fusionner, sans travail, fusionné. */
export const Chantiers: Story = {
  render: (args) => <Seeded list={LIST}><WorktreeBoard {...args} /></Seeded>,
}

/** Une liste servie pendant que la suivante se calcule. */
export const Actualisation: Story = {
  render: (args) => <Seeded list={{ ...LIST, fresh: false }}><WorktreeBoard {...args} /></Seeded>,
}
