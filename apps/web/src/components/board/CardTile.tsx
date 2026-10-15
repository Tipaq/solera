import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, CheckSquare, Flag, GitBranch, GripVertical, Link2, MessageSquare, Paperclip } from 'lucide-react'
import { parseSubtasks, type CardDto } from '@solera/protocol'
import { daysUntil, formatDay } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'
import { cx } from '@solera/ui'

/** Ce qui tient sous le titre sans transformer la tuile en fiche. */
const EXCERPT_MAX = 120

interface CardTileProps {
  card: CardDto
  selected?: boolean
  /** Rendu dans le calque de glissement : ni tri, ni clic, seulement l'apparence. */
  disabled?: boolean
  overlay?: boolean
  onOpen?: () => void
}

/**
 * Une carte du board.
 *
 * Le corps est un bouton et le glissement a sa poignée, plutôt qu'une tuile qui serait
 * les deux à la fois. Au pointeur, un seuil de déplacement suffirait à distinguer le
 * clic du geste ; au clavier non, la barre d'espace servant aux deux, et une carte
 * qu'on ne peut plus ouvrir sans souris est un recul que l'ergonomie du glissement ne
 * rachète pas.
 */
export function CardTile({ card, selected = false, overlay = false, disabled = false, onOpen }: CardTileProps) {
  const t = useTranslate()
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: overlay || disabled })

  const excerpt = card.description.trim().replace(/\s+/g, ' ')
  const sessions = card.conversations.length
  const links = card.references.length + card.referencedBy.length
  // Le worktree de la dernière session dit dans quelle branche le chantier vit, ce qui
  // est le repère qu'on cherche avant d'en ouvrir une de plus.
  const branch = card.conversations.findLast((session) => session.worktreeName)?.worktreeName
  const agents = [...new Set(card.conversations.map((session) => session.agent))]
  const subtasks = parseSubtasks(card.description)
  const done = subtasks.filter((task) => task.checked).length
  // Une échéance ne colore la tuile que quand il est trop tard ou presque : une date
  // posée pour dans trois semaines est une information, pas une alerte.
  const days = card.dueAt === null ? null : daysUntil(card.dueAt)

  const body = (
    <>
      <div className="flex items-baseline gap-1.5 pr-9 md:pr-5">
        <span className="shrink-0 text-meta font-medium text-ink-faint">#{card.number}</span>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-ink">{card.title}</p>
      </div>

      {excerpt ? (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-faint">
          {excerpt.length > EXCERPT_MAX ? `${excerpt.slice(0, EXCERPT_MAX)}...` : excerpt}
        </p>
      ) : null}

      {card.dueAt !== null || card.milestone || subtasks.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-ink-faint">
          {card.dueAt !== null && days !== null ? (
            <span
              className={cx(
                'inline-flex items-center gap-1',
                days < 0 && 'text-critical',
                days >= 0 && days <= 2 && 'text-caution',
              )}
              title={t('board.card.due')}
            >
              <CalendarDays size={11} />
              {formatDay(card.dueAt)}
            </span>
          ) : null}
          {card.milestone ? (
            <span className="inline-flex min-w-0 items-center gap-1" title={card.milestone.title}>
              <Flag size={11} className="shrink-0" />
              <span className="max-w-28 truncate">{card.milestone.title}</span>
            </span>
          ) : null}
          {subtasks.length > 0 ? (
            <span className="inline-flex items-center gap-1" title={t('board.card.subtasks')}>
              <CheckSquare size={11} />
              {t('board.card.subtasks.count', { done, total: subtasks.length })}
            </span>
          ) : null}
        </div>
      ) : null}

      {sessions > 0 || links > 0 || branch || card.attachmentCount > 0 ? (
        <div className="mt-3 flex flex-wrap border-t border-line/60 pt-2.5 items-center gap-x-2.5 gap-y-1 text-meta text-ink-faint">
          {agents.map((agent) => (
            <AgentIcon key={agent} agent={agent} size={11} />
          ))}
          {sessions > 0 ? (
            <span
              className="inline-flex items-center gap-1"
              title={t('board.card.sessions', { count: sessions })}
            >
              <MessageSquare size={11} />
              {sessions}
            </span>
          ) : null}
          {card.attachmentCount > 0 ? <span className="inline-flex items-center gap-1" title={t('board.files.title')}><Paperclip size={11} />{card.attachmentCount}</span> : null}
          {links > 0 ? (
            <span
              className="inline-flex items-center gap-1"
              title={t('board.card.links', { count: links })}
            >
              <Link2 size={11} />
              {links}
            </span>
          ) : null}
          {branch ? (
            <span className="inline-flex min-w-0 items-center gap-1" title={branch}>
              <GitBranch size={11} className="shrink-0" />
              <span className="max-w-28 truncate font-mono">{branch}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  )

  const skin = cx(
    'surface relative rounded-xl border shadow-sm',
    selected ? 'border-accent' : 'border-line',
  )

  if (overlay) {
    return <div className={cx(skin, 'shadow-float rotate-2 p-2.5')}>{body}</div>
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        skin,
        'group/card transition-colors',
        // Le trou laissé par la carte tenue, le calque en portant l'apparence.
        isDragging ? 'opacity-40' : 'hover:border-line-strong',
      )}
    >
      <button data-card-open={card.id} type="button" onClick={onOpen} className="w-full p-3.5 text-left">
        {body}
      </button>

      {!disabled ? <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('board.card.drag', { number: card.number })}
        className={cx(
          'absolute top-0 right-0 flex size-11 items-center justify-center cursor-grab touch-none rounded text-ink-faint md:top-1.5 md:right-1 md:size-6',
          'opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100',
          // Sans survol au doigt, la poignée doit rester visible ou elle n'existe pas.
          '[@media(hover:none)]:opacity-60',
        )}
      >
        <GripVertical size={14} />
      </button> : null}
    </div>
  )
}
