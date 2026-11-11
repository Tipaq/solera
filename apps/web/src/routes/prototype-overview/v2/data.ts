/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les données de l'Aperçu v2, mises à plat une fois pour les quatre variantes de style :
 * c'est le style qu'on compare, pas le contenu. Tout vient des requêtes réelles, sauf
 * en `?demo=1`, où les jalons, les demandes, le code et le journal sont SIMULÉS.
 */
import { useMemo } from 'react'
import type { AgentKind, CardDto, JournalEntryDto, ProjectDto, PullRequestBadgeState } from '@solera/protocol'
import { useJournal } from '../../../lib/journal'
import { DAY, liveSessions, stateOf, useProtoData, useProtoHref, type CardState } from '../../prototype-milestones/model'
import { horizonOf, milestoneAsks, nextAction, type HorizonMilestone } from '../../prototype-milestones/maturity'
import { layersOf } from '../../prototype-milestones/waves'
import { cardDestination } from '../../prototype-milestones/destination'
import { useOverviewData, type AskItem, type CodeLine } from '../data'
import { inboxMilestoneNumber, type InboxItem, type InboxMilestone } from '../../../components/prototype/AskInbox'
import { answerCardSession, answerQuestion, mergeMilestonePr, validateDraft } from '../../prototype-milestones/demo-store'

export type SessionTone = 'running' | 'awaiting' | 'broken' | 'quiet'

export interface V2Session {
  id: string
  title: string
  agent: AgentKind
  tone: SessionTone
  to: string
}

export interface V2Ask {
  key: string
  kind: AskItem['kind']
  title: string
  detail: string
  to: string
  /** Lien hors de Solera (une PR) : s'ouvre à côté. */
  external: boolean
  since: number | null
}

export interface V2Code {
  key: string
  root: boolean
  branch: string
  ahead: number
  behind: number
  dirty: number
  conflicts: boolean
  pr: { number: number; title: string; url: string; state: PullRequestBadgeState } | null
  sessions: V2Session[]
  card: V2CardRef | null
  at: number | null
  to: string
  /** L'arbre, pour ses gestes (diff, nettoyage) ; `null` pour la racine. */
  treeId: string | null
  path: string | null
  /** Une session y attend Tim. */
  awaiting: boolean
}

/** La carte d'un arbre, et le jalon auquel elle appartient : à quoi sert l'arbre. */
export interface V2CardRef {
  number: number
  title: string
  to: string
  milestone: { number: number; title: string; to: string } | null
}

export interface V2Wave {
  index: number
  cards: { card: CardDto; state: CardState; to: string }[]
  open: number
}

export interface V2Milestone {
  entry: HorizonMilestone
  to: string
  progress: number
  waves: V2Wave[]
  sessions: V2Session[]
  action: { label: string; detail: string }
  /**
   * Ce qui attend Tim dans ce jalon, compté dans « Ce qui t'attend ». Le phare n'en
   * montre que le repère (« 1 t'attend ») : la demande vit dans la liste, une seule fois.
   */
  waiting: { count: number; key: string } | null
  concurrency: number
}

export interface V2Event {
  entry: JournalEntryDto
  to: string | null
}

export interface V2Data {
  demo: boolean
  projectId: string
  asks: V2Ask[]
  /** « Ce qui t'attend », réponse sur place : la même liste pour les trois variantes. */
  inbox: InboxItem[]
  current: V2Milestone | null
  /** Prêts et découpés, puis lancés au-delà du premier : ce qui part ensuite. */
  next: V2Milestone[]
  /** À affiner et idées. */
  later: V2Milestone[]
  delivered: number
  code: V2Code[]
  settledTrees: number
  events: V2Event[]
  isPending: boolean
}

const EVENTS_SHOWN = 5

const RANK: Record<HorizonMilestone['maturity'], number> = {
  launched: 0,
  ready: 1,
  split: 2,
  refine: 3,
  idea: 4,
  delivered: 5,
}

