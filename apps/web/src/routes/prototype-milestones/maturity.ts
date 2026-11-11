/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import type { CardDto } from '@solera/protocol'
import type { Milestone } from '../../lib/timeline'
import { isOpen, type ProtoData, type RefineQuestion } from './model'
import type { DemoRun, DraftCard } from './demo-store'
import { isFlaggedMilestone } from './flags'

/**
 * La maturité d'un jalon : où il en est entre l'idée et la livraison.
 *
 * HEURISTIQUE, dérivée des cartes telles qu'elles existent aujourd'hui (rien ne la stocke) :
 *
 * - **Idée** : pas d'enfants. Le modèle actuel ne connaît pas de jalon sans enfants — un
 *   jalon *est* une carte qui en a. Une idée de jalon est une carte de haut niveau, sans
 *   enfants, qui porte le **drapeau « jalon »** (SIMULÉ, voir `flags.ts`).
 * - **À affiner** : des questions d'affinage en attente, ou un brouillon de découpage à
 *   valider (SIMULÉS en démo : `demo-store.ts` ; en vrai, c'est la session d'affinage
 *   qui t'attend).
 * - **À régler** (l'ancien « Découpé », qu'on lisait « à découper ») : des enfants, mais pas lançable — une carte « à préciser »
 *   (`toClarifySince`) ou pas encore acceptée, un cycle de blocages, ou aucune carte
 *   ouverte qui puisse partir (toutes retenues par des cartes hors jalon).
 * - **Prêt** : des enfants, rien à préciser, pas de cycle, au moins une carte qui peut
 *   partir, et aucun pilotage.
 * - **Lancé** : un pilotage en marche ou en pause (`useActiveMilestones`), jusqu'à la
 *   fusion de la PR du jalon — même quand toutes ses cartes sont déjà closes.
 * - **Livré** : toutes les enfants closes (faites ou abandonnées), au moins une faite.
 */
export type Maturity = 'idea' | 'refine' | 'split' | 'ready' | 'launched' | 'delivered'

export const MATURITIES: Maturity[] = ['idea', 'refine', 'split', 'ready', 'launched', 'delivered']

export const MATURITY_LABEL: Record<Maturity, string> = {
  idea: 'Idée',
  refine: 'À affiner',
  // « Découpé » se lisait « à découper » : c'est l'inverse. Le jalon a ses cartes, il
  // reste des choses à régler avant de pouvoir partir.
  split: 'À régler',
  ready: 'Prêt',
  launched: 'Lancé',
  delivered: 'Livré',
}

/** Teinte d'une pastille de maturité. */
export const MATURITY_TONE: Record<Maturity, string> = {
  idea: 'bg-surface-high text-ink-soft',
  refine: 'bg-caution/15 text-caution',
  split: 'bg-surface-high text-ink',
  ready: 'bg-positive/15 text-positive',
  launched: 'bg-accent/20 text-accent',
  delivered: 'bg-positive/25 text-positive',
}

/** Un jalon tel que l'horizon le lit : idée sans enfants comprise. */
export interface HorizonMilestone {
  card: CardDto
  cards: CardDto[]
  done: number
  maturity: Maturity
  questions: RefineQuestion[]
  toClarify: CardDto[]
  notAccepted: CardDto[]
  cycle: CardDto[]
  /** Cartes qui peuvent partir tout de suite : ouvertes, sans bloqueur ouvert. */
  startable: CardDto[]
  /** Cartes ajoutées après le lancement du pilotage. */
  addedSinceLaunch: CardDto[]
  launchedAt: number | null
  /** Le brouillon de découpage en attente de validation (démo). */
  draft: DraftCard[] | null
  /** Le pilotage simulé (démo), `null` sinon. */
  run: DemoRun | null
}

export function isIdea(card: CardDto): boolean {
  return card.parent === null && card.children.length === 0 && isFlaggedMilestone(card)
}

