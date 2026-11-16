import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type {
  CardDraft,
  CardDto,
  CardLinkDto,
  CardRefinementDetailDto,
  CardRefinementDto,
  ConversationDto,
} from '@solera/protocol'
import { horizonOf } from '../../lib/milestone-model'
import { fixtureCard, PROJECT_ID } from '../board/card-fixtures'
import { RefinementPanel } from './RefinementPanel'

const NOW = Date.now()
const SESSION = 'split-182'

const session = (extra: Partial<CardRefinementDto> = {}): CardRefinementDto => ({
  conversationId: SESSION, title: 'Affiner : Page projet v2 · Jalons', status: 'idle', mode: 'questions', createdAt: NOW - 3_600_000,
  draft: null, change: null, ...extra,
})

const DRAFT: CardDraft = {
  parent: { kind: 'existing', card: { cardId: 'card-182', number: 182, title: 'Page projet v2 · Jalons' } },
  cards: [
    { key: 'a', title: 'Échelle et axe du Gantt', description: '', subtasks: ['Échelle par jour', 'Axe des mois'], after: [], blockedBy: [], related: [] },
    { key: 'b', title: 'Barres de cartes', description: '', subtasks: [], after: ['a'], blockedBy: [], related: [] },
    { key: 'c', title: 'Infobulle flottante', description: '', subtasks: [], after: ['a'], blockedBy: [{ cardId: 'card-161', number: 161, title: 'Tiroir commun' }], related: [] },
    { key: 'd', title: 'Horizon des jalons', description: '', subtasks: [], after: ['b', 'c'], blockedBy: [], related: [] },
  ],
}

const QUESTIONS: CardRefinementDetailDto['prompt'] = {
  kind: 'question', requestId: 'q1', requestedAt: NOW - 600_000,
  event: {
    type: 'question.requested', requestId: 'q1', blocking: true,
    questions: [
      { id: 'cible', header: 'Cible', question: 'À quoi verra-t-on que le jalon est fini ?', options: [], multiSelect: false, allowOther: true, secret: false },
      { id: 'gantt', header: 'Gantt', question: 'Le Gantt détaillé fait-il partie de ce jalon, ou du suivant ?', options: [], multiSelect: false, allowOther: true, secret: false },
    ],
  },
}

const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })

/** Le jalon #182, avec ou sans enfants, et sa session d'affinage. */
function entryOf(refinement: CardRefinementDto | null, withChildren = false) {
  const milestone = fixtureCard(182, 'Page projet v2 · Jalons', 'todo', {
    milestone: true, refinement, description: 'L’onglet Jalons, la page d’un jalon, son affinage et son lancement.',
  })
  const kids = withChildren ? [fixtureCard(191, 'Échelle et axe', 'todo'), fixtureCard(192, 'Barres de cartes', 'todo')] : []
  for (const kid of kids) kid.parent = link(milestone)
  milestone.children = kids.map(link)
  return horizonOf({ cards: [milestone, ...kids], runs: [], requests: new Map() })[0]!
}

function Seeded({ detail, cards, children }: { detail: CardRefinementDetailDto | null; cards?: CardDto[]; children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    if (detail) client.setQueryData(['card-refinement', 'card-182'], detail)
    if (cards) client.setQueryData(['cards', PROJECT_ID], cards)
    client.setQueryData(['conversations', 'all'], [{ id: SESSION, projectId: PROJECT_ID, isOwner: true } as unknown as ConversationDto])
    return null
  })
  return <div className="w-[min(46rem,100%)]">{children}</div>
}

const detailOf = (extra: Partial<CardRefinementDetailDto>): CardRefinementDetailDto => ({
  session: null, activity: null, prompt: null, draft: null, change: null, ...extra,
})

const meta = {
  title: "Composants d'application/Session d'affinage d'un jalon",
  component: RefinementPanel,
  parameters: {
    docs: {
      description: {
        component:
          "La session d'affinage d'un jalon, résumée sur sa page (#195, spec jalons AFF-1..6) : son état (**t'attend**, **travaille**, **terminée**, **pas encore lancée**) et son mode, ce qu'elle fait, ses questions répondues sur place — gardées une à une, envoyées ensemble à la dernière —, et son brouillon de découpage corrigé puis validé (`DraftEditor`), et l'ajout au jalon qu'elle propose de ranger (#196, AFF-7 : `AdditionProposal`). « Ouvrir la session » reste le geste principal : le fil complet vit dans la session.",
      },
    },
  },
  args: { projectId: PROJECT_ID, entry: entryOf(null) },
} satisfies Meta<typeof RefinementPanel>

export default meta
type Story = StoryObj<typeof meta>

