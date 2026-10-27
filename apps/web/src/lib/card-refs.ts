import { createContext, useContext } from 'react'
import type { CardDto } from '@solera/protocol'
import { useCards } from './cards'

/**
 * Le projet dont un texte rendu peut citer les cartes (`#12`).
 *
 * Fourni par les écrans qui savent de quel projet ils parlent : une conversation, le
 * détail d'une carte. Ailleurs (notes de version, consignes), un `#12` n'a pas de board
 * auquel se rapporter et reste du texte.
 */
export const CardRefContext = createContext<string | null>(null)

interface CardRefs {
  /** Par numéro, pour l'aperçu et le lien. */
  byNumber: Map<number, CardDto>
  /** Les numéros seuls, ce que l'analyse du markdown reconnaît ; absent sans carte. */
  numbers: Set<number> | undefined
}

const NO_CARDS: CardRefs = { byNumber: new Map(), numbers: undefined }

// Construit une fois par réponse du board, et non une fois par message du fil.
const indexes = new WeakMap<CardDto[], CardRefs>()

function indexOf(cards: CardDto[] | undefined): CardRefs {
  if (!cards) return NO_CARDS
  const cached = indexes.get(cards)
  if (cached) return cached
  const byNumber = new Map(cards.map((card) => [card.number, card]))
  const index = { byNumber, numbers: byNumber.size > 0 ? new Set(byNumber.keys()) : undefined }
  indexes.set(cards, index)
  return index
}

/** Les cartes citables du projet en cours, par numéro ; vide hors contexte. */
export function useCardRefs(): { projectId: string | null; cards: Map<number, CardDto>; numbers: Set<number> | undefined } {
  const projectId = useContext(CardRefContext)
  // La liste du board, déjà en cache quand on vient de lui : un seul appel par projet,
  // partagé par tous les messages du fil.
  const { data } = useCards(projectId ?? undefined)
  const { byNumber, numbers } = indexOf(data)
  return { projectId, cards: byNumber, numbers }
}

/** L'adresse d'une carte : le board de son projet, tiroir ouvert sur elle. */
export function cardHref(projectId: string, number: number): string {
  return `/p/${projectId}/board?carte=${number}`
}
