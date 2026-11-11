/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useSyncExternalStore } from 'react'
import type { CardColumn, CardConversationDto, CardDto, CardLinkDto } from '@solera/protocol'
import { DAY, demoCards } from './model'
import { flagDemoCard } from './flags'
import { draftFromAnswers, draftFromSteps, keywords, questionsForPhrase, readBrief, titleFromBrief } from './brief'

/**
 * La démo **à états** (`?demo=1`) : un magasin en mémoire, recopié dans ce navigateur,
 * qui devient la source de `useProtoData` en démo. Toutes les vues suivent donc le même
 * parcours : ajouter un jalon, l'affiner, le découper, préciser, lancer, suivre, livrer.
 *
 * Rien ne part au serveur. Chaque geste a un effet visible, et `resetDemo()` remet tout
 * à l'état de départ.
 *
 * La progression d'un jalon lancé se fait par **tics** : toutes les 3 s si le défilement
 * automatique est actif, ou un pas à la fois (`stepDemo`). À chaque tic, une carte
 * avance d'un cran : file → au travail → revue → fusionnée.
 */

const STORAGE = 'proto-demo-state-v2'
const TICK_MS = 3_000

export type RunStatus = 'waiting' | 'queued' | 'working' | 'review' | 'merged' | 'blocked'
export type RunMode = 'manual' | 'auto'

export interface DemoRun {
  milestoneId: string
  startedAt: number
  concurrency: number
  mode: RunMode
  confined: boolean
  paused: boolean
  statuses: Record<string, RunStatus>
  /** Le blocage simulé, posé une fois par pilotage : une question de la session. */
  blockedOnce: boolean
  blocked: { cardId: string; question: string } | null
  prOpen: boolean
  merged: boolean
}

export interface DemoQuestion {
  id: string
  text: string
  at: number
  answer: string | null
}

export interface DraftCard {
  key: string
  title: string
  after: string[]
  /** Flux v2 : les sous-tâches que l'agent propose avec la carte. */
  subtasks?: string[]
}

/** Flux v2 : un message du fil d'affinage, tel que la page du jalon le montre. */
export interface ThreadMessage {
  id: string
  from: 'agent' | 'user' | 'activity'
  text: string
  at: number
}

/** Flux v2 : ce que l'agent propose de faire d'un ajout à un jalon déjà découpé. */
export interface AdditionProposal {
  text: string
  /** Ranger dans une carte existante (sous-tâche), ou créer des cartes. */
  kind: 'subtask' | 'cards'
  cardId?: string
  cardNumber?: number
  cards?: { title: string; afterId: string | null; afterNumber: number | null }[]
}

export interface DemoRefine {
  questions: DemoQuestion[]
  /** Le brouillon `propose_cards` de l'agent, en attente de validation. */
  draft: DraftCard[] | null
  /** Flux v2 : le fil de la session d'affinage (absent dans le flux v1). */
  thread?: ThreadMessage[]
  /** Flux v2 : une phrase (questions d'abord) ou un brief (découpage direct). */
  mode?: 'phrase' | 'brief'
  /** Flux v2 : un ajout au jalon en attente de décision. */
  addition?: AdditionProposal | null
}

interface DemoState {
  cards: CardDto[]
  runs: Record<string, DemoRun>
  refine: Record<string, DemoRefine>
  flagged: string[]
  autoTick: boolean
  nextNumber: number
}

/* ------------------------------------------------------------------ état */

let state: DemoState | null = null
let version = 0
const listeners = new Set<() => void>()

