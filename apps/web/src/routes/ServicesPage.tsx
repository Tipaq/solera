import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Bot, ChevronDown, CircleHelp, Play, RotateCw, Server, Square, SquareTerminal, Unplug, X } from 'lucide-react'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ServiceAppAction, ServiceAppDto, ServiceDto, ServicesDto } from '@solera/protocol'
import { HeaderBand } from '../components/HeaderBand'
import { Badge, Banner, Button, EmptyState, IconButton, cx } from '@solera/ui'
import { api } from '../lib/api'
import { formatBytes } from '../lib/attachments'
import { conversationPath } from '../lib/conversation-route'
import { SystemLoad, type LoadConsumer } from '../components/services/SystemLoad'
import { useTranslate, type MessageKey } from '../lib/i18n'

type Attributed = Pick<ServiceDto, 'projectId' | 'projectName' | 'conversationId' | 'conversationTitle' | 'origin'>

export function ServicesPage() {
  const t = useTranslate()
  const client = useQueryClient()
  const [chosen, setChosen] = useState('all')
  const query = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServicesDto>('/api/services'),
    refetchInterval: 5000,
  })
  const stop = useMutation({
    mutationFn: (id: string) => api.post(`/api/services/${encodeURIComponent(id)}/stop`),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['services'] }) },
  })
  const control = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ServiceAppAction }) =>
      api.post(`/api/services/apps/${encodeURIComponent(id)}/${action}`),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['services'] }) },
  })
  const scannedAt = query.data?.scannedAt ?? Date.now()
  const services = query.data?.services ?? []
  const apps = query.data?.apps ?? []
  /**
   * Le filtre vaut pour toutes les listes : ses pastilles se construisent sur leur
   * réunion, avec le nombre de lignes de chacune. Hors projet, deux cas qui ne se
   * confondent pas : une conversation sans projet, dont on connaît l'auteur, et une
   * origine que Solera n'a pas pu retrouver (l'admin seul la voit).
   */
  const owners = [...apps, ...services.filter((entry) => entry.kind !== 'helper')]
  const bucketOf = (entry: Attributed) => entry.projectId ?? (entry.conversationId ? 'none' : 'unknown')
  const buckets = new Map<string, { label: string; count: number }>()
  for (const entry of owners) {
    const key = bucketOf(entry)
    const label = entry.projectName ?? t(key === 'none' ? 'services.noProject' : 'services.unknownOrigin')
    buckets.set(key, { label, count: (buckets.get(key)?.count ?? 0) + ('kind' in entry && entry.kind === 'launcher' ? 0 : 1) })
  }
  const chips = [...buckets.entries()].sort((a, b) =>
    (a[0] === 'unknown' ? 2 : a[0] === 'none' ? 1 : 0) - (b[0] === 'unknown' ? 2 : b[0] === 'none' ? 1 : 0) || a[1].label.localeCompare(b[1].label))
  // Un projet dont le dernier service vient de s'arrêter n'a plus de pastille : la vue
  // retombe sur tout, plutôt que sur un filtre qu'on ne pourrait plus voir ni défaire.
  const project = buckets.has(chosen) ? chosen : 'all'
  const inProject = (entry: Attributed) => project === 'all' || bucketOf(entry) === project

  const filteredApps = apps.filter(inProject)
  // Une commande suit son lanceur dans le filtre : c'est lui qui porte le projet à l'écran.
  const launchers = services.filter((entry) => entry.kind === 'launcher' && inProject(entry))
  const byLauncher = new Map<number, ServiceDto[]>()
  for (const entry of services) {
    if (entry.launcherPid === null) continue
    byLauncher.set(entry.launcherPid, [...(byLauncher.get(entry.launcherPid) ?? []), entry])
  }
  // Une commande dont le lanceur n'est pas visible garde sa place, sous son propre projet.
  const stray = services.filter((entry) => entry.kind === 'command' && entry.launcherPid !== null
    && !services.some((launcher) => launcher.pid === entry.launcherPid) && inProject(entry))
  const detached = services.filter((entry) => entry.kind === 'detached' && inProject(entry))
  const commands = launchers.flatMap((launcher) => (byLauncher.get(launcher.pid) ?? []).filter((entry) => entry.kind === 'command'))
  const total = filteredApps.length + commands.length + stray.length + detached.length
  const nothing = total === 0 && launchers.length === 0
  const busy = stop.isPending || control.isPending

  /**
   * Ce que Solera fait tourner, pour la barre de la machine, tous projets confondus : la
   * machine ne se filtre pas. Un agent compte avec ses outils (serveurs MCP), comme sur
   * sa ligne ; ses commandes comptent à part, chacune sous son nom.
   */
  const consumers: LoadConsumer[] = [
    ...apps.map((app) => ({ id: app.id, label: appName(app.unit), memoryBytes: app.memoryBytes ?? 0, cpu: app.cpu })),
    ...services.filter((entry) => entry.kind === 'launcher').map((launcher) => {
      const helpers = services.filter((entry) => entry.kind === 'helper' && entry.launcherPid === launcher.pid)
      return {
        id: launcher.id,
        label: launcher.conversationTitle ?? t(launcher.origin === 'terminal' ? 'services.launcher.terminal' : 'services.launcher.agent'),
        memoryBytes: launcher.memoryBytes + helpers.reduce((sum, helper) => sum + helper.memoryBytes, 0),
        cpu: (launcher.cpu ?? 0) + helpers.reduce((sum, helper) => sum + (helper.cpu ?? 0), 0),
      }
    }),
    ...services.filter((entry) => entry.kind === 'command' || entry.kind === 'detached')
      .map((entry) => ({ id: entry.id, label: shortCommand(entry.command ?? entry.name), memoryBytes: entry.memoryBytes, cpu: entry.cpu })),
  ]

  // Pas de filtre pour un seul projet : il n'y aurait rien à choisir.
  const filter = chips.length > 1 ? (
    <div role="radiogroup" aria-label={t('services.filter')} className="flex flex-wrap gap-1.5">
      {[['all', { label: t('services.allProjects'), count: 0 }] as const, ...chips].map(([key, chip]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={project === key}
          onClick={() => setChosen(key)}
          className={cx(
            'flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors pointer-coarse:h-11',
            project === key ? 'border-accent bg-accent-wash text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:bg-surface-high',
          )}
        >
          {chip.label}
          {key === 'all' ? null : <span className="tabular-nums text-ink-faint">{chip.count}</span>}
        </button>
      ))}
    </div>
  ) : null

  return (
    <Cores.Provider value={query.data?.system?.cores ?? 1}>
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBand>
        <Server size={16} className="shrink-0 text-ink-faint" />
        <h1 className="truncate text-sm font-medium">{t('services.title')}</h1>
        {query.data?.supported ? <Badge>{total}</Badge> : null}
        {/* Pas de bouton d'actualisation : la liste se relit toutes les 5 secondes. */}
      </HeaderBand>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {query.data?.system ? <SystemLoad system={query.data.system} consumers={consumers} /> : null}
          {filter}
          {query.error ? <Banner>{t('services.loadError')} {query.error.message}</Banner> : null}
          {stop.error ? <Banner>{stop.error.message}</Banner> : null}
          {control.error ? <Banner>{control.error.message}</Banner> : null}
          {query.isPending ? <p role="status" className="text-sm text-ink-faint">{t('services.loading')}</p>
            : query.data && !query.data.supported ? <EmptyState icon={<Server size={22} />} title={t('services.unsupported')} />
              : query.data && nothing ? <EmptyState icon={<Server size={22} />} title={t('services.empty')} description={t('services.emptyHint')} />
                : query.data ? (
                  <>
                    <Section id="services-apps" title={t('services.apps.title')} count={filteredApps.length} help={t('services.apps.description')}>
                      {filteredApps.length ? (
                        <List>
                          {filteredApps.map((app) => (
                            <AppRow key={app.id} app={app} scannedAt={scannedAt} busy={busy}
                              onAction={(action) => control.mutate({ id: app.id, action })} />
                          ))}
                        </List>
                      ) : <p className="text-sm text-ink-faint">{t('services.apps.empty')}</p>}
                    </Section>
                    <Section id="services-launchers" title={t('services.launchers.title')} count={commands.length + stray.length} help={t('services.launchers.description')}>
                      {launchers.length || stray.length ? (
                        <List>
                          {launchers.map((launcher) => (
                            <LauncherGroup key={launcher.id} launcher={launcher} entries={byLauncher.get(launcher.pid) ?? []}
                              scannedAt={scannedAt} busy={busy} onStop={(id) => stop.mutate(id)} />
                          ))}
                          {stray.map((entry) => <ProcessRow key={entry.id} entry={entry} attributed scannedAt={scannedAt} busy={busy} onStop={(id) => stop.mutate(id)} />)}
                        </List>
                      ) : <p className="text-sm text-ink-faint">{t('services.launchers.empty')}</p>}
                    </Section>
                    {detached.length ? (
                      <Section id="services-detached" title={t('services.detached.title')} count={detached.length} help={t('services.detached.description')}>
                        <List>
                          {detached.map((entry) => <ProcessRow key={entry.id} entry={entry} attributed scannedAt={scannedAt} busy={busy} onStop={(id) => stop.mutate(id)} />)}
                        </List>
                      </Section>
                    ) : null}
                  </>
                ) : null}
          {/* Ce que la page couvre, et pourquoi : replié, c'est une question qu'on se pose
              une fois, pas un texte à relire à chaque visite. */}
          <details className="text-xs leading-relaxed text-ink-faint">
            <summary className="flex w-fit cursor-pointer items-center gap-1.5 hover:text-ink">
              <CircleHelp size={13} aria-hidden />
              {t('services.scopeTitle')}
            </summary>
            <div className="mt-2 flex max-w-2xl flex-col gap-2">
              <p>{t('services.description')}</p>
              <p>{t('services.scope')}</p>
            </div>
          </details>
        </div>
      </div>
    </div>
    </Cores.Provider>
  )
}

