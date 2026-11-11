import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { JournalEntryDto } from '@solera/protocol'
import { RecentEventsView } from './RecentEvents'

const HOUR = 3_600_000
const now = Date.now()

const base = {
  projectId: 'p-nimbus',
  cardNumber: null,
  source: null,
  count: null,
  status: null,
  conversationId: null,
} satisfies Omit<JournalEntryDto, 'id' | 'kind' | 'at' | 'title'>

const ENTRIES: JournalEntryDto[] = [
  { ...base, id: 'closed', kind: 'cardClosed', at: now - 0.4 * HOUR, title: 'Axe à deux étages du Gantt', cardNumber: 12 },
  { ...base, id: 'branch', kind: 'branch', at: now - 2 * HOUR, title: 'feat/902-maturite fusionnée dans jalon/901', count: 4 },
  { ...base, id: 'note', kind: 'note', at: now - 5 * HOUR, title: 'Le cache hors ligne garde sept jours', cardNumber: 7, conversationId: 'c1' },
  { ...base, id: 'session', kind: 'session', at: now - 20 * HOUR, title: 'Refactor settings storage', conversationId: 'c2' },
  { ...base, id: 'run', kind: 'run', at: now - 30 * HOUR, title: 'Revue nocturne', status: 'failed' },
]

/** La largeur de la colonne de droite de l'Aperçu, 24 rem. */
const column: Decorator = (Story) => <div className="w-96"><Story /></div>

const meta = {
  title: "Composants d'application/Aperçu · Derniers événements",
  component: RecentEventsView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Les *Derniers événements* de l'Aperçu (`projet.md` A-6) : les cinq dernières lignes du journal, toutes natures mêlées, une icône teintée seulement pour ce qui ferme un chantier ou a échoué. Une ligne mène à sa session, sinon à sa carte, sinon elle reste inerte. Le lien du titre ouvre Travail › Par moment.",
      },
    },
  },
  args: { projectId: 'p-nimbus', entries: ENTRIES, days: 14 },
  decorators: [column],
} satisfies Meta<typeof RecentEventsView>

export default meta
type Story = StoryObj<typeof meta>

export const Cinq: Story = { name: 'Cinq événements' }

export const Vide: Story = { args: { entries: [] } }
