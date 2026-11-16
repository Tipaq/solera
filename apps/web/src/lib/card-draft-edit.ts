import { MAX_DRAFT_CARDS, withoutDraftCard, type CardDraft, type CardDraftCard } from '@solera/protocol'

/*
 * Corriger un brouillon de découpage (`propose_cards`) avant de le valider (#195, spec
 * jalons AFF-6) : renommer, retirer, réordonner, lier, ajouter. Pur, sans React : la page
 * d'un jalon (`DraftEditor`) tient le brouillon corrigé en local et l'envoie au clic,
 * contrôlé par `cardDraftProblems` comme le bloc du fil.
 *
 * Chaque fonction rend le brouillon lui-même quand le geste ne change rien : l'appelant
 * peut s'en servir pour ne pas rerendre.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** La lettre d'une carte du brouillon, par son rang : A, B, C… */
export function draftLetter(index: number): string {
  return LETTERS[index] ?? String(index + 1)
}

const withCard = (draft: CardDraft, key: string, patch: Partial<CardDraftCard>): CardDraft => ({
  ...draft,
  cards: draft.cards.map((card) => (card.key === key ? { ...card, ...patch } : card)),
})

/** Un titre vide ou inchangé n'est pas un renommage : on garde celui de l'agent. */
export function renameDraftCard(draft: CardDraft, key: string, title: string): CardDraft {
  const next = title.trim()
  const card = draft.cards.find((entry) => entry.key === key)
  if (!card || !next || next === card.title) return draft
  return withCard(draft, key, { title: next })
}

/** Retire une carte, et les liens « après » qui la citaient. */
export function removeDraftCard(draft: CardDraft, key: string): CardDraft {
  return withoutDraftCard(draft, key)
}

/**
 * Échange une carte avec sa voisine du dessus (`-1`) ou du dessous (`1`) : l'ordre est
 * celui de la création, donc des numéros.
 *
 * Les pastilles « après » ne montrent que les cartes du dessus. Passer une carte au-dessus
 * de celle qu'elle attend défait donc ce lien, plutôt que de le laisser invisible —
 * c'est le seul que l'échange retourne.
 */
export function moveDraftCard(draft: CardDraft, key: string, delta: -1 | 1): CardDraft {
  const index = draft.cards.findIndex((card) => card.key === key)
  const target = index + delta
  if (index < 0 || target < 0 || target >= draft.cards.length) return draft
  const cards = [...draft.cards]
  const [upper, lower] = delta === -1 ? [cards[target]!, cards[index]!] : [cards[index]!, cards[target]!]
  // `lower` passe au-dessus : il ne peut plus attendre `upper`.
  const raised = lower.after.includes(upper.key) ? { ...lower, after: lower.after.filter((other) => other !== upper.key) } : lower
  const top = Math.min(index, target)
  cards[top] = raised
  cards[top + 1] = upper
  return { ...draft, cards }
}

/**
 * Allume ou éteint « `key` après `afterKey` ». Un lien s'allume seulement vers une carte du
 * dessus ; il s'éteint toujours, même celui que l'agent aurait posé vers le dessous.
 */
export function toggleDraftAfter(draft: CardDraft, key: string, afterKey: string): CardDraft {
  const index = draft.cards.findIndex((card) => card.key === key)
  const before = draft.cards.findIndex((card) => card.key === afterKey)
  const card = draft.cards[index]
  if (!card || before < 0) return draft
  if (card.after.includes(afterKey)) return withCard(draft, key, { after: card.after.filter((other) => other !== afterKey) })
  return before < index ? withCard(draft, key, { after: [...card.after, afterKey] }) : draft
}

/**
 * Les cartes du dessous qu'une carte attend : `propose_cards` ne range pas ses cartes dans
 * l'ordre de leurs liens. La page les montre allumées après les pastilles du dessus, pour
 * qu'aucun lien ne parte sans s'être vu.
 */
export function draftLinksBelow(draft: CardDraft, key: string): string[] {
  const index = draft.cards.findIndex((card) => card.key === key)
  const below = new Set(draft.cards.slice(index + 1).map((card) => card.key))
  return draft.cards[index]?.after.filter((other) => below.has(other)) ?? []
}

/** Une carte de plus peut-elle entrer dans le brouillon ? */
export function canAddDraftCard(draft: CardDraft): boolean {
  return draft.cards.length < MAX_DRAFT_CARDS
}

/**
 * Ajoute une carte à la fin, après la dernière : ce qu'on ajoute à la main vient
 * d'ordinaire en fin de chantier, et la pastille se rééteint d'un clic. Sa clé est libre
 * (`k1`, `k2`…), choisie hors de celles de l'agent.
 */
export function addDraftCard(draft: CardDraft, title: string): CardDraft {
  const clean = title.trim()
  if (!clean || !canAddDraftCard(draft)) return draft
  const used = new Set(draft.cards.map((card) => card.key))
  let n = 1
  while (used.has(`k${n}`)) n += 1
  const last = draft.cards.at(-1)
  const card: CardDraftCard = {
    key: `k${n}`,
    title: clean,
    description: '',
    subtasks: [],
    after: last ? [last.key] : [],
    blockedBy: [],
    related: [],
  }
  return { ...draft, cards: [...draft.cards, card] }
}
