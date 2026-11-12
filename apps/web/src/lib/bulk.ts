/** Ce qui n'a pas suivi un geste en masse, et pourquoi. */
export interface BulkFailure {
  id: string
  error: unknown
}

/**
 * Un geste sur chaque identifiant, l'un après l'autre, jusqu'au bout : un refus n'arrête
 * pas les suivants. Rend les échecs, avec leur erreur, dans l'ordre.
 *
 * Pas de route en masse côté serveur : la boucle reprend celles d'un seul objet.
 */
export async function inTurn(ids: readonly string[], step: (id: string) => Promise<unknown>): Promise<BulkFailure[]> {
  const failed: BulkFailure[] = []
  for (const id of ids) {
    try {
      await step(id)
    } catch (error) {
      failed.push({ id, error })
    }
  }
  return failed
}
