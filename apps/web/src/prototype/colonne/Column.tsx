/**
 * PROTOTYPE JETABLE (#121, #51) — la colonne de gauche, recopiée de `components/sidebar`
 * à la main et nourrie de `data.ts`. Les classes sont celles du code de `main` : c'est ce
 * qui rend le jugement honnête. Seules la section des demandes et la zone basse en mode
 * projet sont neuves.
 */
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Columns3,
  FilePlus2,
  FolderInput,
  FolderPlus,
  GitBranch,
  Hourglass,
  ListChecks,
  ListTree,
  MessageCircleQuestion,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  Scale,
  Search,
  ShieldQuestion,
  SquareKanban,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cx, IconButton, Menu, MenuItem, MenuSeparator } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { Logo } from '../../components/Logo'
import {
  dotOf,
  orderDemands,
  PROJECTS,
  projectOf,
  threadOf,
  THREADS,
  type Demand,
  type Project,
  type Thread,
  type ThreadDot,
} from './data'

export type Variant = 'A' | 'B' | 'C' | 'D'
export type Mode = 'tree' | 'project'

/** `null` = *Sans projet*, une entrée du sélecteur comme les autres. */
export type CurrentProject = string | null

export interface ColumnProps {
  variant: Variant
  demands: Demand[]
  mode: Mode
  onMode: (mode: Mode) => void
  current: CurrentProject
  onCurrent: (project: CurrentProject) => void
  openThread: string
  onOpenThread: (id: string) => void
  coarse: boolean
}

const SHOWN = 5

/* ——— Petits morceaux recopiés du code ——— */

const DOT_CLASS: Record<Exclude<ThreadDot, null>, string> = {
  working: 'bg-accent animate-pulse',
  awaiting: 'bg-caution',
  unread: 'bg-ink',
}

function Dot({ state }: { state: ThreadDot }) {
  if (!state) return null
  return <span className={cx('block size-1.5 shrink-0 rounded-full', DOT_CLASS[state])} />
}

function Avatar({ project, className = 'size-4' }: { project?: Project; className?: string }) {
  if (!project) return <MessagesSquare size={14} className="shrink-0 text-ink-faint" />
  // Solera a son image dans la vraie colonne : le prototype la rend par le logo.
  if (project.id === 'solera') return <Logo size={14} className={cx('shrink-0 text-accent', className)} />
  return (
    <span aria-hidden className={cx('flex shrink-0 items-center justify-center', className)}>
      <span className="size-1/2 rounded-full" style={{ background: project.color }} />
    </span>
  )
}

/** La hauteur d'une ligne de 32 px, 44 au doigt — ici forcée par le prototype. */
const h = (coarse: boolean, fine = 'h-8') => (coarse ? 'h-11' : fine)

function SectionHeader({ icon: Icon, iconClass, label, children, coarse }: {
  icon: LucideIcon
  iconClass?: string
  label: string
  children?: ReactNode
  coarse: boolean
}) {
  return (
    <button
      type="button"
      className={cx('flex w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-surface-high', h(coarse))}
    >
      <Icon size={14} className={cx('shrink-0', iconClass ?? 'text-ink-faint')} />
      <span className="flex-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
      <ArrowUpRight size={14} className="shrink-0 text-ink-faint" />
    </button>
  )
}

function CountPill({ tone, count }: { tone: 'caution' | 'accent'; count: number }) {
  return (
    <span className={cx(
      'flex items-center gap-1 rounded-full px-1.5 py-px text-meta font-medium tabular-nums',
      tone === 'caution' ? 'bg-caution/12 text-caution' : 'bg-accent-wash text-accent',
    )}>
      <Dot state={tone === 'caution' ? 'awaiting' : 'working'} />
      {count}
    </span>
  )
}

/* ——— La section des demandes, trois variantes ——— */

const KIND_ICON: Record<string, LucideIcon> = {
  permission: ShieldQuestion,
  question: MessageCircleQuestion,
  plan: ListChecks,
  decision: Scale,
  cards: Columns3,
  drafts: FilePlus2,
  move: FolderInput,
}

