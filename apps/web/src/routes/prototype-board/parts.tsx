/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { AlarmClock, CircleHelp, Inbox, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'
import { Button, cx } from '@solera/ui'
import { PageToolbar } from '../../components/prototype/ViewSwitch'
import { AgentIcon } from '../../components/AgentIcon'
import { relativeDate } from '../../lib/dates'
import { DemoToggle } from '../prototype-milestones/HorizonVariant'
import { liveSessions } from '../prototype-milestones/model'
import { shortTitle, type BoardCard, type BoardData, type BoardMilestone, type MilestoneFilter } from './data'

/** Le type MIME du glissement d'une tuile : son id. */
export const DRAG_TYPE = 'application/x-proto-card'

export function startDrag(event: DragEvent, cardId: string) {
  event.dataTransfer.setData(DRAG_TYPE, cardId)
  event.dataTransfer.effectAllowed = 'move'
}

/** L'étiquette d'un jalon : un point de sa teinte et son titre court. */
export function MilestoneTag({ milestone, className }: { milestone: BoardMilestone; className?: string }) {
  // Court : le numéro et le début du titre ; le titre entier en infobulle.
  return (
    <span title={`Jalon #${milestone.card.number} — ${milestone.card.title}`} className={cx('inline-flex min-w-0 items-center gap-1.5 self-start rounded px-1.5 py-px text-[11px]', milestone.tint.wash, milestone.tint.text, className)}>
      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', milestone.tint.dot)} />
      <span className="shrink-0 tabular-nums opacity-80">#{milestone.card.number}</span>
      <span className="truncate">{shortTitle(milestone.card.title)}</span>
    </span>
  )
}

/** Barre fine des sous-tâches, avec le compte. */
export function SubtaskBar({ done, total }: { done: number; total: number }) {
  if (total === 0) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-ink-faint">
      <span className="h-1 w-10 overflow-hidden rounded-full bg-surface-high">
        <span className="block h-full rounded-full bg-ink-soft" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      {done}/{total}
    </span>
  )
}

/** Les agents qui tournent sur la carte, l'un en ambre s'il t'attend. */
export function LiveAgents({ entry }: { entry: BoardCard }) {
  const live = liveSessions(entry.card)
  if (live.length === 0) return null
  return (
    <span className="flex items-center -space-x-1">
      {live.slice(0, 3).map((session) => (
        <span
          key={session.id}
          title={session.status === 'awaiting_input' ? `${session.title} : t'attend` : `${session.title} : tourne`}
          className={cx(
            'relative flex size-5 items-center justify-center rounded-full bg-canvas ring-2',
            session.status === 'awaiting_input' ? 'ring-caution' : 'ring-accent/60',
          )}
        >
          <AgentIcon agent={session.agent} size={11} />
          {session.status === 'running' ? (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 size-1.5 animate-pulse rounded-full bg-accent" />
          ) : null}
        </span>
      ))}
    </span>
  )
}

/** Les petits drapeaux qui changent ce qu'on fait d'une carte. */
export function CardFlags({ entry }: { entry: BoardCard }) {
  const { card } = entry
  return (
    <>
      {entry.waiting ? <span className="rounded bg-caution/15 px-1.5 py-px text-[11px] font-medium text-caution">t'attend</span> : null}
      {card.acceptedAt === null ? (
        <span className="inline-flex items-center gap-1 rounded bg-surface-high px-1.5 py-px text-[11px] text-ink-soft">
          <Inbox size={11} /> à accepter
        </span>
      ) : null}
      {card.toClarifySince !== null ? (
        <span className="inline-flex items-center gap-1 rounded bg-surface-high px-1.5 py-px text-[11px] text-ink-soft">
          <CircleHelp size={11} /> à préciser
        </span>
      ) : null}
    </>
  )
}

export function DueLabel({ entry }: { entry: BoardCard }) {
  if (entry.card.dueAt === null) return null
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs', entry.late ? 'font-medium text-critical' : 'text-ink-faint')}>
      <AlarmClock size={11} /> {relativeDate(entry.card.dueAt)}
    </span>
  )
}

/**
 * Une tuile de kanban. Ce qui se lit d'abord : le titre ; puis ce qui demande un geste
 * (t'attend, à accepter, à préciser, en retard) ; le reste en méta discrète.
 */
export function Tile({
  entry,
  onOpen,
  showMilestone = true,
  draggable = true,
}: {
  entry: BoardCard
  onOpen: () => void
  showMilestone?: boolean
  draggable?: boolean
}) {
  const closed = entry.column === 'done' || entry.column === 'abandoned'
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(event) => startDrag(event, entry.card.id)}
      onClick={onOpen}
      className={cx(
        'group flex w-full flex-col gap-2 rounded-lg border bg-canvas p-3 text-left transition-colors',
        'hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
        entry.waiting ? 'border-caution/60 shadow-[inset_3px_0_0_var(--color-caution)]' : 'border-line',
        closed && 'opacity-60',
      )}
    >
      {showMilestone && entry.milestone ? <MilestoneTag milestone={entry.milestone} /> : null}
      <span className="line-clamp-2 text-sm leading-5 text-ink">{entry.card.title}</span>
      <span className="flex flex-wrap items-center gap-1.5 empty:hidden">
        <CardFlags entry={entry} />
      </span>
      <span className="flex items-center gap-2.5">
        <span className="text-xs tabular-nums text-ink-faint">#{entry.card.number}</span>
        <SubtaskBar {...entry.subtasks} />
        <DueLabel entry={entry} />
        <span className="ml-auto flex items-center gap-1.5">
          {entry.moved ? <span className="text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-300">local</span> : null}
          <LiveAgents entry={entry} />
        </span>
      </span>
    </button>
  )
}

