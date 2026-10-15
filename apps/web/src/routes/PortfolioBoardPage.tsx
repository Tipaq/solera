import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronDown, ListFilter, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CARD_COLUMNS, type AgentKind, type CardColumn } from '@solera/protocol'
import { Menu, MenuCheckboxItem, MenuLabel, cx } from '@solera/ui'
import { AgentIcon } from '../components/AgentIcon'
import { CardTile } from '../components/board/CardTile'
import { COLUMN_DOTS, columnLabel } from '../components/board/columns'
import { useAllCards, useMoveCard } from '../lib/cards'
import { useTranslate } from '../lib/i18n'
import { useProjects } from '../lib/projects'
import type { PortfolioCard } from '../lib/portfolio'

/** Les quatre colonnes du board global : l'abandon est un classement, pas une étape. */
const COLUMNS: readonly CardColumn[] = CARD_COLUMNS.filter((column) => column !== 'abandoned')

/** Les filtres actifs vivent dans l'adresse : un board filtré se partage par lien. */
const PROJECT_PARAM = 'projet'
const AGENT_PARAM = 'agent'

const collisionDetection: CollisionDetection = (args) => {
  const under = pointerWithin(args)
  return under.length > 0 ? under : rectIntersection(args)
}

/**
 * Le **board global** : les cartes de tous les projets, mêlées dans quatre colonnes.
 *
 * Parti retenu le 2026-10-15 contre le board en couloirs (un par projet, écran F9) : on
 * surveille mieux par projet, mais un projet calme y occupe une bande vide et la hauteur
 * double. Ici on travaille par **état** — c'est la question qu'on pose au board global,
 * « qu'est-ce qui est en revue », pas « où en est Tableaux ». Le risque assumé est qu'à
 * trois projets chargés une colonne devienne un patchwork ; la barre de filtres est là
 * pour ça.
 *
 * Deux dimensions de filtre seulement, projet et agent. Des quatre que montre la
 * maquette, *Étiquette* **ne viendra pas** — les étiquettes sont refusées (carte #32,
 * `docs/audits/2026-10-15-champs-de-carte/`) — et *Jalon* arrive avec la carte #36. Le
 * jalon y est une **carte** et non une entité : le filtre listera donc des cartes-jalons
 * du projet, et chacune s'affiche en `#numéro — titre` cliquable.
 *
 * Le glissement change la **colonne** d'une carte et pas son rang : dans une colonne qui
 * mêle cinq projets, le rang n'a plus de sens — la position d'une carte s'entend dans
 * son propre board, et c'est là qu'on la règle.
 *
 * Référence : `docs/audits/2026-10-14-gestion-de-projet/final/pages/`, écran F8.
 */
