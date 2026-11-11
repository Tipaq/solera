/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les actions du projet telles que le modèle les décrit (`protocol/src/actions.ts`) :
 * un raccourci qui lance une commande shell dans le worktree de la conversation d'où
 * l'on clique, sinon à la racine. `task` se termine dans un terminal du panneau et n'a
 * pas d'historique ; `service` tourne sous systemd avec un état et des ports ; une
 * action écrite par un agent est `proposed` jusqu'à sa relecture.
 */
import {
  MAX_ACTION_COMMAND_CHARS,
  MAX_ACTION_LABEL_CHARS,
  MAX_ACTION_SUBDIR_CHARS,
  type ProjectActionDto,
  type ProjectActionKind,
} from '@solera/protocol'
import { actionView } from '../../lib/actions'
import { elapsed } from '../../lib/dates'

const MIN = 60_000
const HOUR = 60 * MIN

/** Le jeu de démo, de la même forme que `/api/actions`. */
export function demoActions(projectId: string): ProjectActionDto[] {
  const now = Date.now()
  const base = {
    projectId,
    description: null,
    subdir: null,
    url: null,
    status: 'approved' as const,
    agentConversationId: null,
    agentConversationTitle: null,
    createdAt: now - 20 * 24 * HOUR,
    updatedAt: now - 20 * 24 * HOUR,
    service: null,
    lastRun: null,
  }
  return [
    {
      ...base,
      id: 'demo-dev',
      label: 'Serveur de dev',
      description: 'Le serveur et vite, avec rechargement à chaud.',
      kind: 'service',
      command: 'scripts/dev.sh',
      url: 'https://mon-hote:{port}',
      service: { unit: 'solera-app-dev-3f2a', state: 'active', cwd: '~/projects/solera', ports: [5173, 7417], startedAt: now - 2 * HOUR },
    },
    {
      ...base,
      id: 'demo-catalog',
      label: 'Catalogue',
      description: 'Le Storybook des composants d’application.',
      kind: 'service',
      command: 'pnpm --filter @solera/catalog dev',
      url: 'http://localhost:{port}',
      service: { unit: 'solera-app-catalog-91c0', state: 'inactive', cwd: null, ports: [], startedAt: null },
    },
    {
      ...base,
      id: 'demo-worker',
      label: 'Worker de notifications',
      kind: 'service',
      command: 'node apps/server/dist/notify-worker.js',
      service: { unit: 'solera-app-worker-77ad', state: 'failed', cwd: null, ports: [], startedAt: now - 40 * MIN },
    },
    {
      ...base,
      id: 'demo-test',
      label: 'Tests unitaires',
      description: 'Vitest sur tout le monorepo.',
      kind: 'task',
      command: 'pnpm test',
      lastRun: { terminalId: 't-1', alive: false, exitCode: 0, startedAt: now - 12 * MIN },
    },
    {
      ...base,
      id: 'demo-lint',
      label: 'Lint',
      kind: 'task',
      command: 'pnpm lint',
      lastRun: { terminalId: 't-2', alive: false, exitCode: 1, startedAt: now - 50 * MIN },
    },
    {
      ...base,
      id: 'demo-typecheck',
      label: 'Typecheck du web',
      kind: 'task',
      command: 'pnpm exec tsc --noEmit',
      subdir: 'apps/web',
    },
    {
      ...base,
      id: 'demo-board-ui',
      label: 'Suite UI du tableau',
      description: 'Playwright sur le tableau, avec les libs de Chromium.',
      kind: 'task',
      command: 'LD_LIBRARY_PATH=$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu pnpm test:board-ui',
      status: 'proposed',
      agentConversationId: 'x',
      agentConversationTitle: 'Revue de la PR #117',
      updatedAt: now - 3 * HOUR,
    },
  ]
}

/** La commande d'avant, pour relire ce qu'un agent a changé (démo). */
export const DEMO_PREVIOUS_COMMAND: Record<string, string> = {
  'demo-board-ui': 'pnpm test:board-ui',
}

export type ActionGroup = 'review' | 'service' | 'task'

export function groupOf(action: ProjectActionDto): ActionGroup {
  if (action.status === 'proposed') return 'review'
  return action.kind
}

export type Tone = 'positive' | 'critical' | 'caution' | 'neutral'

/** L'état en une phrase et un ton, fidèle à ce que le serveur sait vraiment. */
export function stateOf(action: ProjectActionDto): { tone: Tone; text: string; live: boolean } {
  const view = actionView(action)
  if (action.status === 'proposed') return { tone: 'caution', text: 'À relire avant le premier lancement', live: false }
  if (action.service) {
    if (view.live) {
      const ports = action.service.ports.map((port) => `:${port}`).join(' ')
      const since = action.service.startedAt ? ` depuis ${elapsed(action.service.startedAt)}` : ''
      return { tone: 'positive', text: `En marche${ports ? ` ${ports}` : ''}${since}`, live: true }
    }
    if (view.failed) return { tone: 'critical', text: 'En échec : son unité s’est arrêtée', live: false }
    return { tone: 'neutral', text: 'Arrêté', live: false }
  }
  if (action.kind === 'service') return { tone: 'neutral', text: 'Arrêté (sans systemd : il tournera dans un terminal)', live: false }
  const run = action.lastRun
  if (!run) return { tone: 'neutral', text: 'Pas de passage visible', live: false }
  if (run.alive) return { tone: 'positive', text: `En cours dans un terminal · ${elapsed(run.startedAt)}`, live: true }
  if (run.exitCode === 0) return { tone: 'positive', text: `Dernier passage réussi · il y a ${elapsed(run.startedAt)}`, live: false }
  if (run.exitCode === null) return { tone: 'neutral', text: 'Interrompu par un redémarrage', live: false }
  return { tone: 'critical', text: `Dernier passage en échec (code ${run.exitCode}) · il y a ${elapsed(run.startedAt)}`, live: false }
}