/** Les puces de jalon : le filtre qui remplace les cartes-jalons des colonnes. */
export function MilestoneChips({
  data,
  filter,
  onFilter,
}: {
  data: BoardData
  filter: MilestoneFilter
  onFilter: (next: MilestoneFilter) => void
}) {
  const loose = data.cards.filter((entry) => entry.milestone === null && entry.column !== 'done' && entry.column !== 'abandoned').length
  const chip = (active: boolean) =>
    cx(
      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
      active ? 'border-ink-soft bg-surface-high text-ink' : 'border-line text-ink-soft hover:border-line-strong',
    )
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
      <button type="button" className={chip(filter === null)} onClick={() => onFilter(null)}>
        Tout
      </button>
      {data.milestones
        .filter((milestone) => milestone.done < milestone.leaves.length)
        .map((milestone) => (
          <button
            key={milestone.card.id}
            type="button"
            className={chip(filter === milestone.card.id)}
            onClick={() => onFilter(filter === milestone.card.id ? null : milestone.card.id)}
          >
            <span aria-hidden className={cx('size-1.5 rounded-full', milestone.tint.dot)} />
            <span className="max-w-48 truncate">{milestone.card.title}</span>
            <span className="tabular-nums text-ink-faint">
              {milestone.done}/{milestone.leaves.length}
            </span>
          </button>
        ))}
      {loose > 0 ? (
        <button type="button" className={chip(filter === 'none')} onClick={() => onFilter(filter === 'none' ? null : 'none')}>
          Sans jalon <span className="tabular-nums text-ink-faint">{loose}</span>
        </button>
      ) : null}
    </div>
  )
}

/**
 * Ce que les vues du Tableau partagent dans la variante `vues` : la recherche et le
 * filtre de jalon survivent au changement d'affichage, et le sélecteur se pose dans
 * leur barre.
 */
export interface SharedView {
  query: string
  setQuery: (next: string) => void
  filter: MilestoneFilter
  setFilter: (next: MilestoneFilter) => void
  view: ReactNode
}

/** La barre du haut, commune aux variantes : la barre d'outils de page du proto. */
export function Toolbar({
  data,
  query,
  onQuery,
  filter,
  onFilter,
  view,
  children,
}: {
  data: BoardData
  query: string
  onQuery: (next: string) => void
  filter: MilestoneFilter
  onFilter: (next: MilestoneFilter) => void
  /** Le sélecteur d'affichage, quand la page en porte un (variante `vues`). */
  view?: ReactNode
  children?: ReactNode
}) {
  const [notice, setNotice] = useState(false)
  return (
    <>
      <PageToolbar
        left={
          <label className="flex h-8 w-full items-center gap-2 rounded-lg border border-line px-2.5 text-sm focus-within:border-line-strong sm:w-64">
            <Search size={14} className="shrink-0 text-ink-faint" />
            <input
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Chercher, ou #12"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-faint"
            />
            {query ? (
              <button type="button" aria-label="Effacer" onClick={() => onQuery('')} className="text-ink-faint hover:text-ink">
                <X size={13} />
              </button>
            ) : null}
          </label>
        }
        right={
          <>
            {children}
            {data.movedCount > 0 ? (
              <button
                type="button"
                onClick={data.resetMoves}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fuchsia-700 hover:bg-fuchsia-500/10 dark:text-fuchsia-300"
                title="Les glissements du proto ne vont pas au serveur"
              >
                <RotateCcw size={12} /> {data.movedCount} déplacement(s) local(aux)
              </button>
            ) : null}
            <DemoToggle demo={data.proto.demo} />
          </>
        }
        view={view}
        action={
          /* « + Carte » ici, au bout de la barre, et non dans la rangée d'onglets. */
          <Button size="sm" icon={<Plus size={15} />} onClick={() => setNotice(true)}>
            Carte
          </Button>
        }
        below={<MilestoneChips data={data} filter={filter} onFilter={onFilter} />}
      />
      {notice ? (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-dashed border-fuchsia-500/60 px-3 py-2 text-xs text-fuchsia-600 md:mx-6 dark:text-fuchsia-300">
          Simulé : la création passe par le formulaire existant (variante « actuel »).
          <button type="button" className="ml-auto underline" onClick={() => setNotice(false)}>Fermer</button>
        </div>
      ) : null}
    </>
  )
}

/** Un interrupteur discret de la barre. */
export function Toggle({ on, onChange, children }: { on: boolean; onChange: (next: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors',
        on ? 'border-ink-soft bg-surface-high text-ink' : 'border-line text-ink-soft hover:border-line-strong',
      )}
    >
      {children}
    </button>
  )
}