/**
 * Une section : son titre, son compte, et son explication derrière une icône — elle
 * dit ce qu'est une app permanente ou un processus détaché, ce qu'on ne relit pas.
 */
function Section({ id, title, count, help, children }: { id: string; title: string; count: number; help: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 id={id} className="text-sm font-semibold">{title}</h2>
        {count ? <span className="text-xs tabular-nums text-ink-faint">{count}</span> : null}
        <span title={help} className="text-ink-faint"><CircleHelp size={13} aria-label={help} /></span>
      </div>
      {children}
    </section>
  )
}

/** Une liste de lignes séparées, dans un seul cadre : pas une carte par service. */
function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">{children}</ul>
}

function useDuration(scannedAt: number) {
  const t = useTranslate()
  return (startedAt: number | null) => {
    if (startedAt === null) return null
    const minutes = Math.max(0, Math.floor((scannedAt - startedAt) / 60000))
    return minutes < 60 ? t('services.minutes', { count: minutes }) : t('services.hours', { count: Math.floor(minutes / 60) })
  }
}

/**
 * La commande telle qu'elle se lit d'un coup d'œil : un chemin absolu ne garde que son
 * dernier segment. La ligne entière reste dans les détails, et en infobulle.
 */
function shortCommand(command: string): string {
  return command.replace(/(?:^|(?<=\s))\/(?:[^\s/]+\/)+([^\s/]+)/g, '$1')
}

