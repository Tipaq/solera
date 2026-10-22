import type { Meta, StoryObj } from '@storybook/react-vite'
import { WorktreeGoneNotice } from './WorktreeGoneNotice'

const meta = {
  title: "Composants d'application/WorktreeGoneNotice",
  component: WorktreeGoneNotice,
  parameters: {
    docs: {
      description: {
        component:
          "Ce qui remplace le composer quand le worktree d'une conversation a disparu, le plus souvent emporté avec sa branche par un merge.\n\n**Archiver** est le geste principal : après un merge, le travail est livré. **Continuer à la racine** rattache le fil au dossier du projet ; la ligne du dessous dit avant le clic si le CLI y garde sa session ou repart sur une neuve. Rien ne bascule en silence.",
      },
    },
  },
  args: {
    agent: 'claude',
    canAct: true,
    pending: false,
    onArchive: () => {},
    onContinue: () => {},
  },
} satisfies Meta<typeof WorktreeGoneNotice>

export default meta
type Story = StoryObj<typeof meta>

/** Claude reprend sa session depuis la racine. */
export const Claude: Story = {}

/** opencode ne la reprend pas : le bandeau le dit avant le geste. */
export const SessionNeuve: Story = {
  name: 'Session neuve',
  args: { agent: 'opencode' },
}

/** Un fil partagé, lu par quelqu'un d'autre que son propriétaire : l'état, sans les gestes. */
export const Lecteur: Story = {
  args: { canAct: false },
}

/** Le geste a échoué : la raison s'affiche au-dessus des boutons, qui restent là. */
export const Erreur: Story = {
  args: { error: 'Cette conversation a encore son worktree.' },
}