function initial(): DemoState {
  const cards = demoCards('demo')
  const byNumber = (number: number) => cards.find((card) => card.number === number)!
  const flagged = cards.filter((card) => card.parent === null && card.children.length === 0 && card.description && card.dueAt === null).map((card) => card.id)

  // #901, lancé il y a quinze jours, avec #903 bloquée par une question.
  const m1 = byNumber(901)
  const statuses: Record<string, RunStatus> = {}
  for (const child of childrenOf(cards, m1.id)) statuses[child.id] = statusFromColumn(child)

  // #919 « Activité et Journal fusionnés » : deux questions d'affinage en attente.
  const m4 = byNumber(919)
  const hour = 3_600_000
  return {
    cards,
    runs: {
      [m1.id]: {
        milestoneId: m1.id,
        startedAt: Date.now() - 15 * DAY,
        concurrency: 3,
        mode: 'auto',
        confined: true,
        paused: false,
        statuses,
        blockedOnce: false,
        blocked: null,
        prOpen: false,
        merged: false,
      },
    },
    refine: {
      [m4.id]: {
        questions: [
          { id: 'q-a', text: 'Les sessions terminées restent-elles dans le fil, ou seulement leurs décisions ?', at: Date.now() - 3 * hour, answer: null },
          { id: 'q-b', text: 'Faut-il garder une adresse /journal pour les liens déjà partagés ?', at: Date.now() - 2 * hour, answer: null },
        ],
        draft: null,
      },
    },
    flagged,
    autoTick: true,
    nextNumber: Math.max(...cards.map((card) => card.number)) + 1,
  }
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (raw) return JSON.parse(raw) as DemoState
  } catch {
    /* on repart de zéro */
  }
  return initial()
}

function current(): DemoState {
  if (!state) {
    state = load()
    for (const id of state.flagged) flagDemoCard(id)
  }
  return state
}

function commit(next: DemoState) {
  state = { ...next, cards: normalize(next.cards) }
  for (const id of state.flagged) flagDemoCard(id)
  localStorage.setItem(STORAGE, JSON.stringify(state))
  version += 1
  listeners.forEach((listener) => listener())
}

function update(change: (draft: DemoState) => void) {
  const draft = structuredClone(current())
  change(draft)
  commit(draft)
}

/** Les liens portent la colonne et le titre de leur cible : on les recopie après chaque geste. */
function normalize(cards: CardDto[]): CardDto[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const fix = (entry: CardLinkDto): CardLinkDto => {
    const target = byId.get(entry.id)
    return target ? { ...entry, column: target.column, title: target.title, number: target.number } : entry
  }
  return cards.map((card) => ({
    ...card,
    parent: card.parent ? fix(card.parent) : null,
    children: card.children.map(fix),
    blocks: card.blocks.map(fix),
    blockedBy: card.blockedBy.map(fix),
  }))
}

function childrenOf(cards: CardDto[], parentId: string): CardDto[] {
  return cards.filter((card) => card.parent?.id === parentId)
}

function statusFromColumn(card: CardDto): RunStatus {
  if (card.column === 'done' || card.column === 'abandoned') return 'merged'
  if (card.column === 'review') return 'review'
  if (card.column === 'in_progress') return 'working'
  return 'queued'
}

function linkOf(card: CardDto): CardLinkDto {
  return { id: card.id, number: card.number, title: card.title, column: card.column }
}

function find(draft: DemoState, id: string): CardDto {
  return draft.cards.find((card) => card.id === id)!
}

function setColumn(card: CardDto, column: CardColumn) {
  card.column = column
  card.columnSince = Date.now()
  card.updatedAt = Date.now()
}

function setSession(card: CardDto, status: CardConversationDto['status'] | null) {
  if (status === null) {
    card.conversations = card.conversations.map((entry) => ({ ...entry, status: 'idle' }))
    return
  }
  const id = `demo-session-${card.number}`
  const existing = card.conversations.find((entry) => entry.id === id) ?? card.conversations[0]
  if (existing) existing.status = status
  else
    card.conversations.push({
      id,
      title: card.title,
      agent: 'claude',
      status,
      costUsd: 0,
      worktreeId: null,
      worktreeName: `feat/${card.number}`,
      archivedAt: null,
      createdAt: Date.now(),
    })
}

