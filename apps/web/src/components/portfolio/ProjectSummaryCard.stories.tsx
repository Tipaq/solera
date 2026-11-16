import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ProjectDto } from '@solera/protocol'
import type { ProjectSummary } from '../../lib/portfolio-overview'
import { ProjectSummaryCard } from './ProjectSummaryCard'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = Date.now()

const project = (id: string, name: string, color: string) => ({ id, name, image: null, color }) as ProjectDto

const SUMMARY: ProjectSummary = {
  project: project('p-nimbus', 'Nimbus', '#5B9DF9'),
  waiting: 0,
  live: 1,
  open: 9,
  milestone: { number: 42, title: 'Mode hors ligne', done: 5, total: 8, dueAt: now + 6 * DAY },
  lastAt: now - 2 * HOUR,
}

/** Une case de la grille de l'Aperçu, entre `sm` et `xl`. */
const cell: Decorator = (Story) => <div className="w-80"><Story /></div>

const meta = {
  title: "Composants d'application/Portefeuille · Carte de projet",
  component: ProjectSummaryCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "La carte d'un projet à l'Aperçu du portefeuille (`coque.md` PF-10) : ce qui l'attend, son jalon en cours (le même que le phare de son Aperçu) avec son avancement et son échéance, ses cartes ouvertes, ses sessions vivantes et l'ancienneté de son dernier événement. Le bord ambre dit qu'une session y attend. Elle mène au projet.",
      },
    },
  },
  args: { summary: SUMMARY },
  decorators: [cell],
} satisfies Meta<typeof ProjectSummaryCard>

export default meta
type Story = StoryObj<typeof meta>

export const EnCours: Story = { name: 'Jalon en cours' }

export const Attend: Story = {
  name: 'Une session attend',
  args: { summary: { ...SUMMARY, waiting: 2, live: 3, milestone: { ...SUMMARY.milestone!, dueAt: null } } },
}

export const SansJalon: Story = {
  name: 'Sans jalon, au calme',
  args: {
    summary: { ...SUMMARY, project: project('p-atlas', 'Atlas, l’API des lieux et de leurs fuseaux horaires', '#E0A43B'), live: 0, open: 1, milestone: null, lastAt: null },
  },
}
