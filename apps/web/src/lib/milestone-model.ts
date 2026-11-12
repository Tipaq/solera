import type { CardBranchPrDto, CardDto, MilestoneRunDto } from '@solera/protocol'
import { isOpen, loadedStatus, type StatusOf } from './card-state'
import { pluralOf } from './code-model'
import type { MessageKey, MessageParams } from './i18n'
import { requestSummary, type SessionRequest } from './session-request-summary'

/*
 * Le modèle des jalons (#188, spec jalons MAT-1..12) : où en est chaque jalon d'un projet
 * entre l'idée et la livraison, pourquoi, et ce qu'il attend. Pur, sans React ni réseau :
 * `useMilestones` (`lib/milestones`) lui passe les cartes, les pilotages actifs, les
 * demandes ouvertes et les statuts vivants.
 *
 * Rien ne stocke la maturité : elle se déduit, à chaque lecture, de ce qui existe.
 */

/** Les étapes, dans l'ordre du parcours (MAT-1). `split` se lit « À régler ». */
export const MATURITIES = ['idea', 'refine', 'split', 'ready', 'launched', 'delivered'] as const
export type Maturity = (typeof MATURITIES)[number]

/**
 * Un jalon : une carte de premier niveau qui porte le drapeau, ou qui a des enfants. Le
 * serveur pose le drapeau au premier enfant (#183) ; les enfants comptent quand même,
 * pour une carte lue avant que le drapeau existe.
 */
export function isMilestone(card: Pick<CardDto, 'parent' | 'milestone' | 'children'>): boolean {
  return card.parent === null && (card.milestone || card.children.length > 0)
}

/** Une idée de jalon (MAT-3) : drapeautée, sans parente ni enfant. Le Tableau ne la montre pas. */
export function isIdea(card: Pick<CardDto, 'parent' | 'milestone' | 'children'>): boolean {
  return card.parent === null && card.milestone && card.children.length === 0
}

/**
 * Les cartes prises dans une boucle de blocages internes au jeu (MAT-4) : celles qui en
 * dépendent sans y être n'en font pas partie, ni un bloqueur hors du jeu.
 */
export function cycleOf<T extends Pick<CardDto, 'id' | 'blockedBy'>>(cards: readonly T[]): T[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const state = new Map<string, 'visiting' | 'done'>()
  const inCycle = new Set<string>()
  const stack: string[] = []
  const visit = (card: T) => {
    state.set(card.id, 'visiting')
    stack.push(card.id)
    for (const blocker of card.blockedBy) {
      const next = byId.get(blocker.id)
      if (!next) continue
      const seen = state.get(next.id)
      if (seen === 'visiting') for (const id of stack.slice(stack.indexOf(next.id))) inCycle.add(id)
      else if (!seen) visit(next)
    }
    stack.pop()
    state.set(card.id, 'done')
  }
  for (const card of cards) if (!state.has(card.id)) visit(card)
  return cards.filter((card) => inCycle.has(card.id))
}

/** Une enfant qu'une session attend, et la demande qu'elle pose quand on la connaît. */
export interface AwaitingCard {
  card: CardDto
  conversationId: string
  request: SessionRequest | null
}

/** Un jalon lu par le modèle (MAT-5), idée comprise. */
export interface MilestoneEntry {
  card: CardDto
  /** Ses enfants directes. */
  children: CardDto[]
  /** Les enfants faites. */
  done: number
  maturity: Maturity
  /** Le pilotage en marche ou en pause, `null` sinon. */
  run: MilestoneRunDto | null
  launchedAt: number | null
  paused: boolean
  /**
   * La PR du jalon vers la branche par défaut, pas encore fusionnée : ouverte, ou fermée
   * sur la forge (`closedAt`), et alors à rouvrir plutôt qu'à fusionner.
   */
  pr: CardBranchPrDto | null
  /** Les questions ouvertes de la session d'affinage. */
  questions: { conversationId: string; requestId: string; items: { id: string; text: string }[] } | null
  /** Le brouillon de découpage qui attend sa validation. */
  draft: { conversationId: string; requestId: string; count: number } | null
  /**
   * La session d'affinage, au statut vivant : `working` elle travaille, `waiting` elle
   * attend une réponse (une question qu'on sait lire est dans `questions`), `null` au repos
   * ou absente.
   */
  refining: 'working' | 'waiting' | null
  toClarify: CardDto[]
  notAccepted: CardDto[]
  cycle: CardDto[]
  /** Ouvertes, sans bloqueur ouvert : elles peuvent partir tout de suite. */
  startable: CardDto[]
  /** Créées après le début du pilotage : le périmètre qui grossit. */
  addedSinceLaunch: CardDto[]
  /** Les enfants qu'une session attend : le repère ambre (MAT-11). */
  awaiting: AwaitingCard[]
}

