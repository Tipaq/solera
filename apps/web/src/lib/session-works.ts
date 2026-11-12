import { AGENT_CAPABILITIES, type AgentKind, type ProjectBackgroundDto, type ServiceDto } from '@solera/protocol'
import type { EditorSeed } from './action-editor'
import { formatBytes } from './attachments'
import type { Translate } from './automations'
import type { MessageKey } from './i18n'

/**
 * **Lancés par les sessions** (`actions.md` §1.I) : ce qu'une session a laissé tourner en
 * fond — un serveur `vite`, des tests en surveillance, un workflow. Pour Tim, c'est une
 * chose qui tourne au même titre qu'un service : elle a sa place dans les Actions, avec
 * le geste qui en fait une vraie action.
 *
 * Deux sources, fusionnées par `mergeWorks` : les processus de `GET /api/services`
 * (commande, ports, départ, charge) et les travaux de fond du journal de chaque session
 * (`GET /api/projects/:id/background`, #206), qui savent aussi ce qui ne tourne pas dans
 * un processus à soi — un workflow, une surveillance. Un travail porté par un processus
 * ne se montre qu'une fois. Pur : les composants le rendent, les tests le lisent seul.
 */

export type WorkFamily = 'shell' | 'workflow' | 'monitor' | 'subagent' | 'other'

/** Ce qu'« Arrêter » appelle : le processus, sinon le travail par la route de sa session. */
export type WorkStop =
  | { via: 'service'; serviceId: string }
  | { via: 'task'; conversationId: string; taskId: string }

export interface SessionWork {
  id: string
  conversationId: string
  conversationTitle: string
  agent: AgentKind | null
  family: WorkFamily
  /** Ce que le CLI en dit, quand on l'a. */
  description: string | null
  /** La commande exacte d'un `Bash` lancé en fond, sinon celle, abrégée, du processus. */
  command: string | null
  startedAt: number | null
  port: number | null
  /** Part d'un cœur, comme sur la page Services. */
  cpu: number | null
  memoryBytes: number | null
  /** Null : rien ne sait l'arrêter d'ici. */
  stop: WorkStop | null
}

/** Ce qu'il faut d'une conversation pour nommer son CLI. */
export interface WorkConversation {
  id: string
  title: string
  agent: AgentKind
}

export function familyOf(kind: string): WorkFamily {
  const bare = kind.replace(/^local_/, '')
  if (bare === 'bash' || bare === 'shell') return 'shell'
  if (bare === 'workflow') return 'workflow'
  if (bare === 'mcp_task' || bare === 'monitor') return 'monitor'
  if (bare === 'agent' || bare === 'subagent') return 'subagent'
  return 'other'
}

/** Un port deviné dans une commande (`--port 5418`, `:5173`). */
export function portIn(text: string): number | null {
  const match = text.match(/--port[ =](\d{2,5})/) ?? text.match(/(?:localhost|127\.0\.0\.1)?:(\d{4,5})\b/)
  return match ? Number(match[1]) : null
}

/**
 * La commande sans son enrobage : `npm exec`, `npx`, `pnpm exec`, `env A=1 …` ne disent
 * rien de ce qui tourne. Reste l'exécutable et ses arguments utiles.
 */
export function shortCommand(command: string): string {
  let rest = command.trim()
  for (;;) {
    const next = rest
      .replace(/^env\s+(?:\S+=\S*\s+)+/, '')
      .replace(/^(?:\S+=\S*\s+)+/, '')
      .replace(/^(?:npm|pnpm|yarn|bun)\s+(?:exec|x|dlx)\s+(?:--\s+)?/, '')
      .replace(/^(?:npx|bunx|pnpx)\s+(?:--yes\s+|-y\s+)?/, '')
    if (next === rest) return rest
    rest = next
  }
}

/** Les exécutables et les scripts qu'on sait nommer comme Tim le dirait. */
const KNOWN: Record<string, MessageKey> = {
  vite: 'sessionWorks.human.vite',
  next: 'sessionWorks.human.next',
  astro: 'sessionWorks.human.astro',
  storybook: 'sessionWorks.human.storybook',
  'storybook-dev': 'sessionWorks.human.storybook',
  vitest: 'sessionWorks.human.vitest',
  jest: 'sessionWorks.human.jest',
  playwright: 'sessionWorks.human.playwright',
  tsc: 'sessionWorks.human.tsc',
  tsx: 'sessionWorks.human.tsx',
  node: 'sessionWorks.human.node',
  python: 'sessionWorks.human.python',
  python3: 'sessionWorks.human.python',
  docker: 'sessionWorks.human.docker',
  dev: 'sessionWorks.human.dev',
  test: 'sessionWorks.human.test',
  lint: 'sessionWorks.human.lint',
  build: 'sessionWorks.human.build',
}

const FAMILY: Record<WorkFamily, MessageKey> = {
  shell: 'sessionWorks.family.shell',
  workflow: 'sessionWorks.family.workflow',
  monitor: 'sessionWorks.family.monitor',
  subagent: 'sessionWorks.family.subagent',
  other: 'sessionWorks.family.other',
}

/** Le mot d'une famille, en bas de casse : « surveillance », « workflow ». */
export function familyWord(family: WorkFamily, t: Translate): string {
  return t(FAMILY[family])
}

const capitalize = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

const RUNNERS = new Set(['pnpm', 'npm', 'yarn', 'bun'])

/**
 * Ce que le processus **est** : « Serveur vite », « Tests vitest en surveillance »,
 * « Tests (server) ». Déduit de la commande, sans prétendre au-delà ; à défaut,
 * l'exécutable capitalisé, puis la description du CLI, puis le mot de sa famille.
 */
