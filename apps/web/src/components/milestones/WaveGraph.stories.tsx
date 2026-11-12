import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardConversationDto, CardDto, CardLinkDto } from '@solera/protocol'
import { fixtureCard } from '../board/card-fixtures'
import { WaveGraph } from './WaveGraph'

const DAY = 86_400_000
const now = Date.now()
const LAUNCHED = now - 4 * DAY

const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })

/** `card` attend `blockers`, liés dans les deux sens comme le serveur les rend. */
function after(card: CardDto, ...blockers: CardDto[]): CardDto {
  for (const blocker of blockers) {
    card.blockedBy.push(link(blocker))
    blocker.blocks.push(link(card))
  }
  return card
}

const session = (id: string, status: CardConversationDto['status']): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: now - DAY,
})

/** Un jalon en trois vagues : une faite, une qui tourne, une qui t'attend, une ajoutée, une en retard. */
function milestone(): CardDto[] {
  const axis = fixtureCard(911, 'Échelle et axe du Gantt', 'done')
  const bars = after(fixtureCard(912, 'Barres de cartes et flèches', 'in_progress', { conversations: [session('s-912', 'running')] }), axis)
  const tip = after(fixtureCard(913, 'Infobulle flottante', 'in_progress', { conversations: [session('s-913', 'awaiting_input')] }), axis)
  const horizon = after(fixtureCard(914, 'Horizon des jalons', 'todo', { dueAt: now - 2 * DAY }), bars, tip)
  const gantt = after(fixtureCard(915, 'Gantt détaillé', 'todo', { createdAt: now - DAY }), bars)
  const doc = fixtureCard(916, 'Documenter les primitives', 'todo')
  return [axis, bars, tip, horizon, gantt, doc]
}

/** Deux cartes qui s'attendent l'une l'autre : l'arête qui remonte est rouge. */
function cycle(): CardDto[] {
  const a = fixtureCard(921, 'Fil unique', 'todo')
  const b = after(fixtureCard(922, 'Filtres par nature', 'todo'), a)
  after(a, b)
  return [a, b, after(fixtureCard(923, 'Recherche', 'todo'), b)]
}

const meta = {
  title: "Composants d'application/Vagues d'un jalon",
  component: WaveGraph,
  parameters: {
    docs: {
      description: {
        component:
          "Les cartes d'un jalon en **vagues** (#194, spec jalons VAG-3..10) : une colonne par étage de dépendances, de gauche à droite. Les arêtes vont du bloqueur à la bloquée, en pointillé tant qu'il n'est pas fait ; une arête qui remonte ferme un cycle, en rouge. Le survol éclaire la chaîne d'une carte. Une carte qu'une session attend passe en ambre ; une carte ajoutée après le lancement le dit. Sous 560 px, les vagues s'empilent et les liens s'écrivent « après #N ».",
      },
    },
  },
  args: { projectId: 'p1', cards: milestone(), concurrency: 3, launchedAt: LAUNCHED },
} satisfies Meta<typeof WaveGraph>

export default meta
type Story = StoryObj<typeof meta>

/** Un jalon lancé : faite, en cours, qui t'attend, en retard, ajoutée. */
export const Lance: Story = {}

/** Une concurrence de 1 : la deuxième vague part en deux passes. */
export const UneALaFois: Story = { args: { concurrency: 1 } }

/** Un cycle : l'arête qui remonte passe par-dessus, en pointillé rouge. */
export const Cycle: Story = { args: { cards: cycle(), launchedAt: null } }

/** Au téléphone : les vagues empilées, les liens en clair. */
export const Etroit: Story = {
  decorators: [(Story) => <div style={{ width: 360 }}><Story /></div>],
}
