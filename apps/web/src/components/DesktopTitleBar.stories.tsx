import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { DesktopBridge } from '@solera/protocol'
import { DesktopTitleBar } from './DesktopTitleBar'

const chrome = (platform: DesktopBridge['window']['platform']): DesktopBridge['window'] => ({
  platform,
  menu: async () => undefined,
  colors: async () => undefined,
})

// La barre est fixée en haut de la fenêtre : `transform` en fait un bloc conteneur, pour
// qu'elle reste dans son cadre.
const inFrame: Decorator = (Story) => (
  <div className="relative h-20 overflow-hidden rounded-md border border-line [transform:translateZ(0)]">
    <Story />
  </div>
)

const meta = {
  title: "Composants d'application/Barre de titre du bureau",
  component: DesktopTitleBar,
  parameters: {
    docs: {
      description: {
        component:
          "La barre de titre de l'app de bureau, à la place des barres natives de titre et de menus. Elle prend le canevas du thème et en recopie les couleurs sur les contrôles natifs de la fenêtre, qui restent à leur place : les feux à gauche sous macOS, les boutons à droite ailleurs, où un bouton ouvre le menu de l'app.\n\nDans un navigateur, elle n'existe pas.",
      },
    },
  },
  decorators: [inFrame],
} satisfies Meta<typeof DesktopTitleBar>

export default meta
type Story = StoryObj<typeof meta>

export const WindowsEtLinux: Story = { name: 'Windows et Linux', args: { chrome: chrome('win32') } }

export const MacOS: Story = { name: 'macOS', args: { chrome: chrome('darwin') } }
