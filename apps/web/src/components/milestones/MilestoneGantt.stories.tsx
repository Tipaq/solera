import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardConversationDto, CardDto, CardLinkDto, MilestoneRunDto } from '@solera/protocol'
import { horizonOf } from '../../lib/milestone-model'
import { fixtureCard } from '../board/card-fixtures'
import { DAY } from '../gantt/scale'
import { MilestoneGantt } from './MilestoneGantt'

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

function depend(blocked: CardDto, ...blockers: CardDto[]) {
  for (const blocker of blockers) {
    blocked.blockedBy.push(link(blocker))
    blocker.blocks.push(link(blocked))
  }
}

const scale = fixtureCard(911, 'Échelle et axe', 'done', { createdAt: now - 12 * DAY, dueAt: now - 6 * DAY })
const bars = fixtureCard(912, 'Barres de cartes et infobulle', 'review', { createdAt: now - 8 * DAY, dueAt: now - DAY })
const arrows = fixtureCard(913, 'Flèches « bloque » et chaîne éclairée', 'in_progress', {
  createdAt: now - 5 * DAY, dueAt: now + 4 * DAY, conversations: [session('s-913', 'running')],
})
const tip = fixtureCard(914, 'Infobulle bornée à la fenêtre', 'todo', {
  createdAt: now - 3 * DAY, dueAt: now + 6 * DAY, conversations: [session('s-914', 'awaiting_input')],
})
const stories = fixtureCard(915, 'Stories du Gantt', 'todo', { createdAt: now - 2 * DAY })
depend(bars, scale)
depend(arrows, scale)
depend(tip, arrows)
const address = fixtureCard(921, 'Adresse de secours', 'in_progress', { createdAt: now - 9 * DAY, dueAt: now - 2 * DAY })
const probe = fixtureCard(922, 'Sonde réseau', 'todo', { createdAt: now - 4 * DAY, dueAt: now + 2 * DAY })
depend(probe, address)

/**
 * Un jalon lancé (chaîne de dépendances, une session qui tourne, une qui t'attend), un
 * jalon en retard, un livré — replié au départ —, un jalon sans échéance, et deux cartes
 * datées hors jalon.
 */
const CARDS = [
  ...family(fixtureCard(910, 'Page projet v2 · Jalons', 'in_progress', { milestone: true, createdAt: now - 14 * DAY, dueAt: now + 9 * DAY }), [
    scale, bars, arrows, tip, stories,
  ]),
  ...family(fixtureCard(920, 'Accès distant fiable', 'todo', { milestone: true, createdAt: now - 10 * DAY, dueAt: now - 3 * DAY }), [address, probe]),
  ...family(fixtureCard(940, 'Comptes Claude nommés', 'done', { milestone: true, createdAt: now - 24 * DAY, dueAt: now - 12 * DAY }), [
    fixtureCard(941, 'Alias facultatif', 'done', { createdAt: now - 22 * DAY, dueAt: now - 15 * DAY }),
    fixtureCard(942, 'Migration', 'done', { createdAt: now - 20 * DAY, dueAt: now - 13 * DAY }),
  ]),
  ...family(fixtureCard(950, 'Fil unique', 'todo', { milestone: true, createdAt: now - 6 * DAY }), [
    fixtureCard(951, 'Filtres par nature', 'todo', { createdAt: now - 6 * DAY, dueAt: now + 12 * DAY }),
  ]),
  fixtureCard(960, 'Renouveler le certificat', 'todo', { createdAt: now - 3 * DAY, dueAt: now + 3 * DAY }),
  fixtureCard(961, 'Sauvegarde de la base', 'done', { createdAt: now - 11 * DAY, dueAt: now - 5 * DAY }),
  fixtureCard(901, 'Mode hors ligne', 'todo', { milestone: true }),
]
const RUNS = [{ id: 'run-910', cardId: 'card-910', state: 'running', createdAt: now - 4 * DAY, cards: [] } as unknown as MilestoneRunDto]
const ENTRIES = horizonOf({ cards: CARDS, runs: RUNS, requests: new Map() })

const meta = {
  title: "Composants d'application/Gantt des jalons",
  component: MilestoneGantt,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "L'onglet Jalons en vue **Gantt** (#191, spec jalons GNT) : un groupe par jalon qui a des cartes, dans l'ordre d'échéance, puis « Hors jalon » pour les cartes datées sans parente. L'en-tête d'un groupe reste collé sous l'axe ; son titre et sa barre mènent à la page du jalon. La barre est une **jauge** remplie par l'état des cartes, avec le losange d'échéance et le pourcentage livré. Les jalons livrés sont repliés au départ.\n\nUne ligne de carte mène à sa destination (sa session, sa fiche si elle t'attend, un brouillon sinon) ; `ℹ` ouvre sa fiche sur place. Au survol, la ligne s'éclaire sur toute la largeur avec sa chaîne de dépendances.",
      },
    },
  },
  args: { projectId: 'p-1', entries: ENTRIES, cards: CARDS, zoom: 'month' },
  argTypes: { zoom: { control: 'inline-radio', options: ['week', 'month'] } },
  // Le Gantt prend la hauteur de sa page : on lui en donne une.
  render: (args) => (
    <div className="h-[36rem]">
      <MilestoneGantt {...args} />
    </div>
  ),
} satisfies Meta<typeof MilestoneGantt>

export default meta
type Story = StoryObj<typeof meta>

/** Toutes les formes : lancé, en retard, livré replié, sans échéance, hors jalon. */
export const Complet: Story = {}

/** L'échelle « Semaine » : un jour par colonne, l'axe défile en largeur. */
export const Semaine: Story = { args: { zoom: 'week' } }

/** Aucun jalon découpé ni carte datée. */
export const Vide: Story = { args: { entries: [], cards: [] } }