const kindOf = (demand: Demand) => (demand.tier === 'decision' ? 'decision' : demand.kind)

/** Le libellé court d'un accord, à droite de sa ligne quand le titre est celui du fil. */
const GRANT_SHORT: Record<string, string> = { cards: 'cartes', drafts: 'brouillons', move: 'à ranger' }

function grantShort(demand: Extract<Demand, { tier: 'grant' }>) {
  const count = demand.ask.match(/^\d+/)?.[0]
  return count ? `${count} ${GRANT_SHORT[demand.kind]}` : GRANT_SHORT[demand.kind]
}

function rowClass(coarse: boolean, active: boolean) {
  return cx(
    'flex w-full items-center gap-2 rounded-md px-1.5 pl-2.5 text-left text-sm transition-colors',
    h(coarse),
    active ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
  )
}

/**
 * A — « Le point seul ». La ligne a la même forme pour les trois rangs : le projet, le
 * fil (ou la question, pour une décision), et à droite **un seul** repère. Le blocage est
 * le point ambre que le fil porte déjà partout ailleurs dans la colonne ; une décision
 * dit son échéance, un accord ce qu'il range.
 */
function RowA({ demand, coarse, active, onOpen }: RowProps) {
  const thread = threadOf(demand.threadId)
  const text = demand.tier === 'decision' ? demand.ask : thread.title
  return (
    <button type="button" onClick={onOpen} title={`${thread.title} — ${demand.ask}`} className={rowClass(coarse, active)}>
      <Avatar project={projectOf(thread.projectId)} className="size-3.5" />
      <span className={cx('min-w-0 flex-1 truncate', demand.tier === 'blocked' && 'font-medium text-ink')}>{text}</span>
      {demand.tier === 'blocked' ? <span className="flex w-4 justify-center"><Dot state="awaiting" /></span> : null}
      {demand.tier === 'decision' ? (
        <span className="shrink-0 text-meta tabular-nums text-ink-faint">{demand.due}</span>
      ) : null}
      {demand.tier === 'grant' ? (
        <span className="shrink-0 text-meta text-ink-faint">{grantShort(demand)}</span>
      ) : null}
    </button>
  )
}

/**
 * B — « La demande en clair ». La ligne dit **ce qui est demandé**, pas le fil qui le
 * demande : l'icône dit le genre (permission, question, plan, décision, cartes…), en
 * ambre quand le fil est bloqué. Les trois rangs se séparent par l'espace seul, sans
 * sous-titre. Le projet passe en petite puce à droite.
 */
function RowB({ demand, coarse, active, onOpen }: RowProps) {
  const thread = threadOf(demand.threadId)
  const Icon = KIND_ICON[kindOf(demand)]!
  return (
    <button type="button" onClick={onOpen} title={`${demand.ask} — ${thread.title}`} className={rowClass(coarse, active)}>
      <Icon size={14} className={cx('shrink-0', demand.tier === 'blocked' ? 'text-caution' : 'text-ink-faint')} />
      <span className={cx('min-w-0 flex-1 truncate', demand.tier === 'blocked' && 'text-ink')}>{demand.ask}</span>
      {demand.tier === 'decision' ? (
        <span className="flex shrink-0 items-center gap-0.5 text-meta tabular-nums text-ink-faint">
          <Hourglass size={10} />{demand.due}
        </span>
      ) : (
        <span className="shrink-0 text-meta tabular-nums text-ink-faint">{demand.age}</span>
      )}
      <Avatar project={projectOf(thread.projectId)} className="size-3" />
    </button>
  )
}

/**
 * C — « Le fil bloqué déplié ». Une décision et un accord tiennent sur une ligne, comme
 * en A ; un fil bloqué en prend deux : le fil, puis ce qu'il attend. C'est le seul rang
 * où un agent est à l'arrêt, et c'est lui qui gagne la place.
 */