export interface MilestonesInput {
  cards: readonly CardDto[]
  /** Les pilotages actifs du projet (`useActiveMilestones`). */
  runs: readonly MilestoneRunDto[]
  /** Les demandes ouvertes, par conversation (`useSessionRequests`). */
  requests: ReadonlyMap<string, SessionRequest>
  statusOf?: StatusOf
}

const byNumber = (a: CardDto, b: CardDto) => a.number - b.number

/**
 * Tous les jalons et idées d'un projet, analysés : les datés d'abord, du plus proche au
 * plus lointain, puis par numéro. Un jalon abandonné n'en est plus un — ses enfants
 * abandonnées en font une parente abandonnée, pas un jalon livré.
 */
export function horizonOf({ cards, runs, requests, statusOf = loadedStatus }: MilestonesInput): MilestoneEntry[] {
  const children = new Map<string, CardDto[]>()
  for (const card of cards) {
    if (card.parent === null) continue
    const bucket = children.get(card.parent.id)
    if (bucket) bucket.push(card)
    else children.set(card.parent.id, [card])
  }
  const active = new Map(
    runs.filter((run) => run.state === 'running' || run.state === 'paused').map((run) => [run.cardId, run]),
  )
  return cards
    // Une idée close n'attend plus rien ; un jalon clos par ses enfants, lui, est livré.
    .filter((card) => isMilestone(card) && card.column !== 'abandoned' && (isOpen(card) || card.children.length > 0))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || byNumber(a, b))
    .map((card) =>
      analyseMilestone(card, (children.get(card.id) ?? []).sort(byNumber), active.get(card.id) ?? null, requests, statusOf),
    )
}

/** La règle de maturité (MAT-2), dans son ordre : la première qui s'applique l'emporte. */
export function analyseMilestone(
  card: CardDto,
  children: CardDto[],
  run: MilestoneRunDto | null,
  requests: ReadonlyMap<string, SessionRequest>,
  statusOf: StatusOf = loadedStatus,
): MilestoneEntry {
  const open = children.filter(isOpen)
  const refinement = card.refinement
  const request = refinement ? requests.get(refinement.conversationId) : undefined
  const questions =
    refinement && request?.kind === 'question' && request.event.questions.length > 0
      ? {
          conversationId: refinement.conversationId,
          requestId: request.requestId,
          items: request.event.questions.map((question) => ({ id: question.id, text: question.question })),
        }
      : null
  const draft =
    refinement?.draft ? { conversationId: refinement.conversationId, requestId: refinement.draft.requestId, count: refinement.draft.count } : null
  const refinementStatus = refinement ? statusOf({ id: refinement.conversationId, status: refinement.status }) : null
  const refining = refinementStatus === 'running' ? 'working' : refinementStatus === 'awaiting_input' ? 'waiting' : null

  const pr = card.branchPr && card.branchPr.mergedAt === null ? card.branchPr : null
  const toClarify = open.filter((entry) => entry.toClarifySince !== null)
  const notAccepted = open.filter((entry) => entry.acceptedAt === null)
  const cycle = cycleOf(open)
  const startable = open.filter((entry) => !entry.blockedBy.some(isOpen))
  const launchedAt = run?.createdAt ?? null
  const addedSinceLaunch = launchedAt === null ? [] : children.filter((entry) => entry.createdAt > launchedAt)
  const awaiting = open.flatMap((child): AwaitingCard[] => {
    // Le même prédicat qu'`awaitsMe`, dont on garde ici la session.
    const session = child.conversations.find((conversation) => !conversation.archivedAt && statusOf(conversation) === 'awaiting_input')
    return session ? [{ card: child, conversationId: session.id, request: requests.get(session.id) ?? null }] : []
  })

  const asking = questions !== null || draft !== null
  let maturity: Maturity
  if (run || pr) maturity = 'launched'
  else if (children.length === 0) maturity = asking || refining !== null ? 'refine' : 'idea'
  else if (open.length === 0) maturity = 'delivered'
  else if (asking) maturity = 'refine'
  else if (toClarify.length || notAccepted.length || cycle.length || startable.length === 0) maturity = 'split'
  else maturity = 'ready'

  return {
    card,
    children,
    done: children.filter((entry) => entry.column === 'done').length,
    maturity,
    run,
    launchedAt,
    paused: run?.state === 'paused',
    pr,
    questions,
    draft,
    refining,
    toClarify,
    notAccepted,
    cycle,
    startable,
    addedSinceLaunch,
    awaiting,
  }
}

