import type { Meta, StoryObj } from '@storybook/react-vite'
import { TurnChanges } from './TurnChanges'
import { turnCheckpoint } from './checkpoint-fixtures'

const meta = {
  title: "Composants d'application/TurnChanges",
  component: TurnChanges,
  parameters: {
    docs: {
      description: {
        component:
          "Ce qu'un tour a changé dans le dépôt, en une ligne posée à la fin du tour.\n\nUn repère de marge et non une bulle : il ne dit rien que le tour n'ait déjà dit, il ouvre sur la vue Git filtrée sur ce tour et sur le retour à l'état d'avant. Les chiffres viennent des deux captures git du tour (`refs/solera/checkpoints/…`), pas du journal : un fichier écrit par un script lancé par l'agent y figure aussi.\n\nUn tour sans changement n'a pas de repère, une capture manquée non plus. Le retour en arrière n'est offert qu'au propriétaire du fil, hors tour.",
      },
    },
  },
  args: {
    checkpoint: turnCheckpoint,
    onShow: () => {},
    onRestore: () => {},
  },
} satisfies Meta<typeof TurnChanges>

export default meta
type Story = StoryObj<typeof meta>

export const Pret: Story = { name: 'Prêt' }

/** Conversation partagée, ou tour en cours : on voit, on ne défait pas. */
export const SansRetour: Story = {
  name: 'Sans retour en arrière',
  args: { onRestore: undefined },
}

/** Après un retour en arrière : la marge pâlit, et le repère le dit. */
export const Ramene: Story = {
  name: 'Ramené en arrière',
  args: { checkpoint: { ...turnCheckpoint, restored: true } },
}

/** Une liste coupée : le fil le dit, le diff complet reste lisible par l'API. */
export const Partielle: Story = {
  name: 'Liste partielle',
  args: { checkpoint: { ...turnCheckpoint, truncated: true } },
}
