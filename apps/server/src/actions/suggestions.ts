import { constants } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  MAX_ACTION_SUGGESTIONS,
  type ActionSuggestion,
  type ActionSuggestionReason,
  type ProjectActionKind,
} from '@solera/protocol'

/**
 * Suggestions « Trouvé dans le dépôt » de l'éditeur d'actions.
 *
 * Un lecteur pur par source (`package.json`, `Makefile`, `justfile`), puis une passe
 * qui lit le dépôt et les assemble. Rien n'est exécuté : on lit les fichiers, on ne
 * demande pas à `make` ou à `just` ce qu'ils savent faire, parce qu'un Makefile peut
 * lancer n'importe quoi rien qu'en se lisant.
 *
 * Seule la racine du projet est lue, et les espaces de travail qu'elle déclare : un
 * monorepo n'est pas fouillé dossier par dossier.
 */

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm'

/** Le gestionnaire de paquets, d'après le verrou posé à la racine. */
export function packageManagerOf(rootFiles: ReadonlySet<string>): PackageManager {
  if (rootFiles.has('pnpm-lock.yaml')) return 'pnpm'
  if (rootFiles.has('yarn.lock')) return 'yarn'
  if (rootFiles.has('bun.lock') || rootFiles.has('bun.lockb')) return 'bun'
  return 'npm'
}

function scriptCommand(manager: PackageManager, script: string): string {
  return manager === 'pnpm' || manager === 'yarn' ? `${manager} ${script}` : `${manager} run ${script}`
}

/** Les noms qui annoncent un serveur, seuls ou en tête (`dev:web`). */
const SERVICE_NAMES = new Set(['dev', 'start', 'serve', 'storybook', 'preview'])

function natureOf(name: string): { kind: ProjectActionKind; reason: ActionSuggestionReason } {
  const head = name.split(/[:._-]/)[0]!
  return SERVICE_NAMES.has(head) ? { kind: 'service', reason: 'service-name' } : { kind: 'task', reason: 'task' }
}

function suggestion(source: string, name: string, command: string, subdir: string): ActionSuggestion {
  const { kind, reason } = natureOf(name)
  return { source, name, kind, reason, command, subdir, url: kind === 'service' ? 'http://localhost:{port}' : null }
}

/** Ce que le gestionnaire lance de lui-même : en faire un bouton le jouerait deux fois. */
const LIFECYCLE_SCRIPTS = new Set([
  'preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack',
  'preversion', 'version', 'postversion',
])

/** Les scripts d'un `package.json` déjà parsé, sans ses crochets `pre…` / `post…`. */
export function packageScripts(
  source: string,
  manifest: unknown,
  manager: PackageManager,
  subdir: string,
): ActionSuggestion[] {
  const scripts = (manifest as { scripts?: unknown } | null)?.scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return []
  const names = Object.entries(scripts)
    .filter(([, body]) => typeof body === 'string' && body.trim() !== '')
    .map(([name]) => name)
  const declared = new Set(names)
  const isHook = (name: string) =>
    (name.startsWith('pre') && declared.has(name.slice(3))) || (name.startsWith('post') && declared.has(name.slice(4)))
  return names
    .filter((name) => !LIFECYCLE_SCRIPTS.has(name) && !isHook(name))
    .map((name) => suggestion(source, name, scriptCommand(manager, name), subdir))
}

/**
 * Les cibles d'un Makefile qu'on appellerait à la main : une seule par ligne, ni
 * variable, ni cible spéciale (`.PHONY`), ni règle générique (`%.o`), ni fichier.
 */
export function makeTargets(text: string): string[] {
  const targets: string[] = []
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z0-9_][A-Za-z0-9_-]*)\s*:(?![:=])/.exec(line)
    if (match && !targets.includes(match[1]!)) targets.push(match[1]!)
  }
  return targets
}

/** Mots du justfile qui ouvrent un réglage, pas une recette. */
const JUST_KEYWORDS = new Set(['set', 'alias', 'export', 'import', 'mod'])

/**
 * Les recettes d'un justfile qu'un clic peut lancer : sans paramètre (un bouton n'en
 * demande pas), ni privées (`_nom`, `[private]`).
 */
export function justRecipes(text: string): string[] {
  const recipes: string[] = []
  let attributes: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (line.startsWith('[')) {
      attributes.push(trimmed)
      continue
    }
    const match = /^@?([A-Za-z][A-Za-z0-9_-]*)([^:]*):(?!=)/.exec(line)
    const privateRecipe = attributes.some((attribute) => attribute.includes('private'))
    if (trimmed !== '' && !line.startsWith(' ') && !line.startsWith('\t')) attributes = []
    if (!match || JUST_KEYWORDS.has(match[1]!) || privateRecipe) continue
    if (match[2]!.trim() !== '') continue
    if (!recipes.includes(match[1]!)) recipes.push(match[1]!)
  }
  return recipes
}

/** Une action déjà enregistrée, telle que la comparaison la lit. */
export interface ExistingCommand {
  command: string
  subdir: string | null
}

const sameDir = (subdir: string | null) => (subdir ?? '').trim().replace(/^\.\/?/, '').replace(/\/+$/, '')

/** Retire ce qui est déjà un bouton du projet : même commande, même dossier. */
export function withoutExisting(suggestions: ActionSuggestion[], existing: ExistingCommand[]): ActionSuggestion[] {
  const taken = new Set(existing.map((entry) => `${sameDir(entry.subdir)}\n${entry.command.trim()}`))
  return suggestions.filter((entry) => !taken.has(`${sameDir(entry.subdir)}\n${entry.command.trim()}`))
}

