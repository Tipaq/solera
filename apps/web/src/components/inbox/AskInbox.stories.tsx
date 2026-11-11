import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import type { InboxItem } from '../../lib/inbox'
import type { SessionRequest } from '../../lib/session-request-summary'
import { AskInbox, openInboxItem } from './AskInbox'

const MINUTE = 60_000

const QUESTION: SessionRequest = {
  kind: 'question',
  requestId: 'q1',
  requestedAt: Date.now() - 12 * MINUTE,
  event: {
    type: 'question.requested',
    requestId: 'q1',
    questions: [
      {
        id: 'keep',
        header: 'Composant',
        question: 'Je peux supprimer l’ancien composant, ou faut-il le garder derrière un réglage le temps de la transition ?',
        options: [
          { label: 'Le supprimer', description: '', preview: null },
          { label: 'Le garder derrière un réglage', description: '', preview: null },
        ],
        multiSelect: false,
        allowOther: true,
        secret: false,
      },
    ],
  },
}

const PERMISSION: SessionRequest = {
  kind: 'permission',
  requestId: 'p1',
  requestedAt: Date.now() - 4 * MINUTE,
  event: {
    type: 'permission.requested',
    requestId: 'p1',
    toolName: 'Bash',
    input: { command: 'pnpm install --ignore-scripts' },
    suggestions: [],
  },
}

const milestone = (number: number, title: string) => ({ number, title, to: `/p/p1/timeline/${number}` })

function session(
  key: string,
  title: string,
  ago: number,
  rest: Partial<Extract<InboxItem, { kind: 'session' }>> = {},
): InboxItem {
  return {
    kind: 'session',
    key,
    conversationId: key,
    title,
    project: null,
    agent: 'claude',
    tone: 'awaiting',
    since: Date.now() - ago * MINUTE,
    milestone: null,
    cardNumber: null,
    open: `/p/p1/c/${key}`,
    request: null,
    canDecide: true,
    ...rest,
  }
}

const TWO: InboxItem[] = [
  session('s-a', 'Socle commun de la page projet', 12, {
    cardNumber: 163,
    milestone: milestone(157, 'Page projet v2 · 1 — Socle commun'),
    request: QUESTION,
  }),
  session('s-b', 'Installer les dépendances', 4, { agent: 'codex', request: PERMISSION }),
]

const FIVE: InboxItem[] = [
  ...TWO,
  session('s-c', 'Vue Git, lot 3', 95, { tone: 'broken', agent: 'opencode', cardNumber: 50 }),
  {
    kind: 'light',
    key: 'c-1',
    tone: 'review-card',
    title: 'Comptes d’onglet à trois tons',
    project: null,
    number: 158,
    to: '/p/p1/board?carte=158',
    external: false,
    since: Date.now() - 3 * 60 * MINUTE,
  },
  {
    kind: 'light',
    key: 'pr-p1-118',
    tone: 'review-pr',
    title: 'Dev container sous Windows natif',
    project: null,
    number: 118,
    to: 'https://github.com/o/r/pull/118',
    external: true,
    since: Date.now() - 26 * 60 * MINUTE,
  },
]

const MILESTONES: InboxItem[] = [
  {
    kind: 'refine',
    key: 'q-182',
    milestone: milestone(182, 'Jalons'),
    questions: [
      { id: '1', text: 'Le phare montre-t-il le jalon courant ou le prochain à livrer ?' },
      { id: '2', text: 'Une carte sans échéance hérite-t-elle de celle du jalon ?' },
    ],
    onAnswer: () => {},
  },
  {
    kind: 'draft',
    key: 'd-200',
    milestone: milestone(200, 'Actions et Planifiées'),
    cards: [
      { key: 'a', title: 'Compte des actions', after: [] },
      { key: 'b', title: 'Onglet Actions', after: ['a'] },
      { key: 'c', title: 'Planifiées', after: ['a', 'b'] },
    ],
    onValidate: () => {},
  },
  {
    kind: 'merge',
    key: 'm-157',
    milestone: milestone(157, 'Socle commun'),
    branch: 'jalon/157-socle-commun',
    base: 'main',
    onMerge: () => {},
  },
]

const padded: Decorator = (Story) => (
  <div className="max-w-4xl p-6">
    <Story />
  </div>
)

const meta = {
  title: "Composants d'application/Ce qui t'attend",
  component: AskInbox,
  args: { items: TWO },
  decorators: [padded],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "**Une seule liste** pour tout ce qui réclame Tim (#163), posée par l'Aperçu, Travail, le panneau, `/sessions` et le portefeuille. Une ligne par demande ; la réponse se déplie au geste, **une à la fois**, et se referme après l'envoi. Trois lignes visibles, puis « N de plus ».\n\nLes **lourdes** (une réponse) passent avant les **légères** (un coup d'œil : carte à relire, PR prête). L'étiquette « Jalon #N » mène au jalon sans ouvrir la ligne. Ailleurs — un jalon, une carte — on ne pose qu'un repère qui ouvre la ligne ici (`openInboxItem`), jamais la demande recopiée.",
      },
    },
  },
} satisfies Meta<typeof AskInbox>

export default meta
type Story = StoryObj<typeof meta>

/** Rien n'attend : une ligne calme, pas de bloc vide. */
export const Vide: Story = { args: { items: [] } }

/** Une question et une permission, avec leur jalon et leur carte. */
export const DeuxDemandes: Story = { name: 'Deux demandes', args: { items: TWO } }

/** Cinq lignes, dont une session arrêtée, une carte à relire et une PR : trois visibles, puis « 2 de plus ». */
export const CinqLignes: Story = { name: 'Cinq lignes dont une PR', args: { items: FIVE } }

/** La question dépliée sous sa ligne, avec ses choix et le champ libre. */
export const UneDepliee: Story = {
  name: 'Une dépliée',
  args: { items: FIVE },
  render: (args) => <Opened {...args} openKey="s-a" />,
}

/** Les trois genres du domaine Jalons : affinage, découpage, PR du jalon. */
export const Jalons: Story = {
  name: 'Affinage, découpage, PR de jalon',
  args: { items: MILESTONES },
  render: (args) => <Opened {...args} openKey="d-200" />,
}

/** Sans en-tête, pour une tuile qui porte déjà son titre. */
export const SansEnTete: Story = { name: 'Sans en-tête', args: { items: TWO, bare: true } }

function Opened({ openKey, ...props }: { items: InboxItem[]; bare?: boolean; openKey: string }) {
  useEffect(() => openInboxItem(openKey), [openKey])
  return <AskInbox {...props} />
}
