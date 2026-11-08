import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Le `devcontainer.json` que Solera garde pour un projet qui n'en a pas (ADR 0001, #143).
 *
 * Hors du dépôt, dans les données de Solera : rien n'est écrit dans le projet. Il passe
 * au CLI `devcontainer` par `--config`, et le reste (démarrage, montages, CLI des agents,
 * Services) est celui du dev container d'un dépôt : il n'y a qu'un mécanisme.
 *
 * Le `devcontainer.json` du dépôt prévaut toujours : celui-ci n'est lu qu'en son absence.
 */
export class ManagedDevcontainers {
  constructor(private readonly root: string) {}

  /** Où il vit : un dossier par projet, pour que ses chemins relatifs n'en croisent pas d'autre. */
  pathOf(projectId: string): string {
    return join(this.root, projectId, 'devcontainer.json')
  }

  /** Son chemin s'il existe, null sinon. */
  configOf(projectId: string): string | null {
    const path = this.pathOf(projectId)
    return existsSync(path) ? path : null
  }

  read(projectId: string): string | null {
    const path = this.configOf(projectId)
    return path ? readFileSync(path, 'utf8') : null
  }

  /** Écrit le texte tel quel, commentaires compris, après avoir vérifié qu'il se lit. */
  async write(projectId: string, content: string): Promise<void> {
    assertDevcontainerJson(content)
    const path = this.pathOf(projectId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content.endsWith('\n') ? content : `${content}\n`)
  }

  async remove(projectId: string): Promise<void> {
    await rm(dirname(this.pathOf(projectId)), { recursive: true, force: true })
  }
}

/** Le texte n'est pas un `devcontainer.json` qu'on saurait passer au CLI. */
export class InvalidDevcontainerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDevcontainerError'
  }
}

/**
 * Vérifie qu'un texte est un objet JSON, avec les commentaires et les virgules finales
 * que le format permet (JSONC). Le reste, le CLI le dira au démarrage.
 */
export function assertDevcontainerJson(content: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonc(content))
  } catch (err) {
    throw new InvalidDevcontainerError(`This is not valid JSON: ${(err as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidDevcontainerError('A devcontainer.json is a JSON object.')
  }
  const config = parsed as Record<string, unknown>
  if (!('image' in config) && !('build' in config) && !('dockerComposeFile' in config)) {
    throw new InvalidDevcontainerError('A devcontainer.json needs an "image", a "build" or a "dockerComposeFile".')
  }
}

/** Retire les commentaires et les virgules finales d'un JSONC, sans toucher aux chaînes. */
export function stripJsonc(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const char = text[i]!
    if (char === '"') {
      const start = i
      i++
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
      out += text.slice(start, ++i)
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
    } else {
      out += char
      i++
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** Les features officielles d'une stack, reconnue à un fichier à la racine du projet. */
const STACKS: { files: string[]; feature: string }[] = [
  { files: ['package.json'], feature: 'ghcr.io/devcontainers/features/node:1' },
  { files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'], feature: 'ghcr.io/devcontainers/features/python:1' },
  { files: ['go.mod'], feature: 'ghcr.io/devcontainers/features/go:1' },
  { files: ['Cargo.toml'], feature: 'ghcr.io/devcontainers/features/rust:1' },
  { files: ['Gemfile'], feature: 'ghcr.io/devcontainers/features/ruby:1' },
  { files: ['pom.xml', 'build.gradle', 'build.gradle.kts'], feature: 'ghcr.io/devcontainers/features/java:1' },
  { files: ['composer.json'], feature: 'ghcr.io/devcontainers/features/php:1' },
  { files: ['global.json'], feature: 'ghcr.io/devcontainers/features/dotnet:2' },
]

/** Les features de la stack du projet, de ce qu'on reconnaît sans lire les fichiers. */
export function detectFeatures(workspace: string): string[] {
  return STACKS.filter((stack) => stack.files.some((file) => existsSync(join(workspace, file)))).map(
    (stack) => stack.feature,
  )
}

/**
 * Le modèle par défaut : l'image de base des dev containers, qui a git et un utilisateur
 * non root, et les features de la stack détectée. Un point de départ à éditer.
 */
export function defaultDevcontainerJson(name: string, workspace: string): string {
  const features = detectFeatures(workspace)
  const lines = [
    '// Kept by Solera outside the repository. The repository\'s own .devcontainer, if one appears, takes precedence.',
    '// Reference: https://containers.dev/implementors/json_reference/',
    '{',
    `  "name": ${JSON.stringify(name)},`,
    '  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",',
    features.length === 0
      ? '  "features": {}'
      : ['  "features": {', features.map((feature) => `    ${JSON.stringify(feature)}: {}`).join(',\n'), '  }'].join('\n'),
    '}',
  ]
  return `${lines.join('\n')}\n`
}
