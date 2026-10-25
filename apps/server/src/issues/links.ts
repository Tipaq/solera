import { eq } from 'drizzle-orm'
import { cardIssues, type CardIssueRow, type Db, type Tx } from '@solera/db'
import type { CardColumn, CardIssueDto, IssuePush } from '@solera/protocol'

/**
 * Ce que le mouvement d'une carte absorbée doit écrire dans l'outil (#84).
 *
 * Appelé par `recordCardMove`, le passage obligé de tout changement de colonne : une
 * carte terminée ferme son issue comme terminée, une carte abandonnée comme non prévue,
 * une carte rouverte la rouvre. Seulement posé ici, écrit plus tard par le balayage
 * (`issues/service.ts`) : le mouvement ne doit pas attendre l'outil, ni échouer avec lui.
 *
 * Comparé à l'état connu de l'issue et non à l'ancienne colonne : une issue fermée de
 * l'extérieur, puis sa carte terminée, n'a rien à écrire ; un aller-retour avant le
 * balayage annule ce qui était en attente.
 */
export function queueIssueState(db: Db | Tx, cardId: string, to: CardColumn): void {
  const link = db.select().from(cardIssues).where(eq(cardIssues.cardId, cardId)).get()
  if (!link) return
  const pending = pendingFor(link, to)
  if (pending === link.pending) return
  db.update(cardIssues).set({ pending, pushError: null, updatedAt: Date.now() }).where(eq(cardIssues.cardId, cardId)).run()
}

function pendingFor(link: CardIssueRow, to: CardColumn): IssuePush | null {
  // Un refus attend toujours son mot : déplacer la carte refusée n'y change rien tant
  // qu'elle reste fermée.
  if (link.pending === 'refused' && to === 'abandoned') return 'refused'
  if (to === 'done') return link.state === 'open' ? 'completed' : null
  if (to === 'abandoned') return link.state === 'open' ? 'not_planned' : null
  return link.state === 'closed' ? 'reopen' : null
}

/**
 * Le refus d'une carte absorbée ferme son issue avec un mot, plutôt qu'en silence : la
 * personne qui l'a ouverte, souvent hors de l'équipe, doit savoir qu'elle a été lue.
 */
export function queueIssueRefusal(db: Db | Tx, cardId: string): void {
  const link = db.select().from(cardIssues).where(eq(cardIssues.cardId, cardId)).get()
  if (!link || link.state === 'closed') return
  db.update(cardIssues).set({ pending: 'refused', pushError: null, updatedAt: Date.now() }).where(eq(cardIssues.cardId, cardId)).run()
}

/**
 * Le dépôt d'une carte absorbée, lu dans l'adresse de son issue plutôt que dans la
 * source : une source changée ou débranchée ne prive pas la carte de sa discussion.
 */
export function repositoryOf(link: Pick<CardIssueRow, 'url'>): string | null {
  return /github\.com\/([^/]+\/[^/]+)\/issues\//.exec(link.url)?.[1] ?? null
}

export function toCardIssueDto(link: CardIssueRow): CardIssueDto {
  return {
    provider: link.provider,
    number: link.externalId,
    url: link.url,
    state: link.state,
    pending: link.pending,
    pushError: link.pushError,
  }
}
