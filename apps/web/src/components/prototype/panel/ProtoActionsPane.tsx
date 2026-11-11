/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'onglet Actions du panneau, aligné sur l'onglet Actions du projet : le **Lanceur
 * compact**. Rangé par nature (Services, Commandes, Agents), un geste par ligne —
 * l'interrupteur d'un service, « Lancer » d'une commande ou d'un agent, « Relire » d'une
 * action proposée — et une seule ligne d'outils : la recherche quand il y en a beaucoup,
 * « + Nouvelle ▾ » et « Tout voir ».
 *
 * **On reste dans la session, et dans le panneau** : un clic sur une action, « Relire »
 * et « + Nouvelle » ouvrent l'action **à la place de la liste**, dans le panneau même
 * (`ActionDrawer` en `inline`), avec « ‹ Actions » pour remonter — une navigation en
 * pile. Un tiroir posé à côté du panneau en ouvrait deux (Tim, 2026-11-11). Panneau trop
 * étroit pour éditer : « Agrandir le panneau » le passe en plein écran.
 *
 * **On ne quitte plus la session pour « tout voir »** (Tim, 2026-11-11) : l'onglet montre
 * **toutes** les actions, avec Affichage ▾ — *Lanceur* (défaut), *Liste* (par état),
 * *Agenda* (en liste par jour quand le panneau est étroit) —, et le groupe « Lancés par
 * les sessions » : ce que les sessions ont laissé tourner en fond. L'onglet du projet est
 * un bouton ↗ au bout de la ligne : un menu ⋯ qui ne portait que lui était un détour, et
 * « Agrandir » doublait le bouton du panneau (Tim, 2026-11-11).
 *
 * Données : celles de l'onglet (`useAutomations`, démo comprise). Aucune écriture :
 * chaque geste dit « Simulé ». Depuis une conversation, « Lancer » partirait dans son
 * worktree, comme le vrai lanceur.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AlarmClock, ArrowUpRight, Bot, CalendarDays, LayoutGrid, List, Maximize2, Play, Plus, Server, ShieldQuestion, SquareTerminal } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Popover, cx } from '@solera/ui'
import { useAutomations, type Automation } from '../../../routes/prototype-automations/model'
import { ActionDrawer, newActionPanel, type ActionPanel, type NewActionKind } from '../../../routes/prototype-automations/ActionDrawer'
import { MenuHeading, MenuSegment, ToolbarSearch, ViewTiles, toolbarButtonClass, useView, type ViewOption } from '../ViewSwitch'
import type { BackgroundWork } from '../../../lib/background'
import { ActionsAgenda, type ActionsAgendaMode } from '../../../routes/prototype-automations/ActionsAgenda'
import { SessionWorksSection, useSessionWorks } from '../../../routes/prototype-automations/SessionWorks'
import { ReviewButton, ServiceSwitch, StateIcon, actionState } from '../../../routes/prototype-automations/LaunchButton'
import { onActionEdit, takeActionEdit } from './actionBridge'
import { CommandRunDetail, CommandRunsGroup, useCommandRuns } from './CommandRuns'
import { ActionsStatusMeta, scrollToAnchor, useActionsCount } from '../actionsCount'
import { SUGGESTIONS } from '../../../routes/prototype-actions/data'

type PaneView = 'lanceur' | 'liste' | 'agenda'
const PANE_VIEWS: ViewOption<PaneView>[] = [
  { key: 'lanceur', label: 'Lanceur', icon: <LayoutGrid size={14} /> },
  { key: 'liste', label: 'Liste', icon: <List size={14} /> },
  { key: 'agenda', label: 'Agenda', icon: <CalendarDays size={14} /> },
]

/** Le tri du jeu de démo montré dans le panneau (libellés du jeu de l'onglet). */
const PANEL_DEMO = new Set([
  'Serveur de dev',
  'Catalogue',
  'Tests unitaires',
  'Lint',
  'Typecheck du web',
  'Purger les journaux de plus de 30 jours',
  'Revue nocturne des dépendances',
  'Rapport hebdo',
  'Suite UI du tableau',
])

/** En dessous, l'éditeur (cartes, phrase de planification, mini-calendrier) est à l'étroit. */
const MIN_EDIT_WIDTH = 360