/* ------------------------------------------------------------------ prochaine action */

/**
 * Ce que l'étape appelle (MAT-6), en données : `nextActionText` en fait des phrases.
 * `refining` (l'affinage travaille, rien n'attend encore) et `openRefine` (il attend,
 * mais pas une question qu'on sache lire ici : une permission) ne sont pas dans le
 * prototype, qui n'avait pas de session vivante sans question.
 */
export type NextAction =
  | { kind: 'refine' }
  | { kind: 'validateDraft'; count: number }
  | { kind: 'answer'; count: number }
  | { kind: 'refining' }
  | { kind: 'openRefine' }
  | { kind: 'settle'; toClarify: number[]; notAccepted: number[]; cycle: number[] }
  | { kind: 'undoCycle'; cycle: number[] }
  | { kind: 'reviewDeps' }
  | { kind: 'launch'; count: number }
  | { kind: 'merge'; pr: CardBranchPrDto }
  | { kind: 'prClosed'; pr: CardBranchPrDto }
  | { kind: 'answerBlock'; card: number; request: SessionRequest | null }
  | { kind: 'follow'; done: number; total: number; added: number; paused: boolean }
  | { kind: 'review'; count: number }

const numbers = (cards: readonly CardDto[]) => cards.map((card) => card.number)

/**
 * La PR finale du jalon (RUN-9) : à fusionner, fermée sans fusion sur la forge, ou rien à
 * en faire. Tant qu'un pilotage tourne — une carte entrée au jalon après son ouverture —,
 * elle attend : la fusionner livrerait sans cette carte.
 */
export function prStage(entry: Pick<MilestoneEntry, 'pr' | 'run'>): 'open' | 'closed' | null {
  if (!entry.pr || entry.run) return null
  return entry.pr.closedAt === null ? 'open' : 'closed'
}

export function nextAction(entry: MilestoneEntry): NextAction {
  switch (entry.maturity) {
    case 'idea':
      return { kind: 'refine' }
    case 'refine':
      if (entry.draft) return { kind: 'validateDraft', count: entry.draft.count }
      if (entry.questions) return { kind: 'answer', count: entry.questions.items.length }
      return entry.refining === 'waiting' ? { kind: 'openRefine' } : { kind: 'refining' }
    case 'split': {
      const toClarify = numbers(entry.toClarify)
      const notAccepted = numbers(entry.notAccepted)
      const cycle = numbers(entry.cycle)
      if (!toClarify.length && !notAccepted.length && !cycle.length) return { kind: 'reviewDeps' }
      if (!toClarify.length && !notAccepted.length) return { kind: 'undoCycle', cycle }
      return { kind: 'settle', toClarify, notAccepted, cycle }
    }
    case 'ready':
      return { kind: 'launch', count: entry.startable.length }
    case 'launched': {
      const pr = prStage(entry)
      if (pr) return { kind: pr === 'open' ? 'merge' : 'prClosed', pr: entry.pr! }
      const [first] = entry.awaiting
      if (first) return { kind: 'answerBlock', card: first.card.number, request: first.request }
      return {
        kind: 'follow',
        done: entry.done,
        total: entry.children.length,
        added: entry.addedSinceLaunch.length,
        paused: entry.paused,
      }
    }
    case 'delivered':
      return { kind: 'review', count: entry.done }
  }
}

/* ------------------------------------------------------------------ raisons */

