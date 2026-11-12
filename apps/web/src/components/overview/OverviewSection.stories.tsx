import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { MoreLink, OverviewSection } from './OverviewSection'

/** La largeur de la colonne de droite de l'Aperçu, 24 rem. */
const column: Decorator = (Story) => <div className="w-96"><Story /></div>

const meta = {
  title: "Composants d'application/Aperçu · Bloc",
  component: OverviewSection,
  decorators: [column],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Un bloc de l'Aperçu : un intitulé petit et gris, un lien ↗ à droite quand un onglet en dit plus, puis des lignes. Pas de cadre : c'est l'écart entre les blocs qui sépare, et la seule surface teintée de la page est le phare des jalons. `caps` met l'intitulé en capitales (« ACTIONS »).",
      },
    },
  },
  args: {
    title: 'Derniers événements',
    more: <MoreLink to="/p/p-nimbus/travail?vue=moment">Par moment</MoreLink>,
    children: <p className="text-sm text-ink-faint">Rien ces 14 derniers jours.</p>,
  },
} satisfies Meta<typeof OverviewSection>

export default meta
type Story = StoryObj<typeof meta>

export const AvecLien: Story = { name: 'Avec un lien' }

export const EnCapitales: Story = {
  name: 'En capitales',
  args: { title: 'Actions', caps: true, more: undefined, children: <p className="text-sm text-ink-faint">Rien ne tourne.</p> },
}
