import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardDto, CardLinkDto, MilestoneRunDto, ProjectDto } from '@solera/protocol'
import { milestoneGroups, portfolioMilestones } from '../../lib/portfolio-milestones'
import { fixtureCard } from '../board/card-fixtures'
import { DAY } from '../gantt/scale'
import { PortfolioGantt } from './PortfolioGantt'
import { PortfolioHorizon } from './PortfolioHorizon'

const now = Date.now()
const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })
const project = (id: string, name: string, color: string) => ({ id, name, image: null, color, archivedAt: null }) as ProjectDto

const NIMBUS = project('p-nimbus', 'Nimbus', '#5B9DF9')
const ATELIER = project('p-atelier', 'Atelier', '#E5A54B')

/** Un jalon et ses enfants, dans un projet, liés dans les deux sens comme le serveur les rend. */
function family(projectId: string, parent: CardDto, kids: CardDto[]): CardDto[] {
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids].map((card) => ({ ...card, projectId }))
}

const sync = fixtureCard(110, 'Synchronisation hors ligne', 'in_progress', { milestone: true, createdAt: now - 14 * DAY, dueAt: now + 4 * DAY })

/**
 * Deux projets : chez Nimbus un jalon lancé, un en retard, un prêt et une idée ; chez
 * Atelier un jalon à régler qui attend celui de Nimbus, et un livré.
 */
const CARDS = [
  ...family('p-nimbus', sync, [
    fixtureCard(111, 'File d’attente locale', 'done', { createdAt: now - 12 * DAY }),
    fixtureCard(112, 'Résolution des conflits', 'in_progress'),
    fixtureCard(113, 'Indicateur de connexion', 'todo'),
  ]),
  ...family('p-nimbus', fixtureCard(120, 'Notifications push', 'todo', { milestone: true, createdAt: now - 20 * DAY, dueAt: now - 2 * DAY }), [
    fixtureCard(121, 'Abonnement du navigateur', 'done', { createdAt: now - 18 * DAY }),
    fixtureCard(122, 'Préférences par projet', 'todo'),
  ]),
  ...family('p-nimbus', fixtureCard(130, 'Tableau de bord des coûts', 'todo', { milestone: true, createdAt: now - 6 * DAY, dueAt: now + 24 * DAY }), [
    fixtureCard(131, 'Agrégat par jour', 'todo'),
  ]),
  { ...fixtureCard(140, 'Mode lecture seule', 'todo', { milestone: true }), projectId: 'p-nimbus' },
  ...family(
    'p-atelier',
    fixtureCard(210, 'Export en PDF', 'todo', { milestone: true, createdAt: now - 4 * DAY, dueAt: now + 14 * DAY, blockedBy: [link(sync)] }),
    [fixtureCard(211, 'Mise en page', 'todo', { toClarifySince: now - DAY })],
  ),
  ...family('p-atelier', fixtureCard(220, 'Thème sombre', 'done', { milestone: true, createdAt: now - 30 * DAY, dueAt: now - 10 * DAY }), [
    fixtureCard(221, 'Jetons de couleur', 'done', { createdAt: now - 28 * DAY }),
  ]),
]
const RUNS = new Map([['p-nimbus', [{ id: 'run-110', cardId: 'card-110', state: 'running', createdAt: now - 7 * DAY, cards: [] } as unknown as MilestoneRunDto]]])
const PROJECTS = [NIMBUS, ATELIER]
const GROUPS = milestoneGroups(portfolioMilestones({ projects: PROJECTS, cards: CARDS, runs: RUNS }), PROJECTS)

const meta = {
  title: "Composants d'application/Portefeuille · Jalons",
  component: PortfolioGantt,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Les Jalons du portefeuille (#240, `coque.md` PF-28 à PF-31), sur le modèle de maturité d'un projet. **Gantt** commun : un axe pour tous les projets, une bande d'en-tête par projet, la barre d'un jalon de l'axe d'un projet (`MilestoneBar` : part faite, lancement, losange d'échéance, retard hachuré), et les flèches « bloque » entre jalons, d'un projet à l'autre aussi. **Horizon** (`PortfolioHorizon`) : une bande par projet, une tuile par jalon, triée par maturité puis échéance ; bord rouge en retard.\n\nLa page (`routes/PortfolioMilestonesPage`) passe des bandes déjà filtrées par sa barre ; les jalons livrés y sont masqués par défaut.",
      },
    },
  },
  args: { groups: GROUPS, zoom: 'month', now },
} satisfies Meta<typeof PortfolioGantt>

export default meta
type Story = StoryObj<typeof meta>

/** Le Gantt, échelle « Mois ». Survoler l'export d'Atelier éclaire sa dépendance à Nimbus. */
export const Gantt: Story = {}

/** L'échelle « Semaine » : un jour par colonne, l'axe défile en largeur. */
export const GanttSemaine: Story = { args: { zoom: 'week' } }

/** L'horizon en tuiles. */
export const Horizon: Story = { render: () => <PortfolioHorizon groups={GROUPS} now={now} /> }
