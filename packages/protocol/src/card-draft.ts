import { z } from 'zod'

/**
 * Le brouillon d'un découpage en cartes (#70) : ce qu'un agent propose après une dictée,
 * et que la personne corrige puis valide. **Rien n'est créé avant le clic** : le
 * brouillon vit dans la demande et dans le journal de la conversation, pas sur le board.
 *
 * Les cartes du brouillon n'ont pas encore de numéro : elles se désignent entre elles par
 * une clé que l'agent choisit (`key`), et c'est par elle que passent les liens « bloque »
 * internes au brouillon (`after`). Les cartes existantes, elles, sont nommées par leur
 * numéro, résolu au dépôt.
 */

/** Au-delà, ce n'est plus un chantier qu'on relit d'un coup, mais plusieurs. */
export const MAX_DRAFT_CARDS = 20
/** Bornes d'accord avec `card-gestures.ts` et la route du board. */
export const DRAFT_TITLE_MAX = 200
export const DRAFT_DESCRIPTION_MAX = 20_000
export const DRAFT_SUBTASKS_MAX = 30
export const DRAFT_SUBTASK_MAX = 300
export const DRAFT_LINKS_MAX = 20

/** Une carte existante nommée dans le brouillon : de quoi l'afficher sans relire la base. */
export const cardDraftRefSchema = z.object({ cardId: z.string(), number: z.number(), title: z.string() })
export type CardDraftRef = z.infer<typeof cardDraftRefSchema>

export const cardDraftCardSchema = z.object({
  /** La clé que l'agent lui a donnée, unique dans le brouillon. */
  key: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(DRAFT_TITLE_MAX),
  description: z.string().max(DRAFT_DESCRIPTION_MAX).default(''),
  subtasks: z.array(z.string().max(DRAFT_SUBTASK_MAX)).max(DRAFT_SUBTASKS_MAX).default([]),
  /** Les clés des cartes du brouillon qui doivent être finies avant celle-ci. */
  after: z.array(z.string()).max(DRAFT_LINKS_MAX).default([]),
  /** Les cartes existantes qui doivent être finies avant celle-ci. */
  blockedBy: z.array(cardDraftRefSchema).max(DRAFT_LINKS_MAX).default([]),
  /**
   * Les cartes existantes proches, que l'agent a vues en lisant le board : liées à la
   * création (« liée à », #109), pour qu'un recoupement se voie plutôt que se perde.
   */
  related: z.array(cardDraftRefSchema).max(DRAFT_LINKS_MAX).default([]),
})
export type CardDraftCard = z.infer<typeof cardDraftCardSchema>

/**
 * La parente des cartes du brouillon : une carte existante (celle d'où le découpage est
 * parti, d'ordinaire), une carte neuve créée avec elles (le jalon), ou aucune.
 */
export const cardDraftParentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), card: cardDraftRefSchema }),
  z.object({
    kind: z.literal('new'),
    title: z.string().trim().min(1).max(DRAFT_TITLE_MAX),
    description: z.string().max(DRAFT_DESCRIPTION_MAX).default(''),
    /** L'échéance du jalon, en minuit local, ou null. */
    dueAt: z.number().nullable().default(null),
  }),
])
export type CardDraftParent = z.infer<typeof cardDraftParentSchema>

export const cardDraftSchema = z.object({
  parent: cardDraftParentSchema.nullable(),
  cards: z.array(cardDraftCardSchema).min(1).max(MAX_DRAFT_CARDS),
})
export type CardDraft = z.infer<typeof cardDraftSchema>

/** Une carte créée à la validation, avec la clé qu'elle portait dans le brouillon. */
export const cardDraftCreatedSchema = z.object({ key: z.string(), cardId: z.string(), number: z.number(), title: z.string() })
export type CardDraftCreated = z.infer<typeof cardDraftCreatedSchema>

/** Ce que la personne renvoie au clic : le brouillon tel qu'elle l'a corrigé. */
export const cardDraftDecisionBodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('created'), draft: cardDraftSchema }),
  z.object({ decision: z.literal('refused') }),
])
export type CardDraftDecisionBody = z.infer<typeof cardDraftDecisionBodySchema>

/**
 * Ce qui empêche un brouillon d'être créé tel quel, en codes que l'interface traduit et
 * que le serveur revérifie : deux cartes de même clé, un lien vers une clé absente, une
 * carte qui s'attend elle-même, ou une boucle de dépendances.
 *
 * Vide quand le brouillon se crée. Pur et partagé : le bloc éditable s'en sert pour
 * griser « Créer » au moment même où une correction ferait une boucle.
 */
export type CardDraftProblem =
  | { code: 'duplicate_key'; key: string }
  | { code: 'unknown_key'; key: string; missing: string }
  | { code: 'self'; key: string }
  | { code: 'cycle'; keys: string[] }

export function cardDraftProblems(draft: Pick<CardDraft, 'cards'>): CardDraftProblem[] {
  const problems: CardDraftProblem[] = []
  const keys = new Set<string>()
  for (const card of draft.cards) {
    if (keys.has(card.key)) problems.push({ code: 'duplicate_key', key: card.key })
    keys.add(card.key)
  }
  for (const card of draft.cards) {
    for (const before of card.after) {
      if (before === card.key) problems.push({ code: 'self', key: card.key })
      else if (!keys.has(before)) problems.push({ code: 'unknown_key', key: card.key, missing: before })
    }
  }
  if (problems.length > 0) return problems

  // Un parcours en profondeur suffit : vingt cartes au plus. Le premier cycle trouvé est
  // rendu, dans l'ordre où il se parcourt, pour qu'on sache quel lien retirer.
  const after = new Map(draft.cards.map((card) => [card.key, card.after]))
  const state = new Map<string, 'visiting' | 'done'>()
  const path: string[] = []
  const visit = (key: string): string[] | null => {
    if (state.get(key) === 'done') return null
    if (state.get(key) === 'visiting') return path.slice(path.indexOf(key))
    state.set(key, 'visiting')
    path.push(key)
    for (const next of after.get(key) ?? []) {
      const cycle = visit(next)
      if (cycle) return cycle
    }
    path.pop()
    state.set(key, 'done')
    return null
  }
  for (const card of draft.cards) {
    const cycle = visit(card.key)
    if (cycle) return [{ code: 'cycle', keys: cycle }]
  }
  return []
}

/**
 * Le brouillon sans une de ses cartes : retirée de la liste, et des `after` qui la
 * citaient. Ce que fait le bouton de suppression du bloc ; ici pour que le serveur et
 * l'interface disent la même chose de ce qu'une suppression défait.
 */
export function withoutDraftCard<T extends Pick<CardDraft, 'cards'>>(draft: T, key: string): T {
  return {
    ...draft,
    cards: draft.cards
      .filter((card) => card.key !== key)
      .map((card) => (card.after.includes(key) ? { ...card, after: card.after.filter((other) => other !== key) } : card)),
  }
}