function newCard(draft: DemoState, title: string, extra: Partial<CardDto> = {}): CardDto {
  const now = Date.now()
  const number = draft.nextNumber
  draft.nextNumber += 1
  const card: CardDto = {
    id: `demo-${number}`,
    projectId: 'demo',
    number,
    title,
    description: '',
    column: 'todo',
    position: number,
    dueAt: null,
    parent: null,
    children: [],
    acceptedAt: now,
    toClarifySince: null,
    createdBy: 'tim',
    createdByName: 'Tim',
    createdAt: now,
    updatedAt: now,
    columnSince: now,
    conversations: [],
    attachmentCount: 0,
    noteCount: 0,
    references: [],
    referencedBy: [],
    blocks: [],
    blockedBy: [],
    related: [],
    duplicateOf: null,
    duplicates: [],
    issue: null,
    ...extra,
  }
  draft.cards.push(card)
  return card
}

function attach(draft: DemoState, child: CardDto, parentId: string) {
  const parent = find(draft, parentId)
  child.parent = linkOf(parent)
  parent.children.push(linkOf(child))
}

function depend(card: CardDto, blocker: CardDto) {
  card.blockedBy.push(linkOf(blocker))
  blocker.blocks.push(linkOf(card))
}

/* ------------------------------------------------------------------ lecture */

export interface DemoSnapshot {
  cards: CardDto[]
  runs: Record<string, DemoRun>
  refine: Record<string, DemoRefine>
  autoTick: boolean
}

let snapshot: { version: number; value: DemoSnapshot } | null = null

function read(): DemoSnapshot {
  if (!snapshot || snapshot.version !== version) {
    const value = current()
    snapshot = { version, value: { cards: value.cards, runs: value.runs, refine: value.refine, autoTick: value.autoTick } }
  }
  return snapshot.value
}

/** Le magasin, pour un composant : se relit à chaque geste. */
export function useDemoStore(enabled: boolean): DemoSnapshot | null {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
  )
  if (enabled) ensureTicker()
  return enabled ? value : null
}

/** Le statut d'une carte dans le pilotage de son jalon, `null` hors pilotage. */
export function runStatusOf(snapshot: DemoSnapshot | null, card: CardDto): RunStatus | null {
  if (!snapshot || !card.parent) return null
  const run = snapshot.runs[card.parent.id]
  if (!run || run.merged) return null
  const status = run.statuses[card.id]
  if (status === 'queued' || status === 'waiting' || status === undefined) return readyInRun(snapshot.cards, card) ? 'queued' : 'waiting'
  return status
}

function readyInRun(cards: CardDto[], card: CardDto): boolean {
  return card.blockedBy.every((blocker) => {
    const target = cards.find((entry) => entry.id === blocker.id)
    return !target || target.column === 'done' || target.column === 'abandoned'
  })
}

/* ------------------------------------------------------------------ gestes : ajouter, affiner */

export function addIdea(title: string, refineNow: boolean): number {
  let number = 0
  update((draft) => {
    const card = newCard(draft, title, { position: 100 + draft.nextNumber })
    draft.flagged.push(card.id)
    number = card.number
    if (refineNow) draft.refine[card.id] = { questions: questionsFor(title), draft: null }
  })
  return number
}

function questionsFor(title: string): DemoQuestion[] {
  const now = Date.now()
  return [
    { id: 'cible', text: `« ${title} » : qu'est-ce qui doit marcher à la fin, concrètement ?`, at: now, answer: null },
    { id: 'hors-champ', text: "Qu'est-ce qui est hors champ pour ce jalon ?", at: now, answer: null },
    { id: 'ordre', text: 'Un ordre imposé, ou une échéance à tenir ?', at: now, answer: null },
  ]
}

export function startRefine(milestoneId: string) {
  update((draft) => {
    const card = find(draft, milestoneId)
    draft.refine[milestoneId] = { questions: questionsFor(card.title), draft: null }
  })
}