/* ------------------------------------------------------------------ l'éditeur */

export interface ActionDraft {
  label: string
  description: string
  kind: ProjectActionKind | null
  command: string
  subdir: string
  url: string
}

export const EMPTY_DRAFT: ActionDraft = { label: '', description: '', kind: null, command: '', subdir: '', url: '' }

export function draftOf(action: ProjectActionDto): ActionDraft {
  return {
    label: action.label,
    description: action.description ?? '',
    kind: action.kind,
    command: action.command,
    subdir: action.subdir ?? '',
    url: action.url ?? '',
  }
}

export interface Suggestion {
  source: string
  label: string
  kind: ProjectActionKind
  command: string
  subdir: string
  url?: string
  why: string
}

/** Ce qu'une détection trouverait dans Solera (SIMULÉ : rien ne lit le dépôt ici). */
export const SUGGESTIONS: Suggestion[] = [
  { source: 'package.json', label: 'Serveur de dev', kind: 'service', command: 'pnpm dev', subdir: '', url: 'http://localhost:{port}', why: '« dev » : un serveur, il tourne en continu' },
  { source: 'package.json', label: 'Tests', kind: 'task', command: 'pnpm test', subdir: '', why: '« test » : se termine avec un code de sortie' },
  { source: 'package.json', label: 'Lint', kind: 'task', command: 'pnpm lint', subdir: '', why: '« lint » : une vérification ponctuelle' },
  { source: 'package.json', label: 'Build', kind: 'task', command: 'pnpm build', subdir: '', why: '« build » : se termine' },
  { source: 'apps/catalog/package.json', label: 'Catalogue', kind: 'service', command: 'pnpm --filter @solera/catalog dev', subdir: '', url: 'http://localhost:{port}', why: 'Storybook : un serveur' },
  { source: 'apps/web/package.json', label: 'Suite UI du composer', kind: 'task', command: 'pnpm test:composer-ui', subdir: 'apps/web', why: 'Playwright : se termine' },
]

/** Une arborescence du dépôt, pour choisir le dossier (SIMULÉ). */
export const REPO_TREE: { path: string; depth: number }[] = [
  { path: '', depth: 0 },
  { path: 'apps', depth: 1 },
  { path: 'apps/server', depth: 2 },
  { path: 'apps/web', depth: 2 },
  { path: 'apps/catalog', depth: 2 },
  { path: 'packages', depth: 1 },
  { path: 'packages/db', depth: 2 },
  { path: 'packages/protocol', depth: 2 },
  { path: 'scripts', depth: 1 },
]

export interface DraftProblems {
  label?: string
  command?: string
  subdir?: string
  url?: string
  kind?: string
}

/** Les bornes du protocole, vérifiées au fil de la saisie. */
export function problemsOf(draft: ActionDraft): DraftProblems {
  const problems: DraftProblems = {}
  if (!draft.kind) problems.kind = 'Choisis une nature.'
  if (!draft.label.trim()) problems.label = 'Un libellé, court : c’est le texte du bouton.'
  else if (draft.label.trim().length > MAX_ACTION_LABEL_CHARS) problems.label = `${MAX_ACTION_LABEL_CHARS} caractères au plus.`
  if (!draft.command.trim()) problems.command = 'La commande à lancer.'
  else if (draft.command.length > MAX_ACTION_COMMAND_CHARS) problems.command = `${MAX_ACTION_COMMAND_CHARS} caractères au plus.`
  const subdir = draft.subdir.trim()
  if (subdir.startsWith('/')) problems.subdir = 'Un chemin relatif au worktree, pas absolu : l’action suit le worktree d’où on la lance.'
  else if (subdir.split(/[\\/]/).includes('..')) problems.subdir = 'Sans « .. » : on reste dans le projet.'
  else if (subdir.length > MAX_ACTION_SUBDIR_CHARS) problems.subdir = `${MAX_ACTION_SUBDIR_CHARS} caractères au plus.`
  const url = draft.url.trim()
  if (draft.kind === 'service' && url && !/^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(url.replaceAll('{port}', '1'))) {
    problems.url = 'Une adresse http(s), avec {port} si tu veux.'
  }
  return problems
}

/** Solera est-il servi depuis une autre machine que celle du navigateur ? */
export function soleraIsRemote(): boolean {
  const host = window.location.hostname
  return host !== 'localhost' && host !== '127.0.0.1'
}

/** Quelques lignes de sortie plausibles, pour « Essayer » (SIMULÉ). */
export function fakeOutput(draft: ActionDraft): string[] {
  const cwd = `~/projects/solera${draft.subdir ? `/${draft.subdir}` : ''}`
  const head = [`$ cd ${cwd}`, `$ ${draft.command || '…'}`]
  if (draft.kind === 'service') return [...head, '  VITE v6.4.3  ready in 287 ms', '  ➜  Local:   http://127.0.0.1:5173/', '(le service tient : il écoute sur :5173)']
  return [...head, ' ✓ packages/protocol (212 tests)', ' ✓ apps/server (488 tests)', ' Test Files  61 passed', 'exit 0']
}