/** Projet, puis conversation ou terminal d'origine, en une ligne. */
function Attribution({ entry }: { entry: Attributed }) {
  const t = useTranslate()
  return (
    <span className="flex min-w-0 items-center gap-x-1.5">
      {entry.projectId ? <Link to={`/p/${entry.projectId}`} className="shrink-0 font-medium text-ink-soft hover:text-accent">{entry.projectName}</Link>
        : <span className="shrink-0">{t(entry.conversationId ? 'services.noProject' : 'services.unknownOrigin')}</span>}
      {entry.conversationId ? (
        <>
          <span aria-hidden>·</span>
          <Link to={conversationPath({ id: entry.conversationId, projectId: entry.projectId })} className="flex min-w-0 items-center gap-1 text-accent hover:underline">
            <span className="truncate">{entry.conversationTitle || t('services.conversation')}</span><ArrowUpRight size={12} className="shrink-0" />
          </Link>
        </>
      ) : !entry.projectId ? null : (
        <>
          <span aria-hidden>·</span>
          <span className="truncate">{t(entry.origin === 'terminal' ? 'services.terminal' : entry.origin === 'agent' ? 'services.deletedConversation' : 'services.unknownOrigin')}</span>
        </>
      )}
    </span>
  )
}

/**
 * Une ligne de service : état, nom court et ports, puis une ligne de contexte ; les
 * actions à droite, et tout ce qui est technique — PID, dossier, ligne de commande
 * entière, journal — replié sous « Détails ».
 */