export function answerQuestion(milestoneId: string, questionId: string, answer: string) {
  update((draft) => {
    const refine = draft.refine[milestoneId]
    if (!refine) return
    const question = refine.questions.find((entry) => entry.id === questionId)
    if (!question) return
    question.answer = answer
    const card = find(draft, milestoneId)
    card.description = `${card.description}${card.description ? '\n' : ''}- **${question.text}** — ${answer}`
    if (refine.thread) {
      // Flux v2 : la réponse entre dans le fil, et l'agent enchaîne quand tout est répondu.
      refine.thread.push(say('user', answer))
      const done = refine.questions.every((entry) => entry.answer !== null)
      if (done && !refine.draft && card.children.length === 0) {
        const answers = Object.fromEntries(refine.questions.map((entry) => [entry.id, entry.answer ?? '']))
        refine.draft = draftFromAnswers(card.title, answers)
        refine.thread.push(say('agent', `Merci, j'ai ce qu'il me faut. Je propose ${refine.draft.length} cartes, à corriger puis valider ci-dessous.`))
      } else if (done) {
        refine.thread.push(say('agent', 'Noté, j’en tiens compte dans le découpage.'))
      }
      return
    }
    // Toutes répondues : l'agent propose un découpage.
    if (refine.questions.every((entry) => entry.answer !== null) && card.children.length === 0) {
      refine.draft = [
        { key: 'a', title: `Modèle et API : ${card.title}`, after: [] },
        { key: 'b', title: `Interface : ${card.title}`, after: ['a'] },
        { key: 'c', title: 'Cas limites et réglages', after: ['a'] },
        { key: 'd', title: 'Documentation et revue finale', after: ['b', 'c'] },
      ]
    }
  })
}

export function renameDraftCard(milestoneId: string, key: string, title: string) {
  update((draft) => {
    const entry = draft.refine[milestoneId]?.draft?.find((card) => card.key === key)
    if (entry) entry.title = title
  })
}

export function removeDraftCard(milestoneId: string, key: string) {
  update((draft) => {
    const refine = draft.refine[milestoneId]
    if (!refine?.draft) return
    refine.draft = refine.draft.filter((card) => card.key !== key).map((card) => ({ ...card, after: card.after.filter((entry) => entry !== key) }))
  })
}

/**
 * Le clic qui crée tout. Pour montrer l'étape suivante, la troisième carte arrive « à
 * préciser » et la dernière n'est pas encore acceptée.
 */
export function validateDraft(milestoneId: string) {
  update((draft) => {
    const refine = draft.refine[milestoneId]
    if (!refine?.draft) return
    const created = new Map<string, CardDto>()
    refine.draft.forEach((entry, index) => {
      const card = newCard(draft, entry.title, {
        toClarifySince: index === 2 ? Date.now() : null,
        acceptedAt: index === refine.draft!.length - 1 && index !== 2 ? null : Date.now(),
        description: entry.subtasks?.length ? entry.subtasks.map((line) => `- [ ] ${line}`).join('\n') : '',
      })
      attach(draft, card, milestoneId)
      created.set(entry.key, card)
    })
    for (const entry of refine.draft) for (const key of entry.after) {
      const blocker = created.get(key)
      if (blocker) depend(created.get(entry.key)!, blocker)
    }
    if (refine.thread) {
      const numbers = [...created.values()].map((card) => `#${card.number}`).join(', ')
      refine.thread.push(say('agent', `Cartes créées : ${numbers}. Il reste à préciser et accepter ce que le jalon signale, puis il sera prêt à partir.`))
    }
    refine.draft = null
  })
}

/* ------------------------------------------------------------------ flux v2 : écrire, affiner */

let messageSeq = 0
function say(from: ThreadMessage['from'], text: string): ThreadMessage {
  messageSeq += 1
  return { id: `m-${Date.now()}-${messageSeq}`, from, text, at: Date.now() }
}

export interface MilestoneBrief {
  text: string
  links: string[]
  cardIds: string[]
  dueAt: number | null
  intent: 'note' | 'refine' | 'split'
}

