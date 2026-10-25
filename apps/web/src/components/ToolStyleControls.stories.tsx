import type { Meta, StoryObj } from '@storybook/react-vite'
import { ToolStyleControls } from './ToolStyleControls'

const meta = {
  title: "Composants d'application/ToolStyleControls",
  component: ToolStyleControls,
  parameters: {
    docs: {
      description: {
        component:
          "Le choix de la présentation des outils dans le fil, dans Apparence.\n\nSix présentations à la même densité, et un aperçu monté sur les vrais composants du fil : un outil de Solera, un MCP d'un autre serveur, un outil du CLI en cours. Le choix est enregistré sur le compte, comme le thème.",
      },
    },
  },
} satisfies Meta<typeof ToolStyleControls>

export default meta
type Story = StoryObj<typeof meta>

export const Defaut: Story = { name: 'Par défaut' }
