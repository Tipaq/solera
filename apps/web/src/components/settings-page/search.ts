import { foldForMatch } from '@solera/protocol'

/** Ce qu'une page de réglages sait d'un réglage pour le retrouver et le ranger. */
export interface SearchableSetting {
  id: string
  /** La clé de sa catégorie (« general », « danger »…). */
  category: string
  /** Le titre de son groupe, tel qu'il s'affiche. */
  group: string
  label: string
  help?: string
  /** Des mots qui le font trouver, en plus de son libellé et de son aide. */
  keywords?: string[]
}

/** La palette n'en montre pas plus : au-delà, mieux vaut préciser la saisie. */
export const SEARCH_LIMIT = 10

/**
 * Les réglages qui répondent à une saisie, dans l'ordre de la page : chaque mot doit
 * paraître, casse et accents ignorés, dans le libellé, l'aide, le groupe, la catégorie
 * ou les mots-clés. Une saisie vide ne rend rien : la palette montre alors son mode
 * d'emploi, pas la page entière.
 */
export function searchSettings<T extends SearchableSetting>(
  items: readonly T[],
  query: string,
  categoryLabel: (key: string) => string,
): T[] {
  const words = foldForMatch(query.trim()).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return items
    .filter((item) => {
      const haystack = foldForMatch(
        [item.label, item.help ?? '', item.group, categoryLabel(item.category), ...(item.keywords ?? [])].join(' '),
      )
      return words.every((word) => haystack.includes(word))
    })
    .slice(0, SEARCH_LIMIT)
}

/** Les groupes d'une catégorie, dans l'ordre où leurs réglages paraissent. */
export function groupsOf<T extends SearchableSetting>(items: readonly T[], category: string): { name: string; items: T[] }[] {
  const groups: { name: string; items: T[] }[] = []
  for (const item of items) {
    if (item.category !== category) continue
    const group = groups.find((entry) => entry.name === item.group)
    if (group) group.items.push(item)
    else groups.push({ name: item.group, items: [item] })
  }
  return groups
}
