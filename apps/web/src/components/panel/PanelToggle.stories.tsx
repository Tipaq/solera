import type { Meta, StoryObj } from '@storybook/react-vite'
import { PanelToggle } from './PanelToggle'

const meta = {
  title: "Composants d'application/Panneau/Bouton du panneau",
  component: PanelToggle,
  args: { open: false, status: { running: 2, toReview: 1 } },
  parameters: {
    docs: {
      description: {
        component:
          "Le bouton qui ouvre le panneau d'une conversation. Un point ambre quand une action du projet attend sa relecture, sinon vert quand quelque chose y tourne ; rien quand tout est calme. Son nom le dit : « Ouvrir le panneau — 2 en marche · 1 à relire ».",
      },
    },
  },
} satisfies Meta<typeof PanelToggle>

export default meta
type Story = StoryObj<typeof meta>

/** Une action à relire : l'ambre l'emporte. */
export const ARelire: Story = { name: 'À relire' }

/** Rien à relire : le vert seul. */
export const EnMarche: Story = { name: 'En marche', args: { status: { running: 2, toReview: 0 } } }

/** Rien ne tourne ni n'attend, ou un fil libre. */
export const Calme: Story = { args: { status: null } }

/** Le panneau ouvert : l'icône passe à l'accent, le point reste. */
export const Ouvert: Story = { args: { open: true } }