export function ProtoActionsPane({ projectId, conversationId, background = [], onExpand }: {
  projectId: string
  conversationId?: string
  /** Les travaux de fond de la conversation ouverte, que la page connaît en détail. */
  background?: BackgroundWork[]
  /** Passe le panneau en plein écran ; absent quand il couvre déjà l'écran. */
  onExpand?: () => void
}) {
  const allData = useAutomations(projectId)
  const allWorks = useSessionWorks(projectId, conversationId ? { conversationId, background } : undefined)
  /*
    La démo du panneau : un projet qui a déjà ses actions — deux services (dont un en
    marche), trois commandes (réussie, en échec, jamais lancée) et une planifiée chaque
    nuit, deux tâches d'agent planifiées, une action à relire, et deux processus de
    sessions dont un d'une autre session. Un tri dans le jeu de démo de l'onglet, pour que
    la colonne étroite reste lisible.
  */
  const data = allData.demo ? { ...allData, items: allData.items.filter((item) => PANEL_DEMO.has(item.label)).map(withDemoRun) } : allData
  const sessionWorks = allWorks.demo ? { ...allWorks, works: allWorks.works.slice(0, 2) } : allWorks
  const [view, setView] = useView<PaneView>('panneau-actions', projectId, ['lanceur', 'liste', 'agenda'])
  const [agendaMode, setAgendaMode] = useState<ActionsAgendaMode>('jour')
  const [displayOpen, setDisplayOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<ActionPanel | null>(null)
  // Les commandes lancées ici (terminaux du panneau) et celle dont on lit le détail.
  const runs = useCommandRuns(projectId, conversationId)
  const statusCount = useActionsCount(projectId)
  const [runOpen, setRunOpen] = useState<string | null>(null)
  const openRun = runs.find((run) => run.id === runOpen) ?? null
  const root = useRef<HTMLDivElement>(null)
  const width = useWidth(root)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const demo = params.get('demo') === '1'
  const tab = (extra = '') => `/p/${projectId}/actions${demo || extra ? '?' : ''}${[demo ? 'demo=1' : '', extra].filter(Boolean).join('&')}`
  const where = conversationId ? 'dans le worktree de cette conversation' : 'à la racine du projet'
  const simulate = (text: string) => setNotice(`Simulé : ${text}.`)

  const needle = query.trim().toLocaleLowerCase()
  const items = data.items.filter((item) => !needle || `${item.label} ${item.command ?? ''} ${item.prompt ?? ''}`.toLocaleLowerCase().includes(needle))
  const services = items.filter((item) => item.what === 'command' && item.commandKind === 'service')
  const commands = items.filter((item) => item.what === 'command' && item.commandKind !== 'service')
  const agents = items.filter((item) => item.what === 'agent')
  // Une commande qui tourne dans un terminal est déjà dans « En cours » (les commandes
  // lancées ici) : la liste par état ne la redit pas.
  const live = items.filter((item) => item.live && item.live.kind !== 'terminal')
  const toReview = items.filter((item) => !item.live && item.review)
  const planned = items.filter((item) => !item.live && !item.review && item.schedule)
  const onDemand = items.filter((item) => !item.live && !item.review && !item.schedule)
  const works = sessionWorks.works.filter((work) => !needle || `${work.label} ${work.command ?? ''} ${work.conversationTitle}`.toLocaleLowerCase().includes(needle))
  const rowOf = (item: Automation) =>
    item.what === 'agent' ? <AgentRow key={item.id} item={item} onOpen={openAction} simulate={simulate} />
      : item.commandKind === 'service' ? <ServiceRow key={item.id} item={item} onOpen={openAction} simulate={simulate} where={where} />
        : <CommandRow key={item.id} item={item} onOpen={openAction} simulate={simulate} where={where} />
  const worksGroup = (
    <SessionWorksSection
      projectId={projectId}
      works={works}
      compact
      currentConversationId={conversationId}
      onMakeAction={(seed) => setPanel({ mode: 'edit', seed, back: null })}
      simulate={simulate}
    />
  )
  const runsGroup = <CommandRunsGroup runs={runs} onOpen={(run) => setRunOpen(run.id)} simulate={simulate} />
  const currentView = PANE_VIEWS.find((option) => option.key === view)!

  const NEW: { label: string; kind: NewActionKind }[] = [
    { label: 'Nouvelle commande', kind: 'commande' },
    { label: 'Nouveau service', kind: 'service' },
    { label: 'Nouvelle tâche d’agent', kind: 'agent' },
    { label: 'Planifier une action…', kind: 'planifier' },
  ]
  const openAction = (item: Automation, review = false) => setPanel({ mode: 'detail', id: item.id, review })
  // « En faire une action » depuis l'onglet Agent : l'éditeur s'ouvre ici, pré-rempli.
  useEffect(() => {
    const take = () => {
      const seed = takeActionEdit()
      if (seed) setPanel({ mode: 'edit', seed, back: null })
    }
    take()
    return onActionEdit(take)
  }, [])

  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {notice ? (
        <p role="status" className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-high/50 px-3 py-2 text-xs text-ink-soft">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-ink-faint hover:text-ink">✕</button>
        </p>
      ) : null}

      {openRun ? (
        <CommandRunDetail projectId={projectId} conversationId={conversationId} run={openRun} onBack={() => setRunOpen(null)} simulate={simulate} />
      ) : panel !== null ? (
        <>
          {panel.mode !== 'detail' && onExpand && width > 0 && width < MIN_EDIT_WIDTH ? (
            <p className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-xs text-ink-soft">
              <span className="min-w-0 flex-1">Le panneau est étroit pour éditer.</span>
              <button type="button" onClick={onExpand} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2 text-xs text-ink hover:bg-surface-high">
                <Maximize2 size={12} /> Agrandir le panneau
              </button>
            </p>
          ) : null}
          <ActionDrawer
            projectId={projectId}
            items={data.items}
            panel={panel}
            onPanel={setPanel}
            onClose={() => setPanel(null)}
            simulate={simulate}
            launchWhere={where}
            inline
          />
        </>
      ) : (
      <>
      {/* Une ligne : le titre et son compte à gauche, puis Affichage, « + Nouvelle » et
          l'onglet du projet. La recherche ne vient qu'au-delà de huit actions. */}
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <span className="shrink-0 text-sm font-medium text-ink">Actions</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">{data.items.length}</span>
        {/* PROTOTYPE : ce que disait le ⚡ retiré — « N en marche », « N à relire » ; un clic
            passe en Liste et descend jusqu'au groupe. */}
        <ActionsStatusMeta
          count={statusCount}
          onRunning={() => { setView('liste'); window.setTimeout(() => scrollToAnchor('pane-actions-running'), 60) }}
          onReview={() => { setView('liste'); window.setTimeout(() => scrollToAnchor('pane-actions-review'), 60) }}
        />
        <span className="min-w-0 flex-1" />
        {data.items.length > 8 ? <ToolbarSearch value={query} onChange={setQuery} placeholder="Chercher" /> : null}
        <Popover
          open={displayOpen}
          onOpenChange={setDisplayOpen}
          label="Affichage"
          side="bottom"
          align="end"
          className="w-64"
          trigger={
            <button type="button" className={toolbarButtonClass(false)} title={`Affichage : ${currentView.label}`} aria-label={`Affichage : ${currentView.label}`}>
              {currentView.icon}
            </button>
          }
        >
          <div className="pb-3">
            <ViewTiles options={PANE_VIEWS} value={view} onChange={(next) => { setView(next); setDisplayOpen(false) }} />
            {view === 'agenda' ? (
              <>
                <MenuHeading>Période</MenuHeading>
                <MenuSegment<ActionsAgendaMode> options={[{ key: 'jour', label: 'Jour' }, { key: 'semaine', label: 'Semaine' }]} value={agendaMode} onChange={setAgendaMode} />
              </>
            ) : (
              <p className="px-3 pt-1 text-xs text-ink-faint">{view === 'lanceur' ? 'Par nature : services, commandes, agents.' : 'Par état : en cours, à relire, planifiées, à la demande.'}</p>
            )}
          </div>
        </Popover>
        <Popover
          open={adding}
          onOpenChange={setAdding}
          label="Nouvelle action"
          side="bottom"
          align="end"
          className="w-60 p-1"
          trigger={
            <button type="button" className={toolbarButtonClass(false)}>
              <Plus size={14} /> Nouvelle <span aria-hidden className="text-ink-faint">▾</span>
            </button>
          }
        >
          {NEW.map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={() => {
                setAdding(false)
                setPanel(newActionPanel(entry.kind))
              }}
              className="flex w-full rounded-md px-2.5 py-2 text-left text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
            >
              {entry.label}
            </button>
          ))}
        </Popover>
        {/* Démo : un projet qui aurait déjà ses actions. Bascule `?demo=1` dans l'adresse
            de la conversation, comme sur les pages du projet. */}
        <button
          type="button"
          aria-pressed={demo}
          title={demo ? 'Revenir aux vraies données' : 'Voir avec des actions de démo'}
          onClick={() =>
            setParams((current) => {
              const next = new URLSearchParams(current)
              if (demo) next.delete('demo')
              else next.set('demo', '1')
              return next
            }, { replace: true })
          }
          className={cx(
            'inline-flex h-11 shrink-0 items-center rounded-md border border-dashed px-2 text-[11px] transition-colors md:h-9 pointer-coarse:h-11',
            demo ? 'border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300' : 'border-fuchsia-500/40 text-fuchsia-700/70 hover:border-fuchsia-500 dark:text-fuchsia-300/70',
          )}
        >
          Démo
        </button>
        <Link to={tab()} className={toolbarButtonClass(false)} title="Ouvrir dans l'onglet Actions du projet" aria-label="Ouvrir dans l'onglet Actions du projet">
          <ArrowUpRight size={14} />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {data.items.length === 0 && !data.isPending ? (
          /* Court, et un pas plus loin : ce que le dépôt propose, à un clic de l'éditeur
             pré-rempli. Les mêmes suggestions que dans l'éditeur. */
          <section className="flex flex-col gap-2 px-3 pt-3 pb-2">
            <p className="text-sm text-ink-soft">Aucune action enregistrée.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.slice(0, 3).map((suggestion) => (
                <button
                  key={suggestion.command}
                  type="button"
                  title={`${suggestion.source} — ${suggestion.why}`}
                  onClick={() =>
                    setPanel({
                      mode: 'edit',
                      back: null,
                      seed: {
                        preset: { what: 'command', kind: suggestion.kind },
                        prefill: { label: suggestion.label, command: suggestion.command, url: suggestion.url ?? '' },
                      },
                    })
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                >
                  <Plus size={12} className="text-ink-faint" />
                  {suggestion.label}
                  <code className="font-mono text-[11px] text-ink-faint">{suggestion.command}</code>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {view === 'agenda' ? (
          <div className="p-3">
            <ActionsAgenda items={items} mode={agendaMode} onMode={setAgendaMode} onOpen={(item) => openAction(item)} />
          </div>
        ) : view === 'liste' ? (
          <>
            <div id="pane-actions-running" className="scroll-mt-2">
              {runsGroup}
              <Group icon={<Play size={14} />} title="Services en marche" items={live}>{rowOf}</Group>
              {worksGroup}
            </div>
            <div id="pane-actions-review" className="scroll-mt-2">
              <Group icon={<ShieldQuestion size={14} />} title="À relire" items={toReview}>{rowOf}</Group>
            </div>
            <Group icon={<AlarmClock size={14} />} title="Planifiées" items={planned}>{rowOf}</Group>
            <Group icon={<Plus size={14} />} title="À la demande" items={onDemand}>{rowOf}</Group>
          </>
        ) : (
          <>
            {runsGroup}
            {worksGroup}
            <Group icon={<Server size={14} />} title="Services" items={services}>
              {(item) => <ServiceRow key={item.id} item={item} onOpen={openAction} simulate={simulate} where={where} />}
            </Group>
            <Group icon={<SquareTerminal size={14} />} title="Commandes" items={commands}>
              {(item) => <CommandRow key={item.id} item={item} onOpen={openAction} simulate={simulate} where={where} />}
            </Group>
            <Group icon={<Bot size={14} />} title="Agents" items={agents}>
              {(item) => <AgentRow key={item.id} item={item} onOpen={openAction} simulate={simulate} />}
            </Group>
          </>
        )}
      </div>
      </>
      )}
    </div>
  )
}

function Group({ title, items, children }: { icon?: ReactNode; title: string; items: Automation[]; children: (item: Automation) => ReactNode }) {
  if (items.length === 0) return null
  return (
    <section className="pt-1.5 pb-1">
      <h3 className="px-3 pt-1.5 pb-1 text-meta font-medium tracking-wide text-ink-faint uppercase">
        {title} <span className="tabular-nums">{items.length}</span>
      </h3>
      <ul className="flex flex-col">{items.map(children)}</ul>
    </section>
  )
}

/**
 * Une ligne du lanceur compact, ≈36 px, la même forme que celles de l'onglet Agent :
 * l'icône de nature avec son point d'état, le libellé, l'état en gris, et le geste
 * principal en petit à droite. La ligne entière ouvre le détail, en pile.
 */
function Row({ item, onOpen, children }: { item: Automation; onOpen: () => void; children: ReactNode }) {
  const state = actionState(item)
  return (
    <li
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a, button, [role="switch"], [role="menu"]')) return
        onOpen()
      }}
      className="flex min-h-9 cursor-pointer items-center gap-2.5 px-3 transition-colors hover:bg-surface-high/50"
    >
      <StateIcon item={item} tone={state.tone} size="sm" />
      <button type="button" onClick={onOpen} title={state.text} className="flex min-w-0 flex-1 items-baseline gap-2 text-left outline-none focus-visible:underline">
        <span className="truncate text-sm text-ink">{item.label}</span>
        <span className={cx('min-w-0 truncate text-xs', state.tone === 'review' ? 'text-caution' : state.tone === 'fail' ? 'text-critical' : 'text-ink-faint')}>{state.text}</span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5">{children}</span>
    </li>
  )
}

function ServiceRow({ item, onOpen, simulate, where }: { item: Automation; onOpen: (item: Automation, review?: boolean) => void; simulate: (text: string) => void; where: string }) {
  if (item.review) return <Row item={item} onOpen={() => onOpen(item, true)}><ReviewButton size="row" onReview={() => onOpen(item, true)} /></Row>
  const on = item.live?.kind === 'service'
  return (
    <Row item={item} onOpen={() => onOpen(item)}>
      {on && item.live?.href ? (
        <a href={item.live.href} target="_blank" rel="noreferrer" title="Ouvrir" aria-label={`Ouvrir « ${item.label} »`} className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink">
          <ArrowUpRight size={13} />
        </a>
      ) : null}
      <ServiceSwitch
        on={on}
        withText={false}
        label={on ? `Arrêter « ${item.label} »` : `Démarrer « ${item.label} » ${where}`}
        onToggle={() => simulate(on ? `arrêter « ${item.label} »` : `démarrer « ${item.label} » ${where}`)}
      />
    </Row>
  )
}

/** ▷ : lancer ici, en petit. Dans une conversation, ici = son worktree. */
function LaunchHere({ label, onLaunch }: { label: string; onLaunch: () => void }) {
  return (
    <button type="button" onClick={onLaunch} title={label} aria-label={label} className="grid size-8 place-items-center rounded-md text-ink-soft hover:bg-surface-high hover:text-ink">
      <Play size={13} />
    </button>
  )
}

function CommandRow({ item, onOpen, simulate, where }: { item: Automation; onOpen: (item: Automation, review?: boolean) => void; simulate: (text: string) => void; where: string }) {
  if (item.review) return <Row item={item} onOpen={() => onOpen(item, true)}><ReviewButton size="row" onReview={() => onOpen(item, true)} /></Row>
  const running = item.live?.kind === 'terminal'
  return (
    <Row item={item} onOpen={() => onOpen(item)}>
      {running ? (
        <button type="button" title="Son terminal" aria-label="Ouvrir son terminal" onClick={() => simulate('ouvrir son terminal dans l’onglet Terminaux')} className="grid size-8 place-items-center rounded-md text-ink-soft hover:bg-surface-high hover:text-ink">
          <SquareTerminal size={13} />
        </button>
      ) : (
        <LaunchHere label={`Lancer ${where}`} onLaunch={() => simulate(`lancer « ${item.label} » ${where}`)} />
      )}
    </Row>
  )
}

function AgentRow({ item, onOpen, simulate }: { item: Automation; onOpen: (item: Automation, review?: boolean) => void; simulate: (text: string) => void }) {
  if (item.review) return <Row item={item} onOpen={() => onOpen(item, true)}><ReviewButton size="row" onReview={() => onOpen(item, true)} /></Row>
  const running = item.live?.kind === 'session'
  return (
    <Row item={item} onOpen={() => onOpen(item)}>
      {running && item.live?.href ? (
        <Link to={item.live.href} title="Sa session" aria-label="Ouvrir sa session" className="grid size-8 place-items-center rounded-md text-ink-soft hover:bg-surface-high hover:text-ink">
          <ArrowUpRight size={13} />
        </Link>
      ) : (
        <LaunchHere label="Lancer dans une nouvelle session" onLaunch={() => simulate(`lancer « ${item.label} » dans une nouvelle session`)} />
      )}
    </Row>
  )
}

/** La largeur du panneau, pour proposer de l'agrandir quand l'éditeur y est à l'étroit. */
function useWidth(root: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(Math.round(element.getBoundingClientRect().width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])
  return width
}

/**
 * La démo du panneau, accordée aux commandes qu'on voit tourner en tête : le lint est
 * relancé et tourne, les tests viennent d'échouer, le typecheck a réussi.
 */
function withDemoRun(item: Automation): Automation {
  const now = Date.now()
  if (item.label === 'Lint') return { ...item, live: { kind: 'terminal', text: 'en cours · eslint', href: null } }
  if (item.label === 'Tests unitaires') {
    return { ...item, failStreak: 1, runs: [{ id: 'demo-tests-last', status: 'failed', startedAt: now - 3 * 60_000 - 18_000, finishedAt: now - 3 * 60_000, exitCode: 1 }, ...item.runs] }
  }
  if (item.label === 'Typecheck du web') {
    return { ...item, runs: [{ id: 'demo-tc-last', status: 'succeeded', startedAt: now - 12 * 60_000 - 9_000, finishedAt: now - 12 * 60_000, exitCode: 0 }, ...item.runs] }
  }
  return item
}
