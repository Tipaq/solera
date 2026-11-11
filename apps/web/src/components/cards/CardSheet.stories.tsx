import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { DetailSurfaceContext } from '../../lib/detail-surface'
import { CARDS, CURRENT, PROJECT_ID, SeededBoard } from '../board/card-fixtures'
import { DrawerLayer } from '../shell/Drawer'
import { CardInfoButton } from './CardInfoButton'
import { CardSheet } from './CardSheet'
import { CardSheetHost } from './CardSheetHost'

const DAY = 24 * 60 * 60 * 1000

/** Une zone de contenu de lieu, sous une rangée, qui porte le calque des tiroirs. */
function Place({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[44rem] flex-col border border-line">
      <div className="h-11 shrink-0 border-b border-line" />
      <div className="relative flex min-h-0 flex-1 overflow-clip">
        <div className="min-w-0 flex-1 p-4 text-sm text-ink-soft md:p-6">{children}</div>
        <DrawerLayer />
      </div>
    </div>
  )
}

const withBoard: Decorator = (Story) => (
  <SeededBoard>
    <Story />
  </SeededBoard>
)

const byNumber = (number: number) => CARDS.find((entry) => entry.number === number)!

const meta = {
  title: "Composants d'application/CardSheet",
  component: CardSheet,
  decorators: [withBoard],
  parameters: {
    docs: {
      description: {
        component:
          "La fiche d'une carte **sur place** (#199), hors du board : l'icône `ℹ` d'une carte l'ouvre par-dessus la vue, sans la quitter, et l'adresse la retient (`?fiche=N`).\n\nDans l'ordre de ce qu'on vient y faire : répondre à la session qui attend (`AskInbox` nu), voir ses sessions, cocher, suivre les liens — un clic passe à la fiche de la carte liée —, lire. En pied, les gestes de fond et la case **« C'est un jalon »**, cochée et grisée d'office quand la carte a des enfants, grisée quand elle est rangée dans un jalon.\n\nLa fiche du board (`CardDetail`, `?carte=`) reste celle où l'on édite.",
      },
    },
  },
  args: { open: true, projectId: PROJECT_ID, card: CURRENT, onClose: () => undefined, onSelect: () => undefined },
  render: (args) => (
    <Place>
      <CardSheet {...args} />
    </Place>
  ),
} satisfies Meta<typeof CardSheet>

export default meta
type Story = StoryObj<typeof meta>

/** Une carte rangée dans un jalon : sessions, cases, liens, notes ; la case « jalon » grisée. */
export const Fiche: Story = {}

/** En retard : l'échéance passe en rouge. */
export const EnRetard: Story = {
  name: 'En retard',
  args: { card: { ...CURRENT, dueAt: Date.UTC(2026, 9, 19, 10, 0) - 2 * DAY } },
}

/** Un jalon : la case est cochée d'office et grisée, « Dedans » liste ses enfants. */
export const Jalon: Story = { args: { card: byNumber(42) } }

/** Une carte nue, sans session : « Lancer une session », la case « jalon » libre. */
export const Vierge: Story = { args: { card: byNumber(40) } }

/** Dans le panneau d'une conversation : la fiche s'ouvre en pile, « ‹ Projet » pour revenir. */
export const EnPile: Story = {
  name: 'En pile',
  args: { back: 'Projet' },
  render: (args) => (
    <DetailSurfaceContext.Provider value="panel">
      <div className="surface flex h-[44rem] w-[26rem] flex-col border border-line">
        <CardSheet {...args} />
      </div>
    </DetailSurfaceContext.Provider>
  ),
}

/** Depuis une liste : `ℹ` écrit `?fiche=N`, l'hôte monté par la page ouvre la fiche. */
export const DepuisUneListe: Story = {
  name: 'Depuis une liste',
  render: () => (
    <Place>
      <ul className="flex max-w-sm flex-col gap-1">
        {CARDS.slice(0, 6).map((card) => (
          <li key={card.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface">
            <span className="text-xs text-ink-faint tabular-nums">#{card.number}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{card.title}</span>
            <CardInfoButton card={card} />
          </li>
        ))}
      </ul>
      <CardSheetHost projectId={PROJECT_ID} />
    </Place>
  ),
}