function Row({ dot, icon, name, fullName, ports, meta, actions, details, indent = false }: {
  dot?: string
  icon?: ReactNode
  name: ReactNode
  fullName: string
  ports: number[]
  meta: ReactNode[]
  actions: ReactNode
  details: [MessageKey, ReactNode][]
  indent?: boolean
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <li className={cx('flex min-w-0 flex-col', indent && 'pl-3 sm:pl-6')}>
      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        {icon ?? <span aria-hidden className={cx('size-2 shrink-0 rounded-full', dot ?? 'bg-ink-faint')} />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 truncate font-mono text-sm text-ink" title={fullName}>{name}</code>
            {ports.length ? (
              <span className="flex shrink-0 gap-1" aria-label={t('services.ports')}>
                {ports.map((port) => <Badge key={port} tone="accent">:{port}</Badge>)}
              </span>
            ) : null}
          </div>
          {/* Passe à la ligne plutôt que de se chevaucher au téléphone. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
            {meta.filter(Boolean).map((item, index) => (
              <span key={index} className="flex min-w-0 max-w-full items-center gap-2">
                {index > 0 ? <span aria-hidden>·</span> : null}
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <IconButton label={t('services.details')} aria-expanded={open} onClick={() => setOpen(!open)}>
            <ChevronDown size={15} className={cx('transition-transform', open && 'rotate-180')} />
          </IconButton>
        </div>
      </div>
      {open ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line bg-sunken px-3 py-2.5 text-xs">
          {details.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-faint">{t(label)}</dt>
              <dd className="min-w-0 break-all font-mono text-ink-soft">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  )
}

/** Le libellé d'une action, que le téléphone réduit à son icône : la ligne garde sa place. */
function Label({ children }: { children: ReactNode }) {
  return <span className="hidden sm:inline">{children}</span>
}

/** Un agent ou un terminal, en en-tête de groupe, avec ce qu'il a lancé dessous. */
function LauncherGroup({ launcher, entries, scannedAt, busy, onStop }: {
  launcher: ServiceDto
  entries: ServiceDto[]
  scannedAt: number
  busy: boolean
  onStop: (id: string) => void
}) {
  const t = useTranslate()
  const duration = useDuration(scannedAt)
  const commands = entries.filter((entry) => entry.kind === 'command')
  const helpers = entries.filter((entry) => entry.kind === 'helper')
  const agent = launcher.origin === 'agent'
  const Icon = agent ? Bot : SquareTerminal
  const memory = launcher.memoryBytes + helpers.reduce((sum, helper) => sum + helper.memoryBytes, 0)
  const helperNames = helpers.map((helper) => helper.command ?? helper.name).join('\n')
  const kind = t(agent ? 'services.launcher.agent' : launcher.origin === 'terminal' ? 'services.launcher.terminal' : 'services.unknownOrigin')
  return (
    <li>
      <section aria-label={`${kind} ${launcher.conversationTitle ?? launcher.projectName ?? launcher.name}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 bg-sunken px-3 py-2 text-xs text-ink-faint">
          <Icon size={14} className="shrink-0" />
          <span className="shrink-0 font-medium text-ink-soft">{kind}</span>
          <span aria-hidden>·</span>
          <Attribution entry={launcher} />
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span title={new Date(launcher.startedAt).toLocaleString()}>{duration(launcher.startedAt)}</span>
            <span aria-hidden>·</span>
            <span title={helpers.length ? t('services.launcher.helpersHint', { names: helperNames }) : undefined}>{formatBytes(memory)}</span>
          </span>
        </div>
        {commands.length ? (
          <ul className="divide-y divide-line">
            {commands.map((entry) => (
              <ProcessRow key={entry.id} entry={entry} scannedAt={scannedAt} busy={busy} onStop={onStop} indent
                attributed={entry.conversationId !== launcher.conversationId || entry.projectId !== launcher.projectId} />
            ))}
          </ul>
        ) : <p className="px-3 py-2.5 pl-9 text-xs text-ink-faint">{t('services.launcher.idle')}</p>}
      </section>
    </li>
  )
}

/** Une commande et tout ce qui en descend, ou un processus détaché. */
function ProcessRow({ entry, attributed, scannedAt, busy, onStop, indent = false }: {
  entry: ServiceDto
  attributed?: boolean
  scannedAt: number
  busy: boolean
  onStop: (id: string) => void
  indent?: boolean
}) {
  const t = useTranslate()
  const cores = useContext(Cores)
  const duration = useDuration(scannedAt)
  const title = entry.command ?? entry.name
  const names = entry.processes.map((process) => process.count > 1 ? `${process.name} ×${process.count}` : process.name).join(', ')
  return (
    <Row
      indent={indent}
      dot="bg-positive"
      icon={entry.kind === 'detached' ? <Unplug size={14} className="shrink-0 text-ink-faint" aria-hidden /> : undefined}
      name={shortCommand(title)}
      fullName={title}
      ports={entry.ports}
      meta={[
        attributed ? <Attribution entry={entry} /> : null,
        <span title={new Date(entry.startedAt).toLocaleString()}>{duration(entry.startedAt)}</span>,
        cpuText(entry.cpu, cores),
        formatBytes(entry.memoryBytes),
        entry.kind === 'detached' ? t(entry.stopsWithSolera ? 'services.stopsWithSolera' : 'services.shutdownUnknown') : null,
      ]}
      actions={entry.canStop ? (
        <Button variant="ghost" size="sm" icon={<Square size={13} />} title={t('services.stopHint')} aria-label={t('services.stop')} disabled={busy} onClick={() => onStop(entry.id)}>
          <Label>{t('services.stop')}</Label>
        </Button>
      ) : <span className="text-xs text-ink-faint" title={t('services.readOnlyHint')}>{t('services.readOnly')}</span>}
      details={[
        ['services.detail.command', title],
        ['services.detail.cwd', entry.cwd],
        ['services.detail.pid', String(entry.pid)],
        ['services.detail.tree', entry.processCount > 1 ? t('services.tree', { count: entry.processCount, names }) : null],
      ]}
    />
  )
}

function appName(unit: string): string {
  return unit.replace(/^solera-app-/, '').replace(/\.service$/, '')
}

/** Les cœurs de la machine, pour rapporter la charge d'une ligne à la jauge du haut. */
const Cores = createContext(1)

/**
 * La charge d'une ligne, rapportée à toute la machine comme la jauge du haut : « 180 % »
 * d'un cœur ne se compare à rien, « 23 % » des huit se lit à côté des 46 % du total.
 * Sous 1 %, elle se tait.
 */
function cpuText(cpu: number | null, cores: number): string | null {
  const share = cpu === null ? 0 : cpu / cores
  return share >= 0.01 ? `CPU ${Math.round(share * 100)} %` : null
}

/** Pastille et libellé de l'état systemd ; un état inconnu se montre tel quel. */
const APP_STATES: Record<string, { key: MessageKey; dot: string }> = {
  active: { key: 'services.app.state.active', dot: 'bg-positive' },
  activating: { key: 'services.app.state.activating', dot: 'bg-caution' },
  deactivating: { key: 'services.app.state.deactivating', dot: 'bg-caution' },
  reloading: { key: 'services.app.state.reloading', dot: 'bg-caution' },
  failed: { key: 'services.app.state.failed', dot: 'bg-critical' },
  inactive: { key: 'services.app.state.inactive', dot: 'bg-ink-faint' },
}

function AppRow({ app, scannedAt, busy, onAction }: {
  app: ServiceAppDto
  scannedAt: number
  busy: boolean
  onAction: (action: ServiceAppAction) => void
}) {
  const t = useTranslate()
  const cores = useContext(Cores)
  const duration = useDuration(scannedAt)
  const state = APP_STATES[app.state]
  const name = appName(app.unit)
  const manageable = app.canStop || app.canRestart || app.canReset
  return (
    <Row
      dot={state?.dot}
      name={<span className="font-sans font-medium">{name}</span>}
      fullName={app.unit}
      ports={app.ports}
      meta={[
        <span className={cx(app.state === 'failed' && 'text-critical')}>{state ? t(state.key, { result: app.result }) : app.state}</span>,
        <Attribution entry={app} />,
        app.startedAt !== null ? <span title={new Date(app.startedAt).toLocaleString()}>{duration(app.startedAt)}</span> : null,
        cpuText(app.cpu, cores),
        app.memoryBytes !== null ? formatBytes(app.memoryBytes) : null,
        app.enabled ? <span title={t('services.app.enabledHint', { unit: app.unit })}>{t('services.app.enabled')}</span> : null,
      ]}
      actions={
        <>
          {app.canReset ? <Button variant="ghost" size="sm" icon={<X size={13} />} title={t('services.app.resetHint')} aria-label={t('services.app.reset')} disabled={busy} onClick={() => onAction('reset')}><Label>{t('services.app.reset')}</Label></Button> : null}
          {app.canRestart ? (
            <Button variant="ghost" size="sm" icon={app.state === 'inactive' ? <Play size={13} /> : <RotateCw size={13} />} aria-label={t(app.state === 'inactive' ? 'services.app.start' : 'services.app.restart')} disabled={busy} onClick={() => onAction('restart')}>
              <Label>{t(app.state === 'inactive' ? 'services.app.start' : 'services.app.restart')}</Label>
            </Button>
          ) : null}
          {app.canStop ? <Button variant="ghost" size="sm" icon={<Square size={13} />} aria-label={t('services.app.stop')} disabled={busy} onClick={() => onAction('stop')}><Label>{t('services.app.stop')}</Label></Button> : null}
          {!manageable ? <span className="text-xs text-ink-faint" title={t('services.app.readOnlyHint')}>{t('services.readOnly')}</span> : null}
        </>
      }
      details={[
        ['services.detail.command', app.command],
        ['services.detail.description', app.description],
        ['services.detail.cwd', app.cwd],
        ['services.detail.lifetime', !app.enabled && app.transient ? t('services.app.transient') : null],
        ['services.detail.logs', `journalctl --user -u ${app.unit}`],
      ]}
    />
  )
}
