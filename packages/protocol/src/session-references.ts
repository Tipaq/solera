/**
 * Citer une autre session dans un message : `session:<id>`.
 *
 * L'identifiant plutôt que le titre ou l'adresse : il survit à un renommage, à
 * l'archivage, et ne dépend ni du nom d'hôte du serveur ni du port du bureau. Le fil
 * l'affiche avec le titre courant ; l'agent qui le reçoit le passe à
 * `read_conversation`. Doit rester d'accord avec `sessionReference` de
 * `apps/server/src/mcp/solera-mcp.mjs`.
 */
export function sessionReference(id: string): string {
  return `session:${id}`
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ROUTE = new RegExp(`^(?:/p/(${UUID}))?/c/(${UUID})/?$`, 'i')
/**
 * Compilée une fois : l'appel tourne à chaque frappe du composer. `matchAll` travaille
 * sur une copie de l'expression, donc le `lastIndex` de celle-ci reste à zéro d'un appel
 * à l'autre malgré le drapeau `g`.
 */
const REFERENCE = new RegExp(
  `https?://[^\\s<>"\`]+|(?:/p/${UUID})?/c/${UUID}(?:[?#][^\\s<>"\`]*)?|session:${UUID}|${UUID}`,
  'gi',
)
/** Sans drapeau `g` : `test` ne garde alors aucun état entre deux appels. */
const ANY_UUID = new RegExp(UUID, 'i')

export interface SessionReferenceRange {
  start: number
  end: number
  id: string
  /**
   * Écrite comme une référence (`session:`, une adresse de conversation). Un UUID nu ne
   * devient un lien qu'une fois reconnu comme une session du projet : il peut aussi bien
   * nommer un commit, une carte, une ligne de base.
   */
  explicit: boolean
  /** Le projet que nomme l'adresse, quand c'en est une. */
  projectId?: string
}

/** `https://hôte:443` et `https://hôte` sont la même origine. */
function sameOrigin(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/\/+$/, '').replace(/^(https:.*):443$/, '$1').replace(/^(http:.*):80$/, '$1')
  return normalize(a) === normalize(b)
}

/**
 * Chaque référence de session d'un texte, avec sa place.
 *
 * Une adresse se consomme entière, même étrangère : l'UUID d'une adresse d'une autre
 * instance ne doit pas devenir par accident un lien vers une session d'ici. `origin`
 * est celle de l'interface, pour reconnaître l'adresse d'un fil copiée depuis la barre
 * du navigateur ; sans elle, seuls les chemins `/p/…/c/…` sont reconnus.
 */
export function sessionReferenceRanges(text: string, origin?: string): SessionReferenceRange[] {
  // Chaque référence retenue contient un UUID, l'adresse comprise : sans UUID nulle part,
  // rien ne peut sortir, et le texte se rend sans parcourir les quatre alternatives.
  if (!ANY_UUID.test(text)) return []
  const ranges: SessionReferenceRange[] = []
  for (const match of text.matchAll(REFERENCE)) {
    const start = match.index
    const value = match[0]
    // Collé à un mot ou à un chemin : un morceau d'autre chose.
    if (start > 0 && /[\w/:.-]/.test(text[start - 1]!)) continue
    if (/^https?:/i.test(value) || value.startsWith('/')) {
      // La ponctuation qui ferme une phrase n'appartient pas à l'adresse.
      const clean = value.replace(/[),.;!?]+$/, '')
      const address = /^(https?:\/\/[^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i.exec(clean)
      if (address && (!origin || !sameOrigin(address[1]!, origin))) continue
      if (!address && /[\w/-]/.test(text[start + clean.length] ?? '')) continue
      const pathname = address ? address[2] : clean.split(/[?#]/)[0]
      const route = ROUTE.exec(pathname ?? '')
      if (route) {
        ranges.push({
          start,
          end: start + clean.length,
          id: route[2]!.toLowerCase(),
          ...(route[1] ? { projectId: route[1].toLowerCase() } : {}),
          explicit: true,
        })
      }
      continue
    }
    if (/[\w-]/.test(text[start + value.length] ?? '')) continue
    const explicit = value.toLowerCase().startsWith('session:')
    ranges.push({
      start,
      end: start + value.length,
      id: (explicit ? value.slice('session:'.length) : value).toLowerCase(),
      explicit,
    })
  }
  return ranges
}

/**
 * Le `@@` en cours de frappe sous le curseur, et ce qui le suit.
 *
 * Distinct du `@` des fichiers : la recherche porte sur des titres, donc plusieurs mots,
 * et s'arrête seulement au saut de ligne ou à un autre `@`.
 */
export function sessionMentionAt(
  value: string,
  caret: number,
): { query: string; start: number; end: number } | null {
  const match = /(?:^|\s)@@([^@\n]*)$/.exec(value.slice(0, caret))
  if (!match) return null
  const query = match[1] ?? ''
  return { query, start: caret - query.length - 2, end: caret }
}
