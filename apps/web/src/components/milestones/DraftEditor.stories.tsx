import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { CardDraft } from '@solera/protocol'
import { DraftEditor } from './DraftEditor'

const card = (key: string, title: string, after: string[] = [], extra: Partial<CardDraft['cards'][number]> = {}) => ({
  key, title, description: '', subtasks: [], after, blockedBy: [], related: [], ...extra,
})

const DRAFT: CardDraft = {
  parent: { kind: 'existing', card: { cardId: 'card-182', number: 182, title: 'Page projet v2 · Jalons' } },
  cards: [
    card('a', 'Échelle et axe du Gantt', [], { subtasks: ['Échelle par jour', 'Axe des mois'] }),
    card('b', 'Barres de cartes', ['a']),
    card('c', 'Infobulle flottante', ['a'], { blockedBy: [{ cardId: 'card-161', number: 161, title: 'Tiroir commun' }] }),
    card('d', 'Horizon des jalons', ['b', 'c']),
  ],
}

/** Le brouillon corrigé reste celui de la story : chaque geste s'y voit. */
function Editable({ draft: initial, blocked }: { draft: CardDraft; blocked: boolean }) {
  const [draft, setDraft] = useState(initial)
  return (
    <div className="w-[min(46rem,100%)]">
      <DraftEditor draft={draft} onChange={setDraft} blocked={blocked} onValidate={() => undefined} busy={false} error={null} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Brouillon de découpage d'un jalon",
  component: DraftEditor,
  parameters: {
    docs: {
      description: {
        component:
          "Le brouillon `propose_cards` corrigé sur la page d'un jalon (#195, spec jalons AFF-6) : renommer en place, monter, descendre, retirer, lier aux cartes du dessus par leurs lettres, ajouter à la fin, puis valider. Les gestes sont les fonctions pures de `lib/card-draft-edit` ; `cardDraftProblems` grise la validation. Sans la propriété de la session, il se lit seulement.",
      },
    },
  },
  args: { draft: DRAFT, onChange: () => undefined, blocked: false, onValidate: () => undefined, busy: false, error: null },
} satisfies Meta<typeof DraftEditor>

export default meta
type Story = StoryObj<typeof meta>

/** À corriger : chaque geste modifie le brouillon de la story. */
export const ACorriger: Story = {
  render: () => <Editable draft={DRAFT} blocked={false} />,
}

/** Une question de la session est ouverte : « Valider » attend sa réponse. */
export const QuestionOuverte: Story = {
  render: () => <Editable draft={DRAFT} blocked />,
}

/** L'agent a fait attendre une carte du dessous : le lien se lit, allumé, et s'éteint. */
export const LienVersLeDessous: Story = {
  render: () => <Editable draft={{ ...DRAFT, cards: [card('a', 'Cache des cartes', ['c']), card('b', 'File des envois'), card('c', 'Bandeau hors ligne')] }} blocked={false} />,
}

/** En lecture, pour qui ne possède pas la session. */
export const EnLecture: Story = {
  render: (args) => (
    <div className="w-[min(46rem,100%)]">
      <DraftEditor {...args} readOnly />
    </div>
  ),
}
