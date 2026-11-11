/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les actions hors des Réglages : une action est un outil qu'on utilise, pas un réglage.
 * Un seul foyer, le lanceur ⚡ de la bande, présent sur toutes les pages du projet :
 * - le popover montre **toutes** les actions : ce qui tourne d'abord, puis ce qui est à
 *   relire, puis les services et les tâches, chacune lancée d'un clic, à la racine ou
 *   dans un worktree ;
 * - « Tout voir » mène à l'onglet Actions, qui porte le détail, l'éditeur et les
 *   tâches planifiées : le tiroir « Gérer les actions » qui le doublait a disparu.
 * Raccourci : `A` hors d'un champ. Données réelles ou `?demo=1`. Rien n'est lancé.
 */
import { ArrowUpRight, ChevronRight, Play, Plus, RotateCw, Search, ShieldQuestion, Square, SquareTerminal, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ProjectActionDto } from '@solera/protocol'
import { IconButton, Popover, TooltipButton, cx } from '@solera/ui'
import { actionView, useActions } from '../../lib/actions'
import { useWorktrees } from '../../lib/worktrees'
import { demoActions, stateOf, type Tone } from '../../routes/prototype-actions/data'

const DOT: Record<Tone, string> = {
  positive: 'bg-positive',
  critical: 'bg-critical',
  caution: 'bg-caution',
  neutral: 'bg-line-strong',
}

/** Au-delà, la liste se cherche plutôt qu'elle ne se parcourt. */
const SEARCH_FROM = 8

export function ActionsHub({ projectId }: { projectId: string }) {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data } = useActions()
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const actions = useMemo(
    () => (demo ? demoActions(projectId) : (data ?? []).filter((action) => action.projectId === projectId)),
    [demo, data, projectId],
  )
  const running = actions.filter((action) => action.kind === 'service' && actionView(action).live).length
  const proposed = actions.some((action) => action.status === 'proposed')

  // `A` ouvre le hub, hors d'un champ de saisie : le geste de qui lance la même chose
  // vingt fois par jour.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'a' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const stub = (text: string) => {
    setNotice(`Simulé : ${text}`)
    window.setTimeout(() => setNotice(null), 3000)
  }

  const needle = query.trim().toLocaleLowerCase()
  const shown = needle
    ? actions.filter((action) => `${action.label} ${action.command} ${action.description ?? ''}`.toLocaleLowerCase().includes(needle))
    : actions
  const live = shown.filter((action) => action.status !== 'proposed' && actionView(action).live)
  const review = shown.filter((action) => action.status === 'proposed')
  const idle = shown.filter((action) => action.status !== 'proposed' && !actionView(action).live)
  const services = idle.filter((action) => action.kind === 'service')
  const tasks = idle.filter((action) => action.kind === 'task')

  const label = running > 0 ? `Actions — ${running} service${running > 1 ? 's' : ''} en marche` : 'Actions'

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label="Actions du projet"
        side="bottom"
        align="end"
        className="w-[min(26rem,calc(100vw-1.5rem))] p-0"
        trigger={
          <TooltipButton
            type="button"
            aria-label={label}
            title={`${label} (A)`}
            className={cx(
              'relative inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-ink-faint transition-colors hover:bg-surface-high hover:text-ink md:h-7 md:min-w-7',
              open && 'text-accent',
            )}
          >
            <Zap size={16} className={cx(running > 0 && 'text-positive')} />
            {running > 0 ? <span className="text-xs font-semibold tabular-nums text-positive">{running}</span> : null}
            {proposed ? <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-caution md:top-0.5 md:right-0.5" /> : null}
          </TooltipButton>
        }
      >
        <div className="flex max-h-[min(34rem,calc(100vh-8rem))] flex-col">
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-sm font-medium">Actions</span>
            <span className="text-xs text-ink-faint tabular-nums">{actions.length}</span>
            {demo ? <span className="text-meta text-fuchsia-600 dark:text-fuchsia-300">démo</span> : null}
            <kbd className="ml-auto rounded border border-line px-1 font-mono text-meta text-ink-faint">A</kbd>
            {/* L'ajout mène à l'onglet, éditeur ouvert : c'est là que vivent les suggestions
                du dépôt, l'arborescence, « Essayer » et la planification. */}
            <button
              type="button"
              aria-expanded={adding}
              onClick={() => setAdding((value) => !value)}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2 text-xs font-medium text-accent-ink hover:opacity-90"
            >
              <Plus size={13} /> Nouvelle action
            </button>
          </header>
          {/* Les mêmes entrées que « + Action » de l'onglet : la nature d'abord, ou planifier
              une action qui existe. Chacune mène à l'onglet, l'éditeur ouvert. */}
          {adding ? (
            <nav aria-label="Nouvelle action" className="grid grid-cols-2 gap-1 border-b border-line p-1.5">
              {[
                { key: 'commande', label: 'Commande' },
                { key: 'service', label: 'Service' },
                { key: 'agent', label: 'Tâche d’agent' },
                { key: 'planifier', label: 'Planifier une action…' },
              ].map((entry) => (
                <Link
                  key={entry.key}
                  to={`/p/${projectId}/actions?nouvelle=${entry.key}${demo ? '&demo=1' : ''}`}
                  onClick={() => { setAdding(false); setOpen(false) }}
                  className="rounded-md px-2 py-1.5 text-xs text-ink-soft hover:bg-surface-high hover:text-ink"
                >
                  {entry.label}
                </Link>
              ))}
            </nav>
          ) : null}

          {actions.length > SEARCH_FROM ? (
            <label className="flex items-center gap-2 border-b border-line px-3 py-1.5">
              <Search size={13} className="shrink-0 text-ink-faint" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Chercher une action…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
              />
            </label>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {actions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-faint">
                Aucune action. « Nouvelle action » ci-dessus, ou demande à un agent « ajoute un bouton pour lancer le serveur ».
              </p>
            ) : shown.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-faint">Rien ne correspond.</p>
            ) : (
              <>
                <Group title="En marche" items={live} projectId={projectId} stub={stub} />
                <Group title="À relire" tone="caution" items={review} projectId={projectId} stub={stub} />
                <Group title="Services" items={services} projectId={projectId} stub={stub} />
                <Group title="Tâches" items={tasks} projectId={projectId} stub={stub} />
              </>
            )}
          </div>

          {notice ? <p role="status" className="border-t border-line px-3 py-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">{notice}</p> : null}

          <footer className="border-t border-line p-1">
            <Link
              to={`/p/${projectId}/actions${demo ? '?demo=1' : ''}`}
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
            >
              <ArrowUpRight size={14} />
              Tout voir
              <span className="ml-auto text-xs text-ink-faint">détail, planifiées, agenda</span>
            </Link>
          </footer>
        </div>
      </Popover>

    </>
  )
}