/** Les cartes d'un jalon prises dans un cycle de blocages internes. */
export function cycleOf(cards: CardDto[]): CardDto[] {
  const ids = new Set(cards.map((card) => card.id))
  const byId = new Map(cards.map((card) => [card.id, card]))
  const state = new Map<string, 'visiting' | 'done'>()
  const inCycle = new Set<string>()
  const stack: string[] = []
  const visit = (card: CardDto) => {
    state.set(card.id, 'visiting')
    stack.push(card.id)
    for (const blocker of card.blockedBy) {
      if (!ids.has(blocker.id)) continue
      const status = state.get(blocker.id)
      if (status === 'visiting') {
        for (const id of stack.slice(stack.indexOf(blocker.id))) inCycle.add(id)
      } else if (!status) visit(byId.get(blocker.id)!)
    }
    stack.pop()
    state.set(card.id, 'done')
  }
  for (const card of cards) if (!state.has(card.id)) visit(card)
  return cards.filter((card) => inCycle.has(card.id))
}

export function analyse(milestone: Milestone | { card: CardDto; cards: CardDto[]; done: number }, data: ProtoData): HorizonMilestone {
  const { card, cards } = milestone
  const open = cards.filter(isOpen)
  const refine = data.refine[card.id]
  const questions: RefineQuestion[] = (refine?.questions ?? [])
    .filter((question) => question.answer === null)
    .map((question) => ({ id: question.id, text: question.text, askedBy: 'Claude', at: question.at }))
  const draft = refine?.draft ?? null
  const run = data.runs[card.id] ?? null
  const toClarify = open.filter((entry) => entry.toClarifySince !== null)
  const notAccepted = open.filter((entry) => entry.acceptedAt === null)
  const cycle = cycleOf(open)
  const startable = open.filter((entry) => entry.blockedBy.every((blocker) => blocker.column === 'done' || blocker.column === 'abandoned'))
  const launchedAt = data.runStart.get(card.id) ?? null
  const addedSinceLaunch = launchedAt === null ? [] : cards.filter((entry) => entry.createdAt > launchedAt)

  let maturity: Maturity
  if (data.launched.has(card.id)) maturity = 'launched'
  else if (cards.length === 0) maturity = questions.length > 0 || draft ? 'refine' : 'idea'
  else if (open.length === 0) maturity = 'delivered'
  else if (questions.length > 0 || draft) maturity = 'refine'
  else if (toClarify.length > 0 || notAccepted.length > 0 || cycle.length > 0 || startable.length === 0) maturity = 'split'
  else maturity = 'ready'

  const done = cards.filter((entry) => entry.column === 'done').length
  return { card, cards, done, maturity, questions, toClarify, notAccepted, cycle, startable, addedSinceLaunch, launchedAt, draft, run }
}

/** Tous les jalons de l'horizon, idées comprises. */
export function horizonOf(data: ProtoData): HorizonMilestone[] {
  const ideas = data.cards.filter(isIdea).map((card) => ({ card, cards: [] as CardDto[], done: 0 }))
  return [...data.milestones, ...ideas].map((entry) => analyse(entry, data))
}