function RowC(props: RowProps) {
  const { demand, coarse, active, onOpen } = props
  if (demand.tier !== 'blocked') return <RowA {...props} />
  const thread = threadOf(demand.threadId)
  const Icon = KIND_ICON[demand.kind]!
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${thread.title} — ${demand.ask}`}
      className={cx(
        'flex w-full flex-col justify-center gap-0.5 rounded-md px-1.5 pl-2.5 text-left transition-colors',
        coarse ? 'min-h-14 py-1.5' : 'min-h-11 py-1',
        active ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
      )}
    >
      <span className="flex w-full items-center gap-2 text-sm">
        <Avatar project={projectOf(thread.projectId)} className="size-3.5" />
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{thread.title}</span>
        <span className="flex w-4 justify-center"><Dot state="awaiting" /></span>
      </span>
      <span className="flex w-full items-center gap-1.5 pl-5.5 text-xs text-ink-faint">
        <Icon size={12} className="shrink-0 text-caution" />
        <span className="min-w-0 flex-1 truncate">{demand.ask}</span>
        <span className="shrink-0 text-meta tabular-nums">{demand.age}</span>
      </span>
    </button>
  )
}

interface RowProps {
  demand: Demand
  coarse: boolean
  active: boolean
  onOpen: () => void
}

const ROWS: Record<Variant, (props: RowProps) => ReactNode> = { A: RowA, B: RowB, C: RowC, D: RowA }

/**
 * La section unique. **Absente quand rien n'attend**, comme « À décider » aujourd'hui.
 * Globale dans les deux modes ; en mode projet, le projet courant passe devant.
 */
function DemandSection({ variant, demands, current, mode, coarse, openThread, onOpenThread }: Pick<
  ColumnProps,
  'variant' | 'demands' | 'current' | 'mode' | 'coarse' | 'openThread' | 'onOpenThread'
>) {
  if (demands.length === 0) return null
  const ordered = orderDemands(demands, mode === 'project' ? current : undefined)
  const shown = ordered.slice(0, SHOWN)
  const rest = ordered.length - shown.length
  const blocked = demands.filter((demand) => demand.tier === 'blocked').length
  const Row = ROWS[variant]

  return (
    <section data-shot="demandes" className="shrink-0 border-b border-line px-2 py-1.5">
      <SectionHeader icon={MessageCircleQuestion} iconClass="text-caution" label="À toi" coarse={coarse}>
        {/* A et C comptent tout ; B sépare ce qui bloque du reste, puisque ses lignes ne
            portent pas de point. */}
        {variant === 'B' && blocked > 0 && blocked < demands.length ? (
          <span className="flex items-center gap-1.5 text-meta tabular-nums">
            <CountPill tone="caution" count={blocked} />
            <span className="text-ink-faint">+ {demands.length - blocked}</span>
          </span>
        ) : (
          <CountPill tone="caution" count={demands.length} />
        )}
      </SectionHeader>
      <ul>
        {shown.map((demand, index) => {
          // B sépare les rangs par l'espace : un pas de plus au changement de rang.
          const gap = variant === 'B' && index > 0 && shown[index - 1]!.tier !== demand.tier
          return (
            <li key={demand.id} className={cx(gap && 'mt-1.5')}>
              <Row
                demand={demand}
                coarse={coarse}
                active={openThread === demand.threadId}
                onOpen={() => onOpenThread(demand.threadId)}
              />
            </li>
          )
        })}
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          className={cx('flex w-full items-center gap-2 rounded-md px-1.5 text-left text-xs text-ink-faint transition-colors hover:bg-surface-high hover:text-ink', h(coarse))}
        >
          <MessageCircleQuestion size={14} className="shrink-0" />
          + {rest} de plus
        </button>
      ) : null}
    </section>
  )
}

/* ——— L'activité : ce qui tourne et les non-lus, jamais « attend ta réponse » ——— */

function ActivitySection({ demands, coarse, openThread, onOpenThread }: Pick<
  ColumnProps,
  'demands' | 'coarse' | 'openThread' | 'onOpenThread'
>) {
  const blocked = new Set(demands.filter((demand) => demand.tier === 'blocked').map((demand) => demand.threadId))
  const live = THREADS.filter((thread) => !blocked.has(thread.id) && thread.dot !== null && thread.id !== openThread)
  const unread = live.filter((thread) => thread.dot === 'unread')
  const running = live.filter((thread) => thread.dot === 'working')
  const entries = [...unread, ...running]
  const shown = coarse ? 2 : 7
  const rest = entries.length - shown

  return (
    <div data-shot="activite" className="shrink-0 border-b border-line px-2 py-1.5">
      <SectionHeader icon={Activity} label="Activité" coarse={coarse}>
        {running.length > 0 ? <CountPill tone="accent" count={running.length} /> : null}
      </SectionHeader>
      <ul>
        {entries.slice(0, shown).map((thread) => (
          <li key={thread.id}>
            <button type="button" onClick={() => onOpenThread(thread.id)} className={rowClass(coarse, false)}>
              <Avatar project={projectOf(thread.projectId)} className="size-3.5" />
              <span className={cx('min-w-0 flex-1 truncate', thread.dot === 'unread' && 'font-medium text-ink')}>
                {thread.title}
              </span>
              <span className="shrink-0 text-meta tabular-nums text-ink-faint">{thread.age}</span>
              <Dot state={thread.dot} />
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <button type="button" className={cx('flex w-full items-center gap-2 rounded-md px-1.5 text-left text-xs text-ink-faint', h(coarse))}>
          <Activity size={14} className="shrink-0" />+ {rest} autres sessions actives
        </button>
      ) : null}
    </div>
  )
}

/**
 * D — « Tout dans l'Activité ». Un seul bloc pour la colonne : ce qui t'attend en tête,
 * avec les lignes de A, puis les non-lus, puis ce qui tourne. **Une seule coupure pour
 * le tout** — 7 lignes, 3 au doigt — donc la hauteur ne dépend plus du nombre de
 * demandes : la zone basse garde sa place quoi qu'il arrive. L'en-tête porte les deux
 * comptes, ambre pour ce qui attend, accent pour ce qui tourne.
 */
function UnifiedActivity({ demands, coarse, current, mode, openThread, onOpenThread }: Pick<
  ColumnProps,
  'demands' | 'coarse' | 'current' | 'mode' | 'openThread' | 'onOpenThread'
>) {
  const ordered = orderDemands(demands, mode === 'project' ? current : undefined)
  const blocked = new Set(demands.filter((demand) => demand.tier === 'blocked').map((demand) => demand.threadId))
  const live = THREADS.filter((thread) => !blocked.has(thread.id) && thread.dot !== null && thread.id !== openThread)
  const unread = live.filter((thread) => thread.dot === 'unread')
  const running = live.filter((thread) => thread.dot === 'working')
  const rows = [
    ...ordered.map((demand) => ({ key: demand.id, demand, thread: undefined as Thread | undefined })),
    ...[...unread, ...running].map((thread) => ({ key: thread.id, demand: undefined as Demand | undefined, thread })),
  ]
  // Au doigt, l'en-tête seul : ses deux comptes disent tout, et il ouvre la liste entière.
  const shown = coarse ? [] : rows.slice(0, 7)
  const hiddenDemands = ordered.length - shown.filter((row) => row.demand).length
  const hiddenSessions = rows.length - shown.length - hiddenDemands

  return (
    <div data-shot="activite" className="shrink-0 border-b border-line px-2 py-1.5">
      <SectionHeader icon={Activity} label="Activité" coarse={coarse}>
        {demands.length > 0 ? <CountPill tone="caution" count={demands.length} /> : null}
        {running.length > 0 ? <CountPill tone="accent" count={running.length} /> : null}
      </SectionHeader>
      {rows.length === 0 && !coarse ? <p className="px-2 py-1.5 text-xs text-ink-faint">Aucune session en cours</p> : null}
      <ul>
        {shown.map((row, index) => {
          // Un pas de plus entre ce qui t'attend et le reste : l'espace sépare, pas un titre.
          const gap = index > 0 && !row.demand && shown[index - 1]!.demand
          return (
            <li key={row.key} className={cx(gap && 'mt-1.5')}>
              {row.demand ? (
                <RowA demand={row.demand} coarse={coarse} active={openThread === row.demand.threadId} onOpen={() => onOpenThread(row.demand!.threadId)} />
              ) : (
                <button type="button" onClick={() => onOpenThread(row.thread!.id)} className={rowClass(coarse, false)}>
                  <Avatar project={projectOf(row.thread!.projectId)} className="size-3.5" />
                  <span className={cx('min-w-0 flex-1 truncate', row.thread!.dot === 'unread' && 'font-medium text-ink')}>{row.thread!.title}</span>
                  <span className="shrink-0 text-meta tabular-nums text-ink-faint">{row.thread!.age}</span>
                  <Dot state={row.thread!.dot} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {!coarse && hiddenDemands + hiddenSessions > 0 ? (
        <button type="button" className={cx('flex w-full items-center gap-2 rounded-md px-1.5 text-left text-xs text-ink-faint hover:bg-surface-high hover:text-ink', h(coarse))}>
          <Activity size={14} className="shrink-0" />
          <span>
            +{' '}
            {[
              hiddenDemands > 0 ? `${hiddenDemands} demande${hiddenDemands > 1 ? 's' : ''}` : null,
              hiddenSessions > 0 ? `${hiddenSessions} session${hiddenSessions > 1 ? 's' : ''}` : null,
            ].filter(Boolean).join(' · ')}
          </span>
          {hiddenDemands > 0 ? <span className="ml-auto pr-1"><Dot state="awaiting" /></span> : null}
        </button>
      ) : null}
    </div>
  )
}

/* ——— La zone basse ——— */

function ThreadLine({ thread, demands, coarse, active, onOpen }: {
  thread: Thread
  demands: Demand[]
  coarse: boolean
  active: boolean
  onOpen: () => void
}) {
  const dot = active ? null : dotOf(thread, demands)
  return (
    <li className={cx(
      'flex items-center rounded-md pr-0.5 transition-colors',
      h(coarse),
      active ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
    )}>
      <button type="button" onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-xs">
        <span className="shrink-0 text-ink-faint"><AgentIcon agent={thread.agent} size={14} /></span>
        <span className={cx('min-w-0 flex-1 truncate text-left', dot === 'unread' && 'font-medium')}>{thread.title}</span>
      </button>
      <span className={cx('flex shrink-0 items-center justify-center', coarse ? 'size-11' : 'size-7')}>
        <Dot state={dot} />
      </span>
    </li>
  )
}

/** Le point le plus urgent d'un groupe : ambre s'il attend, encre s'il a du non-lu. */
function groupDot(projectId: string | null, demands: Demand[], openThread: string): ThreadDot {
  const dots = THREADS.filter((thread) => thread.projectId === projectId && thread.id !== openThread)
    .map((thread) => dotOf(thread, demands))
  if (dots.includes('awaiting')) return 'awaiting'
  if (dots.includes('unread')) return 'unread'
  return null
}

function TreeZone({ demands, coarse, openThread, onOpenThread }: Pick<
  ColumnProps,
  'demands' | 'coarse' | 'openThread' | 'onOpenThread'
>) {
  const openProject = threadOf(openThread).projectId
  const groups: { id: string | null; name: string; project?: Project }[] = [
    { id: null, name: 'Sans projet' },
    ...PROJECTS.map((project) => ({ id: project.id, name: project.name, project })),
  ]
  return (
    <ul>
      {groups.map((group) => {
        const open = group.id === openProject || group.id === null
        const threads = THREADS.filter((thread) => thread.projectId === group.id)
        const working = threads.some((thread) => thread.dot === 'working')
        const demanding = groupDot(group.id, demands, openThread)
        return (
          <li key={group.id ?? 'none'}>
            <div className={cx('group flex items-center gap-0.5 rounded-md pr-1 text-ink transition-colors hover:bg-surface-high', h(coarse, 'h-9'))}>
              <span className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-sm font-semibold">
                {group.project ? <Avatar project={group.project} /> : <MessagesSquare size={16} className="shrink-0 text-ink-faint" />}
                <span className="truncate">{group.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 pr-1">
                {working ? <Dot state="working" /> : null}
                <Dot state={demanding} />
              </span>
              <span className="inline-flex size-7 items-center justify-center text-ink-faint">
                <ChevronRight size={14} className={cx('transition-transform', open && 'rotate-90')} />
              </span>
            </div>
            {open ? (
              <ul className="mb-1">
                {threads.map((thread) => (
                  <ThreadLine
                    key={thread.id}
                    thread={thread}
                    demands={demands}
                    coarse={coarse}
                    active={thread.id === openThread}
                    onOpen={() => onOpenThread(thread.id)}
                  />
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
      <li className={cx('flex items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-faint', h(coarse, 'h-9'))}>
        <FolderPlus size={16} className="shrink-0" />Nouveau projet…
      </li>
    </ul>
  )
}

/**
 * Le sélecteur, **une ligne** : le projet courant ouvre la liste, et le bouton de bout
 * de ligne bascule d'un clic entre l'arbre et le projet. La ligne existe dans les deux
 * modes, pour que la bascule soit toujours au même endroit.
 */
function SwitcherLine({ mode, onMode, current, onCurrent, demands, openThread, coarse }: Pick<
  ColumnProps,
  'mode' | 'onMode' | 'current' | 'onCurrent' | 'demands' | 'openThread' | 'coarse'
>) {
  const project = projectOf(current)
  const others = [{ id: null as string | null, name: 'Sans projet', project: undefined as Project | undefined },
    ...PROJECTS.map((entry) => ({ id: entry.id as string | null, name: entry.name, project: entry as Project | undefined }))]
  // Le point du bouton dit qu'il y a du nouveau **ailleurs** que dans le projet affiché.
  const elsewhere = mode === 'project' && others.some((entry) => entry.id !== current && groupDot(entry.id, demands, openThread))

  return (
    <div data-shot="selecteur" className={cx('mb-1 flex items-center gap-0.5 rounded-md border border-line pr-0.5', h(coarse, 'h-9'))}>
      <Menu
        align="start"
        trigger={
          <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm font-semibold text-ink hover:bg-surface-high">
            {mode === 'tree'
              ? <ListTree size={16} className="shrink-0 text-ink-faint" />
              : project ? <Avatar project={project} /> : <MessagesSquare size={16} className="shrink-0 text-ink-faint" />}
            <span className="min-w-0 truncate">{mode === 'tree' ? 'Tous les projets' : project?.name ?? 'Sans projet'}</span>
            <ChevronDown size={14} className="shrink-0 text-ink-faint" />
            {elsewhere ? <span className="ml-auto pr-1"><Dot state={elsewhere ? 'unread' : null} /></span> : null}
          </button>
        }
      >
        <MenuItem icon={<ListTree size={14} />} onSelect={() => onMode('tree')}>Tous les projets</MenuItem>
        <MenuSeparator />
        {others.map((entry) => (
          <MenuItem
            key={entry.id ?? 'none'}
            icon={entry.project ? <Avatar project={entry.project} className="size-3.5" /> : <MessagesSquare size={14} />}
            onSelect={() => { onCurrent(entry.id); onMode('project') }}
          >
            <span className="flex items-center gap-2">
              <span className={cx('flex-1 truncate', mode === 'project' && entry.id === current && 'font-semibold')}>{entry.name}</span>
              <Dot state={groupDot(entry.id, demands, openThread)} />
            </span>
          </MenuItem>
        ))}
      </Menu>
      {mode === 'project' ? (
        <IconButton label="Nouvelle conversation dans ce projet" size="sm"><Plus size={14} /></IconButton>
      ) : null}
      <IconButton
        label={mode === 'tree' ? 'N’afficher qu’un projet' : 'Afficher tous les projets'}
        size="sm"
        onClick={() => onMode(mode === 'tree' ? 'project' : 'tree')}
        className={cx(mode === 'project' && 'text-ink')}
      >
        {mode === 'tree' ? <SquareKanban size={14} /> : <ListTree size={14} />}
      </IconButton>
    </div>
  )
}

function ProjectZone({ current, demands, coarse, openThread, onOpenThread }: Pick<
  ColumnProps,
  'current' | 'demands' | 'coarse' | 'openThread' | 'onOpenThread'
>) {
  const threads = THREADS.filter((thread) => thread.projectId === current)
  const links: { icon: LucideIcon; label: string; meta?: string }[] = current === null ? [] : [
    { icon: SquareKanban, label: 'Tableau', meta: '2 à vérifier' },
    { icon: GitBranch, label: 'Worktrees', meta: '4' },
    { icon: CalendarClock, label: 'Planifiées', meta: '1' },
  ]
  return (
    <div data-shot="zone-projet">
      {links.length > 0 ? (
        <ul className="mb-1.5">
          {links.map((link) => (
            <li key={link.label}>
              <button type="button" className={cx('group flex w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink', h(coarse))}>
                <link.icon size={15} className="shrink-0 text-ink-faint" />
                <span className="flex-1 truncate">{link.label}</span>
                <span className="shrink-0 text-meta tabular-nums text-ink-faint">{link.meta}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="px-2.5 pb-0.5 text-meta font-semibold uppercase tracking-wider text-ink-faint">Conversations</p>
      <ul>
        {threads.map((thread) => (
          <ThreadLine
            key={thread.id}
            thread={thread}
            demands={demands}
            coarse={coarse}
            active={thread.id === openThread}
            onOpen={() => onOpenThread(thread.id)}
          />
        ))}
      </ul>
    </div>
  )
}

/* ——— La colonne entière ——— */

export function Column(props: ColumnProps) {
  const { coarse, mode } = props
  const places: { icon: LucideIcon; label: string; count: ReactNode; active?: boolean }[] = [
    { icon: MessagesSquare, label: 'Fils', count: THREADS.length },
    { icon: SquareKanban, label: 'Projets', count: <Dot state="unread" />, active: true },
    { icon: BookOpen, label: 'Savoir', count: null },
    { icon: CalendarClock, label: 'Planifiées', count: 3 },
  ]

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <Logo size={20} className="text-accent" />
        <span className="text-heading font-semibold tracking-tight">Solera</span>
        <span className="ml-auto">
          <IconButton label="Replier"><PanelLeftClose size={16} /></IconButton>
        </span>
      </header>

      <div className="shrink-0 border-b border-line px-2 py-1.5">
        {[{ icon: Search, label: 'Rechercher' }, { icon: Plus, label: 'Nouvelle conversation' }].map((entry) => (
          <button key={entry.label} type="button" className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-ink-soft hover:bg-surface-high hover:text-ink', h(coarse, 'h-9'))}>
            <entry.icon size={16} className="shrink-0" />
            <span className="flex-1">{entry.label}</span>
          </button>
        ))}
      </div>

      <nav className="shrink-0 border-b border-line px-2 py-1.5">
        <ul>
          {places.map((place) => (
            <li key={place.label}>
              <div className={cx(
                'flex items-center gap-1 rounded-md pr-2.5 pl-2.5 text-sm',
                h(coarse, 'h-9'),
                place.active ? 'bg-accent-wash font-medium text-ink' : 'text-ink-soft',
              )}>
                <place.icon size={16} className="mr-1.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{place.label}</span>
                <span className="shrink-0 text-meta tabular-nums text-ink-faint">{place.count}</span>
              </div>
            </li>
          ))}
        </ul>
      </nav>

      {props.variant === 'D' ? <UnifiedActivity {...props} /> : (
        <>
          <DemandSection {...props} />
          <ActivitySection {...props} />
        </>
      )}

      <div data-shot="zone-basse" className="relative min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-4">
        <SwitcherLine {...props} />
        {mode === 'tree' ? <TreeZone {...props} /> : <ProjectZone {...props} />}
      </div>

      <div className={cx('flex shrink-0 items-center gap-2 border-t border-line px-4 text-sm text-ink-soft', h(coarse, 'h-12'))}>
        <span className="flex size-6 items-center justify-center rounded-full bg-accent-wash text-meta font-semibold text-accent">T</span>
        Tim
      </div>
    </div>
  )
}
