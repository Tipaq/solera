import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardDraft } from '@solera/protocol'
import { AdditionProposal } from './AdditionProposal'

const DRAFT: CardDraft = {
  parent: { kind: 'existing', card: { cardId: 'card-182', number: 182, title: 'Page projet v2 · Jalons' } },
  cards: [
    { key: 'a', title: 'Pièces jointes hors ligne', description: '', subtasks: [], after: [], blockedBy: [{ cardId: 'card-192', number: 192, title: 'Barres' }], related: [] },
    { key: 'b', title: 'Vignettes en cache', description: '', subtasks: [], after: ['a'], blockedBy: [], related: [] },
    { key: 'c', title: 'Bandeau hors ligne', description: '', subtasks: [], after: [], blockedBy: [], related: [] },
  ],
}

const meta = {
  title: "Composants d'application/Ajout proposé au jalon",
  component: AdditionProposal,
  parameters: {
    docs: {
      description: {
        component:
          "Où la session d'affinage range un ajout au jalon (#196, spec jalons AFF-7) : en sous-tâches d'une carte — celles qu'elle porte déjà sont dites, le clic les sautera —, ou en nouvelles cartes, chacune avec ce après quoi elle part. « Laisser tel quel » refuse la demande ; rien n'est écrit avant le clic.",
      },
    },
  },
  args: { canDecide: true, busy: false, error: null, onDecide: () => {} },
  render: (args) => (
    <div className="w-[min(46rem,100%)]">
      <AdditionProposal {...args} />
    </div>
  ),
} satisfies Meta<typeof AdditionProposal>

export default meta
type Story = StoryObj<typeof meta>

/** Une sous-tâche dans une carte du jalon. */
export const SousTache: Story = {
  args: {
    addition: {
      kind: 'subtasks', conversationId: 'split', requestId: 'c1',
      targets: [{ cardId: 'card-192', number: 192, title: 'Barres', subtasks: [{ label: 'Pièces jointes hors ligne', present: false }] }],
    },
  },
}

/** Deux sous-tâches, dont une que la carte porte déjà. */
export const DejaPresente: Story = {
  args: {
    addition: {
      kind: 'subtasks', conversationId: 'split', requestId: 'c1',
      targets: [{ cardId: 'card-192', number: 192, title: 'Barres', subtasks: [{ label: 'Barres par jour', present: true }, { label: 'Pièces jointes hors ligne', present: false }] }],
    },
  },
}

/** Rien de neuf : la carte les porte toutes, « Ajouter » est grisé. */
export const RienDeNeuf: Story = {
  args: {
    addition: {
      kind: 'subtasks', conversationId: 'split', requestId: 'c1',
      targets: [{ cardId: 'card-192', number: 192, title: 'Barres', subtasks: [{ label: 'Barres par jour', present: true }] }],
    },
  },
}

/** De nouvelles cartes dans un jalon déjà découpé. */
export const NouvellesCartes: Story = {
  args: {
    addition: {
      kind: 'cards', conversationId: 'split', requestId: 'd2', draft: DRAFT,
      cards: [
        { key: 'a', title: 'Pièces jointes hors ligne', after: { number: 192 } },
        { key: 'b', title: 'Vignettes en cache', after: { title: 'Pièces jointes hors ligne' } },
        { key: 'c', title: 'Bandeau hors ligne', after: null },
      ],
    },
  },
}

/** Lu par qui n'a pas le projet : la proposition, sans les boutons. */
export const SansDroit: Story = { args: { ...NouvellesCartes.args, canDecide: false } }