/** Ce que l'agent dirait en ouvrant l'affinage, selon ce qu'on lui a donné. */
function openRefine(draft: DemoState, card: CardDto, brief: string, intent: 'refine' | 'split'): DemoRefine {
  const reading = readBrief(brief)
  const related = card.related.length ? `, ${card.related.length} carte${card.related.length > 1 ? 's' : ''} jointe${card.related.length > 1 ? 's' : ''}` : ''
  const thread: ThreadMessage[] = [say('activity', `Je lis le projet : AGENTS.md, ${draft.cards.filter((entry) => entry.column !== 'done').length} cartes ouvertes, les jalons en cours${related}.`)]
  if (reading.sufficient || intent === 'split') {
    const steps = reading.steps.length ? reading.steps : [card.title]
    const seeds = draftFromSteps(steps, reading.constraints)
    const open = reading.openPoints.slice(0, 1)
    thread.push(
      say(
        'agent',
        `Ton brief suffit pour découper : ${steps.length} étape${steps.length > 1 ? 's' : ''}${reading.constraints.length ? `, ${reading.constraints.length} contrainte${reading.constraints.length > 1 ? 's' : ''} reprises en vérifications` : ''}${reading.outOfScope.length ? `, le hors champ laissé de côté` : ''}. Voici un découpage.`,
      ),
    )
    const questions: DemoQuestion[] = open.map((text, index) => ({ id: `ouvert-${index}`, text: `Tu as laissé ouvert : « ${text} ». Je pars sur quoi ?`, at: Date.now(), answer: null }))
    if (questions.length) thread.push(say('agent', 'Une seule question avant de valider :'))
    return { questions, draft: seeds, thread, mode: 'brief', addition: null }
  }
  const questions = questionsForPhrase(card.title).map((question) => ({ ...question, at: Date.now(), answer: null }))
  thread.push(say('agent', `Une phrase, c'est un bon départ. Avant de découper, ${questions.length} questions :`))
  return { questions, draft: null, thread, mode: 'phrase', addition: null }
}

/** « + Jalon » du flux v2 : le jalon naît de ce qu'on a écrit, et l'affinage part ou non. */
export function createMilestoneFromBrief(input: MilestoneBrief): number {
  let number = 0
  update((draft) => {
    const title = titleFromBrief(input.text)
    const lines = input.text.trim().split('\n')
    const body = lines.slice(lines[0]?.startsWith('#') ? 1 : 0).join('\n').trim()
    const links = input.links.length ? `\n\n**Liens**\n${input.links.map((link) => `- ${link}`).join('\n')}` : ''
    const card = newCard(draft, title, { position: 100 + draft.nextNumber, dueAt: input.dueAt, description: `${body}${links}`.trim() })
    for (const id of input.cardIds) {
      const other = draft.cards.find((entry) => entry.id === id)
      if (other) {
        card.related.push(linkOf(other))
        other.related.push(linkOf(card))
      }
    }
    draft.flagged.push(card.id)
    number = card.number
    if (input.intent !== 'note') draft.refine[card.id] = openRefine(draft, card, input.text, input.intent)
  })
  return number
}

/** « Affiner » depuis la page d'un jalon du flux v2 : l'agent lit ce que le jalon porte déjà. */
export function startRefineV2(milestoneId: string) {
  update((draft) => {
    const card = find(draft, milestoneId)
    draft.refine[milestoneId] = openRefine(draft, card, `${card.title}
${card.description}`, 'refine')
  })
}

export function moveDraftCard(milestoneId: string, key: string, delta: -1 | 1) {
  update((draft) => {
    const list = draft.refine[milestoneId]?.draft
    if (!list) return
    const index = list.findIndex((card) => card.key === key)
    const target = index + delta
    if (index < 0 || target < 0 || target >= list.length) return
    const [moved] = list.splice(index, 1)
    list.splice(target, 0, moved!)
  })
}

export function toggleDraftAfter(milestoneId: string, key: string, afterKey: string) {
  update((draft) => {
    const entry = draft.refine[milestoneId]?.draft?.find((card) => card.key === key)
    if (!entry || key === afterKey) return
    entry.after = entry.after.includes(afterKey) ? entry.after.filter((other) => other !== afterKey) : [...entry.after, afterKey]
  })
}

export function addDraftCard(milestoneId: string, title: string) {
  update((draft) => {
    const list = draft.refine[milestoneId]?.draft
    if (!list) return
    const used = new Set(list.map((card) => card.key))
    const key = 'abcdefghijklmnopqrstuvwxyz'.split('').find((letter) => !used.has(letter)) ?? `k${list.length}`
    list.push({ key, title, after: list.length ? [list[list.length - 1]!.key] : [], subtasks: [] })
  })
}

