/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * **Lancés par les sessions** : les travaux de fond qu'une session a laissés tourner
 * (un serveur `vite` démarré par l'agent avec `run_in_background`, une surveillance, un
 * workflow). Pour Tim, c'est une chose qui tourne au même titre qu'un service : elle a sa
 * place dans les Actions, avec le geste qui en fait une vraie action.
 *
 * Ce que Solera sait aujourd'hui (vérifié dans le code) :
 * - par conversation, le journal porte `background.updated` (id, `kind`, `description`)
 *   et `task.completed` ; le serveur en tire `openBackgroundTasks(conversationId)` et la
 *   page d'une conversation le replie en `BackgroundWork` (`lib/background.ts`) — mais
 *   **ni la commande exacte, ni l'heure de départ, ni un port, ni la sortie** ;
 * - pour toutes les conversations, le flux des statuts ne porte que leur **nombre**
 *   (`liveBackground(id)`, `conversations.background_count`) ;
 * - **aucune route** ne liste les travaux de fond d'un projet.
 * D'où : la conversation ouverte montre ses travaux en détail (description, famille) ;
 * les autres sessions du projet n'apparaissent que par leur compte, avec un lien ; la
 * démo simule le reste (commande, port, sortie), marqué.
 */
import { ArrowUpRight, Bot, MoreHorizontal, Radio, Square, SquareTerminal, Waves, Wand2 } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Menu, MenuItem, MenuLabel, MenuSeparator, cx } from '@solera/ui'
import type { AgentKind, ServicesDto } from '@solera/protocol'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatBytes } from '../../lib/attachments'
import { AgentIcon } from '../../components/AgentIcon'
import type { BackgroundWork } from '../../lib/background'
import { liveBackground, subscribeStatus } from '../../lib/conversation-status'
import { useAllConversations } from '../../lib/conversations'
import { elapsed } from '../../lib/dates'
import type { EditorSeed } from './Editor'
import { Group as LauncherGroup, TILE_BOX, useInLauncher } from './Launcher'
import { quietGestureClass } from './LaunchButton'

export type WorkFamily = 'shell' | 'workflow' | 'monitor' | 'subagent' | 'other'

export interface SessionWork {
  id: string
  conversationId: string
  conversationTitle: string
  agent: AgentKind | null
  family: WorkFamily
  /** Ce que Solera en sait : la description du CLI, ou la commande (démo). */
  label: string
  /** La commande exacte : seulement en démo, le journal ne la porte pas à ce niveau. */
  command: string | null
  startedAt: number | null
  port: number | null
  output: string[] | null
  /** Une session dont on ne connaît que le nombre de travaux (hors de la conversation ouverte). */
  countOnly: number | null
  simulated: boolean
  /** Venu de `GET /api/services` : l'entrée, sa charge et sa mémoire. */
  serviceId?: string
  cpu?: number | null
  memoryBytes?: number
  origin?: 'agent' | 'terminal' | 'unknown'
}

