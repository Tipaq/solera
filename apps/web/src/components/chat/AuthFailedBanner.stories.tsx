import type { Meta, StoryObj } from '@storybook/react-vite'
import { AuthFailedBanner } from './AuthFailedBanner'

/**
 * Un tour refusé faute d'authentification. Hors serveur, le catalogue n'a ni le fil ni
 * d'autre compte : il montre le compte nommé et le lien vers la connexion d'un compte ;
 * le choix d'un autre compte n'apparaît qu'avec une liste.
 */
const meta = {
  title: "Composants d'application/Fil · connexion refusée",
  component: AuthFailedBanner,
  args: {
    conversationId: 'story',
    account: { id: null, label: null },
    message: 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}',
    canDecide: true,
  },
  render: (args) => <div className="w-[40rem]"><AuthFailedBanner {...args} /></div>,
} satisfies Meta<typeof AuthFailedBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Terminal: Story = { name: 'Connexion du terminal' }

export const Compte: Story = {
  name: 'Compte de Solera',
  args: { account: { id: 'perso', label: 'Tim perso' } },
}
