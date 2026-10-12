import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { ContentFileDto, ContentMatchDto, ContentSearchDto } from '@solera/protocol'
import { HttpError } from '../http/errors.js'
import { SEARCH_SKIP, resolveInside } from '../workspace.js'

/**
 * Recherche par contenu dans le répertoire de travail.
 *
 * Un `grep` maison plutôt qu'un appel à `ripgrep` : il n'est pas installé sur cette
 * machine, l'exiger ferait dépendre une vue du panneau d'un binaire absent, et une
 * marche bornée en JavaScript tient largement sur un dépôt de travail. Le prix se paie
 * sur un monorepo entier — d'où les plafonds ci-dessous, qui sont annoncés au client
 * plutôt que subis.
 *
 * Les mêmes critères servent à chercher et à remplacer, et c'est tout l'intérêt de ce
 * module : la liste affichée **est** l'aperçu du remplacement, et deux chemins de code
 * distincts finiraient par écrire autre chose que ce qui est montré.
 */

/** Au-delà, la liste ne se lit plus : on dit qu'elle est tronquée et on s'arrête. */
const MAX_FILES = 200
const MAX_MATCHES = 2_000
/** Par fichier : un fichier généré peut porter mille occurrences du même mot. */
const MAX_MATCHES_PER_FILE = 50
const MAX_VISITED = 30_000

/**
 * Au-delà, le fichier n'est plus du texte qu'on lit, et le charger entier pour y
 * chercher trois mots coûte plus que le résultat ne rapporte.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Une ligne plus longue que ça est rognée autour de sa première correspondance. */
const MAX_LINE_CHARS = 300

export interface SearchCriteria {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  include: string
  exclude: string
}

/**
 * Un motif de chemin à la VS Code, réduit à ce qu'on tape vraiment.
 *
 * `**` traverse les dossiers, `*` s'arrête au séparateur, `?` prend un caractère. Un
 * motif sans aucun de ces trois est traité comme une sous-chaîne — taper
 * `node_modules` dans *Exclure* doit marcher sans qu'on ait à écrire `**\/node_modules\/**`.
 */
function globToRegExp(pattern: string): RegExp {
  const trimmed = pattern.trim()
  if (!/[*?]/.test(trimmed)) {
    return new RegExp(escapeRegExp(trimmed).replaceAll('/', '\\/'))
  }

  let source = ''
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    if (char === '*') {
      if (trimmed[i + 1] === '*') {
        source += '.*'
        i += 1
        // `**/` doit aussi accepter zéro dossier : `apps/**/*.ts` trouve `apps/a.ts`.
        if (trimmed[i + 1] === '/') i += 1
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') source += '[^/]'
    else source += escapeRegExp(char as string)
  }
  return new RegExp(`^${source}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Liste séparée par des virgules, vide si le champ l'est. */
function parsePatterns(value: string): RegExp[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(globToRegExp)
}

/**
 * L'expression qui reconnaît une occurrence.
 *
 * Toujours globale : c'est elle qui énumère les correspondances d'une ligne. Une
 * expression invalide est une erreur de l'utilisateur, pas une panne : elle remonte
 * comme telle et la vue l'écrit sous le champ.
 */
export function matcher(criteria: SearchCriteria): RegExp {
  const body = criteria.regex ? criteria.query : escapeRegExp(criteria.query)
  // Les bornes de mot ne valent que pour un terme littéral : autour d'une expression
  // régulière quelconque, `\b` change son sens au lieu de la restreindre.
  const source = criteria.wholeWord && !criteria.regex ? `\\b${body}\\b` : body
  try {
    return new RegExp(source, criteria.caseSensitive ? 'g' : 'gi')
  } catch (error) {
    throw new HttpError(400, 'invalid_regex', error instanceof Error ? error.message : 'Invalid regular expression.')
  }
}

/** Les fichiers à visiter, dans l'ordre des dossiers, bornés en largeur. */
async function* walk(root: string, criteria: SearchCriteria): AsyncGenerator<string> {
  const include = parsePatterns(criteria.include)
  const exclude = parsePatterns(criteria.exclude)
  const queue: string[] = ['']
  let visited = 0

  while (queue.length > 0) {
    const relative = queue.shift() as string

    let entries
    try {
      entries = await readdir(resolveInside(root, relative), { withFileTypes: true })
    } catch {
      // Un dossier illisible (droits, lien cassé) n'interrompt pas la recherche.
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) continue
      visited += 1
      if (visited > MAX_VISITED) return

      const path = relative ? `${relative}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        if (SEARCH_SKIP.has(entry.name)) continue
        // Un dossier exclu n'est pas descendu : c'est ce qui rend `node_modules`
        // gratuit au lieu de le traverser pour écarter chacun de ses fichiers.
        if (exclude.some((pattern) => pattern.test(path) || pattern.test(entry.name))) continue
        queue.push(path)
        continue
      }

      if (exclude.some((pattern) => pattern.test(path) || pattern.test(entry.name))) continue
      if (include.length > 0 && !include.some((pattern) => pattern.test(path))) continue
      yield path
    }
  }
}

