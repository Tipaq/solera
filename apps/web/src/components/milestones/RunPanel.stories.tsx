import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type {
  CardBranchPrDto,
  CardConversationDto,
  CardDto,
  CardLinkDto,
  MilestoneCardStatus,
  MilestoneRunCardDto,
  MilestoneRunDto,
  ProjectEnvironmentsDto,
} from '@solera/protocol'
import { horizonOf, type MilestoneEntry } from '../../lib/milestone-model'
import { useMergeBranchPullRequest } from '../../lib/pull-requests'
import { PROJECT_ID, SeededBoard, fixtureCard } from '../board/card-fixtures'
import { RunPanel } from './RunPanel'

const HOUR = 3_600_000
const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })

function milestone(number: number, title: string, kids: CardDto[], extra: Partial<CardDto> = {}): CardDto[] {
  const parent = fixtureCard(number, title, 'in_progress', { milestone: true, branch: `jalon/${number}-acces-distant-fiable`, ...extra })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

const after = (card: CardDto, blocker: CardDto) => {
  card.blockedBy.push(link(blocker))
  blocker.blocks.push(link(card))
  return card
}

const session = (id: string, status: CardConversationDto['status']): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: Date.now() - HOUR,
})

const pilot = (card: CardDto, status: MilestoneCardStatus, extra: Partial<MilestoneRunCardDto> = {}): MilestoneRunCardDto => ({
  cardId: card.id, number: card.number, title: card.title, layer: 0, status, blockReason: null, blockedBy: [], conversationId: null,
  conversationTitle: null, conversationStatus: null, worktreeName: null, agent: null, model: null, error: null, ...extra,
})

function runOf(parent: CardDto, cards: MilestoneRunCardDto[], extra: Partial<MilestoneRunDto> = {}): MilestoneRunDto {
  return {
    id: `run-${parent.id}`, cardId: parent.id, cardNumber: parent.number, cardTitle: parent.title, state: 'running', mode: 'auto',
    concurrency: 3, confined: null, agent: 'claude', model: 'opus', branch: parent.branch!, busy: 2, cards,
    createdAt: Date.now() - 2 * HOUR - 20 * 60_000, endedAt: null, ...extra,
  }
}

const entryOf = (cards: CardDto[], runs: MilestoneRunDto[] = []): MilestoneEntry => horizonOf({ cards, runs, requests: new Map() })[0]!

/**
 * Un jalon en route : une fusionnée, une au travail, une en revue, une qui t'attend, une
 * en file, une qui attend ses bloqueurs, et une ajoutée depuis le lancement.
 */
function launched(extra: Partial<MilestoneRunDto> = {}): MilestoneEntry {
  const merged = fixtureCard(931, 'Adresse de secours par IP', 'done')
  const working = fixtureCard(932, 'Sonde réseau', 'in_progress', { conversations: [session('s-932', 'running')] })
  const review = fixtureCard(933, 'Doc d’installation mobile', 'review', { conversations: [session('s-933', 'idle')] })
  const asking = fixtureCard(934, 'Journal des coupures', 'in_progress', { conversations: [session('s-934', 'awaiting_input')] })
  const queued = fixtureCard(935, 'Reprise après coupure', 'todo')
  const waiting = after(fixtureCard(936, 'Alerte de coupure longue', 'todo'), asking)
  const added = fixtureCard(937, 'Test de bout en bout au téléphone', 'todo', { createdAt: Date.now() - 10 * 60_000 })
  const cards = milestone(930, 'Accès distant fiable', [merged, working, review, asking, queued, waiting, added])
  const run = runOf(cards[0]!, [
    pilot(merged, 'done'),
    pilot(working, 'working'),
    pilot(review, 'reviewing'),
    pilot(asking, 'blocked', { blockReason: 'awaiting_input' }),
    pilot(queued, 'queued'),
    pilot(waiting, 'waiting'),
  ], extra)
  return entryOf(cards, [run])
}

/** Toutes fusionnées dans la branche du jalon : sa PR vers main est ouverte, ou fermée. */
function finalPr(pr: Partial<CardBranchPrDto> = {}): MilestoneEntry {
  return entryOf(
    milestone(940, 'Comptes nommés', [fixtureCard(941, 'Alias', 'done'), fixtureCard(942, 'Migration', 'done')], {
      branch: 'jalon/940-comptes-nommes',
      branchPr: { number: 78, url: 'https://github.com/tipaq/solera/pull/78', base: 'main', mergedAt: null, closedAt: null, ...pr },
    }),
  )
}

const ENVIRONMENTS: ProjectEnvironmentsDto = {
  default: { where: 'host', confined: false },
  choices: [
    { where: 'host', confined: false },
    { where: 'host', confined: true },
  ],
  suggested: null,
  autonomousConfined: true,
}

function Seeded({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(['projects', PROJECT_ID, 'environments'], ENVIRONMENTS)
    return null
  })
  return <SeededBoard>{children}</SeededBoard>
}

/** La page tient la fusion (sa prochaine action la partage) ; la story la tient à sa place. */
function Panel({ entry }: { entry: MilestoneEntry }) {
  return (
    <Seeded>
      <Merging entry={entry} />
    </Seeded>
  )
}

function Merging({ entry }: { entry: MilestoneEntry }) {
  const merge = useMergeBranchPullRequest(PROJECT_ID)
  return (
    <div className="w-[340px]">
      <RunPanel projectId={PROJECT_ID} entry={entry} merge={merge} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/RunPanel",
  component: RunPanel,
  parameters: {
    docs: {
      description: {
        component:
          "Le **suivi d'un jalon lancé** (#198), à la place du panneau Lancer : où en est chaque carte (au travail, en revue, fusionnée, ce qui **t'attend en ambre**, sa raison en infobulle), la bascule à la main ↔ autonome, les places, le confinement des prochaines sessions, une carte à ajouter, la pause et l'arrêt (confirmé).\n\nQuand toutes les cartes sont fusionnées dans la branche du jalon, la **PR finale** se fusionne d'ici dans la branche par défaut ; fermée sans fusion sur la forge, elle le dit au lieu de proposer une fusion refusée.",
      },
    },
  },
  args: { projectId: PROJECT_ID, entry: launched(), merge: undefined as never },
} satisfies Meta<typeof RunPanel>

export default meta
type Story = StoryObj<typeof meta>

/** En autonome : les places occupées, et le choix des places en cours de route. */
export const Autonome: Story = {
  render: () => <Panel entry={launched()} />,
}

/** À la main : « Lancer » sur la carte en file, la ligne manuelle à la place des places. */
export const ALaMain: Story = {
  name: 'À la main',
  render: () => <Panel entry={launched({ mode: 'manual', confined: false })} />,
}

/** En pause : le point ambre, « Reprendre ». */
export const EnPause: Story = {
  name: 'En pause',
  render: () => <Panel entry={launched({ state: 'paused' })} />,
}

/** La PR finale ouverte : « Fusionner dans main » et « Ouvrir la PR ↗ ». */
export const PrOuverte: Story = {
  name: 'PR ouverte',
  render: () => <Panel entry={finalPr()} />,
}

/** Fermée sans fusion sur la forge : à rouvrir, plus de fusion proposée. */
export const PrFermee: Story = {
  name: 'PR fermée',
  render: () => <Panel entry={finalPr({ closedAt: Date.now() - HOUR })} />,
}