/** Pourquoi un jalon est à son étape (MAT-7), en raisons concrètes plutôt qu'en règle. */
export type MaturityReason =
  | { kind: 'noCards' }
  | { kind: 'questions'; count: number }
  | { kind: 'draft'; count: number }
  | { kind: 'refining' }
  | { kind: 'refineWaiting' }
  | { kind: 'toClarify'; cards: number[] }
  | { kind: 'notAccepted'; cards: number[] }
  | { kind: 'cycle'; cards: number[] }
  | { kind: 'noStartable' }
  | { kind: 'startable'; count: number }
  | { kind: 'merged'; done: number; total: number }
  | { kind: 'paused' }
  | { kind: 'blocked'; cards: number[] }
  | { kind: 'prOpen' }
  | { kind: 'prClosed' }
  | { kind: 'delivered'; count: number }

export function maturityReasons(entry: MilestoneEntry): MaturityReason[] {
  switch (entry.maturity) {
    case 'idea':
      return [{ kind: 'noCards' }]
    case 'refine': {
      const reasons: MaturityReason[] = []
      if (entry.questions) reasons.push({ kind: 'questions', count: entry.questions.items.length })
      if (entry.draft) reasons.push({ kind: 'draft', count: entry.draft.count })
      if (reasons.length) return reasons
      return [entry.refining === 'waiting' ? { kind: 'refineWaiting' } : { kind: 'refining' }]
    }
    case 'split': {
      const reasons: MaturityReason[] = []
      if (entry.toClarify.length) reasons.push({ kind: 'toClarify', cards: numbers(entry.toClarify) })
      if (entry.notAccepted.length) reasons.push({ kind: 'notAccepted', cards: numbers(entry.notAccepted) })
      if (entry.cycle.length) reasons.push({ kind: 'cycle', cards: numbers(entry.cycle) })
      return reasons.length ? reasons : [{ kind: 'noStartable' }]
    }
    case 'ready':
      return [{ kind: 'startable', count: entry.startable.length }]
    case 'launched': {
      const reasons: MaturityReason[] = [{ kind: 'merged', done: entry.done, total: entry.children.length }]
      if (entry.paused) reasons.push({ kind: 'paused' })
      // Le repère, pas la demande : elle se lit dans « Ce qui t'attend » (DECISIONS, « une seule liste »).
      if (entry.awaiting.length) reasons.push({ kind: 'blocked', cards: entry.awaiting.map((awaiting) => awaiting.card.number) })
      const pr = prStage(entry)
      if (pr) reasons.push({ kind: pr === 'open' ? 'prOpen' : 'prClosed' })
      return reasons
    }
    case 'delivered':
      return [{ kind: 'delivered', count: entry.done }]
  }
}

/* ------------------------------------------------------------------ page d'un jalon */

/**
 * Ce que fait le bouton de la prochaine action sur la page d'un jalon (JAL-6). Une
 * session bloquée ouvre la fiche de sa carte, où l'on répond sur place : sa demande n'est
 * pas recopiée dans l'affinage (spec §2.6-1, « une seule liste »).
 */
export type MilestoneGesture =
  | { kind: 'refine' }
  | { kind: 'scroll'; target: 'affinage' | 'lancer' }
  | { kind: 'merge' }
  | { kind: 'link'; url: string }
  | { kind: 'sheet'; number: number }

export function gestureOf(entry: MilestoneEntry): MilestoneGesture | null {
  const action = nextAction(entry)
  switch (action.kind) {
    case 'refine':
      return { kind: 'refine' }
    case 'validateDraft':
    case 'answer':
    case 'refining':
    case 'openRefine':
    case 'settle':
    case 'undoCycle':
    case 'reviewDeps':
      return { kind: 'scroll', target: 'affinage' }
    case 'launch':
    case 'follow':
      return { kind: 'scroll', target: 'lancer' }
    case 'prClosed':
      return { kind: 'link', url: action.pr.url }
    case 'merge':
      return { kind: 'merge' }
    case 'answerBlock':
      return { kind: 'sheet', number: action.card }
    case 'review':
      return null
  }
}

/**
 * L'affinage attend quelque chose de toi (JAL-8) : il passe alors en tête de la page,
 * avant les vagues. Une idée sans cartes aussi : c'est d'ici qu'on la lance.
 */
