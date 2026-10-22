import type { Meta, StoryObj } from '@storybook/react-vite'
import { CLI_TOAST, DECISION_TOAST, QUESTION_TOAST, SeededDecisions } from './decisions/decision-fixtures'
import { Toaster } from './Toaster'

const meta = {
  title: "Composants d'application/Toaster",
  component: Toaster,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Les toasts de l'application, en haut de l'écran : en bas, ils couvriraient la barre de saisie. Centrés au téléphone, à droite au large.\n\n**Seul ce qu'un humain doit traiter arrive ici** — un CLI qui attend dans une autre conversation, une décision qu'une session demande. Une fin de tour n'en fait jamais : la colonne la montre déjà. Le serveur ne les envoie qu'aux onglets visibles, et pousse la notification système aux autres appareils.\n\nIls restent jusqu'à ce qu'on les traite ou les écarte. Ouvrir la conversation règle une demande de CLI ; une décision tranchée, ici ou ailleurs, retire son toast. Au-delà de deux, le reste se compte.\n\nSur leur propre couche, `z-[90]`, au-dessus d'un dialogue : elle reste à inscrire dans `LAYERS` du design system.",
      },
    },
  },
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

/** Une décision demandée : la question, d'où elle vient, et de quoi y répondre sur place. */
export const Decision: Story = {
  name: 'Décision',
  render: () => <SeededDecisions toasts={[DECISION_TOAST]}><div className="h-64" /><Toaster /></SeededDecisions>,
}

/** Un CLI qui attend une autorisation dans une autre conversation. */
export const DemandeDeCli: Story = {
  name: 'Demande de CLI',
  render: () => <SeededDecisions toasts={[CLI_TOAST]}><div className="h-64" /><Toaster /></SeededDecisions>,
}

/** Trois demandes : les deux plus récentes, et la troisième comptée. */
export const Pile: Story = {
  render: () => (
    <SeededDecisions toasts={[CLI_TOAST, QUESTION_TOAST, DECISION_TOAST]}>
      <div className="h-96" />
      <Toaster />
    </SeededDecisions>
  ),
}