export function PortfolioBoardPage() {
  const t = useTranslate()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const { data: projects } = useProjects()
  const visible = useMemo(
    () => (projects ?? []).filter((project) => !project.archivedAt),
    [projects],
  )
  const { cards, isPending } = useAllCards(visible)
  const move = useMoveCard()

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
  const [held, setHeld] = useState<PortfolioCard | null>(null)
  /** La colonne visée pendant le geste, pour que la carte s'y voie avant d'être lâchée. */
  const [moved, setMoved] = useState<{ id: string; column: CardColumn } | null>(null)

  const selectedProjects = params.getAll(PROJECT_PARAM)
  const selectedAgents = params.getAll(AGENT_PARAM)

  const toggle = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    const current = next.getAll(key)
    next.delete(key)
    for (const entry of current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]) {
      next.append(key, entry)
    }
    setParams(next, { replace: true })
  }
  const clear = (key: string) => {
    const next = new URLSearchParams(params)
    next.delete(key)
    setParams(next, { replace: true })
  }

  const agents = useMemo(() => {
    const seen = new Set<AgentKind>()
    for (const card of cards) for (const session of card.conversations) seen.add(session.agent)
    return [...seen].sort()
  }, [cards])

  const shown = useMemo(
    () =>
      cards.filter((card) => {
        if (selectedProjects.length > 0 && !selectedProjects.includes(card.projectId)) return false
        if (selectedAgents.length > 0) {
          const theirs = card.conversations.map((session) => session.agent)
          if (!theirs.some((agent) => selectedAgents.includes(agent))) return false
        }
        return card.column !== 'abandoned'
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, selectedProjects.join(','), selectedAgents.join(',')],
  )

  const columnOf = (card: PortfolioCard) =>
    moved?.id === card.id ? moved.column : card.column

  const onDragStart = (event: DragStartEvent) => {
    setHeld(shown.find((card) => card.id === String(event.active.id)) ?? null)
  }
  const onDragEnd = (event: DragEndEvent) => {
    const card = held
    setHeld(null)
    setMoved(null)
    if (!card || !event.over) return
    const overId = String(event.over.id)
    const column = COLUMNS.includes(overId as CardColumn)
      ? (overId as CardColumn)
      : shown.find((entry) => entry.id === overId)?.column
    if (!column || column === card.column) return
    move.mutate({ id: card.id, projectId: card.projectId, column })
  }

  if (isPending && cards.length === 0) return null

  const projectCount = new Set(shown.map((card) => card.projectId)).size

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* La barre de filtres, sous la rangée et au-dessus des colonnes : elle règle le
          board, donc elle lui appartient — la mettre dans la rangée en ferait une vue de
          plus, et dans la bande un réglage qui survivrait à un changement d'onglet. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <ListFilter size={15} className="shrink-0 text-ink-faint" />

        <FilterMenu
          label={t('portfolio.filter.project')}
          empty={t('portfolio.filter.allProjects')}
          selected={selectedProjects.length}
        >
          {visible.map((project) => (
            <MenuCheckboxItem
              key={project.id}
              checked={selectedProjects.includes(project.id)}
              onCheckedChange={() => toggle(PROJECT_PARAM, project.id)}
            >
              {project.name}
            </MenuCheckboxItem>
          ))}
        </FilterMenu>

        <FilterMenu
          label={t('portfolio.filter.agent')}
          empty={t('portfolio.filter.agent')}
          selected={selectedAgents.length}
        >
          {agents.length === 0 ? (
            <MenuLabel>{t('portfolio.filter.noAgent')}</MenuLabel>
          ) : (
            agents.map((agent) => (
              <MenuCheckboxItem
                key={agent}
                checked={selectedAgents.includes(agent)}
                onCheckedChange={() => toggle(AGENT_PARAM, agent)}
              >
                <span className="flex items-center gap-2">
                  <AgentIcon agent={agent} size={13} />
                  {agent}
                </span>
              </MenuCheckboxItem>
            ))
          )}
        </FilterMenu>

        {/* Un filtre actif devient une puce qui se retire d'un clic : c'est le seul
            endroit où l'on voit *ce qui est filtré* sans rouvrir le menu. */}
        {selectedProjects.length > 0 ? (
          <FilterChip
            label={selectedProjects
              .map((id) => visible.find((project) => project.id === id)?.name)
              .filter(Boolean)
              .join(', ')}
            onClear={() => clear(PROJECT_PARAM)}
            clearLabel={t('portfolio.filter.clear')}
          />
        ) : null}
        {selectedAgents.length > 0 ? (
          <FilterChip
            label={selectedAgents.join(', ')}
            onClear={() => clear(AGENT_PARAM)}
            clearLabel={t('portfolio.filter.clear')}
          />
        ) : null}

        <p className="ml-auto shrink-0 text-xs text-ink-faint">
          {t('portfolio.board.count', { cards: shown.length, projects: projectCount })}
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={(event) => {
          if (!held || !event.over) return
          const overId = String(event.over.id)
          const column = COLUMNS.includes(overId as CardColumn)
            ? (overId as CardColumn)
            : shown.find((entry) => entry.id === overId)?.column
          setMoved(column ? { id: held.id, column } : null)
        }}
        onDragEnd={onDragEnd}
        onDragCancel={() => { setHeld(null); setMoved(null) }}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-3 md:p-5">
          {COLUMNS.map((column) => (
            <GlobalColumn
              key={column}
              column={column}
              cards={shown.filter((card) => columnOf(card) === column)}
              onOpen={(card) => navigate(`/p/${card.projectId}/board?carte=${card.number}`)}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {held ? <CardTile card={held} project={held.project} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function FilterMenu({ label, empty, selected, children }: {
  label: string
  empty: string
  selected: number
  children: React.ReactNode
}) {
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          className={cx(
            'flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors',
            selected > 0
              ? 'border-accent/40 bg-accent-wash text-accent'
              : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
          )}
        >
          {selected > 0 ? label : empty}
          <ChevronDown size={13} className="shrink-0" />
        </button>
      }
    >
      {children}
    </Menu>
  )
}

function FilterChip({ label, onClear, clearLabel }: {
  label: string
  onClear: () => void
  clearLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`${clearLabel} : ${label}`}
      className="flex min-h-9 min-w-0 shrink items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-wash px-2.5 text-xs text-accent"
    >
      <span className="min-w-0 truncate">{label}</span>
      <X size={13} className="shrink-0" />
    </button>
  )
}

/**
 * Une colonne du board global.
 *
 * Le fond creusé, la pastille et le compte sont ceux de `BoardPage`, et les tuiles sont
 * les `CardTile` de l'application : un board qui se redessine ici finirait par mentir sur
 * celui qu'on ouvre en cliquant dessus. Seule la pastille de projet s'ajoute, puisque
 * c'est elle qui dit d'où sort chaque carte.
 */
function GlobalColumn({ column, cards, onOpen }: {
  column: CardColumn
  cards: PortfolioCard[]
  onOpen: (card: PortfolioCard) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column })

  return (
    <section
      className="flex h-full max-h-full w-full shrink-0 flex-col rounded-xl border border-line/60 bg-sunken/60 md:w-72 md:min-w-64 md:flex-1"
      aria-label={columnLabel(column)}
    >
      <header className="flex shrink-0 items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <span className={cx('size-2 shrink-0 rounded-full', COLUMN_DOTS[column])} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-soft">
          {columnLabel(column)}
        </h2>
        <span className="rounded-md bg-surface-high px-1.5 py-0.5 text-xs tabular-nums text-ink-faint">
          {cards.length}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={cx(
          'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-md px-2 pb-2 transition-colors',
          isOver && 'bg-accent-wash/40',
        )}
      >
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <CardTile key={card.id} card={card} project={card.project} onOpen={() => onOpen(card)} />
          ))}
        </SortableContext>
      </div>
    </section>
  )
}