export function refinePending(entry: MilestoneEntry): boolean {
  return (
    entry.questions !== null ||
    entry.draft !== null ||
    entry.card.refinement?.change != null ||
    entry.refining === 'waiting' ||
    entry.toClarify.length > 0 ||
    entry.notAccepted.length > 0 ||
    entry.cycle.length > 0 ||
    (entry.maturity === 'idea' && entry.children.length === 0)
  )
}

/**
 * L'étage d'une carte dans le jeu (VAG-3) : 0 sans bloqueur dedans, sinon un de plus que
 * le plus haut de ses bloqueurs. Un cycle est coupé là où le parcours le referme, pour
 * que chaque carte ait sa colonne : son arête qui remonte le montre.
 */
export function layersOf<T extends Pick<CardDto, 'id' | 'blockedBy'>>(cards: readonly T[]): Map<string, number> {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const layers = new Map<string, number>()
  const visiting = new Set<string>()
  const visit = (card: T): number => {
    const known = layers.get(card.id)
    if (known !== undefined) return known
    if (visiting.has(card.id)) return 0
    visiting.add(card.id)
    const blockers = card.blockedBy.flatMap((blocker) => byId.get(blocker.id) ?? [])
    const layer = blockers.length === 0 ? 0 : 1 + Math.max(...blockers.map(visit))
    visiting.delete(card.id)
    layers.set(card.id, layer)
    return layer
  }
  for (const card of cards) visit(card)
  // Coupé, un cycle peut laisser un étage vide (la carte qui le referme compte 0 pour
  // celle qui l'attend) : les étages se resserrent, dans le même ordre.
  const rank = new Map([...new Set(layers.values())].sort((a, b) => a - b).map((layer, index) => [layer, index]))
  return new Map([...layers].map(([id, layer]) => [id, rank.get(layer)!]))
}

/**
 * Les vagues d'un jalon (VAG-3, VAG-4) : une liste par étage, de gauche à droite, sans
 * les abandonnées ; dans une vague, ce qui reste à faire en haut, puis par numéro.
 */
export function wavesOf(cards: readonly CardDto[]): CardDto[][] {
  const shown = cards.filter((card) => card.column !== 'abandoned')
  const layers = layersOf(shown)
  const waves: CardDto[][] = []
  for (const card of shown) (waves[layers.get(card.id)!] ??= []).push(card)
  return waves.map((wave) => wave.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || byNumber(a, b)))
}

/** Où en est une vague (VAG-5) : terminée, ou ses ouvertes et en combien de passes. */
export function waveProgress(
  wave: readonly CardDto[],
  concurrency: number,
): { kind: 'finished' } | { kind: 'open'; open: number; passes: number } {
  const open = wave.filter(isOpen).length
  return open === 0 ? { kind: 'finished' } : { kind: 'open', open, passes: Math.ceil(open / Math.max(1, concurrency)) }
}

/* ------------------------------------------------------------------ « Ce qui t'attend » */

/**
 * Ce qu'un jalon demande à Tim (MAT-12), pour « Ce qui t'attend » (coque INB-8..10) :
 * l'appelant y attache les gestes et le lien du jalon. Une session d'enfant qui attend
 * n'en est pas une : elle est déjà dans la liste, étiquetée par son jalon. La session
 * d'affinage qui pose les questions y est aussi : la ligne `refine` la remplace.
 */
export type MilestoneAsk =
  | {
      kind: 'refine'
      key: string
      milestone: CardDto
      conversationId: string
      requestId: string
      questions: { id: string; text: string }[]
    }
  | { kind: 'draft'; key: string; milestone: CardDto; conversationId: string; requestId: string; count: number }
  | { kind: 'merge'; key: string; milestone: CardDto; branch: string; pr: CardBranchPrDto }

export function milestoneAsks(entry: MilestoneEntry): MilestoneAsk[] {
  const { card } = entry
  const asks: MilestoneAsk[] = []
  if (entry.questions) {
    const { conversationId, requestId, items } = entry.questions
    asks.push({ kind: 'refine', key: `refine-${card.id}`, milestone: card, conversationId, requestId, questions: items })
  }
  if (entry.draft) asks.push({ kind: 'draft', key: `draft-${card.id}`, milestone: card, ...entry.draft })
  if (entry.pr && prStage(entry) === 'open' && card.branch) asks.push({ kind: 'merge', key: `merge-${card.id}`, milestone: card, branch: card.branch, pr: entry.pr })
  return asks
}