/**
 * Le texte d'un fichier, ou `null` s'il n'y en a pas à lire.
 *
 * Le binaire se reconnaît à un octet nul dans le début du fichier — c'est la règle de
 * `grep`, et elle suffit : un fichier texte n'en contient jamais.
 */
async function readText(absolute: string): Promise<string | null> {
  let info
  try {
    info = await stat(absolute)
  } catch {
    return null
  }
  if (!info.isFile() || info.size === 0 || info.size > MAX_FILE_BYTES) return null

  let content
  try {
    content = await readFile(absolute, 'utf8')
  } catch {
    return null
  }
  return content.includes('\u0000') ? null : content
}

/** Les correspondances d'une ligne, rognées autour de la première s'il le faut. */
function matchesOf(line: number, text: string, expression: RegExp): ContentMatchDto | null {
  expression.lastIndex = 0
  const ranges: [number, number][] = []
  let found: RegExpExecArray | null
  while ((found = expression.exec(text)) !== null) {
    ranges.push([found.index, found.index + found[0].length])
    // Une expression qui peut reconnaître le vide ne doit pas boucler sur place.
    if (found[0].length === 0) expression.lastIndex += 1
  }
  if (ranges.length === 0) return null

  if (text.length <= MAX_LINE_CHARS) return { line, text, ranges }

  // Rogné autour de la première correspondance, et pas depuis le début : une ligne
  // minifiée de 40 000 caractères n'apprendrait rien de ses trois cents premiers.
  const start = Math.max(0, (ranges[0]?.[0] ?? 0) - 40)
  const slice = text.slice(start, start + MAX_LINE_CHARS)
  return {
    line,
    text: slice,
    trimmedStart: start,
    ranges: ranges
      .map(([from, to]) => [from - start, to - start] as [number, number])
      .filter(([from, to]) => from >= 0 && to <= slice.length),
  }
}

export async function searchContent(root: string, criteria: SearchCriteria): Promise<ContentSearchDto> {
  const expression = matcher(criteria)
  const files: ContentFileDto[] = []
  let totalMatches = 0
  let truncated = false

  for await (const path of walk(root, criteria)) {
    if (files.length >= MAX_FILES || totalMatches >= MAX_MATCHES) {
      truncated = true
      break
    }

    const content = await readText(resolveInside(root, path))
    if (content === null) continue

    const matches: ContentMatchDto[] = []
    let total = 0
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index++) {
      const match = matchesOf(index + 1, lines[index] as string, expression)
      if (!match) continue
      total += match.ranges.length
      if (matches.length < MAX_MATCHES_PER_FILE) matches.push(match)
    }

    if (total === 0) continue
    files.push({ path, matches, total })
    totalMatches += total
  }

  return { files, totalMatches, truncated }
}

/**
 * Remplace toutes les occurrences, dans tous les fichiers que la recherche trouve.
 *
 * Écrit fichier par fichier, et ne touche que ceux qui changent réellement. Pas de
 * transaction : il n'y en a pas sur un système de fichiers, et prétendre le contraire
 * en écrivant d'abord dans un dossier temporaire ne ferait que déplacer l'instant où
 * ça peut casser. Ce qui protège ici, c'est que la liste affichée est l'aperçu exact
 * de ce qui va être écrit, et que la vue demande confirmation.
 */
export async function replaceContent(
  root: string,
  criteria: SearchCriteria,
  replacement: string,
): Promise<{ files: number; matches: number }> {
  const expression = matcher(criteria)
  // `$&`, `$1` et consorts ne sont des références que pour une expression régulière :
  // sur une recherche littérale, un `$` tapé est un `$`.
  const literal = criteria.regex ? replacement : replacement.replaceAll('$', '$$$$')

  let changedFiles = 0
  let changedMatches = 0

  for await (const path of walk(root, criteria)) {
    const absolute = resolveInside(root, path)
    const content = await readText(absolute)
    if (content === null) continue

    expression.lastIndex = 0
    const count = content.match(expression)?.length ?? 0
    if (count === 0) continue

    expression.lastIndex = 0
    const next = content.replace(expression, literal)
    if (next === content) continue

    await writeFile(absolute, next, 'utf8')
    changedFiles += 1
    changedMatches += count
  }

  return { files: changedFiles, matches: changedMatches }
}
