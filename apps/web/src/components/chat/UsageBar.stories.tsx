import type { Meta, StoryObj } from '@storybook/react-vite'
import { UsageBar } from './UsageBar'

const meta = {
  title: "Composants d'application/UsageBar",
  component: UsageBar,
  parameters: {
    docs: {
      description: {
        component:
          "Une fenêtre de quota, telle que le CLI la déclare.\n\nLe protocole en porte une **liste** et non un jeu de champs nommés : les CLI en ajoutent régulièrement côté serveur, sans mise à jour du client. Figer une liste reviendrait à rebuilder à chaque nouveauté, et à masquer en silence tout ce qui n'aurait pas été prévu.\n\nLes seuils (0,75 et 0,9) sont un **choix d'affichage**, pas une information du CLI : aucun des protocoles ne déclare de niveau de gravité exploitable.\n\nLe quatrième cas est le plus important : quand le CLI ne fournit pas le taux, la barre ne dessine **rien**. Une barre vide dirait « zéro », ce qui serait une affirmation que le CLI n'a pas faite.",
      },
    },
  },
  args: { window: { id: 'session', label: 'Session (5 h)', utilization: 0.32, resetsAt: null } },
} satisfies Meta<typeof UsageBar>

export default meta
type Story = StoryObj<typeof meta>

export const Bac: Story = {}

export const LesQuatreEtats: Story = {
  name: 'Les quatre états',
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-4">
      <UsageBar
        window={{ id: 'a', label: 'Session (5 h)', utilization: 0.32, resetsAt: Date.now() + 3 * 3600_000 }}
      />
      <UsageBar
        window={{ id: 'b', label: 'Semaine', utilization: 0.81, resetsAt: Date.now() + 52 * 3600_000 }}
      />
      <UsageBar
        window={{ id: 'c', label: 'Opus · semaine', utilization: 0.94, resetsAt: Date.now() + 20 * 60_000 }}
      />
      <UsageBar window={{ id: 'd', label: 'Fenêtre non renseignée', utilization: null, resetsAt: null }} />
    </div>
  ),
}