/** L'étape où entre un jalon selon le geste du composer « Nouveau jalon ». */
export const ENTRY_STAGE: Record<'note' | 'refine' | 'split', Maturity> = {
  note: 'idea',
  refine: 'refine',
  split: 'refine',
}

/* ------------------------------------------------------------------ en mots */

type Translate = (key: MessageKey, params?: MessageParams) => string

const listed = (cards: readonly number[]) => cards.map((number) => `#${number}`).join(', ')

/** La prochaine action en un libellé de bouton et une ligne de détail. */
export function nextActionText(action: NextAction, t: Translate): { label: string; detail: string } {
  const label = t(`milestones.next.${action.kind}.label`)
  switch (action.kind) {
    case 'refine':
    case 'refining':
    case 'openRefine':
    case 'reviewDeps':
      return { label, detail: t(`milestones.next.${action.kind}.detail`) }
    case 'validateDraft':
    case 'answer':
    case 'launch':
    case 'review':
      return { label, detail: t(`milestones.next.${action.kind}.detail.${pluralOf(action.count)}`, { count: action.count }) }
    case 'settle': {
      const parts = [
        action.toClarify.length ? t(`milestones.next.settle.toClarify.${pluralOf(action.toClarify.length)}`, { count: action.toClarify.length }) : null,
        action.notAccepted.length ? t('milestones.next.settle.notAccepted', { count: action.notAccepted.length }) : null,
        action.cycle.length ? t('milestones.next.settle.cycle', { cards: listed(action.cycle) }) : null,
      ]
      return { label, detail: parts.filter(Boolean).join(' · ') }
    }
    case 'undoCycle':
      return { label, detail: t('milestones.next.settle.cycle', { cards: listed(action.cycle) }) }
    case 'merge':
    case 'prClosed':
      return { label, detail: t(`milestones.next.${action.kind}.detail`, { number: action.pr.number }) }
    case 'answerBlock':
      return {
        label,
        detail: action.request
          ? t('milestones.next.answerBlock.detail', { question: requestSummary(action.request, t) })
          : t('milestones.next.answerBlock.unknown', { number: action.card }),
      }
    case 'follow': {
      const parts = [t('milestones.next.follow.detail', { done: action.done, total: action.total })]
      if (action.added) parts.push(t('milestones.next.follow.added', { count: action.added }))
      if (action.paused) parts.push(t('milestones.next.follow.paused'))
      return { label, detail: parts.join(' · ') }
    }
  }
}

/** Une raison en une phrase. */
export function reasonText(reason: MaturityReason, t: Translate): string {
  switch (reason.kind) {
    case 'noCards':
    case 'refining':
    case 'refineWaiting':
    case 'noStartable':
    case 'paused':
    case 'prOpen':
    case 'prClosed':
      return t(`milestones.maturity.reason.${reason.kind}`)
    case 'questions':
    case 'draft':
    case 'startable':
    case 'delivered':
      return t(`milestones.maturity.reason.${reason.kind}.${pluralOf(reason.count)}`, { count: reason.count })
    case 'toClarify':
    case 'notAccepted':
    case 'blocked':
      return t(`milestones.maturity.reason.${reason.kind}.${pluralOf(reason.cards.length)}`, {
        count: reason.cards.length,
        cards: listed(reason.cards),
      })
    case 'cycle':
      return t('milestones.maturity.reason.cycle', { cards: listed(reason.cards) })
    case 'merged':
      return t('milestones.maturity.reason.merged', { done: reason.done, total: reason.total })
  }
}

/** L'infobulle d'une pastille (MAT-8) : l'étape et sa raison principale. */
export function maturityTooltip(entry: MilestoneEntry, t: Translate): string {
  // `maturityReasons` en rend toujours au moins une.
  const [reason] = maturityReasons(entry)
  return t('milestones.maturity.tooltip', {
    step: t(`milestones.maturity.label.${entry.maturity}`),
    reason: reasonText(reason!, t),
  })
}