/** La prochaine action qu'une maturité appelle, dite en une ligne. */
export function nextAction(entry: HorizonMilestone): { label: string; detail: string } {
  switch (entry.maturity) {
    case 'idea':
      return { label: 'Affiner', detail: "Lancer une session d'affinage : l'agent pose ses questions, puis propose un découpage." }
    case 'refine':
      return entry.draft
        ? { label: 'Valider le découpage', detail: `L'agent propose ${entry.draft.length} cartes : corrige-les, puis valide.` }
        : { label: 'Répondre', detail: `${entry.questions.length} question${entry.questions.length > 1 ? 's' : ''} de l'agent en attente` }
    case 'split': {
      const parts = [
        entry.toClarify.length ? `${entry.toClarify.length} carte${entry.toClarify.length > 1 ? 's' : ''} à préciser` : null,
        entry.notAccepted.length ? `${entry.notAccepted.length} à accepter` : null,
        entry.cycle.length ? `un cycle entre ${entry.cycle.map((card) => `#${card.number}`).join(', ')}` : null,
      ].filter(Boolean)
      if (parts.length) return { label: entry.cycle.length && parts.length === 1 ? 'Défaire le cycle' : 'Préciser', detail: parts.join(' · ') }
      return { label: 'Revoir les dépendances', detail: 'Aucune carte ne peut partir : toutes attendent une carte hors du jalon.' }
    }
    case 'ready':
      return { label: 'Lancer', detail: `${entry.startable.length} carte${entry.startable.length > 1 ? 's' : ''} peuvent partir tout de suite.` }
    case 'launched':
      if (entry.run?.prOpen) return { label: 'Fusionner', detail: 'Toutes les cartes sont fusionnées : la PR du jalon vers main est ouverte.' }
      if (entry.run?.blocked) return { label: 'Répondre', detail: `Une session t'attend : ${entry.run.blocked.question}` }
      return { label: 'Suivre', detail: `${entry.done}/${entry.cards.length} fusionnées${entry.addedSinceLaunch.length ? ` · +${entry.addedSinceLaunch.length} depuis le lancement` : ''}${entry.run?.paused ? ' · en pause' : ''}` }
    case 'delivered':
      return { label: 'Relire le bilan', detail: `${entry.done} cartes livrées.` }
  }
}

/**
 * Ce qui t'attend dans les jalons (démo à états comprise) : les sessions bloquées d'un
 * jalon lancé, les questions d'affinage, les brouillons à valider, les PR de jalon à
 * fusionner. Pour la bande « Ce qui t'attend » de l'Aperçu.
 */
export function milestoneAsks(data: ProtoData): { key: string; title: string; detail: string; number: number }[] {
  return horizonOf(data).flatMap((entry) => {
    const asks: { key: string; title: string; detail: string; number: number }[] = []
    const number = entry.card.number
    if (entry.run?.blocked) asks.push({ key: `block-${entry.card.id}`, title: entry.run.blocked.question, detail: `Jalon #${number} : une session t'attend`, number })
    if (entry.questions.length) asks.push({ key: `q-${entry.card.id}`, title: `${entry.questions.length} question(s) d'affinage`, detail: `Jalon #${number} ${entry.card.title}`, number })
    if (entry.draft) asks.push({ key: `d-${entry.card.id}`, title: 'Découpage proposé à valider', detail: `Jalon #${number} ${entry.card.title}`, number })
    if (entry.run?.prOpen) asks.push({ key: `pr-${entry.card.id}`, title: 'PR du jalon à fusionner', detail: `Jalon #${number} ${entry.card.title}`, number })
    return asks
  })
}

/* ------------------------------------------------------------------ maturité expliquée */

/**
 * La règle de chaque étape, en clair : quand un jalon y est, et ce qui l'en fait sortir.
 * C'est la même logique qu'`analyse`, dite pour un humain ; si l'une change, l'autre suit.
 */
export const MATURITY_RULE: Record<Maturity, { when: string; leave: string }> = {
  idea: {
    when: 'Une carte marquée « C’est un jalon », sans cartes dedans ni questions ouvertes.',
    leave: 'Lancer l’affinage : l’agent lit le projet et pose ses questions, ou propose un découpage.',
  },
  refine: {
    when: 'L’agent attend tes réponses, ou un brouillon de cartes attend ta validation.',
    leave: 'Répondre aux questions, puis valider le brouillon : les cartes sont créées.',
  },
  split: {
    when: 'Les cartes existent, mais quelque chose empêche de partir : une carte à préciser, une carte pas encore acceptée, un cycle de dépendances, ou aucune carte libre.',
    leave: 'Régler ces points un à un : il devient Prêt dès qu’il n’en reste aucun.',
  },
  ready: {
    when: 'Tout est clair, sans cycle, et au moins une carte peut partir tout de suite.',
    leave: 'Lancer : à la main, ou en autonome, vague par vague.',
  },
  launched: {
    when: 'Un pilotage tourne (ou est en pause), jusqu’à la fusion de la PR du jalon.',
    leave: 'Quand toutes les cartes sont fusionnées, fusionner la PR du jalon dans main.',
  },
  delivered: {
    when: 'Toutes les cartes sont closes, au moins une faite.',
    leave: 'C’est la fin du parcours.',
  },
}