/**
 * « Ajouter au jalon » : l'agent range l'ajout dans la carte qui en parle déjà (une
 * sous-tâche), ou propose de nouvelles cartes, posées après la carte la plus proche.
 */
export function proposeAddition(milestoneId: string, text: string) {
  update((draft) => {
    const refine = (draft.refine[milestoneId] ??= { questions: [], draft: null, thread: [], mode: 'brief', addition: null })
    refine.thread ??= []
    const children = childrenOf(draft.cards, milestoneId).filter((card) => card.column !== 'done' && card.column !== 'abandoned')
    const words = keywords(text)
    const scored = children
      .map((card) => ({ card, score: [...keywords(`${card.title} ${card.description}`)].filter((word) => words.has(word)).length }))
      .sort((a, b) => b.score - a.score)
    const best = scored[0]
    const reading = readBrief(text)
    refine.thread.push(say('user', text))
    if (best && best.score >= 2 && reading.steps.length < 2) {
      refine.addition = { text, kind: 'subtask', cardId: best.card.id, cardNumber: best.card.number }
      refine.thread.push(say('agent', `Ça relève de #${best.card.number} « ${best.card.title} » : je propose d'en faire une sous-tâche.`))
    } else {
      const titles = reading.steps.length >= 2 ? reading.steps.slice(0, 5) : [titleFromBrief(text)]
      const anchor = best && best.score > 0 ? best.card : null
      refine.addition = {
        text,
        kind: 'cards',
        cards: titles.map((title) => ({ title, afterId: anchor?.id ?? null, afterNumber: anchor?.number ?? null })),
      }
      refine.thread.push(
        say('agent', `Je propose ${titles.length} nouvelle${titles.length > 1 ? 's' : ''} carte${titles.length > 1 ? 's' : ''}${anchor ? `, après #${anchor.number} qui en est la plus proche` : ', sans dépendance : elle peut partir tout de suite'}.`),
      )
    }
  })
}

export function acceptAddition(milestoneId: string) {
  update((draft) => {
    const refine = draft.refine[milestoneId]
    const proposal = refine?.addition
    if (!refine || !proposal) return
    if (proposal.kind === 'subtask' && proposal.cardId) {
      const card = find(draft, proposal.cardId)
      card.description = `${card.description}${card.description ? '\n' : ''}- [ ] ${proposal.text.split('\n')[0]}`
      refine.thread?.push(say('agent', `Ajouté en sous-tâche de #${card.number}.`))
    } else {
      const created: number[] = []
      for (const entry of proposal.cards ?? []) {
        const card = newCard(draft, entry.title)
        attach(draft, card, milestoneId)
        if (entry.afterId) depend(card, find(draft, entry.afterId))
        const run = draft.runs[milestoneId]
        if (run && !run.merged) {
          run.statuses[card.id] = 'queued'
          run.prOpen = false
        }
        created.push(card.number)
      }
      refine.thread?.push(say('agent', `Cartes ajoutées au jalon : ${created.map((number) => `#${number}`).join(', ')}.`))
    }
    refine.addition = null
  })
}

export function dismissAddition(milestoneId: string) {
  update((draft) => {
    const refine = draft.refine[milestoneId]
    if (!refine?.addition) return
    refine.addition = null
    refine.thread?.push(say('agent', 'D’accord, je laisse le jalon tel quel.'))
  })
}

/* ------------------------------------------------------------------ gestes : préciser */

export function clarifyCard(cardId: string, answer: string) {
  update((draft) => {
    const card = find(draft, cardId)
    card.toClarifySince = null
    card.description = `${card.description}${card.description ? '\n\n' : ''}**Précision** — ${answer}`
  })
}

export function acceptCard(cardId: string) {
  update((draft) => {
    find(draft, cardId).acceptedAt = Date.now()
  })
}

export function removeBlock(cardId: string, blockerId: string) {
  update((draft) => {
    const card = find(draft, cardId)
    const blocker = find(draft, blockerId)
    card.blockedBy = card.blockedBy.filter((entry) => entry.id !== blockerId)
    blocker.blocks = blocker.blocks.filter((entry) => entry.id !== cardId)
  })
}

/* ------------------------------------------------------------------ gestes : lancer, suivre */

export function launchMilestone(milestoneId: string, options: { mode: RunMode; confined: boolean; concurrency: number }) {
  update((draft) => {
    const statuses: Record<string, RunStatus> = {}
    for (const child of childrenOf(draft.cards, milestoneId)) statuses[child.id] = statusFromColumn(child)
    draft.runs[milestoneId] = {
      milestoneId,
      startedAt: Date.now(),
      concurrency: options.concurrency,
      mode: options.mode,
      confined: options.confined,
      paused: false,
      statuses,
      blockedOnce: false,
      blocked: null,
      prOpen: false,
      merged: false,
    }
    const parent = find(draft, milestoneId)
    if (parent.column === 'todo') setColumn(parent, 'in_progress')
    if (options.mode === 'auto') advance(draft, milestoneId)
  })
}

/** À la main : tu lances une carte toi-même. */
export function startCard(cardId: string) {
  update((draft) => {
    const card = find(draft, cardId)
    const run = card.parent ? draft.runs[card.parent.id] : undefined
    if (run) begin(run, card)
    else {
      setColumn(card, 'in_progress')
      setSession(card, 'running')
    }
  })
}

export function setRunMode(milestoneId: string, mode: RunMode) {
  update((draft) => {
    const run = draft.runs[milestoneId]
    if (run) run.mode = mode
  })
}

export function setRunConfined(milestoneId: string, confined: boolean) {
  update((draft) => {
    const run = draft.runs[milestoneId]
    if (run) run.confined = confined
  })
}

export function setPaused(milestoneId: string, paused: boolean) {
  update((draft) => {
    const run = draft.runs[milestoneId]
    if (run) run.paused = paused
  })
}

export function answerBlock(milestoneId: string, answer: string) {
  update((draft) => {
    const run = draft.runs[milestoneId]
    if (!run?.blocked) return
    const card = find(draft, run.blocked.cardId)
    card.description = `${card.description}${card.description ? '\n\n' : ''}**Réponse à la session** — ${answer}`
    run.statuses[card.id] = 'working'
    setSession(card, 'running')
    run.blocked = null
  })
}

/**
 * Répondre à la session d'une carte, depuis « Ce qui t'attend » ou la fiche : le
 * blocage d'un pilotage s'il porte sur elle, sinon la session repart simplement.
 */
export function answerCardSession(cardId: string, answer: string) {
  update((draft) => {
    const card = find(draft, cardId)
    if (!card) return
    card.description = `${card.description}${card.description ? '\n\n' : ''}**Réponse à la session** — ${answer}`
    const run = Object.values(draft.runs).find((entry) => entry.blocked?.cardId === cardId)
    if (run) {
      run.statuses[cardId] = 'working'
      run.blocked = null
    }
    card.conversations = card.conversations.map((entry) => (entry.status === 'awaiting_input' ? { ...entry, status: 'running' } : entry))
  })
}

/** Cocher une sous-tâche d'une carte de démo, dans sa description. */
export function toggleDemoSubtask(cardId: string, index: number, checked: boolean) {
  update((draft) => {
    const card = find(draft, cardId)
    if (!card) return
    let seen = -1
    card.description = card.description
      .split('\n')
      .map((line) => {
        const match = /^(\s*[-*+]\s+)\[( |x|X)\](.*)$/.exec(line)
        if (!match) return line
        seen += 1
        return seen === index ? `${match[1]}[${checked ? 'x' : ' '}]${match[3]}` : line
      })
      .join('\n')
  })
}

/** Une carte de plus dans un jalon lancé : acceptée, elle entre dans la file. */
export function addCardToMilestone(milestoneId: string, title: string) {
  update((draft) => {
    const card = newCard(draft, title)
    attach(draft, card, milestoneId)
    const run = draft.runs[milestoneId]
    if (run && !run.merged) {
      run.statuses[card.id] = 'queued'
      run.prOpen = false
    }
  })
}

export function mergeMilestonePr(milestoneId: string) {
  update((draft) => {
    const run = draft.runs[milestoneId]
    if (!run) return
    run.merged = true
    run.prOpen = false
    setColumn(find(draft, milestoneId), 'done')
  })
}

export function stepDemo() {
  update((draft) => {
    for (const run of Object.values(draft.runs)) if (!run.merged) advance(draft, run.milestoneId, true)
  })
}

export function setAutoTick(on: boolean) {
  update((draft) => {
    draft.autoTick = on
  })
}

export function resetDemo() {
  localStorage.removeItem(STORAGE)
  localStorage.removeItem('proto-milestone-flags')
  commit(initial())
}

function begin(run: DemoRun, card: CardDto) {
  setColumn(card, 'in_progress')
  // Le blocage simulé, une fois par pilotage : la session pose une question.
  const merged = Object.values(run.statuses).filter((status) => status === 'merged').length
  if (!run.blockedOnce && merged >= 1) {
    run.blockedOnce = true
    run.statuses[card.id] = 'blocked'
    run.blocked = { cardId: card.id, question: `#${card.number} : faut-il garder la compatibilité avec l'ancien format, ou peut-on le casser ?` }
    setSession(card, 'awaiting_input')
    return
  }
  run.statuses[card.id] = 'working'
  setSession(card, 'running')
}

/**
 * Un tic du pilotage : chaque carte avance d'un cran. `force` passe outre la pause du
 * défilement automatique (le bouton « Avancer d'un pas »), pas la pause du jalon.
 */
function advance(draft: DemoState, milestoneId: string, _force = false) {
  const run = draft.runs[milestoneId]
  if (!run || run.merged || run.paused) return
  const children = childrenOf(draft.cards, milestoneId)
  for (const child of children) if (!(child.id in run.statuses)) run.statuses[child.id] = statusFromColumn(child)

  // Ce qui avance : revue → fusionnée, puis au travail → revue.
  for (const child of children) {
    const status = run.statuses[child.id]
    if (status === 'review') {
      run.statuses[child.id] = 'merged'
      setColumn(child, 'done')
      setSession(child, null)
    }
  }
  for (const child of children) {
    const status = run.statuses[child.id]
    if (status === 'working') {
      run.statuses[child.id] = 'review'
      setColumn(child, 'review')
      setSession(child, null)
    }
  }

  // Ce qui part : en autonome, les prêtes, dans la limite des places. Une carte bloquée
  // libère sa place, comme dans le vrai pilotage.
  if (run.mode === 'auto') {
    const busy = children.filter((child) => ['working', 'review'].includes(run.statuses[child.id] ?? '')).length
    let free = run.concurrency - busy
    for (const child of children) {
      if (free <= 0) break
      const status = run.statuses[child.id]
      if ((status === 'queued' || status === 'waiting') && child.acceptedAt !== null && readyInRun(draft.cards, child)) {
        begin(run, child)
        free -= 1
      }
    }
  }

  if (children.length > 0 && children.every((child) => run.statuses[child.id] === 'merged')) run.prOpen = true
}

/* ------------------------------------------------------------------ défilement automatique */

let ticker: number | null = null

function ensureTicker() {
  if (ticker !== null || typeof window === 'undefined') return
  ticker = window.setInterval(() => {
    const value = current()
    if (!value.autoTick) return
    const active = Object.values(value.runs).filter((run) => !run.merged && !run.paused)
    if (active.length === 0) return
    update((draft) => {
      for (const run of Object.values(draft.runs)) if (!run.merged) advance(draft, run.milestoneId)
    })
  }, TICK_MS)
}

/** Ce qui fige un pilotage : la question d'une session, que seul Tim peut lever. */
export function demoWaiting(snapshot: DemoSnapshot | null): { milestoneId: string; cardNumber: number; question: string }[] {
  if (!snapshot) return []
  return Object.values(snapshot.runs).flatMap((run) => {
    if (!run.blocked || run.merged) return []
    const card = snapshot.cards.find((entry) => entry.id === run.blocked!.cardId)
    return [{ milestoneId: run.milestoneId, cardNumber: card?.number ?? 0, question: run.blocked.question }]
  })
}
