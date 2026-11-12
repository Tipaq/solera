import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { DEFAULT_DISPLAY } from '../../lib/board-model'
import { ListView } from './ListView'
import { BOARD } from './board-fixtures'

const inPlace: Decorator = (Story) => (
  <div className="h-[40rem] border border-line">
    <Story />
  </div>
)

const meta = {
  title: "Composants d'application/ListView",
  component: ListView,
  decorators: [inPlace],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La Liste du Tableau (B-5) : une table dense groupée par jalon, triée par ses en-têtes, pilotée au clavier. ↑↓ ou j/k déplacent la sélection, Entrée ouvre la fiche, 1 à 4 rangent la carte.",
      },
    },
  },
  args: {
    entries: BOARD.cards,
    milestones: BOARD.milestones,
    display: DEFAULT_DISPLAY,
    column: null,
    onOpen: () => {},
    onMove: () => {},
  },
} satisfies Meta<typeof ListView>

export default meta
type Story = StoryObj<typeof meta>

/** Les ouvertes et les cinq dernières faites, par jalon puis « Sans jalon ». */
export const Groups: Story = {}

/** « Tout voir » de Fait : la colonne filtrée, toutes ses cartes. */
export const OnlyDone: Story = { args: { entries: BOARD.cards.filter((entry) => entry.card.column === 'done'), column: 'done' } }

/** Fait masquée, les abandonnées montrées. */
export const Abandoned: Story = { args: { display: { ...DEFAULT_DISPLAY, done: 'hidden', abandoned: true } } }

/** Rien ne passe les filtres. */
export const Empty: Story = { args: { entries: [] } }