/** Pourquoi ce jalon est à son étape, en raisons concrètes (pas la règle générale). */
export function maturityReasons(entry: HorizonMilestone): string[] {
  const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`
  switch (entry.maturity) {
    case 'idea':
      return ['Pas encore de cartes, et l’affinage n’a pas commencé.']
    case 'refine': {
      const reasons: string[] = []
      if (entry.questions.length) reasons.push(`${plural(entry.questions.length, 'question de l’agent attend', 'questions de l’agent attendent')} ta réponse.`)
      if (entry.draft) reasons.push(`Un brouillon de ${plural(entry.draft.length, 'carte', 'cartes')} attend ta validation.`)
      return reasons.length ? reasons : ['L’affinage est en cours.']
    }
    case 'split': {
      const reasons: string[] = []
      if (entry.toClarify.length) reasons.push(`${plural(entry.toClarify.length, 'carte est', 'cartes sont')} à préciser : ${entry.toClarify.map((card) => `#${card.number}`).join(', ')}.`)
      if (entry.notAccepted.length) reasons.push(`${plural(entry.notAccepted.length, 'carte n’est', 'cartes ne sont')} pas encore acceptée${entry.notAccepted.length > 1 ? 's' : ''} : ${entry.notAccepted.map((card) => `#${card.number}`).join(', ')}.`)
      if (entry.cycle.length) reasons.push(`Un cycle de dépendances bloque ${entry.cycle.map((card) => `#${card.number}`).join(', ')}.`)
      if (!reasons.length && entry.startable.length === 0) reasons.push('Aucune carte ne peut partir : toutes attendent une carte hors du jalon.')
      return reasons
    }
    case 'ready':
      return [`${plural(entry.startable.length, 'carte peut', 'cartes peuvent')} partir tout de suite, rien n’est à régler.`]
    case 'launched': {
      const reasons = [`${entry.done}/${entry.cards.length} cartes fusionnées.`]
      if (entry.run?.paused) reasons.push('Le pilotage est en pause.')
      if (entry.run?.blocked) reasons.push(`Une session t’attend : ${entry.run.blocked.question}`)
      if (entry.run?.prOpen) reasons.push('La PR du jalon vers main est ouverte.')
      return reasons
    }
    case 'delivered':
      return [`${plural(entry.done, 'carte livrée', 'cartes livrées')}.`]
  }
}

/** La phrase courte d'une pastille : l'étape et sa raison principale (infobulle). */
export function maturityTooltip(entry: HorizonMilestone): string {
  return `${MATURITY_LABEL[entry.maturity]} — ${maturityReasons(entry)[0] ?? MATURITY_RULE[entry.maturity].when}`
}

/** L'étape où un jalon entre selon le geste du composer. */
export const ENTRY_STAGE: Record<'note' | 'refine' | 'split', { stage: Maturity; then: string }> = {
  note: { stage: 'idea', then: 'Il attend dans « Plus tard » ; rien ne part.' },
  refine: { stage: 'refine', then: 'L’agent lit le projet et pose ses questions ; tu réponds dans la page du jalon.' },
  split: { stage: 'refine', then: 'L’agent propose tout de suite un brouillon ; à la validation, il passe À régler ou Prêt.' },
}
