import type { Meta, StoryObj } from '@storybook/react-vite'
import { FilingPrompt } from './FilingPrompt'

const meta = {
  title: "Composants d'application/FilingPrompt",
  component: FilingPrompt,
  parameters: {
    docs: {
      description: {
        component:
          "La demande de rangement qu'un agent dépose dans un fil, et que son propriétaire accorde d'un clic.\n\n**Elle annonce son prix, elle ne refuse pas.** Déplacer une conversation détache son worktree et sa carte, et coûte la session native quand le dossier change et que le CLI ne sait pas la reprendre depuis le nouveau (l'agent repart alors d'une sélection du fil) — mais le travail non commité ne bouge pas : il reste dans le projet de départ, visible et récupérable. Refuser quand l'arbre est sale aurait protégé d'une perte qui n'a pas lieu ; refuser dès qu'il y a un worktree aurait rendu indéplaçable toute session ayant travaillé dans un arbre. On le dit, et on exige une confirmation explicite, comme le `force` d'un worktree sale.\n\nLes lignes de prix absentes ne s'affichent pas : un fil libre sans worktree ni carte n'a qu'un prix, la session du CLI, et le plus souvent aucun.\n\nAccordée, la demande ne déplace rien tout de suite : le balayage du daemon applique dès que la conversation se tait, et c'est ce que dit la phrase de l'état accordé.",
      },
    },
  },
  args: {
    conversationId: 'c1',
    canDecide: true,
    filing: {
      kind: 'filing',
      id: 'r1',
      conversationId: 'c1',
      conversationTitle: 'Porter le contexte Savoir',
      projectName: 'Solera',
      worktree: { name: 'design/savoir', dirtyFiles: 4 },
      card: { number: 23, title: 'Un agent déclare un projet' },
      resumable: true,
      status: 'pending',
      reason: null,
    },
  },
} satisfies Meta<typeof FilingPrompt>

export default meta
type Story = StoryObj<typeof meta>

/** Le cas complet : un arbre sale, une carte rattachée, une session reprenable. */
export const Attente: Story = {}

/** Un fil libre : rien à détacher, et le CLI n'avait pas encore de session à reprendre. */
export const FilLibre: Story = {
  name: 'Fil libre',
  args: {
    filing: {
      ...meta.args.filing,
      worktree: null,
      card: null,
      resumable: false,
    },
  },
}

/** Un arbre propre : on nomme quand même le worktree, qui ne suivra pas. */
export const ArbrePropre: Story = {
  name: 'Arbre propre',
  args: {
    filing: { ...meta.args.filing, worktree: { name: 'fix/titre-tronque', dirtyFiles: 0 } },
  },
}

/** Accordée : le déplacement attend que la conversation se taise. */
export const Accordee: Story = {
  name: 'Accordée',
  args: { filing: { ...meta.args.filing, status: 'accepted' } },
}

export const Refusee: Story = {
  name: 'Refusée',
  args: { filing: { ...meta.args.filing, status: 'refused' } },
}

/** Revérifié au clic : le projet de destination avait disparu entre-temps. */
export const Impossible: Story = {
  args: {
    filing: { ...meta.args.filing, status: 'impossible', reason: 'project_not_found' },
  },
}

/** Un fil partagé en lecture : la demande se voit, elle ne se tranche pas. */
export const SansDroit: Story = {
  name: 'Sans droit de décider',
  args: { canDecide: false },
}

/** Revérifié au clic (#119) : un travail de fond tournait, le déplacement l'aurait coupé. */
export const PlusApplicable: Story = {
  name: 'Plus applicable',
  args: {
    filing: { ...meta.args.filing, status: 'impossible', reason: 'background_running' },
  },
}