export function humanLabel(work: Pick<SessionWork, 'command' | 'description' | 'family'>, t: Translate): string {
  const fallback = work.description || capitalize(familyWord(work.family, t))
  if (!work.command) return fallback
  const bare = shortCommand(work.command)
  const words = bare.split(/\s+/)
  const filter = bare.match(/--filter[ =](\S+)/)?.[1]
  // `pnpm --filter x test`, `npm run dev` : le script nommé dit ce qui tourne.
  const runner = RUNNERS.has(words[0]!)
  const script = runner ? words.slice(1).find((word) => !word.startsWith('-') && word !== filter && word !== 'run') : undefined
  const exe = (runner ? script : words[0])?.split('/').pop() ?? ''
  const known = KNOWN[exe]
  let name = known ? t(known) : exe ? capitalize(exe) : fallback
  if (filter) name = t('sessionWorks.human.scoped', { name, scope: filter.replace(/^@[^/]+\//, '') })
  return /(?:^|\s)(?:--watch|-w|watch)(?:\s|$)/.test(bare) ? t('sessionWorks.human.watching', { name }) : name
}

/** La charge et la mémoire, en méta discrète : « 3 % · 120 Mo ». */
export function loadText(work: Pick<SessionWork, 'cpu' | 'memoryBytes'>, t: Translate): string | null {
  const parts = [
    work.cpu != null ? t('sessionWorks.load.cpu', { percent: Math.round(work.cpu * 100) }) : null,
    work.memoryBytes ? formatBytes(work.memoryBytes) : null,
  ].filter((part): part is string => part !== null)
  return parts.length ? parts.join(' · ') : null
}

/** « En faire une action » : l'éditeur pré-rempli, service si ça écoute sur un port. */
export function seedFromWork(work: Pick<SessionWork, 'command' | 'description' | 'family' | 'port' | 'conversationTitle'>, t: Translate): EditorSeed {
  const service = work.port !== null
  return {
    preset: { what: 'command', kind: service ? 'service' : 'task' },
    prefill: {
      label: humanLabel(work, t),
      command: work.command ?? '',
      url: service ? 'http://localhost:{port}' : '',
      description: t('sessionWorks.seed.description', { title: work.conversationTitle }),
    },
  }
}

/** Une entrée de `/api/services` qu'une session du projet a lancée. */
function launchedBySession(entry: ServiceDto, projectId: string): entry is ServiceDto & { conversationId: string } {
  return (entry.kind === 'command' || entry.kind === 'detached') && entry.projectId === projectId && entry.conversationId !== null
}

/**
 * Les deux listes en une. Un travail de fond porté par un processus (`serviceId`) ne
 * fait qu'une ligne, qui prend au travail sa description et sa commande exacte, au
 * processus ses ports, sa charge et son arrêt. Les sous-agents restent dans l'onglet
 * Agent. Les processus d'un terminal n'en sont pas : un terminal n'est pas une session.
 *
 * L'ordre : ceux de `currentConversationId` d'abord, puis par départ.
 */
export function mergeWorks({
  projectId,
  services,
  background,
  conversations,
  currentConversationId,
}: {
  projectId: string
  /** Null quand la machine ne se scanne pas. */
  services: ServiceDto[] | null
  background: ProjectBackgroundDto[]
  conversations: WorkConversation[]
  currentConversationId?: string
}): SessionWork[] {
  const agents = new Map<string, AgentKind>(conversations.map((entry) => [entry.id, entry.agent]))
  for (const group of background) agents.set(group.conversationId, group.agent)
  const titles = new Map(conversations.map((entry) => [entry.id, entry.title]))

  const works = new Map<string, SessionWork>()
  for (const entry of services ?? []) {
    if (!launchedBySession(entry, projectId)) continue
    works.set(entry.id, {
      id: entry.id,
      conversationId: entry.conversationId,
      conversationTitle: entry.conversationTitle ?? titles.get(entry.conversationId) ?? '',
      agent: agents.get(entry.conversationId) ?? null,
      family: 'shell',
      description: null,
      command: entry.command,
      startedAt: entry.startedAt,
      port: entry.ports[0] ?? null,
      cpu: entry.cpu,
      memoryBytes: entry.memoryBytes || null,
      stop: entry.canStop ? { via: 'service', serviceId: entry.id } : null,
    })
  }

  for (const group of background) {
    const canStop = AGENT_CAPABILITIES[group.agent].stopBackgroundTask
    for (const task of group.tasks) {
      const family = familyOf(task.kind)
      if (family === 'subagent') continue
      const carried = task.serviceId ? works.get(task.serviceId) : undefined
      if (carried) {
        carried.family = family
        carried.description = task.description || null
        carried.command = task.command ?? carried.command
        continue
      }
      works.set(`${group.conversationId}:${task.id}`, {
        id: `${group.conversationId}:${task.id}`,
        conversationId: group.conversationId,
        conversationTitle: group.title,
        agent: group.agent,
        family,
        description: task.description || null,
        command: task.command,
        startedAt: task.startedAt,
        port: portIn(task.command ?? task.description),
        cpu: null,
        memoryBytes: null,
        stop: canStop ? { via: 'task', conversationId: group.conversationId, taskId: task.id } : null,
      })
    }
  }

  const here = (work: SessionWork) => (work.conversationId === currentConversationId ? 0 : 1)
  return [...works.values()].sort((a, b) => here(a) - here(b) || (a.startedAt ?? 0) - (b.startedAt ?? 0))
}
