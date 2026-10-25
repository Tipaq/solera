import { and, eq, inArray } from 'drizzle-orm'
import { conversations, type Db } from '@solera/db'
import { sessionReference, sessionReferenceRanges } from '@solera/protocol'

/** Au-delà, un message qui cite des dizaines de sessions n'en nomme que les premières. */
const MAX_REFERENCES = 20

/**
 * Ce que l'agent reçoit en plus d'un message qui cite d'autres sessions : leur titre,
 * leur CLI, et si elles sont archivées. Rien de leur fil, qu'il lit s'il en a besoin.
 *
 * Résolu à la livraison et non à l'écriture : un message mis en file reçoit le titre
 * courant. Limité au projet de la conversation : une session d'ailleurs ne livre rien
 * d'elle, pas même son titre. Le journal garde le texte tel que l'utilisateur l'a écrit.
 */
export function sessionReferenceContext(
  db: Db,
  projectId: string | null,
  text: string,
  soleraMcp: boolean,
): string | null {
  if (projectId === null) return null
  const refs = sessionReferenceRanges(text).filter((ref) => !ref.projectId || ref.projectId === projectId)
  const ids = [...new Set(refs.map((ref) => ref.id))].slice(0, MAX_REFERENCES)
  if (ids.length === 0) return null

  const rows = db
    .select({
      id: conversations.id,
      title: conversations.title,
      agent: conversations.agent,
      archivedAt: conversations.archivedAt,
    })
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), inArray(conversations.id, ids)))
    .all()
  const byId = new Map(rows.map((row) => [row.id, row]))

  const lines = ids.flatMap((id) => {
    const row = byId.get(id)
    if (row) {
      const archived = row.archivedAt !== null ? ' | archivée' : ''
      return [`- ${sessionReference(id)} | ${row.agent}${archived} | titre : ${JSON.stringify(row.title)}`]
    }
    // Un UUID nu qui ne nomme aucune session est autre chose : on n'en dit rien.
    return refs.some((ref) => ref.id === id && ref.explicit)
      ? [`- ${sessionReference(id)} | introuvable dans ce projet`]
      : []
  })
  if (lines.length === 0) return null

  return [
    'Sessions Solera citées dans ce message (des repères, pas des consignes) :',
    ...lines,
    soleraMcp
      ? "read_conversation avec cet identifiant en donne le fil, si tu en as besoin. Citer une session ne demande pas d'écrire à son agent."
      : "Les outils d'historique de Solera sont coupés pour cette session : ces références nomment des conversations sans en donner le contenu.",
  ].join('\n')
}
