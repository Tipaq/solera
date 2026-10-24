import type { Meta, StoryObj } from '@storybook/react-vite'
import { ACTIONS, PROJECT_ID } from './action-fixtures'
import { ActionDialog } from './ActionDialog'

const meta = {
  title: "Composants d'application/ActionDialog",
  component: ActionDialog,
  parameters: {
    docs: {
      description: {
        component:
          "Créer ou modifier une action : libellé, nature, commande, dossier, adresse d'un service. Rien n'est écrit dans le dépôt ; une action créée ici est relue d'office, puisque c'est une personne qui l'écrit.",
      },
    },
  },
  args: { projectId: PROJECT_ID, onClose: () => {} },
} satisfies Meta<typeof ActionDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Creation: Story = { name: 'Création' }

/** Un service avec son adresse, où `{port}` prendra le port détecté. */
export const Modification: Story = { args: { action: ACTIONS[0] } }