export function useV2Data(projectId: string, project: ProjectDto): V2Data {
  const proto = useProtoData(projectId)
  const href = useProtoHref()
  const real = useOverviewData(projectId, project)
  const { data: journal } = useJournal(proto.demo ? undefined : projectId)

  return useMemo(() => {
    const demo = proto.demo
    const byNumber = new Map(proto.cards.map((card) => [card.number, card]))
    const sessionTo = (id: string) => href(`/p/${projectId}/c/${id}`)

    const toMilestone = (entry: HorizonMilestone): V2Milestone => {
      const layers = layersOf(entry.cards)
      const count = Math.max(0, ...[...layers.values()].map((value) => value + 1))
      const waves = Array.from({ length: count }, (_, index) => {
        const cards = entry.cards
          .filter((card) => layers.get(card.id) === index)
          .sort((a, b) => a.number - b.number)
          .map((card) => ({ card, state: stateOf(card), to: href(cardDestination(projectId, card)) }))
        return { index, cards, open: cards.filter((item) => item.state !== 'done' && item.state !== 'abandoned').length }
      })
      const sessions = entry.cards.flatMap((card) =>
        liveSessions(card).map((session) => ({
          id: session.id,
          title: `#${card.number} ${card.title}`,
          agent: session.agent,
          tone: (session.status === 'awaiting_input' ? 'awaiting' : 'running') as SessionTone,
          to: sessionTo(session.id),
        })),
      )
      return {
        entry,
        to: href(`/p/${projectId}/timeline/${entry.card.number}?variant=jalon-v2`),
        progress: entry.cards.length === 0 ? 0 : entry.done / entry.cards.length,
        waves,
        sessions,
        action: nextAction(entry),
        waiting: null,
        concurrency: proto.runConcurrency.get(entry.card.id) ?? 3,
      }
    }

    const horizon = horizonOf(proto)
    const open = horizon
      .filter((entry) => entry.maturity !== 'delivered')
      .sort((a, b) => RANK[a.maturity] - RANK[b.maturity] || a.card.number - b.card.number)
      .map(toMilestone)
    const current = open[0] ?? null
    const rest = open.slice(1)

    /* Les demandes : réelles, ou tirées du jeu de démo (cartes à relire, sessions qui
       attendent) avec une PR prête inventée. */
    const asks: V2Ask[] = demo
      ? [
          // Le parcours de démo des jalons : blocage, questions, brouillon, PR finale.
          ...milestoneAsks(proto).map((ask) => ({
            key: ask.key,
            kind: 'awaiting' as const,
            title: ask.title,
            detail: ask.detail,
            to: href(`/p/${projectId}/timeline/${ask.number}`),
            external: false,
            since: null,
          })),
          ...proto.cards
            .flatMap((card) =>
              card.conversations
                .filter((session) => session.status === 'awaiting_input')
                .map((session) => ({
                  key: `s-${session.id}`,
                  kind: 'awaiting' as const,
                  title: session.title,
                  detail: `#${card.number} attend ta réponse`,
                  to: sessionTo(session.id),
                  external: false,
                  since: Date.now() - 2 * 3_600_000,
                })),
            ),
          ...proto.cards
            .filter((card) => card.column === 'review' && card.children.length === 0)
            .map((card) => ({
              key: `c-${card.id}`,
              kind: 'review-card' as const,
              title: card.title,
              detail: `Carte #${card.number} à relire`,
              to: href(cardDestination(projectId, card)),
              external: false,
              since: card.columnSince,
            })),
        ]
      : real.asks.map((ask) => ({ ...ask, external: ask.kind === 'review-pr' }))

    /* La boîte « Ce qui t'attend » (décidée le 2026-11-11) : une seule liste, chaque
       session étiquetée par son jalon, et de quoi répondre sur place. */
    const byId = new Map(proto.cards.map((card) => [card.id, card]))
    const milestoneOf = (card: CardDto | undefined): InboxMilestone | null => {
      const parent = card?.parent ? byId.get(card.parent.id) : undefined
      if (!parent) return null
      return { number: parent.number, title: parent.title, to: href(`/p/${projectId}/timeline/${parent.number}?variant=jalon-v2`) }
    }
    const milestoneLink = (entry: HorizonMilestone): InboxMilestone => ({
      number: entry.card.number,
      title: entry.card.title,
      to: href(`/p/${projectId}/timeline/${entry.card.number}?variant=jalon-v2`),
    })
    const inbox: InboxItem[] = []
    if (demo) {
      for (const card of proto.cards) {
        const waiting = card.conversations.find((session) => !session.archivedAt && session.status === 'awaiting_input')
        if (!waiting) continue
        const blocked = Object.values(proto.runs).find((run) => run.blocked?.cardId === card.id)
        inbox.push({
          kind: 'session',
          key: `s-${card.id}`,
          title: card.title,
          agent: waiting.agent,
          tone: 'awaiting',
          since: card.columnSince,
          milestone: milestoneOf(card),
          cardNumber: card.number,
          open: sessionTo(waiting.id),
          reply: {
            type: 'demo',
            question: blocked?.blocked?.question ?? 'Je peux supprimer l’ancien composant, ou faut-il le garder derrière un réglage le temps de la transition ?',
            onAnswer: (text) => answerCardSession(card.id, text),
          },
        })
      }
      for (const entry of horizon) {
        const pending = entry.questions
        if (pending.length) {
          inbox.push({
            kind: 'refine',
            key: `q-${entry.card.id}`,
            milestone: milestoneLink(entry),
            questions: pending.map((question) => ({ id: question.id, text: question.text })),
            onAnswer: (id, text) => answerQuestion(entry.card.id, id, text),
          })
        }
        if (entry.draft) {
          inbox.push({ kind: 'draft', key: `d-${entry.card.id}`, milestone: milestoneLink(entry), cards: entry.draft, onValidate: () => validateDraft(entry.card.id) })
        }
        if (entry.run?.prOpen) {
          inbox.push({
            kind: 'merge',
            key: `m-${entry.card.id}`,
            milestone: milestoneLink(entry),
            branch: `jalon/${entry.card.number}`,
            onMerge: () => mergeMilestonePr(entry.card.id),
          })
        }
      }
    } else {
      for (const row of real.rows) {
        if (row.group !== 'asking') continue
        const linked = row.entry.conversation.card
        const card = linked ? byNumber.get(linked.number) : undefined
        inbox.push({
          kind: 'session',
          key: `s-${row.entry.conversation.id}`,
          title: row.entry.conversation.title,
          agent: row.entry.conversation.agent,
          tone: row.marker === 'broken' ? 'broken' : 'awaiting',
          since: row.entry.since,
          milestone: milestoneOf(card),
          cardNumber: linked?.number ?? null,
          open: sessionTo(row.entry.conversation.id),
          reply: { type: 'real', conversationId: row.entry.conversation.id, request: row.request, canDecide: row.entry.conversation.isOwner },
        })
      }
    }
    // Ce qui demande un coup d'œil plutôt qu'une réponse : les cartes à relire, les PR prêtes.
    for (const ask of asks) {
      if (ask.kind !== 'review-card' && ask.kind !== 'review-pr') continue
      inbox.push({ kind: 'light', key: ask.key, tone: ask.kind, title: ask.title, detail: ask.detail, to: ask.to, external: ask.external, since: ask.since })
    }

    // Le repère des jalons : combien de demandes de la liste leur appartiennent.
    const withWaiting = (milestone: V2Milestone): V2Milestone => {
      const mine = inbox.filter((item) => inboxMilestoneNumber(item) === milestone.entry.card.number)
      return mine.length ? { ...milestone, waiting: { count: mine.length, key: mine[0]!.key } } : milestone
    }

    const cardRef = (card: CardDto): V2CardRef => {
      const parent = card.parent ? byId.get(card.parent.id) : undefined
      return {
        number: card.number,
        title: card.title,
        to: href(cardDestination(projectId, card)),
        milestone: parent ? { number: parent.number, title: parent.title, to: href(`/p/${projectId}/timeline/${parent.number}?variant=jalon-v2`) } : null,
      }
    }
    const code: V2Code[] = demo ? demoCode(projectId, byNumber, href, cardRef) : real.code.map((line) => fromLine(line, projectId, href, cardRef))

    const events: V2Event[] = (demo ? demoEvents(projectId) : (journal?.entries ?? []))
      .slice(0, EVENTS_SHOWN)
      .map((entry) => {
        if (entry.conversationId) return { entry, to: sessionTo(entry.conversationId) }
        const card = entry.cardNumber === null ? undefined : byNumber.get(entry.cardNumber)
        return { entry, to: card ? href(cardDestination(projectId, card)) : null }
      })

    return {
      demo,
      projectId,
      asks,
      inbox,
      current: current ? withWaiting(current) : null,
      next: rest.filter((item) => RANK[item.entry.maturity] <= RANK.split).map(withWaiting),
      later: rest.filter((item) => RANK[item.entry.maturity] > RANK.split).map(withWaiting),
      delivered: horizon.filter((entry) => entry.maturity === 'delivered').length,
      code,
      settledTrees: demo ? 2 : real.settledTrees,
      events,
      isPending: proto.isPending,
    }
  }, [proto, real, journal, projectId, href])
}

