import type { Meta, StoryObj } from '@storybook/react-vite'
import type { MilestoneRunCardDto, MilestoneRunDto } from '@solera/protocol'
import { MilestoneBanner } from './MilestoneBanner'

const row = (number: number, title: string, layer: number, extra: Partial<MilestoneRunCardDto>): MilestoneRunCardDto => ({
  cardId: `card-${number}`, number, title, layer, status: 'queued', blockReason: null, blockedBy: [],
  conversationId: null, conversationTitle: null, conversationStatus: null, worktreeName: null,
  agent: null, model: null, error: null, ...extra,
})

const after = (...numbers: number[]) => numbers.map((number) => ({ number, title: `Carte ${number}`, outside: false, abandoned: false }))

/** Le jalon #75 de la planche C1 : dix cartes, deux sessions au travail sur trois. */
const RUN: MilestoneRunDto = {
  id: 'run', cardId: 'card-75', cardNumber: 75, cardTitle: 'Orchestrer le travail par cartes',
  state: 'running', concurrency: 3, agent: 'claude', model: 'claude-opus-5-5', branch: 'jalon/orchestrer', busy: 2,
  createdAt: Date.now() - 50 * 60_000, endedAt: null,
  cards: [
    row(65, 'Trier et porter Sillage', 0, { status: 'blocked', blockReason: 'awaiting_input', conversationId: 'c65' }),
    row(66, 'Ce qu’un agent fait avec les cartes', 1, { status: 'queued', blockedBy: after(65) }),
    row(68, 'PR, revue en boucle, fusion', 1, { status: 'queued', blockedBy: after(65) }),
    row(73, 'Dessiner la page projet', 1, { status: 'working', conversationId: 'c73' }),
    row(67, 'Colonne « À préciser »', 2, { status: 'waiting', blockedBy: after(66) }),
    row(69, 'Clore une carte finie', 2, { status: 'waiting', blockedBy: after(66, 68) }),
    row(70, 'Découper depuis une dictée', 2, { status: 'waiting', blockedBy: after(66) }),
    row(71, 'Promouvoir une sous-tâche', 2, { status: 'waiting', blockedBy: after(66) }),
    row(74, 'Onglet Agents façon Claude Code', 2, { status: 'waiting', blockedBy: after(65, 73) }),
    row(72, 'Lancer un jalon', 3, { status: 'waiting', blockedBy: after(66, 67, 68) }),
  ],
}

const meta = {
  title: "Composants d'application/Le bandeau du jalon lancé",
  component: MilestoneBanner,
  args: { projectId: 'p1', run: RUN },
  parameters: {
    docs: {
      description: {
        component:
          "Le bandeau d'un jalon lancé, en tête de l'Activité et de l'Aperçu (planche C1 de `docs/audits/2026-10-21-page-projet/final/`, #116).\n\n**Un segment par carte**, dans l'ordre des vagues, teinté par son exécution : vert fusionnée, vert pâle en revue, accent en cours, ambre bloquée, gris en file, lavis en attente de ses dépendances. Puis les places occupées, la file, l'attente, et en ambre ce qui te demande quelque chose. « Voir le jalon » mène à sa vue, sous l'onglet Jalons.",
      },
    },
  },
} satisfies Meta<typeof MilestoneBanner>

export default meta
type Story = StoryObj<typeof meta>

/** En marche, comme sur la planche. */
export const EnMarche: Story = {}

/** En pause : la pastille passe à l'ambre, rien ne part. */
export const EnPause: Story = { args: { run: { ...RUN, state: 'paused' } } }

/** Bien avancé : des fusionnées, une en revue, plus rien ne demande. */
export const Avance: Story = {
  args: {
    run: {
      ...RUN,
      busy: 1,
      cards: RUN.cards.map((card, index) =>
        index < 6 ? { ...card, status: 'done' } : index === 6 ? { ...card, status: 'reviewing' } : card,
      ),
    },
  },
}
