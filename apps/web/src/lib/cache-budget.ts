/**
 * Estimation prudente de la taille retenue d'une valeur, qui s'arrête dès le plafond
 * dépassé : une valeur trop grosse ne se parcourt pas en entier pour le savoir.
 */
export function retainedBytes(value: unknown, ceiling: number): number {
  let bytes = 0
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  while (pending.length && bytes <= ceiling) {
    const item = pending.pop()
    if (typeof item === 'string') bytes += 24 + item.length * 2
    else if (item && typeof item === 'object') {
      if (seen.has(item)) continue
      seen.add(item)
      bytes += 64
      if (item instanceof Map) {
        bytes += item.size * 48
        for (const [key, value] of item) pending.push(key, value)
      } else {
        const entries = Object.entries(item)
        bytes += entries.length * 16
        for (const [key, value] of entries) {
          bytes += key.length * 2
          pending.push(value)
        }
      }
    } else bytes += 8
  }
  return bytes
}

/** Budget des fils gardés pour un retour rapide, toutes conversations confondues. */
export const JOURNAL_CACHE_BYTES = 8 * 1024 * 1024
/** Un fil quitté depuis plus longtemps sort du cache. */
export const JOURNAL_CACHE_IDLE_MS = 60_000