/** Pas encore lancée : affiner avec un agent, ou découper directement. */
export const PasLancee: Story = {
  render: (args) => <Seeded detail={null}><RefinementPanel {...args} /></Seeded>,
}

/** Elle travaille : son outil en cours, résumé comme dans le fil. */
export const Travaille: Story = {
  render: (args) => {
    const refinement = session({ status: 'running' })
    const detail = detailOf({
      session: refinement,
      activity: { toolCallId: 't1', toolName: 'Read', startedAt: NOW - 4_000, nested: false, input: { file_path: 'docs/specs/2026-11-page-projet-v2/jalons.md' } },
    })
    return <Seeded detail={detail}><RefinementPanel {...args} entry={entryOf(refinement)} /></Seeded>
  },
}

/** Elle t'attend : deux questions d'une même demande, répondables sur place. */
export const Questions: Story = {
  render: (args) => {
    const refinement = session({ status: 'awaiting_input' })
    return <Seeded detail={detailOf({ session: refinement, prompt: QUESTIONS })}><RefinementPanel {...args} entry={entryOf(refinement)} /></Seeded>
  },
}

/** Un découpage attend sa validation : on le corrige ici, puis on valide. */
export const Brouillon: Story = {
  render: (args) => {
    const refinement = session({ mode: 'direct', draft: { requestId: 'd1', count: DRAFT.cards.length } })
    const detail = detailOf({ session: refinement, draft: { requestId: 'd1', conversationId: SESSION, draft: DRAFT } })
    return <Seeded detail={detail}><RefinementPanel {...args} entry={entryOf(refinement)} /></Seeded>
  },
}

/** Une question encore ouverte : « Valider » attend sa réponse. */
export const BrouillonEtQuestion: Story = {
  render: (args) => {
    const refinement = session({ status: 'awaiting_input', draft: { requestId: 'd1', count: DRAFT.cards.length } })
    const detail = detailOf({ session: refinement, prompt: QUESTIONS, draft: { requestId: 'd1', conversationId: SESSION, draft: DRAFT } })
    return <Seeded detail={detail}><RefinementPanel {...args} entry={entryOf(refinement)} /></Seeded>
  },
}

/** Terminée : le jalon est découpé, rien n'attend. */
export const Terminee: Story = {
  render: (args) => {
    const refinement = session()
    return <Seeded detail={detailOf({ session: refinement })}><RefinementPanel {...args} entry={entryOf(refinement, true)} /></Seeded>
  },
}

/** Au repos sans rien proposer ni cartes : la suite se dit dans la session. */
export const AuRepos: Story = {
  render: (args) => {
    const refinement = session()
    return <Seeded detail={detailOf({ session: refinement })}><RefinementPanel {...args} entry={entryOf(refinement)} /></Seeded>
  },
}

/** Un ajout rangé en sous-tâches d'une carte du jalon ; l'une y est déjà, le clic la sautera. */
export const AjoutEnSousTaches: Story = {
  render: (args) => {
    const refinement = session({ change: { requestId: 'c1', count: 1 } })
    const entry = entryOf(refinement, true)
    const target = entry.children[1]!
    target.description = '## Sous-tâches\n- [ ] Barres par jour'
    const detail = detailOf({
      session: refinement,
      change: {
        requestId: 'c1', conversationId: SESSION,
        changes: [{ cardId: target.id, number: target.number, title: target.title, fromColumn: 'todo', reason: 'Elle dessine déjà les barres.', addSubtasks: ['Barres par jour', 'Pièces jointes hors ligne'] }],
      },
    })
    return <Seeded detail={detail} cards={[entry.card, ...entry.children]}><RefinementPanel {...args} entry={entry} /></Seeded>
  },
}

/** Un ajout en nouvelles cartes dans un jalon déjà découpé. */
export const AjoutEnCartes: Story = {
  render: (args) => {
    const refinement = session({ draft: { requestId: 'd2', count: 2 } })
    const entry = entryOf(refinement, true)
    const draft: CardDraft = {
      parent: DRAFT.parent,
      cards: [
        { key: 'a', title: 'Pièces jointes hors ligne', description: '', subtasks: [], after: [], blockedBy: [{ cardId: 'card-192', number: 192, title: 'Barres de cartes' }], related: [] },
        { key: 'b', title: 'Vignettes en cache', description: '', subtasks: [], after: [], blockedBy: [], related: [] },
      ],
    }
    const detail = detailOf({ session: refinement, draft: { requestId: 'd2', conversationId: SESSION, draft } })
    return <Seeded detail={detail} cards={[entry.card, ...entry.children]}><RefinementPanel {...args} entry={entry} /></Seeded>
  },
}
