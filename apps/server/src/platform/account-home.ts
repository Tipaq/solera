import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

/**
 * Le dossier qu'un CLI reçoit pour un compte de Solera (`CODEX_HOME`, `GROK_HOME`).
 *
 * Il ne contient que du réel, et rien ne pointe vers le home de l'utilisateur (ADR 0001) :
 * un environnement confiné ou un conteneur n'y monte que ce dossier, et un lien vers
 * `~/.codex` lui ouvrirait toutes les connexions de l'hôte. Ce qui en vient y est recopié
 * à chaque lancement : sa configuration, débarrassée de ses secrets, et ses consignes et
 * skills, qui ne sont que du texte. Le reste, le CLI l'écrit lui-même (journaux, bases,
 * mémoires), propre au compte.
 *
 * Les conversations ne sont pas partagées par un dossier commun mais recopiées à la
 * demande, avant une reprise ou un fork, depuis le home qui en a la version la plus
 * récente (`bringNewest`).
 */

/** Ce que l'on recopie du home de l'utilisateur, et comment. */
export interface Mirrored {
  name: string
  kind: 'config' | 'file' | 'dir'
  /** Pour un dossier, les entrées que le CLI tient lui-même et qu'on ne touche pas. */
  skip?: string[]
}

/**
 * Retire les liens qu'un home d'avant (#87) posait vers celui de l'utilisateur. Sous
 * Windows un fichier lié pouvait être un lien physique : il partage son contenu avec
 * l'original, et compte plus d'un nom.
 */
export function dropLinks(home: string): void {
  for (const name of readdirSync(home)) {
    const path = join(home, name)
    const entry = lstatSync(path)
    if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink > 1)) unlinkSync(path)
  }
}

/** Remplace le fichier par un nouveau, sans écrire dans l'ancien : il peut être lié ailleurs. */
function writeReplacing(path: string, content: string): void {
  const tmp = `${path}.solera-${process.pid}`
  writeFileSync(tmp, content, { mode: 0o600 })
  renameSync(tmp, path)
}

/** Recopie dans `home` les entrées `mirrored` de `source`, et retire celles qui n'y sont plus. */
export function mirrorPersonal(source: string, home: string, mirrored: Mirrored[]): void {
  for (const item of mirrored) {
    const from = join(source, item.name)
    const to = join(home, item.name)
    if (item.kind === 'dir') {
      mirrorDir(from, to, new Set(item.skip ?? []))
      continue
    }
    const content = existsSync(from) && statSync(from).isFile() ? readFileSync(from, 'utf8') : null
    const written = content === null ? null : item.kind === 'config' ? configWithoutSecrets(content) : content
    if (written === null) rmSync(to, { force: true })
    else writeReplacing(to, written)
  }
}

function mirrorDir(from: string, to: string, skip: Set<string>): void {
  const wanted = existsSync(from) && statSync(from).isDirectory() ? readdirSync(from).filter((name) => !skip.has(name)) : []
  if (wanted.length === 0 && !existsSync(to)) return
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(to)) {
    if (!skip.has(name)) rmSync(join(to, name), { recursive: true, force: true })
  }
  // Les liens sont suivis : une skill liée ailleurs dans le home arrive en copie.
  for (const name of wanted) cpSync(join(from, name), join(to, name), { recursive: true, dereference: true })
}

/** Une clé dont la valeur peut porter un secret : jeton, mot de passe, clé, en-têtes. */
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|credentials?|authorization|cookie|headers)$/i
/** Des tables de variables d'environnement, où un secret se pose souvent. */
const ENV_TABLE = new Set(['env', 'set'])

function carriesSecret(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).some(([key, inner]) => SECRET_KEY.test(key) || ENV_TABLE.has(key) || carriesSecret(inner))
}

function withoutSecrets(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY.test(key) && !ENV_TABLE.has(key))
      .map(([key, inner]) => [key, withoutSecrets(inner)]),
  )
}

/**
 * La configuration TOML de l'utilisateur, telle qu'un compte la reçoit : sans rien qui
 * puisse porter un secret. Un serveur MCP qui en portait est retiré en entier plutôt que
 * lancé sans son jeton, où il échouerait à chaque tour ; Solera déclare les siens par son
 * propre registre. Null pour un fichier illisible : mieux vaut aucune configuration
 * qu'une recopie qu'on n'a pas su lire.
 */
export function configWithoutSecrets(text: string): string | null {
  let parsed: Record<string, unknown>
  try {
    parsed = parseToml(text) as Record<string, unknown>
  } catch {
    return null
  }
  const servers = parsed.mcp_servers
  if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
    parsed.mcp_servers = Object.fromEntries(Object.entries(servers).filter(([, server]) => !carriesSecret(server)))
  }
  return stringifyToml(withoutSecrets(parsed) as Record<string, unknown>)
}

/** Date de la dernière écriture sous `path`, fichier ou dossier. */
export function newestWrite(path: string): number {
  const entry = statSync(path)
  if (!entry.isDirectory()) return entry.mtimeMs
  let newest = entry.mtimeMs
  for (const name of readdirSync(path)) newest = Math.max(newest, newestWrite(join(path, name)))
  return newest
}

/**
 * Recopie dans `home` la version la plus récente d'une conversation trouvée dans
 * `sources`, au même chemin relatif : le CLI la cherche là. Rien quand `home` a déjà la
 * plus récente, ou que personne ne l'a.
 */
export function bringNewest(home: string, sources: string[], locate: (root: string) => string | null): void {
  const own = locate(home)
  let best: { root: string; path: string; mtimeMs: number } | null = null
  for (const root of sources) {
    if (root === home) continue
    const path = locate(root)
    if (!path) continue
    const mtimeMs = newestWrite(path)
    if (!best || mtimeMs > best.mtimeMs) best = { root, path, mtimeMs }
  }
  if (!best || (own && newestWrite(own) >= best.mtimeMs)) return
  const target = join(home, relative(best.root, best.path))
  if (own) rmSync(own, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(best.path, target, { recursive: true, preserveTimestamps: true, dereference: true })
}