/** La charge et la mémoire, en méta discrète : « 3 % · 120 Mo ». */
export function loadText(work: SessionWork): string | null {
  const parts = [
    work.cpu != null ? `${Math.round(work.cpu * 100)} %` : null,
    work.memoryBytes ? formatBytes(work.memoryBytes) : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function familyOf(kind: string): WorkFamily {
  const bare = kind.replace(/^local_/, '')
  if (bare === 'bash' || bare === 'shell') return 'shell'
  if (bare === 'workflow') return 'workflow'
  if (bare === 'mcp_task' || bare === 'monitor') return 'monitor'
  if (bare === 'agent' || bare === 'subagent') return 'subagent'
  return 'other'
}

export const FAMILY_WORD: Record<WorkFamily, string> = {
  shell: 'commande de fond',
  workflow: 'workflow',
  monitor: 'surveillance',
  subagent: 'sous-agent en fond',
  other: 'travail de fond',
}

export function FamilyIcon({ family, size = 14 }: { family: WorkFamily; size?: number }) {
  if (family === 'shell') return <SquareTerminal size={size} />
  if (family === 'monitor') return <Radio size={size} />
  if (family === 'subagent') return <Bot size={size} />
  return <Waves size={size} />
}

/** Un port deviné dans ce qu'on sait de la commande (`--port 5418`, `:5173`). */
export function portIn(text: string): number | null {
  const match = text.match(/--port[ =](\d{2,5})/) ?? text.match(/(?:localhost|127\.0\.0\.1)?:(\d{4,5})\b/)
  return match ? Number(match[1]) : null
}

const MIN = 60_000

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

/**
 * Ce que le processus **est**, dit comme Tim le dirait : « Serveur vite », « Tests vitest
 * en surveillance », « Script node ». Déduit de la commande, sans prétendre au-delà ;
 * à défaut, la description du CLI ou l'exécutable.
 */
export function humanLabel(work: Pick<SessionWork, 'command' | 'label' | 'port'>): string {
  if (!work.command) return work.label
  const bare = shortCommand(work.command)
  const words = bare.split(/\s+/)
  const watch = /(?:^|\s)(?:--watch|-w|watch)(?:\s|$)/.test(bare) ? ' en surveillance' : ''
  const filter = bare.match(/--filter[ =](\S+)/)?.[1]
  const scope = filter ? ` (${filter.replace(/^@[^/]+\//, '')})` : ''
  // `pnpm --filter x test`, `npm run dev` : le script nommé dit ce qui tourne.
  const runner = ['pnpm', 'npm', 'yarn', 'bun'].includes(words[0]!)
  const script = runner ? words.slice(1).filter((word) => !word.startsWith('-') && word !== filter && word !== 'run')[0] : undefined
  const exe = (runner ? script : words[0])?.split('/').pop() ?? ''
  const known: Record<string, string> = {
    vite: 'Serveur vite',
    next: 'Serveur Next',
    astro: 'Serveur Astro',
    storybook: 'Storybook',
    'storybook-dev': 'Storybook',
    vitest: 'Tests vitest',
    jest: 'Tests jest',
    playwright: 'Tests Playwright',
    tsc: 'Typecheck',
    tsx: 'Script tsx',
    node: 'Script node',
    python: 'Script python',
    python3: 'Script python',
    docker: 'Conteneur docker',
    dev: 'Serveur de dev',
    test: 'Tests',
    lint: 'Lint',
    build: 'Build',
  }
  const name = known[exe] ?? (exe ? `${exe.charAt(0).toUpperCase()}${exe.slice(1)}` : work.label)
  return `${name}${scope}${watch}`
}

function demoWorks(currentId: string | undefined): SessionWork[] {
  const now = Date.now()
  const here = currentId ?? 'demo-conv-1'
  return [
    {
      id: 'demo-bg-vite',
      conversationId: here,
      conversationTitle: 'Repenser la page projet',
      agent: 'claude',
      family: 'shell',
      label: 'Serveur du prototype',
      command: 'npx vite --port 5418 --strictPort',
      startedAt: now - 47 * MIN,
      port: 5418,
      output: ['VITE v6.4.3  ready in 252 ms', '➜  Local:   http://localhost:5418/', '16:31:07 [vite] hmr update /src/routes/prototype-automations/Editor.tsx'],
      countOnly: null,
      simulated: true,
    },
    {
      id: 'demo-bg-tests',
      conversationId: 'demo-conv-2',
      conversationTitle: 'Sessions autonomes confinées',
      agent: 'codex',
      family: 'shell',
      label: 'Tests en surveillance',
      command: 'pnpm --filter @solera/server test --watch',
      startedAt: now - 12 * MIN,
      port: null,
      output: [' ✓ sessions/confined.test.ts (14 tests) 812ms', ' Test Files  31 passed (31)', ' Waiting for file changes...'],
      countOnly: null,
      simulated: true,
    },
    {
      id: 'demo-bg-monitor',
      conversationId: 'demo-conv-3',
      conversationTitle: 'Dev container sous Windows natif',
      agent: 'claude',
      family: 'monitor',
      label: 'Surveiller la CI de la PR #118',
      command: null,
      startedAt: now - 6 * MIN,
      port: null,
      output: null,
      countOnly: null,
      simulated: true,
    },
  ]
}

/**
 * Les travaux de fond des sessions d'un projet. `current` : la conversation ouverte et
 * ses travaux, que la page connaît en détail.
 */
export function useSessionWorks(projectId: string | undefined, current?: { conversationId: string; background: BackgroundWork[] }): {
  works: SessionWork[]
  demo: boolean
} {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data: conversations } = useAllConversations()
  /*
    La vraie source : la page Services sait déjà tout ce qu'une session a laissé tourner
    (`GET /api/services`, entrées `kind: 'command'`) — la commande, ses ports, son
    départ, sa charge, sa session d'origine. Même clé que la page Services : une seule
    requête pour les deux.
  */
  const services = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServicesDto>('/api/services'),
    refetchInterval: 5000,
    enabled: !demo,
    retry: false,
  })
  const mine = useMemo(() => (conversations ?? []).filter((entry) => entry.projectId === projectId), [conversations, projectId])
  // Le nombre de travaux de chaque conversation, tenu à jour par le flux des statuts.
  const counts = useSyncExternalStore(subscribeStatus, () => mine.map((entry) => `${entry.id}:${liveBackground(entry.id)}`).join(','))

  const works = useMemo<SessionWork[]>(() => {
    if (demo) return demoWorks(current?.conversationId)
    const scanned = services.data?.supported ? services.data.services : null
    if (scanned) {
      return scanned
        .filter((entry) => entry.kind === 'command' && entry.projectId === projectId && (!current || entry.conversationId === current.conversationId))
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((entry) => {
          const conversation = mine.find((item) => item.id === entry.conversationId)
          return {
            id: entry.id,
            conversationId: entry.conversationId ?? '',
            conversationTitle: entry.conversationTitle ?? (entry.origin === 'terminal' ? 'un terminal' : 'une session'),
            agent: conversation?.agent ?? null,
            family: 'shell' as const,
            label: entry.command ?? entry.name,
            command: entry.command,
            startedAt: entry.startedAt,
            port: entry.ports[0] ?? null,
            output: null,
            countOnly: null,
            simulated: false,
            serviceId: entry.id,
            cpu: entry.cpu,
            memoryBytes: entry.memoryBytes,
            origin: entry.origin,
          }
        })
    }
    const out: SessionWork[] = []
    const here = current ? mine.find((entry) => entry.id === current.conversationId) : undefined
    for (const work of current?.background ?? []) {
      out.push({
        id: work.id,
        conversationId: current!.conversationId,
        conversationTitle: here?.title ?? 'Cette session',
        agent: here?.agent ?? null,
        family: familyOf(work.kind),
        label: work.description || work.kind,
        command: null,
        startedAt: null,
        port: portIn(work.description),
        output: work.activity ? [work.activity] : null,
        countOnly: null,
        simulated: false,
      })
    }
    for (const entry of mine) {
      if (entry.id === current?.conversationId) continue
      const count = liveBackground(entry.id)
      if (count <= 0) continue
      out.push({
        id: `count-${entry.id}`,
        conversationId: entry.id,
        conversationTitle: entry.title,
        agent: entry.agent,
        family: 'other',
        label: `${count} travail${count > 1 ? 'x' : ''} de fond`,
        command: null,
        startedAt: null,
        port: null,
        output: null,
        countOnly: count,
        simulated: false,
      })
    }
    return out
    // `counts` porte les nombres : relire quand il change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, current, mine, counts, services.data, projectId])

  return { works, demo }
}

/** « En faire une action » : l'éditeur pré-rempli, service si ça écoute sur un port. */
export function seedFromWork(work: SessionWork): EditorSeed {
  const service = work.port !== null
  return {
    preset: { what: 'command', kind: service ? 'service' : 'task' },
    prefill: {
      label: work.label,
      command: work.command ?? '',
      url: service ? 'http://localhost:{port}' : '',
      description: `Repris de « ${work.conversationTitle} », où une session l'avait lancé en fond.`,
    },
  }
}

/** L'icône de famille, avec le point vert de ce qui tourne posé dans son coin. */
function WorkIcon({ work, size = 'md' }: { work: SessionWork; size?: 'md' | 'sm' }) {
  return (
    <span className={cx('relative grid shrink-0 place-items-center rounded-md text-ink-soft', size === 'md' ? 'size-8 bg-surface-high/70' : 'size-6')}>
      {work.countOnly !== null && work.agent ? <AgentIcon agent={work.agent} size={size === 'md' ? 15 : 14} /> : <FamilyIcon family={work.family} size={size === 'md' ? 15 : 14} />}
      <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2.5 animate-pulse rounded-full bg-positive ring-2 ring-canvas" />
    </span>
  )
}

/**
 * La tuile d'un travail, dans le Lanceur : **exactement** le gabarit d'une tuile d'action.
 * En-tête (icône + point, libellé humain, ⋯), une ligne d'état grise, une seule ligne de
 * détail (la commande courte, la session d'origine en pastille si la place le permet), et
 * un seul geste en bas. Le reste — en faire une action, arrêter, aller à la session, la
 * charge — passe dans le ⋯ : une tuile de hauteur fixe ne déborde jamais.
 */
function SessionWorkTile({ projectId, work, onMakeAction, simulate }: {
  projectId: string
  work: SessionWork
  onMakeAction: (seed: EditorSeed) => void
  simulate: (text: string) => void
}) {
  const navigate = useNavigate()
  const sessionHref = `/p/${projectId}/c/${work.conversationId}`
  const counted = work.countOnly !== null
  const name = counted ? work.conversationTitle : humanLabel(work)
  const short = work.command ? shortCommand(work.command) : null
  const load = loadText(work)
  const origin = work.conversationTitle ? `Lancé dans « ${work.conversationTitle} »` : null
  const state = counted
    ? `En cours · ${work.label}`
    : ['En marche', work.port ? `:${work.port}` : null, work.startedAt ? `depuis ${elapsed(work.startedAt)}` : null].filter(Boolean).join(' · ')
  const stop = () => simulate(`arrêter « ${name} » (la route POST /api/services/:id/stop existe, le proto ne l'appelle pas)`)

  return (
    <article className={cx(TILE_BOX, 'gap-2 border-accent/40 bg-accent/5')}>
      <header className="flex min-w-0 items-start gap-2.5">
        <WorkIcon work={work} />
        <span className="flex min-w-0 flex-1 flex-col" title={[work.command, origin, load].filter(Boolean).join('\n')}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink">{name}</span>
            {work.simulated ? <span className="shrink-0 rounded bg-fuchsia-500/15 px-1 text-meta text-fuchsia-700 dark:text-fuchsia-300">simulé</span> : null}
          </span>
          <span className="truncate text-xs text-ink-faint">{state}</span>
        </span>
        <Menu
          trigger={
            <button type="button" aria-label={`Plus pour « ${name} »`} className="-mt-0.5 -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink">
              <MoreHorizontal size={15} />
            </button>
          }
        >
          {counted ? null : <MenuItem onSelect={() => onMakeAction(seedFromWork(work))}>En faire une action</MenuItem>}
          {work.conversationId ? <MenuItem onSelect={() => navigate(sessionHref)}>Aller à la session</MenuItem> : null}
          {counted ? null : (
            <>
              <MenuSeparator />
              <MenuItem onSelect={stop}>Arrêter</MenuItem>
            </>
          )}
          {load ? (
            <>
              <MenuSeparator />
              <MenuLabel><span className="tabular-nums">{load}</span></MenuLabel>
            </>
          ) : null}
        </Menu>
      </header>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-[2.625rem] text-xs text-ink-faint">
        {counted ? (
          <span className="min-w-0 truncate">On n'en connaît que le nombre : la session dit le reste.</span>
        ) : (
          <>
            {short ? <code className="min-w-0 truncate font-mono text-[11px]" title={work.command ?? undefined}>$ {short}</code> : null}
            {work.conversationId ? (
              <Link to={sessionHref} title={origin ?? undefined} className="inline-flex max-w-[45%] min-w-0 shrink items-center gap-1 rounded-full border border-line px-1.5 py-px text-[11px] text-ink-soft hover:border-line-strong hover:text-ink">
                {work.agent ? <AgentIcon agent={work.agent} size={10} /> : null}
                <span className="truncate">{work.conversationTitle}</span>
              </Link>
            ) : null}
          </>
        )}
      </div>

      <footer className="flex min-w-0 items-center gap-1.5">
        {counted ? (
          <Link to={sessionHref} className={quietGestureClass()}>Session <ArrowUpRight size={12} /></Link>
        ) : work.port ? (
          <a href={`http://localhost:${work.port}`} target="_blank" rel="noreferrer" className={cx(quietGestureClass(), 'border border-line text-ink')}>
            Ouvrir :{work.port} <ArrowUpRight size={12} />
          </a>
        ) : (
          <button type="button" onClick={stop} className={cx(quietGestureClass(), 'border border-line text-ink')}>
            <Square size={10} fill="currentColor" /> Arrêter
          </button>
        )}
      </footer>
    </article>
  )
}

/**
 * La ligne d'un processus dans le panneau : **un serveur qui tourne**, lu comme tel. ≈36 px,
 * les mêmes marges et la même icône (nature + point d'état) que les lignes d'actions ; le
 * libellé humain (« Serveur vite »), la session d'origine en pastille seulement si ce n'est
 * pas celle-ci ; à droite le port en lien et la durée ; au survol *Arrêter* et un ⋯ (*En
 * faire une action*, *Voir la sortie*, *Aller à la session*). Un clic déplie la commande
 * exacte, la charge et la sortie quand on la connaît.
 */
function SessionWorkLine({ projectId, work, currentConversationId, onMakeAction, simulate }: {
  projectId: string
  work: SessionWork
  currentConversationId?: string
  onMakeAction: (seed: EditorSeed) => void
  simulate: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const sessionHref = `/p/${projectId}/c/${work.conversationId}`
  const here = Boolean(currentConversationId) && work.conversationId === currentConversationId
  if (work.countOnly !== null) {
    return (
      <li className="flex min-h-9 items-center gap-2.5 px-3 transition-colors hover:bg-surface-high/50">
        <WorkIcon work={work} size="sm" />
        <Link to={sessionHref} className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-sm text-ink">{work.label}</span>
          <SessionPill work={work} />
        </Link>
      </li>
    )
  }
  const name = humanLabel(work)
  const short = work.command ? shortCommand(work.command) : null
  const load = loadText(work)
  const stop = () => simulate(`arrêter « ${name} » (la route POST /api/services/:id/stop existe, le proto ne l'appelle pas)`)
  return (
    <li className="group flex flex-col">
      <div
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a, button, [role="menu"]')) return
          setOpen((value) => !value)
        }}
        className="flex min-h-9 cursor-pointer items-center gap-2.5 px-3 transition-colors hover:bg-surface-high/50"
      >
        <WorkIcon work={work} size="sm" />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={[short ?? work.label, load].filter(Boolean).join(' — ')}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline"
        >
          <span className="min-w-0 truncate text-sm text-ink">{name}</span>
          {here ? null : <SessionPill work={work} />}
          {work.simulated ? <span className="shrink-0 rounded bg-fuchsia-500/15 px-1 text-meta text-fuchsia-700 dark:text-fuchsia-300">démo</span> : null}
        </button>
        <span className="flex shrink-0 items-center gap-0.5">
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
            <button type="button" title="Arrêter (simulé)" aria-label={`Arrêter « ${name} »`} onClick={stop} className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-critical">
              <Square size={10} fill="currentColor" />
            </button>
            <Menu
              trigger={
                <button type="button" aria-label={`Plus pour « ${name} »`} className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink">
                  <MoreHorizontal size={14} />
                </button>
              }
            >
              <MenuItem onSelect={() => onMakeAction(seedFromWork(work))}>En faire une action</MenuItem>
              <MenuItem onSelect={() => setOpen(true)}>Voir la sortie</MenuItem>
              {work.conversationId && !here ? (
                <MenuItem onSelect={() => navigate(sessionHref)}>Aller à la session</MenuItem>
              ) : null}
            </Menu>
          </span>
          {work.port ? (
            <a
              href={`http://localhost:${work.port}`}
              target="_blank"
              rel="noreferrer"
              title={`Ouvrir localhost:${work.port}`}
              className="inline-flex h-8 items-center gap-0.5 rounded-md px-1.5 font-mono text-xs text-ink-soft tabular-nums underline-offset-2 hover:bg-surface-high hover:text-ink hover:underline"
            >
              :{work.port} <ArrowUpRight size={11} />
            </a>
          ) : null}
          {work.startedAt ? <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-faint">{elapsed(work.startedAt)}</span> : null}
        </span>
      </div>
      {open ? (
        <div className="flex flex-col gap-1.5 pr-3 pb-2.5 pl-[2.75rem] text-xs text-ink-faint">
          {work.command ? <code className="font-mono text-[11px] break-all text-ink-soft">$ {work.command}</code> : <span>{work.label}</span>}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span>{here ? 'Lancé par cette session' : `Lancé par « ${work.conversationTitle} »`}</span>
            {work.startedAt ? <span>depuis {elapsed(work.startedAt)}</span> : null}
            {load ? <span className="tabular-nums">{load}</span> : null}
          </span>
          {work.output?.length ? (
            <pre className="overflow-x-auto rounded-md bg-surface-high/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-soft">{work.output.join('\n')}</pre>
          ) : (
            <span>La sortie ne remonte pas jusqu'ici : elle est dans la session qui l'a lancé.</span>
          )}
        </div>
      ) : null}
    </li>
  )
}

/** La session d'origine, en pastille cliquable : seulement quand ce n'est pas celle-ci. */
function SessionPill({ work }: { work: SessionWork }) {
  if (!work.conversationId) return <span className="shrink-0 truncate text-xs text-ink-faint">{work.conversationTitle}</span>
  return (
    <span className="inline-flex max-w-[45%] min-w-0 shrink items-center gap-1 rounded-full border border-line px-1.5 py-px text-[11px] text-ink-soft">
      {work.agent ? <AgentIcon agent={work.agent} size={10} /> : null}
      <span className="truncate">{work.conversationTitle}</span>
    </span>
  )
}

/** Une ligne : la famille, ce qu'on sait, la session d'origine, puis les gestes. */
export function SessionWorkRow({ projectId, work, compact = false, expanded, onToggle, onMakeAction, simulate }: {
  projectId: string
  work: SessionWork
  compact?: boolean
  expanded: boolean
  onToggle: () => void
  onMakeAction: (seed: EditorSeed) => void
  simulate: (text: string) => void
}) {
  const sessionHref = `/p/${projectId}/c/${work.conversationId}`
  const facts: ReactNode[] = [
    <Link key="s" to={sessionHref} className="inline-flex min-w-0 items-center gap-1 underline-offset-2 hover:text-ink hover:underline">
      {work.agent ? <AgentIcon agent={work.agent} size={11} /> : null}
      <span className="truncate">{work.conversationTitle}</span>
    </Link>,
    work.countOnly === null ? <span key="f">{FAMILY_WORD[work.family]}</span> : null,
    work.startedAt ? <span key="t">depuis {elapsed(work.startedAt)}</span> : null,
    work.port ? <span key="p" className="tabular-nums">:{work.port}</span> : null,
  ].filter(Boolean)
  const hasOutput = Boolean(work.output?.length)

  return (
    <li className={cx('flex flex-col', compact ? 'px-3 py-1.5' : 'px-3.5 py-2.5')}>
      <div className="flex min-h-9 items-center gap-2.5">
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-positive" />
        <span className="shrink-0 text-ink-faint"><FamilyIcon family={work.family} /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={hasOutput ? onToggle : undefined}
            className={cx('flex min-w-0 items-center gap-2 text-left', !hasOutput && 'cursor-default')}
          >
            <span className="truncate text-sm text-ink">{work.label}</span>
            {work.simulated ? <span className="shrink-0 rounded bg-fuchsia-500/15 px-1 text-meta text-fuchsia-700 dark:text-fuchsia-300">simulé</span> : null}
          </button>
          {work.command && !compact ? <code className="truncate font-mono text-xs text-ink-faint">$ {work.command}</code> : null}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-faint">{facts}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {work.countOnly !== null ? (
            <Link to={sessionHref} className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-surface-high hover:text-ink md:h-9 pointer-coarse:h-11">
              Session <ArrowUpRight size={12} />
            </Link>
          ) : (
            <>
              {work.port ? (
                <a href={`http://localhost:${work.port}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-surface-high hover:text-ink md:h-9 pointer-coarse:h-11">
                  Ouvrir <ArrowUpRight size={12} />
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => onMakeAction(seedFromWork(work))}
                title="En faire une action : l'éditeur pré-rempli"
                className="inline-flex h-11 items-center gap-1 rounded-md border border-line px-2 text-xs text-ink hover:bg-surface-high md:h-9 pointer-coarse:h-11"
              >
                <Wand2 size={12} /> {compact ? 'Action' : 'En faire une action'}
              </button>
              <button
                type="button"
                onClick={() => simulate(`arrêter « ${work.label} » (la route POST /api/services/:id/stop existe, le proto ne l'appelle pas)`)}
                title="Arrêter"
                aria-label={`Arrêter « ${work.label} »`}
                className="grid size-11 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-critical md:size-9 pointer-coarse:size-11"
              >
                <Square size={11} fill="currentColor" />
              </button>
            </>
          )}
        </span>
      </div>
      {expanded && hasOutput ? (
        <pre className="mt-1.5 ml-[2.375rem] overflow-x-auto rounded-md bg-surface-high/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-soft">
          {work.output!.join('\n')}
        </pre>
      ) : null}
    </li>
  )
}

/**
 * Le groupe « Lancés par les sessions » : dans le Lanceur et la Liste de l'onglet, et dans
 * le panneau d'une conversation (`compact`). Rien quand aucune session ne fait rien.
 */
export function SessionWorksSection({ projectId, works, compact = false, currentConversationId, onMakeAction, simulate }: {
  projectId: string
  works: SessionWork[]
  compact?: boolean
  /** Dans le panneau d'une conversation : ses propres processus disent « cette session ». */
  currentConversationId?: string
  onMakeAction: (seed: EditorSeed) => void
  simulate: (text: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const inLauncher = useInLauncher()
  if (works.length === 0) return null
  if (compact) {
    return (
      <section className="pt-1.5 pb-1">
        <h3 className="px-3 pt-1.5 pb-1 text-meta font-medium tracking-wide text-ink-faint uppercase">
          Processus des sessions <span className="tabular-nums">{works.length}</span>
        </h3>
        <ul className="flex flex-col">
          {works.map((work) => (
            <SessionWorkLine key={work.id} projectId={projectId} work={work} currentConversationId={currentConversationId} onMakeAction={onMakeAction} simulate={simulate} />
          ))}
        </ul>
      </section>
    )
  }
  if (inLauncher) {
    return (
      <LauncherGroup icon={<Waves size={14} />} title="Lancés par les sessions" count={works.length}>
        {works.map((work) => <SessionWorkTile key={work.id} projectId={projectId} work={work} onMakeAction={onMakeAction} simulate={simulate} />)}
      </LauncherGroup>
    )
  }
  const rows = works.map((work) => (
    <SessionWorkRow
      key={work.id}
      projectId={projectId}
      work={work}
      compact={compact}
      expanded={open === work.id}
      onToggle={() => setOpen((current) => (current === work.id ? null : work.id))}
      onMakeAction={onMakeAction}
      simulate={simulate}
    />
  ))
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-ink">Lancés par les sessions</h2>
        <span className="text-xs tabular-nums text-ink-faint">{works.length}</span>
        <span className="hidden min-w-0 truncate text-xs text-ink-faint md:inline">
          — Ce qu'une session a laissé tourner en fond : un serveur, des tests en surveillance. « En faire une action » le garde.
        </span>
      </header>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">{rows}</ul>
    </section>
  )
}
