import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardDto, ProjectDto } from '@solera/protocol'
import { lanesOf, portfolioBoardModel, type LaneMode } from '../../lib/portfolio-board'
import { BOARD_CARDS } from '../board/board-fixtures'
import { fixtureCard } from '../board/card-fixtures'
import { PortfolioBoardView, type PortfolioView } from './PortfolioBoardView'

const now = Date.now()
const DAY = 86_400_000

const project = (id: string, name: string, color: string) => ({ id, name, image: null, color, archivedAt: null }) as ProjectDto

const nimbus = project('p-nimbus', 'Nimbus', '#5B9DF9')
const atlas = project('p-atlas', 'Atlas', '#E0A84F')
const PROJECTS = [nimbus, atlas]

/* Le Tableau des stories du board pour Nimbus, et un second projet plus calme. */
const atlasCards: CardDto[] = [
  fixtureCard(12, 'Exporter les cartes au format CSV', 'in_progress', { id: 'atlas-12', projectId: atlas.id }),
  fixtureCard(14, 'La recherche ignore les accents', 'todo', { id: 'atlas-14', projectId: atlas.id, dueAt: now - 2 * DAY }),
  fixtureCard(15, 'Traduire l’aide en anglais', 'review', { id: 'atlas-15', projectId: atlas.id }),
]
const CARDS = [...BOARD_CARDS.map((card) => ({ ...card, project: nimbus })), ...atlasCards.map((card) => ({ ...card, project: atlas }))]
const MODEL = portfolioBoardModel(CARDS, PROJECTS)

const lanes = (mode: LaneMode) => lanesOf(MODEL.entries, { mode, projects: PROJECTS, milestones: MODEL.milestones })

const meta = {
  title: "Composants d'application/Portefeuille · Tableau",
  component: PortfolioBoardView,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Le Tableau du portefeuille (`coque.md` PF-23 à PF-25) : les tuiles du Tableau d'un projet, non déplaçables, en couloirs par projet, par jalon ou sans couloir. Hors couloirs par projet, la pastille du projet coiffe chaque tuile ; hors couloirs par jalon, la tuile dit son jalon. Fait se limite aux cinq plus récentes par couloir. La Liste n'a pas les faites.",
      },
    },
  },
  args: { lanes: lanes('project'), mode: 'project', view: 'kanban' as PortfolioView, onOpen: () => {} },
} satisfies Meta<typeof PortfolioBoardView>

export default meta
type Story = StoryObj<typeof meta>

/** Le défaut : un couloir par projet. */
export const ParProjet: Story = { name: 'Kanban · par projet' }

/** Un couloir par jalon, son projet en pastille, puis « Sans jalon ». */
export const ParJalon: Story = { name: 'Kanban · par jalon', args: { lanes: lanes('milestone'), mode: 'milestone' } }

/** Toutes les cartes mêlées : chaque tuile porte son projet. */
export const SansCouloir: Story = { name: 'Kanban · sans couloir', args: { lanes: lanes('none'), mode: 'none' } }

export const Liste: Story = { name: 'Liste · par projet', args: { view: 'liste' } }

export const ListeSansCouloir: Story = { name: 'Liste · sans couloir', args: { lanes: lanes('none'), mode: 'none', view: 'liste' } }
