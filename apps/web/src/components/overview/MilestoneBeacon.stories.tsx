import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardConversationDto, CardDto, CardLinkDto, MilestoneRunDto } from '@solera/protocol'
import { horizonOf } from '../../lib/milestone-model'
import { fixtureCard } from '../board/card-fixtures'
import { MilestoneBeaconView } from './MilestoneBeacon'

const DAY = 86_400_000
const now = Date.now()

const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })

function milestone(number: number, title: string, kids: CardDto[], extra: Partial<CardDto> = {}): CardDto[] {
  const parent = fixtureCard(number, title, 'todo', { milestone: true, ...extra })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

const after = (card: CardDto, ...blockers: CardDto[]) => {
  card.blockedBy = blockers.map(link)
  for (const blocker of blockers) blocker.blocks = [...blocker.blocks, link(card)]
  return card
}

const session = (id: string, agent: CardConversationDto['agent'], status: CardConversationDto['status']): CardConversationDto => ({
  id, title: id, agent, status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: now - DAY,
})

/** Un projet en plein travail : un jalon lancé en trois vagues, et sa file. */
function cards(): CardDto[] {
  const schema = fixtureCard(911, 'Schéma des jalons', 'done')
  const maturity = fixtureCard(912, 'Maturité déduite', 'done')
  const horizon = after(fixtureCard(913, 'Vue horizon', 'in_progress', { conversations: [session('s-913', 'codex', 'awaiting_input')] }), schema)
  const gantt = after(fixtureCard(914, 'Gantt pleine largeur', 'in_progress', { conversations: [session('s-914', 'claude', 'running')] }), schema)
  const tiles = after(fixtureCard(915, 'Tuiles de vague', 'todo'), maturity)
  const phone = after(fixtureCard(916, 'Graphe en vagues au téléphone', 'todo'), horizon, gantt)
  return [
    ...milestone(910, 'Page projet v2', [schema, maturity, horizon, gantt, tiles, phone], { dueAt: now + 9 * DAY }),
    ...milestone(920, 'Accès distant fiable', [fixtureCard(921, 'Adresse de secours', 'todo'), fixtureCard(922, 'Doc mobile', 'todo')]),
    ...milestone(930, 'Activité et Journal fusionnés', [fixtureCard(931, 'Fil unique', 'todo', { toClarifySince: now - DAY })]),
    fixtureCard(940, 'Projets partagés en équipe', 'todo', {
      milestone: true,
      refinement: { conversationId: 'split-940', title: 'Affinage', status: 'running', mode: 'questions', createdAt: now, draft: null, change: null },
    }),
    fixtureCard(950, 'Mode hors ligne complet', 'todo', { milestone: true }),
    ...milestone(960, 'Comptes Claude nommés', [fixtureCard(961, 'Alias facultatif', 'done')]),
  ]
}

const run = { cardId: 'card-910', state: 'running', concurrency: 2, createdAt: now - 3 * DAY } as MilestoneRunDto

const entries = horizonOf({ cards: cards(), runs: [run], requests: new Map() })

const meta = {
  title: "Composants d'application/Aperçu · Phare des jalons",
  component: MilestoneBeaconView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Le phare des jalons de l'Aperçu (`projet.md` A-3), seule surface teintée de la page. Le jalon courant — le premier non livré par maturité (Lancé, Prêt, À régler, À affiner, Idée), puis par numéro — en grand : anneau d'avancement, maturité, échéance, sessions vivantes, vagues nommées (la courante cerclée, les finies cochées), et le geste suivant. Quand une demande du jalon attend dans « Ce qui t'attend », le geste cède la place au repère « N t'attend », qui la déplie là-haut sans la redire.\n\nÀ droite, **Ensuite** (prêts, à régler, lancés au-delà du premier) et **Plus tard** (à affiner, idées).",
      },
    },
  },
  args: { projectId: 'p-nimbus', entries, waiting: new Map() },
} satisfies Meta<typeof MilestoneBeaconView>

export default meta
type Story = StoryObj<typeof meta>

/** Le jalon lancé, deux sessions dessus, le geste « Suivre ». */
export const Lance: Story = { name: 'Jalon lancé' }

/** Une session du jalon t'attend : le repère remplace le geste, la file montre son point ambre. */
export const Attend: Story = {
  name: 'Une demande attend',
  args: {
    waiting: new Map([
      [910, { count: 1, key: 's-s-913' }],
      [930, { count: 2, key: 'refine-card-930' }],
    ]),
  },
}

/** Un jalon prêt, pas encore découpé en vagues lancées : le geste « Lancer ». */
export const Pret: Story = {
  name: 'Jalon prêt',
  args: { entries: horizonOf({ cards: cards().filter((card) => card.number < 910 || card.number >= 920), runs: [], requests: new Map() }) },
}

/** Une idée seule : pas de vague, le geste « Affiner ». */
export const Idee: Story = {
  name: 'Une idée seule',
  args: { entries: horizonOf({ cards: [fixtureCard(950, 'Mode hors ligne complet', 'todo', { milestone: true })], runs: [], requests: new Map() }) },
}

/** Aucun jalon ouvert. */
export const Vide: Story = { args: { entries: [] } }
