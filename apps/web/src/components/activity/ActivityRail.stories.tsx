import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AgentKind, ConversationDto, JournalEntryDto, JournalKind } from '@solera/protocol'
import type { LiveConversation } from '../../lib/activity'
import type { ActivityRow } from '../../lib/activity-rows'
import type { JournalDay } from '../../lib/journal'
import { clustersOf } from '../../lib/travail-model'
import { ActivityRail, type RailModel } from './ActivityRail'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.now()

function liveRow(id: string, title: string, agent: AgentKind, branch: string, card: number | null): ActivityRow {
  const conversation = {
    id,
    projectId: 'p1',
    title,
    agent,
    card: card ? { id: `card-${card}`, number: card, title: `Carte ${card}`, column: 'in_progress' } : null,
    updatedAt: NOW - 4 * MINUTE,
    isOwner: true,
    worktreeId: 'w1',
  } as unknown as ConversationDto
  const entry = { conversation, status: 'running', running: true, awaiting: false, unread: false, settledAt: NOW, since: NOW - 4 * MINUTE } as unknown as LiveConversation
  return { entry, group: 'running', marker: 'working', summary: null, place: { root: false, branch, path: `/wt/${branch}` }, pr: null, request: null }
}

let next = 0
function event(kind: JournalKind, ago: number, title: string, extra: Partial<JournalEntryDto> = {}): JournalEntryDto {
  next += 1
  return { id: `e${next}`, kind, at: NOW - ago, title, projectId: 'p1', cardNumber: null, source: null, count: null, status: null, conversationId: null, ...extra }
}

const ENTRIES: JournalEntryDto[] = [
  event('session', 40 * MINUTE, 'Session lancée dans feat/175-travail', { conversationId: 'c-old', cardNumber: 175, source: 'Claude' }),
  event('branch', 55 * MINUTE, 'feat/175-travail : 4 commits poussés', { conversationId: 'c-old', cardNumber: 175, count: 4 }),
  event('note', 70 * MINUTE, 'Décision : la vue Par moment garde le rail', { conversationId: 'c-old', cardNumber: 175, source: 'Claude' }),
  event('cardClosed', 5 * HOUR, 'Page projet v2 · 1 — Socle commun', { cardNumber: 157, count: 6 }),
  event('run', 6 * HOUR, 'Relecture du matin', { status: 'failed' }),
  event('cardOpened', DAY + 2 * HOUR, 'Panneau : cadre commun et ligne Git', { cardNumber: 222 }),
  event('audit', DAY + 5 * HOUR, 'Audit de la page projet versé dans docs/audits'),
  event('branch', 3 * DAY, 'feat/162-barre fusionnée dans main', { cardNumber: 162 }),
]

function daysOf(entries: JournalEntryDto[]): JournalDay[] {
  const days: JournalDay[] = []
  for (const entry of entries) {
    const at = new Date(entry.at).setHours(0, 0, 0, 0)
    const last = days[days.length - 1]
    if (last && last.at === at) last.entries.push(entry)
    else days.push({ at, entries: [entry] })
  }
  return days
}

const MODEL: RailModel = {
  projectId: 'p1',
  live: [liveRow('c1', 'Travail : onglet, barre, Par moment', 'claude', 'feat/175-travail', 175), liveRow('c2', 'Vue Graphe', 'codex', 'feat/178-graphe', 178)],
  inbox: [],
  runs: [],
  days: daysOf(ENTRIES),
  journalDays: 14,
  narrowed: false,
  older: { can: true, loading: false, load: () => {} },
  milestoneOfRow: (row) => (row.entry.conversation.card ? { number: 164, title: 'Page projet v2 · 2' } : null),
  milestoneOfEntry: (entry) => (entry.cardNumber && entry.cardNumber > 160 ? { number: 164, title: 'Page projet v2 · 2' } : null),
  isMilestone: (number) => number === 157,
  agentOf: (entry) => (entry.conversationId ? 'claude' : null),
  entryHref: (entry) => (entry.conversationId ? `/p/p1/c/${entry.conversationId}` : null),
}

function Frame({ model }: { model: RailModel }) {
  return (
    <div className="h-[44rem] overflow-y-auto">
      <ActivityRail model={model} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Le fil Par moment",
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La vue « Par moment » de Travail : le vivant, puis l'historique par jour sur un rail. Les événements rapprochés d'une même session ou carte se replient (" +
          `${clustersOf(ENTRIES).length} lignes pour ${ENTRIES.length} événements ici) ; un jalon livré est un losange vert.`,
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Deux sessions au travail, un groupe d'événements, un échec, un jalon livré. */
export const Fil: Story = { name: 'Le fil', render: () => <Frame model={MODEL} /> }

/** Une recherche qui ne laisse rien : les deux phrases de T-5.8. */
export const RienNeCorrespond: Story = {
  name: 'Rien ne correspond',
  render: () => <Frame model={{ ...MODEL, live: [], days: [], narrowed: true }} />,
}

/** Un projet calme : « Rien ne s'est passé ces N derniers jours », et le début du fil. */
export const Calme: Story = {
  name: 'Un projet calme',
  render: () => <Frame model={{ ...MODEL, live: [], days: [], older: { can: false, loading: false, load: () => {} } }} />,
}