/** Lus au-delà, ce ne sont plus des fichiers de configuration. */
const MAX_FILE_BYTES = 256 * 1024
const MAX_WORKSPACE_PACKAGES = 30
const MAX_SHELL_SCRIPTS = 20

async function readSmall(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function readJson(path: string): Promise<unknown> {
  const text = await readSmall(path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function entries(dir: string) {
  return readdir(dir, { withFileTypes: true }).catch(() => [])
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

/** Les motifs d'espaces de travail : `pnpm-workspace.yaml`, sinon `workspaces` du `package.json`. */
async function workspacePatterns(root: string, manifest: unknown): Promise<string[]> {
  const yaml = await readSmall(join(root, 'pnpm-workspace.yaml'))
  if (yaml !== null) {
    try {
      return strings((parseYaml(yaml) as { packages?: unknown } | null)?.packages)
    } catch {
      return []
    }
  }
  const workspaces = (manifest as { workspaces?: unknown } | null)?.workspaces
  return Array.isArray(workspaces) ? strings(workspaces) : strings((workspaces as { packages?: unknown } | null)?.packages)
}

/**
 * Les dossiers des espaces de travail. Les motifs se lisent comme pnpm et npm les
 * écrivent d'ordinaire : un chemin, ou un dossier suivi de `/*` ; `/**` n'y descend
 * que d'un niveau. Un motif en `!` retire un dossier.
 */
async function workspaceDirs(root: string, patterns: string[]): Promise<string[]> {
  const normalize = (pattern: string) => posix.normalize(pattern.replace(/^\.\//, '')).replace(/\/+$/, '')
  const excluded = new Set(patterns.filter((p) => p.startsWith('!')).map((p) => normalize(p.slice(1))))
  const dirs: string[] = []
  for (const raw of patterns) {
    if (raw.startsWith('!')) continue
    const pattern = normalize(raw)
    if (pattern.startsWith('..') || pattern.startsWith('/')) continue
    const wildcard = /^(.*?)\/\*\*?$/.exec(pattern)
    if (wildcard) {
      const parent = wildcard[1]!
      if (parent.includes('*')) continue
      for (const entry of await entries(join(root, parent))) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          dirs.push(posix.join(parent, entry.name))
        }
      }
    } else if (!pattern.includes('*') && pattern !== '.') {
      dirs.push(pattern)
    }
  }
  return [...new Set(dirs)].filter((dir) => !excluded.has(dir)).sort().slice(0, MAX_WORKSPACE_PACKAGES)
}

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
const MAKEFILES = ['GNUmakefile', 'makefile', 'Makefile']
const JUSTFILES = ['justfile', 'Justfile', '.justfile']

/** Les scripts qu'on lance le plus, dans l'ordre où l'état vide en montre trois. */
const PRIORITY = ['dev', 'start', 'serve', 'test', 'lint', 'build', 'typecheck', 'check', 'format', 'storybook', 'preview']

/**
 * Tout ce que le dépôt sait lancer, la racine d'abord, et à la racine les scripts
 * les plus courants en tête. Une source illisible est passée, pas fatale.
 */
export async function readSuggestions(root: string): Promise<ActionSuggestion[]> {
  const rootEntries = await entries(root)
  const rootFiles = new Set(rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const manager = packageManagerOf(rootFiles)
  const atRoot: ActionSuggestion[] = []

  const manifest = await readJson(join(root, 'package.json'))
  atRoot.push(...packageScripts('package.json', manifest, manager, ''))

  const makefile = MAKEFILES.find((name) => rootFiles.has(name))
  const makeText = makefile ? await readSmall(join(root, makefile)) : null
  for (const target of makeText ? makeTargets(makeText) : []) {
    atRoot.push(suggestion(makefile!, target, `make ${target}`, ''))
  }

  const justfile = JUSTFILES.find((name) => rootFiles.has(name))
  const justText = justfile ? await readSmall(join(root, justfile)) : null
  for (const recipe of justText ? justRecipes(justText) : []) {
    atRoot.push(suggestion(justfile!, recipe, `just ${recipe}`, ''))
  }

  const compose = COMPOSE_FILES.find((name) => rootFiles.has(name))
  if (compose) {
    atRoot.push({
      source: compose, name: 'compose', kind: 'service', reason: 'compose',
      command: 'docker compose up', subdir: '', url: null,
    })
  }

  const shellScripts = (await entries(join(root, 'scripts')))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sh'))
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_SHELL_SCRIPTS)
  for (const file of shellScripts) {
    const path = `scripts/${file}`
    // Exécutable, il suit son shebang ; sinon bash, que les scripts du genre supposent.
    const executable = await access(join(root, path), constants.X_OK).then(() => true, () => false)
    atRoot.push(suggestion(path, file.slice(0, -'.sh'.length), executable ? `./${path}` : `bash ${path}`, ''))
  }

  const rank = (name: string) => {
    const index = PRIORITY.indexOf(name)
    return index === -1 ? PRIORITY.length : index
  }
  const ranked = atRoot
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => rank(a.entry.name) - rank(b.entry.name) || a.order - b.order)
    .map(({ entry }) => entry)

  for (const dir of await workspaceDirs(root, await workspacePatterns(root, manifest))) {
    const source = `${dir}/package.json`
    ranked.push(...packageScripts(source, await readJson(join(root, source)), manager, dir))
  }

  const seen = new Set<string>()
  return ranked
    .filter((entry) => {
      const key = `${entry.subdir}\n${entry.command}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_ACTION_SUGGESTIONS)
}