function fromLine(line: CodeLine, projectId: string, href: (path: string) => string, cardRef: (card: CardDto) => V2CardRef): V2Code {
  return {
    key: line.key,
    root: line.root,
    branch: line.branch,
    ahead: line.ahead,
    behind: line.behind,
    dirty: line.dirty,
    conflicts: line.conflicts,
    pr: line.pr ? { number: line.pr.number, title: line.pr.title, url: line.pr.url, state: line.pr.state } : null,
    sessions: line.sessions.map((row) => ({
      id: row.entry.conversation.id,
      title: row.entry.conversation.title,
      agent: row.entry.conversation.agent,
      tone: row.marker === 'broken' ? 'broken' : row.marker === 'awaiting' ? 'awaiting' : row.marker === 'working' ? 'running' : 'quiet',
      to: href(`/p/${projectId}/c/${row.entry.conversation.id}`),
    })),
    card: line.card ? cardRef(line.card) : null,
    at: line.lastActivityAt,
    to: href(line.to),
    treeId: line.treeId,
    path: line.path,
    awaiting: line.sessions.some((row) => row.marker === 'awaiting' || row.marker === 'broken'),
  }
}

/* ------------------------------------------------------------------ démo (SIMULÉ) */

function demoCode(projectId: string, byNumber: Map<number, CardDto>, href: (path: string) => string, cardRef: (card: CardDto) => V2CardRef): V2Code[] {
  const now = Date.now()
  const card = (number: number) => {
    const found = byNumber.get(number)
    return found ? cardRef(found) : null
  }
  const session = (id: string, title: string, agent: AgentKind, tone: SessionTone): V2Session => ({
    id,
    title,
    agent,
    tone,
    to: href(`/p/${projectId}/c/${id}`),
  })
  return [
    { key: 'root', root: true, branch: 'main', ahead: 0, behind: 0, dirty: 3, conflicts: false, pr: null, sessions: [session('d-root', 'Revue du README', 'claude', 'quiet')], card: null, at: now - 40 * 60_000, to: href(`/p/${projectId}/board`), treeId: null, path: null, awaiting: false },
    { key: 'w1', root: false, branch: 'feat/903-schema-des-jalons', ahead: 4, behind: 1, dirty: 0, conflicts: false, pr: { number: 212, title: 'Schéma des jalons', url: 'https://github.com', state: 'checks' }, sessions: [session('d-1', 'Schéma des jalons', 'claude', 'running')], card: card(903), at: now - 5 * 60_000, to: href(`/p/${projectId}/c/d-1`), treeId: 'demo-w1', path: '/demo/w1', awaiting: false },
    { key: 'w2', root: false, branch: 'feat/905-vue-horizon', ahead: 2, behind: 0, dirty: 6, conflicts: false, pr: { number: 214, title: 'Vue horizon', url: 'https://github.com', state: 'draft' }, sessions: [session('d-2', 'Vue horizon', 'codex', 'awaiting')], card: card(905), at: now - 22 * 60_000, to: href(`/p/${projectId}/c/d-2`), treeId: 'demo-w2', path: '/demo/w2', awaiting: true },
    { key: 'w3', root: false, branch: 'fix/911-gantt-largeur', ahead: 1, behind: 3, dirty: 0, conflicts: false, pr: { number: 209, title: 'Gantt pleine largeur', url: 'https://github.com', state: 'ready' }, sessions: [], card: card(911), at: now - 3 * 3_600_000, to: href(`/p/${projectId}/activity?groupe=worktree`), treeId: 'demo-w3', path: '/demo/w3', awaiting: false },
    { key: 'w4', root: false, branch: 'feat/907-lancer-confine', ahead: 7, behind: 2, dirty: 1, conflicts: true, pr: { number: 207, title: 'Lancer confiné', url: 'https://github.com', state: 'failing' }, sessions: [session('d-4', 'Lancer confiné', 'grok', 'broken')], card: card(907), at: now - 1 * DAY, to: href(`/p/${projectId}/c/d-4`), treeId: 'demo-w4', path: '/demo/w4', awaiting: true },
  ]
}

function demoEvents(projectId: string): JournalEntryDto[] {
  const now = Date.now()
  const base = { projectId, source: null, count: null, status: null, conversationId: null, cardNumber: null }
  return [
    { ...base, id: 'e1', kind: 'cardClosed', at: now - 25 * 60_000, title: 'Axe à deux étages du Gantt', cardNumber: 904, count: 2 },
    { ...base, id: 'e2', kind: 'branch', at: now - 2 * 3_600_000, title: 'feat/902-maturite fusionnée dans jalon/901', count: 5 },
    { ...base, id: 'e3', kind: 'note', at: now - 5 * 3_600_000, title: 'Le cap reste facultatif, une phrase au plus', source: 'Affinage du jalon #901' },
    { ...base, id: 'e4', kind: 'run', at: now - 9 * 3_600_000, title: 'Revue nocturne des dépendances', status: 'succeeded' },
    { ...base, id: 'e5', kind: 'cardOpened', at: now - 1 * DAY, title: 'Graphe en vagues au téléphone', cardNumber: 913 },
  ]
}

