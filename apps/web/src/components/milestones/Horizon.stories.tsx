import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardConversationDto, CardDto, CardLinkDto, MilestoneRunDto } from '@solera/protocol'
import { horizonOf } from '../../lib/milestone-model'
import { fixtureCard } from '../board/card-fixtures'
import { DAY } from '../gantt/scale'
import { Horizon } from './Horizon'

const now = Date.now()
const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })
const session = (id: string, status: CardConversationDto['status']): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: now - DAY,
})

/** Un jalon et ses enfants, liés dans les deux sens comme le serveur les rend. */
function family(parent: CardDto, kids: CardDto[]): CardDto[] {
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

/**
 * Un projet à toutes les étapes : un jalon lancé qui t'attend et a grossi depuis son
 * lancement, un prêt en retard dont une carte avance, un livré ; à régler et prêt pour
 * « Ensuite », une idée et un affinage pour « Plus tard ».
 */
const CARDS = [
  ...family(fixtureCard(910, 'Page projet v2', 'in_progress', { milestone: true, createdAt: now - 6 * DAY, dueAt: now + 5 * DAY }), [
    fixtureCard(911, 'Échelle et axe', 'done', { createdAt: now - 12 * DAY }),
    fixtureCard(912, 'Barres de cartes', 'in_progress', { conversations: [session('s-912', 'awaiting_input')] }),
    fixtureCard(913, 'Ajoutée en route', 'todo', { createdAt: now - DAY }),
  ]),
  ...family(fixtureCard(920, 'Accès distant fiable', 'todo', { milestone: true, createdAt: now - 8 * DAY, dueAt: now - 3 * DAY }), [
    fixtureCard(921, 'Adresse de secours', 'in_progress', { conversations: [session('s-921', 'running')] }),
  ]),
  ...family(fixtureCard(940, 'Comptes Claude nommés', 'done', { milestone: true, createdAt: now - 20 * DAY, dueAt: now - 10 * DAY }), [
    fixtureCard(941, 'Alias facultatif', 'done'),
    fixtureCard(942, 'Migration', 'done'),
  ]),
  ...family(fixtureCard(930, 'Partage en équipe', 'todo', { milestone: true, position: 30, dueAt: now + 28 * DAY }), [fixtureCard(931, 'Invitations', 'todo')]),
  ...family(fixtureCard(950, 'Fil unique', 'todo', { milestone: true, position: 20 }), [fixtureCard(951, 'Filtres par nature', 'todo', { toClarifySince: now - DAY })]),
  fixtureCard(901, 'Mode hors ligne complet', 'todo', { milestone: true, position: 50 }),
  fixtureCard(902, 'Projets partagés', 'todo', {
    milestone: true,
    position: 40,
    refinement: { conversationId: 'split-902', title: 'Affinage', status: 'running', mode: 'questions', createdAt: now - DAY, draft: null, change: null },
  }),
]
const RUNS = [{ id: 'run-910', cardId: 'card-910', state: 'running', createdAt: now - 3 * DAY, cards: [] } as unknown as MilestoneRunDto]
const ENTRIES = horizonOf({ cards: CARDS, runs: RUNS, requests: new Map() })

const meta = {
  title: "Composants d'application/Horizon des jalons",
  component: Horizon,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "L'onglet Jalons en vue **Horizon** (#190, spec jalons CAP, HOR) : le cap du projet, éditable sur place ; la chaîne des maturités ; **Maintenant** sur un axe daté (barre de la plus ancienne création à l'échéance, remplie de la part faite, trait du lancement, losange d'échéance, prolongement hachuré du retard, « N t'attend ») ; **Ensuite** et **Plus tard** en tuiles sans dates, dans l'ordre du tableau, avec leur prochaine action.\n\nLa page (`routes/milestones/MilestonesPage`) passe des jalons déjà filtrés par sa barre : la chaîne compte ce qui est montré.",
      },
    },
  },
  args: {
    project: { id: 'p-1', cap: 'Un cockpit d’agents qu’on utilise tous les jours, au bureau et au téléphone.' },
    entries: ENTRIES,
    zoom: 'month',
  },
} satisfies Meta<typeof Horizon>

export default meta
type Story = StoryObj<typeof meta>

/** Un jalon à chaque étape. Survoler une barre montre son infobulle et pâlit les autres. */
export const Complet: Story = {}

/** L'échelle « Semaine » : un jour par colonne, l'axe défile en largeur. */
export const Semaine: Story = { args: { zoom: 'week' } }

/** Un projet neuf : pas de cap, rien à chaque étape, chaque temps le dit. */
export const Vide: Story = { args: { project: { id: 'p-1', cap: null }, entries: [] } }
