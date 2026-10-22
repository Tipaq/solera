import type { Meta, StoryObj } from '@storybook/react-vite'
import { DecisionDialog } from './DecisionDialog'
import { ANSWERED, DEFAULTED, EXPIRED, OPEN_QUESTION, PENDING, SeededDecisions, WITHDRAWN, WORKTREE } from './decision-fixtures'

const meta = {
  title: "Composants d'application/DecisionDialog",
  component: DecisionDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La réponse à une décision qu'une session a demandée (`request_decision`), d'où qu'on l'ouvre : la colonne « À décider », un toast, le fil de la session, l'historique ou une notification système.\n\n**On tranche ici sans entrer dans la conversation**, qui reste à un clic : choisir demande de lire le contexte, que la colonne et le toast n'ont pas la place de montrer. Un choix se reclique pour se défaire ; la précision écrite accompagne le choix, ou le remplace quand l'agent n'en a proposé aucun.\n\nL'échéance et ce qui arrivera sans réponse sont dits sous le formulaire. Une décision close montre son issue au lieu du formulaire, et c'est aussi ce qui s'affiche quand elle a été tranchée ailleurs pendant qu'on hésitait.\n\nCoque du gabarit *Dialogue* : feuille au doigt, boîte de 640 px au large.",
      },
    },
  },
} satisfies Meta<typeof DecisionDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Le cas complet : un contexte, trois choix, un défaut à l'échéance. */
export const Attente: Story = {
  render: () => <SeededDecisions open={PENDING.id}><DecisionDialog /></SeededDecisions>,
}

/** Sans choix proposés : la réponse s'écrit, et personne ne répondra à sa place. */
export const QuestionOuverte: Story = {
  name: 'Question ouverte',
  render: () => <SeededDecisions open={OPEN_QUESTION.id}><DecisionDialog /></SeededDecisions>,
}

/** Tranchée par une personne, avec une précision. */
export const Tranchee: Story = {
  name: 'Tranchée',
  render: () => <SeededDecisions open={ANSWERED.id}><DecisionDialog /></SeededDecisions>,
}

/** L'échéance a appliqué le choix par défaut. */
export const ParDefaut: Story = {
  name: 'Défaut appliqué',
  render: () => <SeededDecisions open={DEFAULTED.id}><DecisionDialog /></SeededDecisions>,
}

/** Échue sans défaut : la session a appris que personne n'a répondu. */
export const Echue: Story = {
  name: 'Échue',
  render: () => <SeededDecisions open={EXPIRED.id}><DecisionDialog /></SeededDecisions>,
}

/** Retirée : la session a été archivée avant qu'on tranche. */
export const Retiree: Story = {
  name: 'Retirée',
  render: () => <SeededDecisions open={WITHDRAWN.id}><DecisionDialog /></SeededDecisions>,
}

/** Posée par Solera : un arbre fusionné et propre, à nettoyer ou garder. Pas de réponse libre. */
export const Nettoyage: Story = {
  render: () => <SeededDecisions open={WORKTREE.id}><DecisionDialog /></SeededDecisions>,
}