function Group({
  title,
  tone,
  items,
  projectId,
  stub,
}: {
  title: string
  tone?: 'caution'
  items: ProjectActionDto[]
  projectId: string
  stub: (text: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section className="py-1">
      <h3 className={cx('px-3 pt-1 pb-0.5 text-meta font-medium tracking-wide uppercase', tone === 'caution' ? 'text-caution' : 'text-ink-faint')}>
        {title}
      </h3>
      <ul>
        {items.map((action) => (
          <HubRow key={action.id} action={action} projectId={projectId} stub={stub} />
        ))}
      </ul>
    </section>
  )
}

function HubRow({ action, projectId, stub }: { action: ProjectActionDto; projectId: string; stub: (text: string) => void }) {
  const state = stateOf(action)
  const view = actionView(action)
  const [where, setWhere] = useState(false)
  const { data: trees } = useWorktrees(projectId)
  const proposed = action.status === 'proposed'
  const service = action.kind === 'service'

  return (
    <li className="group px-1">
      <div className="flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-surface-high/60">
        <span aria-hidden className={cx('size-2 shrink-0 rounded-full', DOT[state.tone], state.live && 'animate-pulse')} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{action.label}</span>
          <span className="truncate text-xs text-ink-faint">
            {proposed ? `proposée dans « ${action.agentConversationTitle ?? 'une session supprimée'} »` : state.text}
          </span>
        </span>

        {proposed ? (
          <HubButton icon={<ShieldQuestion size={13} />} label="Relire" tone="caution" onClick={() => stub(`relire la commande de « ${action.label} »`)} />
        ) : view.live && service ? (
          <>
            {view.href ? (
              <a href={view.href} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-xs text-accent hover:bg-accent/10">
                Ouvrir <ArrowUpRight size={12} />
              </a>
            ) : null}
            <IconButton label="Relancer (simulé)" size="sm" onClick={() => stub(`relancer « ${action.label} »`)}>
              <RotateCw size={13} />
            </IconButton>
            <IconButton label="Arrêter (simulé)" size="sm" onClick={() => stub(`arrêter « ${action.label} »`)}>
              <Square size={13} />
            </IconButton>
          </>
        ) : view.live ? (
          <HubButton icon={<SquareTerminal size={13} />} label="Terminal" onClick={() => stub(`ouvrir le terminal de « ${action.label} » dans le panneau`)} />
        ) : (
          <span className="flex items-center">
            <HubButton icon={<Play size={13} />} label="Lancer" onClick={() => stub(`lancer « ${action.label} » à la racine du projet`)} />
            <IconButton label="Lancer dans…" size="sm" onClick={() => setWhere((value) => !value)}>
              <ChevronRight size={13} className={cx('transition-transform', where && 'rotate-90')} />
            </IconButton>
          </span>
        )}
      </div>

      {where ? (
        <div className="mb-1 ml-6 flex flex-col border-l border-line pl-2">
          <span className="px-2 pt-1 text-meta text-ink-faint">Lancer dans</span>
          <WhereButton label="La racine du projet" onClick={() => { setWhere(false); stub(`lancer « ${action.label} » à la racine du projet`) }} />
          {(trees ?? []).slice(0, 6).map((tree) => (
            <WhereButton key={tree.id} label={tree.git?.branch ?? tree.name} mono onClick={() => { setWhere(false); stub(`lancer « ${action.label} » dans ${tree.git?.branch ?? tree.name}`) }} />
          ))}
        </div>
      ) : null}
    </li>
  )
}

function HubButton({ icon, label, onClick, tone }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: 'caution' }) {
  return (
    <button
      type="button"
      title={`${label} (simulé)`}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors',
        tone === 'caution' ? 'text-caution hover:bg-caution/10' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function WhereButton({ label, mono, onClick }: { label: string; mono?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx('truncate rounded px-2 py-1 text-left text-xs text-ink-soft hover:bg-surface-high hover:text-ink', mono && 'font-mono')}>
      {label}
    </button>
  )
}
