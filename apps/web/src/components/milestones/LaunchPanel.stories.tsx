import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { DEFAULT_MILESTONE_CONCURRENCY, type CardConversationDto, type CardDto, type CardLinkDto, type ProjectEnvironmentsDto } from '@solera/protocol'
import { horizonOf, type MilestoneEntry } from '../../lib/milestone-model'
import { PROJECT_ID, SeededBoard, fixtureCard } from '../board/card-fixtures'
import { LaunchPanel } from './LaunchPanel'

const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })

function milestone(number: number, title: string, kids: CardDto[], extra: Partial<CardDto> = {}): CardDto[] {
  const parent = fixtureCard(number, title, 'todo', { milestone: true, ...extra })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

const after = (card: CardDto, blocker: CardDto) => {
  card.blockedBy.push(link(blocker))
  blocker.blocks.push(link(card))
  return card
}

const running: CardConversationDto = {
  id: 's-933', title: 'Sonde', agent: 'claude', status: 'running', costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: Date.now(),
}

const entryOf = (cards: CardDto[]): MilestoneEntry => horizonOf({ cards, runs: [], requests: new Map() })[0]!

/** Prêt : une carte part, une attend sa bloqueuse, une travaille déjà. */
function ready(): MilestoneEntry {
  const first = fixtureCard(931, 'Adresse de secours par IP', 'todo')
  return entryOf(
    milestone(930, 'Accès distant fiable', [
      first,
      after(fixtureCard(932, 'Doc d’installation mobile', 'todo'), first),
      fixtureCard(933, 'Sonde réseau', 'in_progress', { conversations: [running] }),
      fixtureCard(934, 'Journal des coupures', 'todo'),
    ]),
  )
}

/** À régler : une carte à préciser, une à accepter. */
function toSettle(): MilestoneEntry {
  return entryOf(
    milestone(920, 'Activité et Journal fusionnés', [
      fixtureCard(921, 'Fil unique', 'todo', { toClarifySince: Date.now() }),
      fixtureCard(922, 'Filtres par nature', 'todo', { acceptedAt: null }),
    ]),
  )
}

const ENVIRONMENTS: ProjectEnvironmentsDto = {
  default: { where: 'host', confined: false },
  choices: [
    { where: 'host', confined: false },
    { where: 'host', confined: true },
    { where: 'devcontainer', confined: false },
  ],
  suggested: null,
  autonomousConfined: false,
}

function Seeded({ entry, children }: { entry: MilestoneEntry; children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(['projects', PROJECT_ID, 'environments'], ENVIRONMENTS)
    client.setQueryData(['milestone-plan', entry.card.id], { cardId: entry.card.id, cards: [], cycle: [], branch: `jalon/${entry.card.number}-acces-distant-fiable` })
    return null
  })
  return <SeededBoard>{children}</SeededBoard>
}

/** La page tient la concurrence (les vagues la montrent) ; la story la tient à sa place. */
function Panel({ entry }: { entry: MilestoneEntry }) {
  const [concurrency, setConcurrency] = useState(DEFAULT_MILESTONE_CONCURRENCY)
  return (
    <Seeded entry={entry}>
      <div className="w-[340px]">
        <LaunchPanel projectId={PROJECT_ID} entry={entry} concurrency={concurrency} onConcurrency={setConcurrency} />
      </div>
    </Seeded>
  )
}

const meta = {
  title: "Composants d'application/LaunchPanel",
  component: LaunchPanel,
  parameters: {
    docs: {
      description: {
        component:
          "Le panneau **Lancer** d'un jalon (#197), à droite de sa page : à la main, carte par carte, ou en autonome, le serveur lançant les cartes prêtes vague par vague.\n\nL'emplacement des sessions suit le projet ; le lancement n'en règle que le **confinement**, coché d'office en autonome. En autonome, les vérifications disent ce qui manque, **les échecs d'abord**, et le bouton reste éteint tant qu'il en reste.",
      },
    },
  },
  args: { projectId: PROJECT_ID, entry: ready(), concurrency: DEFAULT_MILESTONE_CONCURRENCY, onConcurrency: () => undefined },
} satisfies Meta<typeof LaunchPanel>

export default meta
type Story = StoryObj<typeof meta>

/** Prêt, à la main : la liste des cartes ouvertes, « Lancer » sur celles qui peuvent partir. Choisir « Autonome » montre les vérifications. */
export const Pret: Story = {
  name: 'Prêt',
  render: () => <Panel entry={ready()} />,
}

/** À régler : en autonome, les points à régler d'abord, et le lancement éteint. */
export const ARegler: Story = {
  name: 'À régler',
  render: () => <Panel entry={toSettle()} />,
}

/** Une idée, ou un jalon pas encore découpé. */
export const RienALancer: Story = {
  name: 'Rien à lancer',
  render: () => <Panel entry={entryOf([fixtureCard(901, 'Mode hors ligne complet', 'todo', { milestone: true })])} />,
}

/** Toutes ses cartes sont closes : le cadre vert. */
export const Livre: Story = {
  name: 'Livré',
  render: () => (
    <Panel
      entry={entryOf(
        milestone(940, 'Comptes nommés', [fixtureCard(941, 'Alias', 'done'), fixtureCard(942, 'Migration', 'done')], {
          column: 'done',
          branchPr: { number: 78, url: 'https://github.com/tipaq/solera/pull/78', mergedAt: Date.now() },
        }),
      )}
    />
  ),
}
